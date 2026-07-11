# MCP-Server in-Plugin (HTTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den stdio-MCP-Companion (`src/mcp/`) durch einen in-Plugin `node:http`-MCP-Server (Streamable HTTP) ersetzen, sodass externer LLM-Zugriff echte Plugin-Funktionalität wird und der Obsidian-Community-Review „Pass" (0 Warnings) erreicht.

**Architecture:** Ein einziger `node:http`-Server auf `127.0.0.1`, lazy geladen und per `Platform.isMobile`-Gate desktop-only, bedient eine `/mcp`-Route über `StreamableHTTPServerTransport` (stateless) aus dem schon vorhandenen `@modelcontextprotocol/sdk`. Die transport-freie Tool-Logik (`McpTools`) bleibt, wird aber von Node-Adaptern (`fs`/`fetch`/`data.json`) auf **injizierte Live-Plugin-Objekte** (In-Memory-`VaultIndex`, `embedder`, Obsidian-`VaultAdapter`, `settings`) umgestellt. Read-only, drei Tools (`search`/`related`/`read_note`).

**Tech Stack:** TypeScript (strict), esbuild (CJS-Bundle → `main.js`), vitest + happy-dom/node, `@modelcontextprotocol/sdk` ^1.29, zod ^4, `node:http` (desktop-only, lazy).

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen. `moduleResolution: bundler`, `target ES2020`, `module ESNext`.
- **Plugin-obsidian-Grenze:** Nur `main.ts`/`hub_view.ts`/`settings.ts`/`http.ts` dürfen `obsidian` importieren. Der neue Server-Code läuft im Plugin, darf aber `obsidian` nur für `Platform` (Gate) nutzen; die Tool-Logik (`tools.ts`) bleibt **obsidian-frei UND node-builtin-frei** (reine Deps-Injection).
- **`@modelcontextprotocol/sdk` + `zod` bleiben `devDependencies`** — esbuild bündelt sie in `main.js` (`external: ["obsidian","electron"]`). „Null-Runtime-Deps" bleibt.
- **Server-Sicherheit:** Bind ausschließlich `127.0.0.1`; Bearer-Token erzwungen auch auf `/mcp`; CORS nur Loopback-Origins.
- **Bestätigte Defaults:** `mcpEnabled=false`, `mcpPort=8123`, `mcpToken` beim Aktivieren auto-generiert.
- **Tests:** vitest, Obsidian-Mock unter `tests/__mocks__/obsidian.ts` (Alias in `vitest.config.ts`). MCP-Server-Tests laufen mit `// @vitest-environment node`. Nach jeder Änderung **alle Tests grün**, `lint`/`typecheck` 0.
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer bei substanziellem AI-Beitrag: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Referenz-Spec:** `docs/superpowers/specs/2026-07-11-mcp-in-plugin-http-server-design.md`.

---

## File Structure

**Neu:**
- `src/mcp/mcp_deps.ts` — `McpDeps`-Interface (die Live-Plugin-Anschlüsse, die `McpTools` konsumiert).
- `src/mcp/auth.ts` — `generateToken()` + `isAuthorized(header, token)` (reine Funktionen, node-frei).
- `src/mcp/register_tools.ts` — `registerTools(server, tools)`: Tool-Registrierung (aus altem `server.ts` extrahiert), transport-agnostisch.
- `src/mcp/http_server.ts` — `startMcpServer(opts)`: `node:http`-Server + `/mcp`-Route + `StreamableHTTPServerTransport` + Auth. Einziger `node:http`-Nutzer (lazy `require`, `eslint-disable` mit Begründung).

**Geändert:**
- `src/mcp/tools.ts` — `McpTools` von `(cfg: McpConfig, io: ToolIo)` auf `(deps: McpDeps)` umgebaut; `resolveNotePath` node-`path`-frei; `currentIndex()`→`deps.getIndex()`; `ensureEndpoint`/`ToolIo` entfallen.
- `src/settings_core.ts` — 3 neue Settings-Felder + Defaults.
- `src/settings.ts` — neue Sektion „MCP-Server"; `VaultRagPluginHost` um MCP-Methoden erweitern.
- `src/main.ts` — Server-Lifecycle (Start-Gate, `McpDeps`-Factory, Stop via `register`/`onunload`), Plugin-Methoden für die Settings-UI.
- `esbuild.config.mjs` — MCP-Target entfernen; `external` um node-builtins erweitern.
- `eslint.config.mjs` — `src/mcp/**`-Override entfernen (Code ist jetzt Plugin-Code).
- `tests/__mocks__/obsidian.ts` — `Platform` + `Setting`-Methoden (`setHeading`/`addToggle`/`addButton`) ergänzen.
- `tests/mcp_tools.test.ts` — auf `McpDeps`-Injection migrieren.
- `.gitignore`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `../REGISTRY.md` — `mcp-server.js`-/stdio-Referenzen → HTTP-in-Plugin.

**Gelöscht:**
- `src/mcp/node_adapter.ts`, `src/mcp/node_embed.ts`, `src/mcp/config.ts`, `src/mcp/server.ts`.
- `tests/mcp_node_adapter.test.ts`, `tests/mcp_node_embed.test.ts`, `tests/mcp_config.test.ts`.

---

## Task 1: Settings-Felder für den MCP-Server

**Files:**
- Modify: `src/settings_core.ts:14-40` (Interface), `src/settings_core.ts:46-72` (Defaults)
- Test: `tests/settings_core.mcp.test.ts` (neu)

**Interfaces:**
- Produces: `VaultRagSettings` erhält `mcpEnabled: boolean`, `mcpPort: number`, `mcpToken: string`. `DEFAULT_SETTINGS` setzt `false` / `8123` / `""`.

- [ ] **Step 1: Failing test**

Create `tests/settings_core.mcp.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings_core";

describe("MCP settings defaults", () => {
  it("Server ist per Default aus, Port 8123, Token leer", () => {
    expect(DEFAULT_SETTINGS.mcpEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.mcpPort).toBe(8123);
    expect(DEFAULT_SETTINGS.mcpToken).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings_core.mcp.test.ts`
Expected: FAIL — TS-Fehler „Property 'mcpEnabled' does not exist" bzw. `undefined`.

- [ ] **Step 3: Implement**

In `src/settings_core.ts` im Interface `VaultRagSettings` (nach `smartApplyDefaultMode: ApplyMode;`, Zeile 39) ergänzen:
```ts
  mcpEnabled: boolean;
  mcpPort: number;
  mcpToken: string;
```
In `DEFAULT_SETTINGS` (nach `smartApplyDefaultMode: "deterministisch",`, Zeile 71) ergänzen:
```ts
  mcpEnabled: false,
  mcpPort: 8123,
  mcpToken: "",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings_core.mcp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/settings_core.ts tests/settings_core.mcp.test.ts
git commit -m "feat(mcp): Settings-Felder mcpEnabled/mcpPort/mcpToken

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Auth-Helfer (Token-Generierung + Bearer-Check)

**Files:**
- Create: `src/mcp/auth.ts`
- Test: `tests/mcp_auth.test.ts` (neu)

**Interfaces:**
- Produces: `generateToken(): string` (32 hex-Zeichen), `isAuthorized(authHeader: string | undefined, token: string): boolean`.
- Consumes: nichts. Reine Funktionen, node-builtin-frei (nutzt `globalThis.crypto.getRandomValues`, in Electron-Renderer + Node 18+ vorhanden).

- [ ] **Step 1: Failing test**

Create `tests/mcp_auth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateToken, isAuthorized } from "../src/mcp/auth";

describe("mcp auth", () => {
  it("generateToken liefert 32 hex-Zeichen, jeweils verschieden", () => {
    const a = generateToken(), b = generateToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
  it("leerer Server-Token → alles erlaubt (kein Auth erzwungen)", () => {
    expect(isAuthorized(undefined, "")).toBe(true);
    expect(isAuthorized("Bearer x", "")).toBe(true);
  });
  it("gesetzter Token → nur exakter Bearer erlaubt", () => {
    expect(isAuthorized("Bearer geheim", "geheim")).toBe(true);
    expect(isAuthorized("Bearer falsch", "geheim")).toBe(false);
    expect(isAuthorized(undefined, "geheim")).toBe(false);
    expect(isAuthorized("geheim", "geheim")).toBe(false); // ohne "Bearer "-Präfix
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp_auth.test.ts`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Implement**

Create `src/mcp/auth.ts`:
```ts
/** Auth-Helfer für den in-Plugin MCP-HTTP-Server. Reine Funktionen, kein node:-Builtin
 *  (crypto.getRandomValues ist in Electron-Renderer und Node 18+ global verfügbar). */

/** 128-bit Zufallstoken als 32 Hex-Zeichen. */
export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/** true, wenn der Request autorisiert ist. Leerer Server-Token = Auth aus (alles erlaubt).
 *  Sonst muss der Header exakt "Bearer <token>" sein. */
export function isAuthorized(authHeader: string | undefined, token: string): boolean {
  if (!token) return true;
  return authHeader === `Bearer ${token}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp_auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/auth.ts tests/mcp_auth.test.ts
git commit -m "feat(mcp): Auth-Helfer (Token-Generierung + Bearer-Check)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `McpTools` auf `McpDeps`-Injection umbauen

**Files:**
- Create: `src/mcp/mcp_deps.ts`
- Modify: `src/mcp/tools.ts` (komplett-Refactor, siehe unten)
- Test: `tests/mcp_tools.test.ts` (Rewrite)

**Interfaces:**
- Produces: `McpDeps` (Interface), `McpTools` mit Konstruktor `(deps: McpDeps)` und unveränderten Methoden `search(a)`, `related(a)`, `readNote(a)` sowie exportierter `resolveNotePath(rel, exclude): string` (jetzt **vault-relativ**, ohne `vaultRoot`). `HitList`-Typ bleibt.
- Consumes: `VaultIndex` (`src/index.ts`), `Retriever`/`Hit` (`src/retriever.ts`).

**Kontext (warum):** Die alte `McpTools` hing an `McpConfig` (data.json von Platte), `NodeVaultAdapter` (node:fs) und `ToolIo` (node-fetch + Endpoint-Fallback). Im Plugin liefert alles das die Live-Umgebung: der In-Memory-`VaultIndex`, der schon endpoint-aufgelöste `embedder` und der Obsidian-`VaultAdapter`. Der Endpoint-Fallback (`ensureEndpoint`) entfällt — das Plugin verdrahtet `embedder` bereits auf einen erreichbaren Endpoint (`resolveAndReconnectEmbedder`); `deps.embedQuery` kapselt „ready-check + embed + toIndexVector".

- [ ] **Step 1: Failing test — neue `tests/mcp_tools.test.ts` schreiben**

Ersetze `tests/mcp_tools.test.ts` vollständig (der alte Inhalt mit `loadConfig`/temp-Vault/`ToolIo` wird obsolet):
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VaultIndex, IndexManifest } from "../src/index";
import { McpTools, resolveNotePath } from "../src/mcp/tools";
import type { McpDeps } from "../src/mcp/mcp_deps";

const DIM = 4;
function idx(entries: [string, number[]][]): VaultIndex {
  const manifest: IndexManifest = { schema_version: 1, embedding_model: "m", index_dim: DIM, scale: 127, count: entries.length, granularity: "note", quant: "int8" };
  const paths = entries.map(e => e[0]);
  const vecs = new Float32Array(entries.length * DIM);
  entries.forEach(([, v], r) => { const n = Math.hypot(...v) || 1; v.forEach((x, c) => vecs[r * DIM + c] = x / n); });
  return new VaultIndex(manifest, paths, vecs);
}

function deps(over: Partial<McpDeps> = {}): McpDeps {
  const index = idx([["a.md", [1, 0, 0, 0]], ["fast-a.md", [0.9, 0.1, 0, 0]], ["weit.md", [0, 0, 1, 0]]]);
  return {
    getIndex: () => index,
    embedQuery: async () => new Float32Array([1, 0, 0, 0]),
    readNote: async (p) => `# Inhalt von ${p}`,
    settings: () => ({ k: 20, minSim: 0.5, exclude: ["Templates/"] }),
    ...over,
  };
}

describe("resolveNotePath (vault-relativ)", () => {
  it("gibt normalisierten Pfad zurück, wirft bei Traversal/Nicht-md/Ausschluss", () => {
    expect(resolveNotePath("Ordner/Notiz.md", [])).toBe("Ordner/Notiz.md");
    expect(() => resolveNotePath("../x.md", [])).toThrow();
    expect(() => resolveNotePath("x.txt", [])).toThrow();
    expect(() => resolveNotePath("templates/x.md", ["Templates/"])).toThrow(); // case-insensitiv
    expect(() => resolveNotePath("/abs.md", [])).toThrow();
  });
});

describe("McpTools", () => {
  it("related liefert die nächste Notiz", async () => {
    const t = new McpTools(deps());
    const r = await t.related({ path: "a.md", min_similarity: 0.5 });
    expect(r.hits.map(h => h.path)).toEqual(["fast-a.md"]);
  });
  it("related wirft für nicht-indizierte Notiz", async () => {
    const t = new McpTools(deps());
    await expect(t.related({ path: "fehlt.md" })).rejects.toThrow();
  });
  it("search embeddet die Query und rankt", async () => {
    const t = new McpTools(deps());
    const r = await t.search({ query: "egal", min_similarity: 0.5 });
    expect(r.hits[0].path).toBe("a.md");
  });
  it("readNote respektiert den Pfad-Guard und liest via deps", async () => {
    const t = new McpTools(deps());
    expect(await t.readNote({ path: "a.md" })).toEqual({ path: "a.md", content: "# Inhalt von a.md" });
    await expect(t.readNote({ path: "Templates/x.md" })).rejects.toThrow();
  });
  it("wirft wenn kein Index geladen ist", async () => {
    const t = new McpTools(deps({ getIndex: () => null }));
    await expect(t.search({ query: "x" })).rejects.toThrow(/Index/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp_tools.test.ts`
Expected: FAIL — `src/mcp/mcp_deps` fehlt, `McpTools`-Konstruktor-Signatur passt nicht, `resolveNotePath`-Arity.

- [ ] **Step 3a: `src/mcp/mcp_deps.ts` anlegen**

```ts
import type { VaultIndex } from "../index";

/** Die Live-Plugin-Anschlüsse, die McpTools konsumiert — vom Plugin (main.ts) injiziert.
 *  Ersetzt die alten Node-Adapter (data.json/fs/fetch): der Server läuft in Obsidian und
 *  nutzt den In-Memory-Index, den schon endpoint-aufgelösten Embedder und den VaultAdapter. */
export interface McpDeps {
  /** Der aktuell im Plugin geladene Index (oder null im Gefahrenzustand / vor dem ersten Build). */
  getIndex(): VaultIndex | null;
  /** Query-Text → Vektor im Index-Raum (ready-check + embed + toIndexVector; wirft bei offline). */
  embedQuery(text: string, dim: number): Promise<Float32Array>;
  /** Volltext einer bereits als sicher validierten, vault-relativen .md-Notiz (via VaultAdapter). */
  readNote(relPath: string): Promise<string>;
  /** Retrieval-Parameter aus den Plugin-Settings. */
  settings(): { k: number; minSim: number; exclude: string[] };
}
```

- [ ] **Step 3b: `src/mcp/tools.ts` ersetzen**

```ts
import { VaultIndex } from "../index";
import { Retriever, Hit } from "../retriever";
import type { McpDeps } from "./mcp_deps";

export interface HitList { hits: { path: string; score: number }[] }

/** Path-Guard für read_note: vault-relativ, kein Traversal, nur .md, exclude-Präfix (case-insensitiv).
 *  Gibt den normalisierten vault-relativen Pfad zurück (der VaultAdapter liest vault-relativ) —
 *  kein node:path nötig, reine String-Logik. Was vom Index ausgeschlossen ist, gibt der Server
 *  auch nicht als Volltext heraus. */
export function resolveNotePath(rel: string, exclude: string[]): string {
  if (rel.startsWith("/")) throw new Error(`Nur vault-relative Pfade erlaubt: "${rel}"`);
  // Segmente normalisieren, "."/leere entfernen, ".." verbieten.
  const parts = rel.split(/[\\/]/).filter(s => s !== "" && s !== ".");
  if (parts.some(s => s === "..")) throw new Error(`Pfad verlässt den Vault: "${rel}"`);
  const norm = parts.join("/");
  if (!norm.toLowerCase().endsWith(".md")) throw new Error(`Nur Markdown-Notizen (.md) lesbar: "${rel}"`);
  const normLower = norm.toLowerCase();
  const hit = exclude.find(e => e && normLower.startsWith(e.toLowerCase()));
  if (hit) throw new Error(`Pfad liegt unter Ausschluss-Präfix "${hit}": "${rel}"`);
  return norm;
}

/** Transport-freie Tool-Handler des MCP-Servers — register_tools.ts ist die SDK-Schale. */
export class McpTools {
  constructor(private deps: McpDeps) {}

  private requireIndex(): VaultIndex {
    const index = this.deps.getIndex();
    if (!index) throw new Error("Kein Index geladen — im Plugin (neu) indizieren oder aus Backup wiederherstellen.");
    return index;
  }

  private opts(k: number | undefined, minSim: number | undefined) {
    const s = this.deps.settings();
    return { k: k ?? s.k, minSim: minSim ?? s.minSim, exclude: s.exclude };
  }

  private static toHitList(hits: Hit[]): HitList {
    return { hits: hits.map(h => ({ path: h.path, score: Math.round(h.score * 1000) / 1000 })) };
  }

  async search(a: { query: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const index = this.requireIndex();
    const vec = await this.deps.embedQuery(a.query, index.dim);
    return McpTools.toHitList(new Retriever(index).search(vec, this.opts(a.k, a.min_similarity)));
  }

  async related(a: { path: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const index = this.requireIndex();
    if (index.rowFor(a.path) < 0) {
      throw new Error(`Notiz nicht im Index: "${a.path}" — nicht indexiert (exclude-Regel?) oder noch nicht embedded.`);
    }
    return McpTools.toHitList(new Retriever(index).related(a.path, this.opts(a.k, a.min_similarity)));
  }

  async readNote(a: { path: string }): Promise<{ path: string; content: string }> {
    const rel = resolveNotePath(a.path, this.deps.settings().exclude);
    try {
      return { path: a.path, content: await this.deps.readNote(rel) };
    } catch {
      throw new Error(`Notiz nicht gefunden: "${a.path}"`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp_tools.test.ts`
Expected: PASS (alle 6)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp_deps.ts src/mcp/tools.ts tests/mcp_tools.test.ts
git commit -m "refactor(mcp): McpTools auf McpDeps-Injection statt Node-Adapter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Tool-Registrierung + HTTP-MCP-Server

**Files:**
- Create: `src/mcp/register_tools.ts`, `src/mcp/http_server.ts`
- Test: `tests/mcp_http_server.integration.test.ts` (neu)

**Interfaces:**
- Consumes: `McpTools` (Task 3), `isAuthorized` (Task 2).
- Produces: `registerTools(server: McpServer, tools: McpTools): void`; `startMcpServer(opts: { port: number; token: string; tools: McpTools; version: string }): Promise<McpServerHandle>` mit `McpServerHandle = { port: number; close(): Promise<void> }`.

**Kontext (SDK-Muster):** Stateless Streamable HTTP: pro POST `/mcp` ein **frischer** `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`; `server.connect(transport)`, dann `transport.handleRequest(req, res, parsedBody)`. Body wird aus dem `node:http`-Stream gesammelt und JSON-geparst. `node:http` wird **lazy** (`require`) und nur hier importiert.

- [ ] **Step 1: Failing test (Integration, echter Loopback-Port)**

Create `tests/mcp_http_server.integration.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { VaultIndex, IndexManifest } from "../src/index";
import { McpTools } from "../src/mcp/tools";
import type { McpDeps } from "../src/mcp/mcp_deps";
import { startMcpServer } from "../src/mcp/http_server";

const DIM = 4;
function index(): VaultIndex {
  const m: IndexManifest = { schema_version: 1, embedding_model: "x", index_dim: DIM, scale: 127, count: 2, granularity: "note", quant: "int8" };
  const v = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0]);
  return new VaultIndex(m, ["a.md", "b.md"], v);
}
const deps: McpDeps = {
  getIndex: () => index(),
  embedQuery: async () => new Float32Array([1, 0, 0, 0]),
  readNote: async (p) => `# ${p}`,
  settings: () => ({ k: 20, minSim: 0, exclude: [] }),
};

let handle: { close(): Promise<void>; port: number } | null = null;
afterEach(async () => { await handle?.close(); handle = null; });

// Ein MCP-initialize + tools/call in EINEM stateless POST-Muster.
async function mcpCall(port: number, token: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

describe("MCP HTTP-Server", () => {
  it("bindet auf 127.0.0.1 und liefert den Port", async () => {
    handle = await startMcpServer({ port: 0, token: "", tools: new McpTools(deps), version: "9.9.9" });
    expect(handle.port).toBeGreaterThan(0);
  });

  it("401 ohne/falschen Token wenn Token gesetzt", async () => {
    handle = await startMcpServer({ port: 0, token: "geheim", tools: new McpTools(deps), version: "9.9.9" });
    const r = await mcpCall(handle.port, "", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(r.status).toBe(401);
  });

  it("initialize antwortet mit dem Server-Namen bei gültigem Token", async () => {
    handle = await startMcpServer({ port: 0, token: "geheim", tools: new McpTools(deps), version: "9.9.9" });
    const r = await mcpCall(handle.port, "geheim", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(r.status).toBe(200);
    expect(r.text).toContain("vault-retrieval");
  });
});
```

> **Hinweis für den Implementer:** Der `tools/call`-Roundtrip über einen stateless Transport kann je nach SDK-Version einen initialisierten Session-State verlangen. Falls ein voller `initialize`→`tools/call`-Durchlauf in einem Test zu aufwändig ist, genügen die drei obigen Fälle (Bind, 401, initialize-200) als Server-Vertrag; der echte `search`-Roundtrip wird im manuellen Smoke (Task 10-Verifikation) über Claude Code geprüft. **Verifiziere die genauen SDK-Signaturen gegen `node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts`.**

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp_http_server.integration.test.ts`
Expected: FAIL — `src/mcp/http_server` fehlt.

- [ ] **Step 3a: `src/mcp/register_tools.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { McpTools } from "./tools";

type ToolOut = { content: { type: "text"; text: string }[]; isError?: boolean };
const wrap = <A>(fn: (args: A) => Promise<unknown>) => async (args: A): Promise<ToolOut> => {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(args)) }] };
  } catch (e) {
    return { content: [{ type: "text", text: String((e as Error).message ?? e) }], isError: true };
  }
};

const kSchema = z.number().int().positive().optional().describe("Max. Trefferzahl (Default: Plugin-Setting)");
const minSimSchema = z.number().min(0).max(1).optional().describe("Mindest-Ähnlichkeit 0..1 (Default: Plugin-Setting)");

/** Registriert die drei read-only Tools auf einem McpServer — transport-agnostisch. */
export function registerTools(server: McpServer, tools: McpTools): void {
  server.registerTool("search", {
    description: "Semantische Suche über den Obsidian-Vault (Embedding-Index des vault-retrieval-Plugins). Liefert {path, score}-Treffer; Volltext danach via read_note.",
    inputSchema: { query: z.string().describe("Suchanfrage (natürliche Sprache)"), k: kSchema, min_similarity: minSimSchema },
  }, wrap(a => tools.search(a)));

  server.registerTool("related", {
    description: "Inhaltlich verwandte Notizen zu einer gegebenen Notiz (offline, direkt aus dem Index).",
    inputSchema: { path: z.string().describe("Vault-relativer Notiz-Pfad, z. B. 'Ordner/Notiz.md'"), k: kSchema, min_similarity: minSimSchema },
  }, wrap(a => tools.related(a)));

  server.registerTool("read_note", {
    description: "Volltext einer Notiz aus dem Vault lesen (nur .md, exclude-Regeln respektiert).",
    inputSchema: { path: z.string().describe("Vault-relativer Notiz-Pfad") },
  }, wrap(a => tools.readNote(a)));
}
```

- [ ] **Step 3b: `src/mcp/http_server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpTools } from "./tools";
import { registerTools } from "./register_tools";
import { isAuthorized } from "./auth";

export interface McpServerHandle { port: number; close(): Promise<void>; }

const BIND_HOST = "127.0.0.1";

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e as Error); }
    });
    req.on("error", reject);
  });
}

/** Ein frischer McpServer + stateless Transport pro Request (kein Session-State). */
async function handleMcp(req: IncomingMessage, res: ServerResponse, tools: McpTools, version: string): Promise<void> {
  const server = new McpServer({ name: "vault-retrieval", version });
  registerTools(server, tools);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  const body = await readBody(req);
  await transport.handleRequest(req, res, body);
}

/** Startet den in-Plugin HTTP-MCP-Server auf 127.0.0.1. Lazy require("node:http"),
 *  damit auf Mobile (wo der Start gegated ist) nie ein Node-Builtin geladen wird. */
export async function startMcpServer(opts: { port: number; token: string; tools: McpTools; version: string }): Promise<McpServerHandle> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- desktop-only, lazy: node:http nie auf Mobile laden
  const http = require("node:http") as typeof import("node:http");
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const url = req.url ?? "";
        if (!url.startsWith("/mcp")) { res.writeHead(404).end("Not Found"); return; }
        if (!isAuthorized(req.headers["authorization"], opts.token)) {
          res.writeHead(401, { "Content-Type": "text/plain" }).end("Unauthorized");
          return;
        }
        if (req.method !== "POST") { res.writeHead(405).end("Method Not Allowed"); return; }
        await handleMcp(req, res, opts.tools, opts.version);
      } catch (e) {
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`MCP-Server-Fehler: ${String((e as Error).message ?? e)}`);
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, BIND_HOST, () => { server.off("error", reject); resolve(); });
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

> **Implementer-Hinweis:** `esModuleInterop`/`isolatedModules` sind an. Falls `require("node:http")` unter `moduleResolution: bundler` einen TS-Typfehler wirft, `import type { IncomingMessage, ServerResponse }` genügt für die Typen; das `require` bleibt runtime-lazy. esbuild lässt `require("node:http")` stehen (node-builtin external, Task 8). Prüfe die `StreamableHTTPServerTransport`-Option (`sessionIdGenerator: undefined` = stateless) gegen die installierte SDK-Version.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp_http_server.integration.test.ts`
Expected: PASS. Falls der SDK-Handshake abweicht, Test gemäß Step-1-Hinweis auf Bind/401/initialize eingrenzen; Server-Code muss die drei Verträge erfüllen.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/register_tools.ts src/mcp/http_server.ts tests/mcp_http_server.integration.test.ts
git commit -m "feat(mcp): HTTP-MCP-Server (node:http + StreamableHTTPServerTransport, Loopback+Auth)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Obsidian-Mock um `Platform` + Setting-Methoden erweitern

**Files:**
- Modify: `tests/__mocks__/obsidian.ts`
- Test: `tests/obsidian_mock.smoke.test.ts` (neu, winzig)

**Interfaces:**
- Produces: `Platform` (Objekt `{ isMobile: boolean; isDesktop: boolean }`, Default desktop) im Mock; `Setting` erhält `setHeading()`, `addToggle(cb)`, `addButton(cb)` (fluent, `this`).
- Consumes: nichts.

**Kontext:** `main.ts` (Task 6) importiert `Platform` aus `obsidian`; die Settings-Sektion (Task 7) nutzt `addToggle`/`setHeading`/`addButton`. Der Mock kennt beides bisher nicht.

- [ ] **Step 1: Failing test**

Create `tests/obsidian_mock.smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Platform, Setting } from "obsidian";

describe("obsidian mock erweitert", () => {
  it("Platform hat isMobile/isDesktop (Default desktop)", () => {
    expect(Platform.isMobile).toBe(false);
    expect(Platform.isDesktop).toBe(true);
  });
  it("Setting ist fluent mit setHeading/addToggle/addButton", () => {
    const s = new Setting({} as unknown as HTMLElement);
    expect(s.setHeading()).toBe(s);
    expect(s.addToggle(() => {})).toBe(s);
    expect(s.addButton(() => {})).toBe(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian_mock.smoke.test.ts`
Expected: FAIL — `Platform` undefined bzw. Methoden fehlen.

- [ ] **Step 3: Implement**

In `tests/__mocks__/obsidian.ts`:
- `Platform` exportieren:
```ts
export const Platform = { isMobile: false, isDesktop: true };
```
- Im `Setting`-Mock die fehlenden fluent-Methoden ergänzen. Muster wie bestehende (`setName`/`setDesc` geben `this` zurück). Ergänze — und rufe die Callbacks mit fluent-Komponenten-Stubs auf:
```ts
setHeading() { return this; }
addToggle(cb: (t: unknown) => void) { cb({ setValue: () => this, onChange: () => this, setDisabled: () => this }); return this; }
addButton(cb: (b: unknown) => void) { cb({ setButtonText: () => this, setCta: () => this, onClick: () => this, setDisabled: () => this }); return this; }
```
> Falls die vorhandenen Toggle-/Button-Komponenten-Stubs anderer Tests kollidieren, nutze eigenständige Stub-Objekte, deren Methoden `this` (den Stub) zurückgeben. Wichtig ist nur, dass `new Setting(...).addToggle(cb)` nicht wirft und `cb` eine Komponente mit `setValue().onChange()` bekommt.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/obsidian_mock.smoke.test.ts`
Expected: PASS. Danach die volle Suite, um keine Regression im Mock zu verursachen: `npm test`
Expected: alle grün.

- [ ] **Step 5: Commit**

```bash
git add tests/__mocks__/obsidian.ts tests/obsidian_mock.smoke.test.ts
git commit -m "test(mcp): Obsidian-Mock um Platform + Setting-Methoden erweitert

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Server-Lifecycle in `main.ts` verdrahten

**Files:**
- Modify: `src/main.ts` (Import, Felder, onload-Aufruf, neue Methoden, Cleanup)
- Test: `tests/main_mcp_deps.test.ts` (neu — testet die reine Deps-Factory)

**Interfaces:**
- Consumes: `startMcpServer`/`McpServerHandle` (Task 4), `McpTools` (Task 3), `McpDeps` (Task 3), `generateToken` (Task 2), `Platform` (obsidian).
- Produces (public, für Settings-UI Task 7): `mcpServerRunning(): boolean`, `mcpServerAddress(): string | null` (z. B. `http://127.0.0.1:8123/mcp`), `restartMcpServer(): Promise<void>`, `ensureMcpToken(): string` (generiert+speichert Token falls leer). Neue reine Funktion `buildMcpDeps(plugin)` (exportiert für Test).

**Kontext:** `main.ts` hat aktuell **kein `onunload`**; Cleanup läuft über `this.register(...)`. Der Server wird nach `resolveAndReconnectEmbedder()` gestartet (embedder muss verdrahtet sein). Mobile-Gate + dynamischer Import halten `node:http` von Mobile fern.

- [ ] **Step 1: Failing test (Deps-Factory rein)**

Create `tests/main_mcp_deps.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VaultIndex, IndexManifest } from "../src/index";
import { buildMcpDeps, type McpDepsHost } from "../src/main";

function idx(): VaultIndex {
  const m: IndexManifest = { schema_version: 1, embedding_model: "x", index_dim: 4, scale: 127, count: 1, granularity: "note", quant: "int8" };
  return new VaultIndex(m, ["a.md"], new Float32Array([1, 0, 0, 0]));
}

describe("buildMcpDeps", () => {
  it("liefert Index/Settings/read/embed aus dem Host", async () => {
    const host: McpDepsHost = {
      getIndex: () => idx(),
      embedderReady: async () => true,
      embed: async () => [new Float32Array([1, 0, 0, 0])],
      readVault: async (p) => `# ${p}`,
      settings: { k: 5, minSim: 0.2, exclude: ["Templates/"] },
    };
    const deps = buildMcpDeps(host);
    expect(deps.getIndex()?.count).toBe(1);
    expect(deps.settings()).toEqual({ k: 5, minSim: 0.2, exclude: ["Templates/"] });
    expect(await deps.readNote("a.md")).toBe("# a.md");
    const v = await deps.embedQuery("q", 4);
    expect(v.length).toBe(4);
  });
  it("embedQuery wirft wenn Embedder offline", async () => {
    const host: McpDepsHost = {
      getIndex: () => idx(), embedderReady: async () => false,
      embed: async () => [], readVault: async () => "", settings: { k: 5, minSim: 0, exclude: [] },
    };
    await expect(buildMcpDeps(host).embedQuery("q", 4)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main_mcp_deps.test.ts`
Expected: FAIL — `buildMcpDeps`/`McpDepsHost` nicht exportiert.

- [ ] **Step 3a: Imports + `buildMcpDeps` in `src/main.ts`**

Oben bei den Imports ergänzen:
```ts
import { Plugin, WorkspaceLeaf, TFile, TAbstractFile, Notice, Platform } from "obsidian";
```
(`Platform` an die bestehende `obsidian`-Import-Zeile 1 anhängen.)

Und:
```ts
import type { McpDeps } from "./mcp/mcp_deps";
import { McpTools } from "./mcp/tools";
import { generateToken } from "./mcp/auth";
import type { McpServerHandle } from "./mcp/http_server";
```

Vor der Klasse (Datei-Ebene) die reine Factory + ihren Host-Typ:
```ts
/** Entkoppelter Host-Vertrag für buildMcpDeps — erlaubt Unit-Test ohne echtes Plugin. */
export interface McpDepsHost {
  getIndex(): VaultIndex | null;
  embedderReady(): Promise<boolean>;
  embed(text: string): Promise<Float32Array[]>;
  readVault(relPath: string): Promise<string>;
  settings: { k: number; minSim: number; exclude: string[] };
}

/** Baut die McpDeps aus den Live-Plugin-Anschlüssen (ready-check + embed + toIndexVector). */
export function buildMcpDeps(host: McpDepsHost): McpDeps {
  return {
    getIndex: () => host.getIndex(),
    embedQuery: async (text, dim) => {
      if (!(await host.embedderReady())) throw new Error("Embedding-Endpoint nicht erreichbar.");
      const vecs = await host.embed(text);
      if (vecs.length === 0) throw new Error("embed: leere Antwort");
      return toIndexVector(vecs, dim);
    },
    readNote: (relPath) => host.readVault(relPath),
    settings: () => ({ ...host.settings }),
  };
}
```
(`toIndexVector` und `VaultIndex` sind bereits importiert.)

- [ ] **Step 3b: Felder + Lifecycle-Methoden in der Klasse**

Feld neben den anderen (nach `private indexOpChain` Zeile 63):
```ts
  private mcpServer: McpServerHandle | null = null;
```

Neue Methoden (z. B. vor `saveSettings()` Zeile 929):
```ts
  private mcpDepsHost(): McpDepsHost {
    return {
      getIndex: () => this.index,
      embedderReady: () => this.embedderReady(),
      embed: (t) => this.embedder.embed([t]),
      readVault: (p) => this.app.vault.adapter.read(p),
      settings: { k: this.settings.k, minSim: this.settings.minSim, exclude: this.settings.exclude },
    };
  }

  /** Generiert bei Bedarf einen Token, speichert ihn und gibt ihn zurück. */
  ensureMcpToken(): string {
    if (!this.settings.mcpToken) { this.settings.mcpToken = generateToken(); void this.saveSettings(); }
    return this.settings.mcpToken;
  }

  mcpServerRunning(): boolean { return this.mcpServer !== null; }
  mcpServerAddress(): string | null {
    return this.mcpServer ? `http://127.0.0.1:${this.mcpServer.port}/mcp` : null;
  }

  /** Startet den Server, wenn aktiviert und Desktop. Idempotent (stoppt vorher). */
  async startMcpServerIfEnabled(): Promise<void> {
    await this.stopMcpServer();
    if (Platform.isMobile || !this.settings.mcpEnabled) return;
    const token = this.ensureMcpToken();
    try {
      const { startMcpServer } = await import("./mcp/http_server");
      const tools = new McpTools(buildMcpDeps(this.mcpDepsHost()));
      this.mcpServer = await startMcpServer({ port: this.settings.mcpPort, token, tools, version: this.manifest.version });
    } catch (e) {
      console.warn("vault-rag: MCP-Server-Start fehlgeschlagen", e);
      new Notice(`⚠ MCP-Server konnte nicht starten (Port ${this.settings.mcpPort} belegt?): ${String((e as Error).message ?? e)}`, 8000);
      this.mcpServer = null;
    }
  }

  async stopMcpServer(): Promise<void> {
    if (this.mcpServer) { try { await this.mcpServer.close(); } catch { /* egal */ } this.mcpServer = null; }
  }

  /** Vollständiger Neustart (nach Toggle/Port/Token-Änderung in den Settings). */
  async restartMcpServer(): Promise<void> { await this.startMcpServerIfEnabled(); }
```

- [ ] **Step 3c: Start-Aufruf + Cleanup in `onload`**

Nach `void this.resolveAndReconnectEmbedder();` / `void this.resolveAndReconnectChat();` (Zeile 191-192) ergänzen:
```ts
    void this.startMcpServerIfEnabled();
    this.register(() => { void this.stopMcpServer(); });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main_mcp_deps.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck + volle Suite**

Run: `npm run typecheck && npm test`
Expected: 0 Typfehler, alle Tests grün.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts tests/main_mcp_deps.test.ts
git commit -m "feat(mcp): Server-Lifecycle in main.ts (Start-Gate, Deps-Factory, Cleanup)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Settings-Sektion „MCP-Server"

**Files:**
- Modify: `src/settings.ts` (Import, `VaultRagPluginHost`-Interface, `display()`, neue `buildMcpSection`)
- Test: manuell/typecheck (GUI-Sektion; kein Unit-Test-Zwang)

**Interfaces:**
- Consumes (aus `VaultRagPluginHost`): `mcpServerRunning()`, `mcpServerAddress()`, `restartMcpServer()`, `ensureMcpToken()`, `settings.mcpEnabled/mcpPort/mcpToken`.

**Kontext:** Muster wie `buildRobustnessSection(containerEl)` (containerEl-basiert, mehrere `new Setting(containerEl)`). Neue Plugin-Methoden müssen im Interface `VaultRagPluginHost` (settings.ts Zeile 29-50) deklariert sein.

- [ ] **Step 1: `VaultRagPluginHost` erweitern**

Im Interface `VaultRagPluginHost` (Zeile 29-50) ergänzen:
```ts
  mcpServerRunning(): boolean;
  mcpServerAddress(): string | null;
  restartMcpServer(): Promise<void>;
  ensureMcpToken(): string;
```

- [ ] **Step 2: `buildMcpSection` implementieren**

Neue Methode in `VaultRagSettingTab` (bei den anderen `build*`):
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
          await this.plugin.restartMcpServer();
        }));

    const status = this.plugin.mcpServerRunning()
      ? `läuft · ${this.plugin.mcpServerAddress() ?? ""}`
      : (this.plugin.settings.mcpEnabled ? "aus (Start fehlgeschlagen — Port belegt?)" : "aus");
    new Setting(containerEl).setName("Status").setDesc(status);

    if (this.plugin.settings.mcpEnabled) {
      const token = this.plugin.settings.mcpToken;
      const cmd = `claude mcp add --transport http vault-retrieval ${this.plugin.mcpServerAddress() ?? `http://127.0.0.1:${this.plugin.settings.mcpPort}/mcp`} --header "Authorization: Bearer ${token}"`;
      new Setting(containerEl)
        .setName("Claude Code verbinden")
        .setDesc("Diesen Befehl im Terminal ausführen, um den Vault als MCP-Server zu registrieren.")
        .addButton(b => b.setButtonText("Befehl kopieren").onClick(() => {
          void navigator.clipboard.writeText(cmd); new Notice("MCP-Befehl kopiert");
        }));
    }
  }
```

- [ ] **Step 3: In `display()` einhängen**

Nach der Index-Robustheit-Sektion (settings.ts Zeile 198-199) ergänzen:
```ts
    sec("MCP-Server");
    this.buildMcpSection(containerEl);
```
(`Notice` ist in settings.ts bereits importiert — falls nicht, ergänzen.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 Fehler, alle Tests grün.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts
git commit -m "feat(mcp): Settings-Sektion MCP-Server (Toggle/Port/Status/Connect-Befehl)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Build umstellen (esbuild) + alten Node-CLI-Code löschen

**Files:**
- Modify: `esbuild.config.mjs`
- Delete: `src/mcp/node_adapter.ts`, `src/mcp/node_embed.ts`, `src/mcp/config.ts`, `src/mcp/server.ts`, `tests/mcp_node_adapter.test.ts`, `tests/mcp_node_embed.test.ts`, `tests/mcp_config.test.ts`

**Kontext:** Der Plugin-Build ist CJS mit `external: ["obsidian","electron"]`. Der eingebündelte SDK-Code + `http_server.ts` referenzieren node-builtins (`node:http`, evtl. `node:crypto`/`node:stream`). Im Nicht-`platform:node`-Build muss man builtins **external** setzen, sonst versucht esbuild sie zu bündeln und bricht.

- [ ] **Step 1: `esbuild.config.mjs` ersetzen**

```js
import esbuild from "esbuild";
import builtins from "builtin-modules";
const prod = process.argv[2] === "production";
const common = { bundle: true, sourcemap: prod ? false : "inline", logLevel: "info" };
const plugin = await esbuild.context({
  ...common, entryPoints: ["src/main.ts"], format: "cjs",
  target: "es2020", outfile: "main.js",
  // node-builtins external: der eingebündelte MCP-Server nutzt node:http u.a. (desktop-only,
  // in Electron zur Laufzeit vorhanden). obsidian/electron bleiben ebenfalls external.
  external: ["obsidian", "electron", ...builtins, ...builtins.map(b => `node:${b}`)],
});
if (prod) { await plugin.rebuild(); process.exit(0); }
else { await plugin.watch(); }
```
> `builtin-modules` ist eine übliche Obsidian-Plugin-Dev-Dep. Falls nicht installiert: `npm i -D builtin-modules`. Alternativ die builtins manuell listen (`["http","https","crypto","stream","buffer","events","util","net","url","zlib","node:http", ...]`) — `builtin-modules` ist robuster.

- [ ] **Step 2: Alte Node-CLI-Dateien + Tests löschen**

```bash
git rm src/mcp/node_adapter.ts src/mcp/node_embed.ts src/mcp/config.ts src/mcp/server.ts \
       tests/mcp_node_adapter.test.ts tests/mcp_node_embed.test.ts tests/mcp_config.test.ts
```

- [ ] **Step 3: Build + volle Verifikation**

Run: `npm install` (falls `builtin-modules` ergänzt) — dann:
Run: `npm run build`
Expected: `main.js` wird erzeugt, **kein** `mcp-server.js` mehr, keine Bundle-Fehler.

Run: `grep -c "StreamableHTTPServerTransport" main.js`
Expected: ≥ 1 (SDK ist eingebündelt).

Run: `npm run typecheck && npm test`
Expected: 0 Typfehler; alle Tests grün (die 3 gelöschten Suites sind weg, keine offenen Referenzen).

- [ ] **Step 4: Commit**

```bash
git add esbuild.config.mjs package.json package-lock.json
git commit -m "build(mcp): MCP in main.js bündeln, node-builtins external, stdio-CLI-Dateien entfernt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(package-lock/package.json nur falls `builtin-modules` ergänzt; sonst weglassen. Die `git rm`-Löschungen sind bereits gestaged.)

---

## Task 9: ESLint-Override für `src/mcp/**` entfernen

**Files:**
- Modify: `eslint.config.mjs:18-33` (den `files: ["src/mcp/**/*.ts"]`-Block entfernen)

**Kontext:** `src/mcp/` ist jetzt regulärer Plugin-Code. Die Tool-/Auth-/Register-/Deps-Module sind obsidian-frei UND node-builtin-frei → bestehen die vollen Regeln. `http_server.ts` nutzt `node:http` genau an einer Stelle, dort steht bereits ein `eslint-disable-next-line`-Kommentar mit Begründung (Task 4). `import type { IncomingMessage, ServerResponse } from "node:http"` ist ein Typ-Import (kein Runtime-Node-Modul) — falls `import/no-nodejs-modules` auch Typ-Importe flaggt, dort denselben per-line-disable ergänzen.

- [ ] **Step 1: Block entfernen**

In `eslint.config.mjs` den kompletten Objekt-Block mit `files: ["src/mcp/**/*.ts"]` (Zeile 18-33) löschen.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 Fehler. Falls `http_server.ts` `import/no-nodejs-modules` auf der `node:http`-Typ-Import-Zeile meldet: `// eslint-disable-next-line import/no-nodejs-modules -- nur Typen; Runtime lazy require, desktop-only` direkt darüber ergänzen und erneut linten.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs src/mcp/http_server.ts
git commit -m "chore(mcp): ESLint src/mcp-Override entfernt (jetzt regulärer Plugin-Code)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Doku & Metadaten nachziehen

**Files:**
- Modify: `.gitignore`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `../REGISTRY.md`

**Kontext:** Alle Referenzen auf den stdio-CLI (`mcp-server.js`, „zweites esbuild-Target", `node mcp-server.js <vault>`) auf den neuen in-Plugin-HTTP-Server umstellen. Keine Tests; Verifikation = Konsistenz + `grep`.

- [ ] **Step 1: `.gitignore`**

`mcp-server.js` aus `.gitignore` entfernen (Artefakt existiert nicht mehr).

- [ ] **Step 2: `AGENTS.md`**

- Modul-Layout (`src/mcp/`-Zeile, ~103-106): stdio-Beschreibung ersetzen durch: „In-Plugin HTTP-MCP-Server (Loopback, `/mcp`, StreamableHTTP): `http_server.ts` · `register_tools.ts` · `tools.ts` (McpDeps-injiziert) · `mcp_deps.ts` · `auth.ts`. Kein Node-Adapter/kein stdio mehr."
- Commands-Block (`npm run build` baut nur noch `main.js`; die „baut main.js UND mcp-server.js"-Zeile korrigieren).
- Gotcha-Block: `mcp-server.js`-Gotcha (Zeile ~191-193) durch HTTP-Server-Gotcha ersetzen (desktop-only via `Platform.isMobile`, Loopback+Token, läuft nur bei offenem Obsidian). Den `src/mcp`-ESLint-Ausnahme-Satz entfernen.
- esbuild-Zeile („zweites esbuild-Target") entfernen.

- [ ] **Step 3: `README.md`**

Falls ein MCP-Abschnitt existiert: Setup von „Repo bauen + `node mcp-server.js`" auf „Toggle in den Plugin-Einstellungen + `claude mcp add --transport http …`" umstellen. Falls keiner existiert, kurzen Abschnitt „MCP-Server (externer Zugriff, Desktop)" ergänzen.

- [ ] **Step 4: `CHANGELOG.md`**

Unreleased-Eintrag ergänzen (EN, konsistent mit bisherigem Stil):
```
### Changed
- MCP server is now an in-plugin HTTP server (Streamable HTTP on 127.0.0.1, Bearer-token auth,
  desktop-only) instead of a separate stdio Node CLI. Enable it in Settings → "MCP-Server" and
  connect with `claude mcp add --transport http …`. Removes the standalone `mcp-server.js` target.
```

- [ ] **Step 5: `../REGISTRY.md`**

Den MCP-Muster-Eintrag (`vault-rag/src/mcp/` „headless stdio-Frontend") auf „In-Plugin HTTP-MCP-Server (Loopback + StreamableHTTP), desktop-only via Platform-Gate — Muster-Referenz" aktualisieren.

- [ ] **Step 6: Verify**

Run: `grep -rn "mcp-server.js\|StdioServerTransport\|node mcp-server" AGENTS.md README.md CHANGELOG.md .gitignore ../REGISTRY.md`
Expected: keine Treffer mehr (außer bewusst historischen im CHANGELOG früherer Versionen).

Run: `npm run build && npm run typecheck && npm run lint && npm test`
Expected: alles grün, 0 Fehler.

- [ ] **Step 7: Commit**

```bash
git add .gitignore AGENTS.md README.md CHANGELOG.md ../REGISTRY.md
git commit -m "docs(mcp): Doku auf in-Plugin HTTP-MCP-Server umgestellt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manueller Smoke (nach allen Tasks, vor Release — eigener Schritt)

1. `npm run build`, Plugin in Obsidian (Pallas) neu laden.
2. Einstellungen → „MCP-Server" → aktivieren. Status zeigt „läuft · http://127.0.0.1:8123/mcp".
3. „Befehl kopieren" → im Terminal `claude mcp add …` ausführen.
4. In Claude Code: `search`-Tool gegen den Vault → echte Treffer.
5. Token-Fehlerfall: falscher Token → 401.
6. Mobile-Gegenprobe (optional): auf iPhone lädt das Plugin, Server startet nicht (kein Crash).

---

## Self-Review (vom Planautor)

**Spec-Coverage:** Motivation/Ziele → Tasks 1-9; In-Plugin-Server (TaskNotes-Muster) → Task 4/6; Mobile-Gate → Task 6; drei read-only Tools → Task 3/4; Settings+Sicherheit (Toggle/Port/Token, Loopback, Bearer, Connect-Befehl) → Task 1/2/7; Build/Abbau → Task 8; eslint → Task 9; Doku → Task 10; Testing (Tool-Logik, HTTP-Route+Auth, Mobile-Gate) → Task 3/4/5/6. Nicht-Ziele (Write-Tools, weitere Tools, Obsidian-zu-Betrieb, LAN) sind in keinem Task — korrekt.

**Offene Abhängigkeit (bewusst):** Die exakte `StreamableHTTPServerTransport`-API (stateless-Option, `handleRequest`-Body-Parameter) ist gegen die installierte SDK-Version zu verifizieren (Hinweise in Task 4). Der Test-Vertrag (Bind/401/initialize) ist so gewählt, dass er auch bei kleineren SDK-Abweichungen trägt.

**Typ-Konsistenz:** `McpDeps` (Task 3) ↔ `buildMcpDeps` (Task 6) ↔ `McpTools` (Task 3) konsistent; `McpServerHandle` (Task 4) ↔ `main.ts`-Feld (Task 6) konsistent; `resolveNotePath(rel, exclude)` (Task 3) neue Arity in Test + Aufrufer konsistent.
