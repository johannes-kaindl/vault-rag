# MCP-Zugriff-DX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den in 0.13.0 gebauten HTTP-MCP-Server reibungslos von außen anbindbar machen — Multi-Client-Snippets, Token anzeigen/rotieren, Verbindungstest, Tool-Transparenz, geschärfte Start-Fehlerdiagnose.

**Architecture:** Zwei neue pure-core-Module (obsidian-frei, in Node testbar — Muster wie `endpoint_diagnostics.ts`) tragen die gesamte Logik: `client_snippets.ts` (4 Client-Formate) und `mcp_diagnostics.ts` (`classifySelfCheck` + `mapStartError`). Die obsidian-Schicht (`main.ts`-Host-Methoden + `buildMcpSection` in `settings.ts`) verdrahtet sie. Der bestehende Server-Stack (`http_server.ts`/`auth.ts`/`tools.ts`) bleibt unangetastet außer der Start-Fehler-Erfassung.

**Tech Stack:** TypeScript (strict, `noImplicitAny`) · esbuild · vitest + happy-dom · Obsidian Plugin API (`requestUrl`, `Setting`, `DropdownComponent`). Null neue npm-Deps.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **pure-core obsidian-frei** — `client_snippets.ts`/`mcp_diagnostics.ts` importieren nie `obsidian`.
- **Tests:** vitest + happy-dom; kein echter obsidian-Import im Test. Nach jeder Änderung **alle Tests grün**.
- **Loopback-only** — 127.0.0.1, kein neuer Transport, kein LAN/TLS. Servername in allen Snippets: `vault-retrieval`.
- **Commits:** Conventional Commits, deutsche Beschreibung. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Gates:** `npm run lint` == 0, `npm run typecheck` == 0, `npm test` grün — vor jedem Commit einer Task.

---

## File Structure

- **Create** `src/mcp/client_snippets.ts` — `McpClientId`, `McpClient`, `MCP_CLIENTS`, `buildClientSnippet`, `maskToken` (pure).
- **Create** `tests/mcp_client_snippets.test.ts`.
- **Create** `src/mcp/mcp_diagnostics.ts` — `SelfCheckResult`, `classifySelfCheck`, `mapStartError` (pure).
- **Create** `tests/mcp_diagnostics.test.ts`.
- **Modify** `src/main.ts` — Feld `mcpLastStartError`; Methoden `mcpStartError()`, `rotateMcpToken()`, `mcpSelfCheck()`; Start-Fehler-Erfassung in `doStartMcpServer`; `requestUrl`-Import.
- **Modify** `src/settings.ts` — `VaultRagPluginHost` um 3 Methoden erweitern; `buildMcpSection` neu; SettingTab-Felder `showMcpToken`/`mcpClient`.
- **Modify** `styles.css` — `.vault-rag-mcp-snippet`-Regel.

---

## Task 1: Client-Snippets (pure)

**Files:**
- Create: `src/mcp/client_snippets.ts`
- Test: `tests/mcp_client_snippets.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `type McpClientId = "claude-code" | "opencode" | "openclaw" | "generic"`
  - `interface McpClient { id: McpClientId; label: string; hint: string }`
  - `const MCP_CLIENTS: McpClient[]`
  - `function buildClientSnippet(id: McpClientId, ctx: { url: string; token: string }): string`
  - `function maskToken(token: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp_client_snippets.test.ts
import { describe, it, expect } from "vitest";
import { MCP_CLIENTS, buildClientSnippet, maskToken } from "../src/mcp/client_snippets";

const CTX = { url: "http://127.0.0.1:8123/mcp", token: "abcd1234abcd1234" };

describe("MCP_CLIENTS", () => {
  it("listet genau die vier Clients in stabiler Reihenfolge", () => {
    expect(MCP_CLIENTS.map(c => c.id)).toEqual(["claude-code", "opencode", "openclaw", "generic"]);
  });
});

describe("buildClientSnippet", () => {
  it("claude-code: CLI-Einzeiler mit transport http, url und Bearer-Header", () => {
    const s = buildClientSnippet("claude-code", CTX);
    expect(s).toContain("claude mcp add --transport http vault-retrieval");
    expect(s).toContain(CTX.url);
    expect(s).toContain(`Authorization: Bearer ${CTX.token}`);
  });

  it("opencode: gültiges JSON mit type=remote, url, headers", () => {
    const obj = JSON.parse(buildClientSnippet("opencode", CTX));
    expect(obj.mcp["vault-retrieval"]).toMatchObject({
      type: "remote",
      url: CTX.url,
      enabled: true,
      headers: { Authorization: `Bearer ${CTX.token}` },
    });
  });

  it("openclaw: gültiges JSON mit transport=streamable-http unter mcp.servers", () => {
    const obj = JSON.parse(buildClientSnippet("openclaw", CTX));
    expect(obj.mcp.servers["vault-retrieval"]).toMatchObject({
      url: CTX.url,
      transport: "streamable-http",
      headers: { Authorization: `Bearer ${CTX.token}` },
    });
  });

  it("generic: gültiges .mcp.json mit type=http unter mcpServers", () => {
    const obj = JSON.parse(buildClientSnippet("generic", CTX));
    expect(obj.mcpServers["vault-retrieval"]).toMatchObject({
      type: "http",
      url: CTX.url,
      headers: { Authorization: `Bearer ${CTX.token}` },
    });
  });
});

describe("maskToken", () => {
  it("zeigt die ersten 4 Zeichen + Ellipse bei langem Token", () => {
    expect(maskToken("abcd1234abcd1234")).toBe("abcd…");
  });
  it("maskiert kurze/leere Token vollständig", () => {
    expect(maskToken("")).toBe("••••");
    expect(maskToken("ab")).toBe("••••");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp_client_snippets.test.ts`
Expected: FAIL — `Cannot find module '../src/mcp/client_snippets'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/mcp/client_snippets.ts
/** Setup-Snippets für externe MCP-Clients. Rein datengetrieben (URL + Token rein, String raus),
 *  obsidian-frei → in Node testbar. Servername überall "vault-retrieval". */

export type McpClientId = "claude-code" | "opencode" | "openclaw" | "generic";

export interface McpClient { id: McpClientId; label: string; hint: string }

export const MCP_CLIENTS: McpClient[] = [
  { id: "claude-code", label: "Claude Code (CLI)", hint: "claude mcp add …" },
  { id: "opencode", label: "OpenCode (opencode.json)", hint: "mcp-Block" },
  { id: "openclaw", label: "OpenClaw (config)", hint: "mcp.servers-Block" },
  { id: "generic", label: "Generisch (.mcp.json)", hint: "mcpServers-Block" },
];

const SERVER_NAME = "vault-retrieval";

export function buildClientSnippet(id: McpClientId, ctx: { url: string; token: string }): string {
  const auth = `Bearer ${ctx.token}`;
  switch (id) {
    case "claude-code":
      return `claude mcp add --transport http ${SERVER_NAME} ${ctx.url} --header "Authorization: ${auth}"`;
    case "opencode":
      return JSON.stringify({
        mcp: { [SERVER_NAME]: { type: "remote", url: ctx.url, enabled: true, headers: { Authorization: auth } } },
      }, null, 2);
    case "openclaw":
      return JSON.stringify({
        mcp: { servers: { [SERVER_NAME]: { url: ctx.url, transport: "streamable-http", headers: { Authorization: auth } } } },
      }, null, 2);
    case "generic":
      return JSON.stringify({
        mcpServers: { [SERVER_NAME]: { type: "http", url: ctx.url, headers: { Authorization: auth } } },
      }, null, 2);
  }
}

/** Anzeige-Maske: erste 4 Zeichen + Ellipse; kurze/leere Token voll maskiert. */
export function maskToken(token: string): string {
  return token.length >= 5 ? `${token.slice(0, 4)}…` : "••••";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp_client_snippets.test.ts`
Expected: PASS (7 Tests).

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: 0 Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/client_snippets.ts tests/mcp_client_snippets.test.ts
git commit -m "feat(mcp-dx): Client-Setup-Snippets für Claude Code/OpenCode/OpenClaw/generisch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: MCP-Diagnose (pure)

**Files:**
- Create: `src/mcp/mcp_diagnostics.ts`
- Test: `tests/mcp_diagnostics.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `type SelfCheckResult = "ok" | "unauthorized" | "wrong-response" | "unreachable"`
  - `function classifySelfCheck(input: { networkError: boolean; status: number; bodyText: string }): SelfCheckResult`
  - `function mapStartError(e: { code?: string; message?: string }): string`

**Design-Hinweis:** `classifySelfCheck` operiert auf dem **rohen Text-Body**, nicht auf geparster JSON — so erkennt es die JSON-RPC-`result`-Antwort sowohl bei `application/json` als auch bei `text/event-stream` (SSE-Rahmen `data: {…"result"…}`). Das ist der in der Spec markierte Robustheits-Punkt.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp_diagnostics.test.ts
import { describe, it, expect } from "vitest";
import { classifySelfCheck, mapStartError } from "../src/mcp/mcp_diagnostics";

describe("classifySelfCheck", () => {
  it("Netzwerkfehler → unreachable", () => {
    expect(classifySelfCheck({ networkError: true, status: 0, bodyText: "" })).toBe("unreachable");
  });
  it("401 → unauthorized", () => {
    expect(classifySelfCheck({ networkError: false, status: 401, bodyText: "Unauthorized" })).toBe("unauthorized");
  });
  it("200 mit JSON-RPC-result (application/json) → ok", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "vault-retrieval" } } });
    expect(classifySelfCheck({ networkError: false, status: 200, bodyText: body })).toBe("ok");
  });
  it("200 mit SSE-gerahmtem result (text/event-stream) → ok", () => {
    const body = `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}\n\n`;
    expect(classifySelfCheck({ networkError: false, status: 200, bodyText: body })).toBe("ok");
  });
  it("200 aber kein MCP (z.B. HTML) → wrong-response", () => {
    expect(classifySelfCheck({ networkError: false, status: 200, bodyText: "<html>ok</html>" })).toBe("wrong-response");
  });
  it("406/andere Codes → wrong-response", () => {
    expect(classifySelfCheck({ networkError: false, status: 406, bodyText: "Not Acceptable" })).toBe("wrong-response");
  });
});

describe("mapStartError", () => {
  it("EADDRINUSE → 'Port belegt'", () => {
    expect(mapStartError({ code: "EADDRINUSE", message: "listen EADDRINUSE" })).toBe("Port belegt");
  });
  it("sonst → Message durchreichen", () => {
    expect(mapStartError({ message: "boom" })).toBe("boom");
  });
  it("ohne Message → Fallback-Text", () => {
    expect(mapStartError({})).toBe("unbekannter Fehler");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp_diagnostics.test.ts`
Expected: FAIL — `Cannot find module '../src/mcp/mcp_diagnostics'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/mcp/mcp_diagnostics.ts
/** Klartext-Diagnose für den MCP-Server (Verbindungstest + Start-Fehler). Rein, obsidian-frei —
 *  Muster wie endpoint_diagnostics.ts. */

export type SelfCheckResult = "ok" | "unauthorized" | "wrong-response" | "unreachable";

/** Klassifiziert die Antwort des eigenen Loopback-Servers auf einen initialize/tools-list-Call.
 *  Arbeitet auf dem rohen Text-Body → erkennt das JSON-RPC-result in JSON *und* SSE. */
export function classifySelfCheck(input: { networkError: boolean; status: number; bodyText: string }): SelfCheckResult {
  if (input.networkError) return "unreachable";
  if (input.status === 401) return "unauthorized";
  if (input.status === 200 && /"result"\s*:/.test(input.bodyText)) return "ok";
  return "wrong-response";
}

/** Übersetzt einen Server-Start-Fehler in Klartext für die Statuszeile. */
export function mapStartError(e: { code?: string; message?: string }): string {
  if (e.code === "EADDRINUSE") return "Port belegt";
  return e.message ?? "unbekannter Fehler";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp_diagnostics.test.ts`
Expected: PASS (9 Tests).

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: 0 Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp_diagnostics.ts tests/mcp_diagnostics.test.ts
git commit -m "feat(mcp-dx): pure MCP-Diagnose (classifySelfCheck + mapStartError)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Host-Verdrahtung in main.ts

**Files:**
- Modify: `src/main.ts` — Import, Feld, `doStartMcpServer` (Zeilen ~1000-1022), drei neue Methoden nach `mcpServerAddress` (~992).

**Interfaces:**
- Consumes: `mapStartError`, `classifySelfCheck`, `SelfCheckResult` (Task 2); `generateToken` (bereits importiert `./mcp/auth`); `requestUrl` (obsidian).
- Produces (auf der Plugin-Klasse, vom `VaultRagPluginHost` konsumiert):
  - `mcpStartError(): string | null`
  - `rotateMcpToken(): Promise<void>`
  - `mcpSelfCheck(): Promise<SelfCheckResult>`

**Hinweis:** Diese Task ist obsidian-glue (kein Unit-Test — `main.ts` wird nicht headless getestet). Gate = typecheck/lint/build grün + bestehende Tests grün; Laufzeit-Verifikation im GUI-Smoke (Task 5).

- [ ] **Step 1: Import ergänzen**

In `src/main.ts` den obsidian-Import um `requestUrl` erweitern (falls nicht vorhanden) und die Diagnose importieren. Beim vorhandenen `import { generateToken } from "./mcp/auth";` ergänzen:

```ts
import { mapStartError, classifySelfCheck, type SelfCheckResult } from "./mcp/mcp_diagnostics";
```

Sicherstellen, dass `requestUrl` im `from "obsidian"`-Import steht (zu bestehender Liste hinzufügen, falls fehlend).

- [ ] **Step 2: Feld für den letzten Start-Fehler**

Bei den übrigen privaten Feldern der Plugin-Klasse (dort, wo `mcpServer` deklariert ist) ergänzen:

```ts
private mcpLastStartError: string | null = null;
```

- [ ] **Step 3: Start-Fehler in doStartMcpServer erfassen**

In `doStartMcpServer` den `try`/`catch`-Block so anpassen, dass Erfolg den Fehler löscht und der `catch` ihn über `mapStartError` festhält:

```ts
    try {
      const { startMcpServer } = await import("./mcp/http_server");
      const { makeVaultReadGuard } = await import("./mcp/vault_read_guard");
      const host = this.mcpDepsHost();
      const adapter = this.app.vault.adapter;
      if (adapter instanceof FileSystemAdapter) {
        host.readVault = makeVaultReadGuard(adapter.getBasePath(), (p) => adapter.read(p));
      }
      const tools = new McpTools(buildMcpDeps(host));
      this.mcpServer = await startMcpServer({ port: this.settings.mcpPort, token, tools, version: this.manifest.version });
      this.mcpLastStartError = null;
    } catch (e) {
      this.mcpLastStartError = mapStartError(e as { code?: string; message?: string });
      console.warn("vault-rag: MCP-Server-Start fehlgeschlagen", e);
      new Notice(`⚠ MCP-Server konnte nicht starten (${this.mcpLastStartError}): ${String((e as Error).message ?? e)}`, 8000);
      this.mcpServer = null;
    }
```

(Der Symlink-Guard-Kommentarblock aus dem Bestand bleibt erhalten — nur die markierten Zeilen ändern sich.)

- [ ] **Step 4: Drei Host-Methoden ergänzen**

Direkt nach `mcpServerAddress()` (~Zeile 992) einfügen:

```ts
  mcpStartError(): string | null { return this.mcpLastStartError; }

  /** Neuen Token erzeugen, persistieren, Server neu starten. Alte Clients werden ungültig. */
  async rotateMcpToken(): Promise<void> {
    this.settings.mcpToken = generateToken();
    await this.saveSettings();
    await this.restartMcpServer();
  }

  /** Ruft den eigenen Loopback-Server wie ein externer Client (initialize) und klassifiziert. */
  async mcpSelfCheck(): Promise<SelfCheckResult> {
    const url = this.mcpServerAddress();
    if (!url) return "unreachable";
    const body = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vault-retrieval-selfcheck", version: this.manifest.version } },
    });
    try {
      const r = await requestUrl({
        url, method: "POST", throw: false,
        headers: {
          "Authorization": `Bearer ${this.settings.mcpToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body,
      });
      return classifySelfCheck({ networkError: false, status: r.status, bodyText: r.text });
    } catch {
      return classifySelfCheck({ networkError: true, status: 0, bodyText: "" });
    }
  }
```

- [ ] **Step 5: Build + typecheck + bestehende Tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: typecheck/lint 0; alle bestehenden Tests grün (keine neuen — glue).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(mcp-dx): Host-Methoden — Start-Fehler-Erfassung, Token-Rotation, Selbsttest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Settings-Sektion umbauen

**Files:**
- Modify: `src/settings.ts` — `VaultRagPluginHost`-Interface (~Zeile 50-53); SettingTab-Felder; `buildMcpSection` (~788-834); Imports.
- Modify: `styles.css` — Snippet-Regel.

**Interfaces:**
- Consumes: `MCP_CLIENTS`, `buildClientSnippet`, `maskToken`, `McpClientId` (Task 1); `SelfCheckResult` (Task 2); Host-Methoden `mcpStartError`/`rotateMcpToken`/`mcpSelfCheck` (Task 3).
- Produces: nichts (Terminal-Consumer).

**Hinweis:** obsidian-glue (view-layer) — kein Unit-Test, Laufzeit-Verifikation im GUI-Smoke (Task 5).

- [ ] **Step 1: Imports + Interface erweitern**

Oben in `src/settings.ts` ergänzen:

```ts
import { MCP_CLIENTS, buildClientSnippet, maskToken, type McpClientId } from "./mcp/client_snippets";
import type { SelfCheckResult } from "./mcp/mcp_diagnostics";
```

Im `VaultRagPluginHost`-Interface direkt bei den vorhandenen MCP-Methoden ergänzen:

```ts
  mcpStartError(): string | null;
  rotateMcpToken(): Promise<void>;
  mcpSelfCheck(): Promise<SelfCheckResult>;
```

- [ ] **Step 2: SettingTab-Zustandsfelder**

Bei den vorhandenen privaten Feldern der `VaultRagSettingTab`-Klasse (dort, wo `mcpPortRestartTimer`/`lastCaps` stehen) ergänzen:

```ts
  private showMcpToken = false;
  private mcpClient: McpClientId = "claude-code";
```

- [ ] **Step 3: buildMcpSection komplett ersetzen**

Die bestehende `buildMcpSection` (Toggle/Port/Status/Verbinden) durch diese Fassung ersetzen. Toggle + Port bleiben unverändert; ab „Status" neu:

```ts
  private buildMcpSection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("MCP-Server aktivieren")
      .setDesc("Lokaler HTTP-Server, über den externe LLM-Agents (z. B. Claude Code) den Vault durchsuchen. Nur Desktop, nur solange Obsidian läuft. Loopback (127.0.0.1) + Token.")
      .addToggle(t => t.setValue(this.plugin.settings.mcpEnabled).onChange(async (v: boolean) => {
        this.plugin.settings.mcpEnabled = v;
        if (v) this.plugin.ensureMcpToken();
        await this.plugin.saveSettings();
        await this.plugin.restartMcpServer();
        this.display();
      }));

    new Setting(containerEl)
      .setName("Port")
      .setDesc("Loopback-Port des MCP-Servers (Default 8123). Änderung startet den Server neu.")
      .addText(t => t.setPlaceholder("8123").setValue(String(this.plugin.settings.mcpPort))
        .onChange(async (v: string) => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 1 || n > 65535) return;
          this.plugin.settings.mcpPort = n;
          await this.plugin.saveSettings();
          if (this.mcpPortRestartTimer !== null) window.clearTimeout(this.mcpPortRestartTimer);
          this.mcpPortRestartTimer = window.setTimeout(() => {
            this.mcpPortRestartTimer = null;
            void this.plugin.restartMcpServer();
          }, 800);
        }));

    const detail = this.plugin.mcpStartError();
    const status = this.plugin.mcpServerRunning()
      ? `läuft · ${this.plugin.mcpServerAddress() ?? ""}`
      : (this.plugin.settings.mcpEnabled ? `aus — ${detail ?? "Start fehlgeschlagen"}` : "aus");
    new Setting(containerEl).setName("Status").setDesc(status);

    if (!this.plugin.settings.mcpEnabled) return;

    const token = this.plugin.settings.mcpToken;

    new Setting(containerEl)
      .setName("Token")
      .setDesc(this.showMcpToken ? token : maskToken(token))
      .addButton(b => b.setButtonText(this.showMcpToken ? "Verbergen" : "Anzeigen")
        .onClick(() => { this.showMcpToken = !this.showMcpToken; this.display(); }))
      .addButton(b => b.setButtonText("Neu generieren").setWarning()
        .onClick(async () => {
          await this.plugin.rotateMcpToken();
          new Notice("Neuer Token — alte Clients müssen neu verbunden werden");
          this.display();
        }));

    new Setting(containerEl)
      .setName("Verbindung testen")
      .setDesc("Prüft den Server über den Loopback-Endpunkt — wie ein externer Client.")
      .addButton(b => b.setButtonText("Testen")
        .onClick(async () => {
          b.setDisabled(true);
          const res = await this.plugin.mcpSelfCheck();
          b.setDisabled(false);
          const msg = res === "ok" ? "✓ 3 Tools erreichbar"
            : res === "unauthorized" ? "Token stimmt nicht"
            : res === "unreachable" ? "Server nicht erreichbar (aus? Port?)"
            : "Antwort ist kein MCP";
          new Notice(`MCP-Selbsttest: ${msg}`);
        }));

    new Setting(containerEl)
      .setName("Angebotene Tools")
      .setDesc("search · related · read_note — read-only Zugriff auf den Vault-Index.");

    const url = this.plugin.mcpServerAddress() ?? `http://127.0.0.1:${this.plugin.settings.mcpPort}/mcp`;

    new Setting(containerEl)
      .setName("Client-Setup")
      .setDesc("Config für deinen MCP-Client — Client wählen, dann kopieren.")
      .addDropdown(d => {
        for (const c of MCP_CLIENTS) d.addOption(c.id, c.label);
        d.setValue(this.mcpClient);
        d.onChange((v: string) => { this.mcpClient = v as McpClientId; this.display(); });
      })
      .addButton(b => b.setButtonText("Kopieren")
        .onClick(() => {
          void navigator.clipboard.writeText(buildClientSnippet(this.mcpClient, { url, token }));
          new Notice("MCP-Config kopiert");
        }));

    const pre = containerEl.createEl("pre", { cls: "vault-rag-mcp-snippet" });
    pre.setText(buildClientSnippet(this.mcpClient, { url, token: maskToken(token) }));
  }
```

- [ ] **Step 4: CSS-Regel ergänzen**

In `styles.css` anhängen:

```css
.vault-rag-mcp-snippet {
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  background: var(--background-secondary);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  margin: var(--size-4-1) 0 var(--size-4-3);
  user-select: text;
}
```

- [ ] **Step 5: Build + typecheck + lint + Tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: typecheck/lint 0; alle Tests grün.

> **Lint-Wachpunkt:** Falls `eslint-plugin-obsidianmd` `createEl("pre")` über `no-forbidden-elements` beanstandet (die Regel sperrt bekanntermaßen `style`/`script`; `pre` ist üblicherweise erlaubt), Fallback: `containerEl.createDiv({ cls: "vault-rag-mcp-snippet" })` mit `.setText(...)` und `white-space: pre-wrap` im CSS. Verhalten identisch.

- [ ] **Step 6: Build prüfen**

Run: `npm run build`
Expected: `main.js` baut ohne Fehler.

- [ ] **Step 7: Commit**

```bash
git add src/settings.ts styles.css
git commit -m "feat(mcp-dx): Settings — Token reveal/rotate, Verbindungstest, Tool-Liste, Multi-Client-Snippets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Verifikation & GUI-Smoke (finishing)

**Files:** keine (Verifikation).

- [ ] **Step 1: Volle Gates**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: alle Tests grün (Bestand + 16 neue), lint/typecheck 0, `main.js` baut.

- [ ] **Step 2: GUI-Smoke (Johannes, in echtem Obsidian)**

Plugin-Build in den Pallas-Vault deployen, Obsidian neu laden. Prüfen:
1. Settings → MCP-Server: Toggle an → Status „läuft · http://127.0.0.1:8123/mcp".
2. **Token**: „Anzeigen" zeigt Klartext, „Verbergen" maskiert; „Neu generieren" → Notice + Snippet aktualisiert sich.
3. **Verbindung testen** → „✓ 3 Tools erreichbar" (grün). Danach Token in Claude Code absichtlich falsch → Selbsttest bleibt „ok" (nutzt echten Token); Server-Toggle aus → Testen → „nicht erreichbar".
4. **Client-Setup**: Dropdown durch alle vier Clients → Snippet-Vorschau ändert sich (Token maskiert); „Kopieren" → echter Token in der Zwischenablage (in Editor einfügen, prüfen).
5. **Realer Client**: kopiertes Claude-Code-Snippet im Terminal ausführen → `claude mcp list` zeigt `vault-retrieval` verbunden; eine `search`-Abfrage liefert Treffer.
6. **Fehlerdiagnose**: Port auf einen belegten Wert setzen → Status „aus — Port belegt".

- [ ] **Step 3: finishing-a-development-branch**

Nach grünem Smoke: `superpowers:finishing-a-development-branch` (Merge-Optionen). Danach optional Release-Slice.

- [ ] **Step 4: Nebenprodukt — openclaw-Skill-Atom**

Separat (nicht Teil des Merges): Atom unter `/Users/Shared/20_Claude/20_Skills/openclaw/config/` anlegen — „OpenClaw unterstützt `streamable-http`-MCP-Transport mit `headers.Authorization`" (korrigiert den `overview.md`-Cache „stdio-only"). `index.md` updaten.

---

## Self-Review (gegen die Spec)

**Spec coverage:**
- Ziel 1 Multi-Client-Snippets → Task 1 + Task 4 (Dropdown/Kopieren). ✓
- Ziel 2 Token anzeigen+rotieren → Task 3 (`rotateMcpToken`) + Task 4 (reveal/rotate-UI). ✓
- Ziel 3 Verbindung testen → Task 2 (`classifySelfCheck`) + Task 3 (`mcpSelfCheck`) + Task 4 (Knopf). ✓
- Ziel 4 Tool-Transparenz → Task 4 (Zeile „Angebotene Tools"). ✓
- Ziel 5 Start-Fehlerdiagnose → Task 2 (`mapStartError`) + Task 3 (Erfassung) + Task 4 (Status). ✓
- Nicht-Ziele (LAN/TLS/REST/OAuth/neue Tools) → nirgends berührt. ✓
- Verifikationspunkt SSE/`requestUrl` → Task 2 klassifiziert auf Text-Body (SSE-robust) + Task 5 Smoke Punkt 5. ✓

**Placeholder scan:** kein TBD/TODO; alle Code-Steps vollständig. ✓

**Type consistency:** `McpClientId`/`buildClientSnippet`/`maskToken`/`SelfCheckResult`/`classifySelfCheck`/`mapStartError`/`mcpStartError`/`rotateMcpToken`/`mcpSelfCheck` durchgängig gleich benannt in Tasks 1→4. ✓
