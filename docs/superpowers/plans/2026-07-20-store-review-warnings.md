# Store-Review-Warnings 0.16.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die vier Warning-Befunde des Community-Store-Reviews zu Release 0.16.0 abbauen, ohne Verhalten zu ändern.

**Architecture:** Zuerst wird der lokale Linter auf den Stand gebracht, den der Store fährt (`eslint-plugin-obsidianmd` 0.4.1) — er ist danach die Ground Truth für jeden folgenden Schritt. Darauf folgen drei mechanische Umstellungen (`createSpan`, `minAppVersion`+`setDestructive`) und ein inhaltlicher Eingriff: `node:`-Imports werden per Dependency-Injection aus `vault_read_guard.ts` entfernt und der Desktop-Guard in `http_server.ts` für den Linter sichtbar gemacht.

**Tech Stack:** TypeScript, esbuild, vitest, ESLint (flat config), Obsidian Plugin API ≥1.13.0

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-20-store-review-warnings-design.md` — bei Widerspruch zwischen Plan und Spec gilt die Spec.
- **Keine Verhaltensänderung.** Alle Tasks außer Task 5 sind reine Umstellungen; Task 5 fügt eine Schutzprüfung hinzu, die auf Desktop nie greift.
- **`minAppVersion` = `1.13.0`** (exakt dieser Wert, ab Task 3).
- **Kein `eslint-disable` ohne vorherige Eskalationsstufen** — Reihenfolge in Task 5 einhalten.
- **Nicht im Scope:** `getSettingDefinitions()`, `display()`-Deprecation, Vault-Enumeration, Clipboard-Nutzung, der `fs`-basierte Symlink-Guard als solcher.
- **Verifikationsbefehle:** `npm run lint`, `npm test`, `npm run typecheck`, `npm run build`.
- **Testzahl-Baseline:** 684 Tests. Task 4 fügt 2 Tests hinzu (→ 686), Task 5 einen weiteren (→ 687).

---

### Task 1: Linter auf Store-Stand bringen (Gate)

Dieser Task fixt nichts — er stellt fest, ob wir überhaupt gegen dieselben Regeln arbeiten wie der Store. `npm run lint` ist aktuell grün, obwohl der Store vier Warnings meldet; die Regeln stecken erst in 0.4.x.

**Files:**
- Modify: `package.json` (devDependency `eslint-plugin-obsidianmd`)
- Modify: `package-lock.json` (durch npm erzeugt)

**Interfaces:**
- Consumes: nichts
- Produces: eine reproduzierte Warning-Baseline, gegen die Tasks 2–5 verifiziert werden

- [ ] **Step 1: Aktuellen Zustand festhalten**

Run: `npm run lint`
Expected: keine Ausgabe (grün) — das ist der Ausgangszustand.

- [ ] **Step 2: Plugin upgraden**

```bash
npm install --save-dev eslint-plugin-obsidianmd@0.4.1
```

- [ ] **Step 3: Warnings reproduzieren**

Run: `npm run lint`

Expected: Meldungen zu genau diesen Stellen:

```
src/chat_view.ts:225           obsidianmd/prefer-create-el
src/context_panel.ts:29,32,85,89  obsidianmd/prefer-create-el
src/view.ts:12,13              obsidianmd/prefer-create-el
src/mcp/http_server.ts:3,47    node:http
src/mcp/vault_read_guard.ts:1  node:fs/promises
src/mcp/vault_read_guard.ts:2  node:path
```

**STOPP-GATE:** Wenn `npm run lint` weiterhin grün ist oder deutlich andere Stellen meldet, ist die Annahme dieser Spec falsch — dann nicht weiterarbeiten, sondern an den Menschen zurückmelden. Es ist ausdrücklich **kein** Fehler, wenn zusätzlich Meldungen zu `settings.ts` (`getSettingDefinitions`, `display`, `setWarning`) erscheinen; die sind bekannt und werden in Task 3 bzw. gar nicht behandelt.

- [ ] **Step 4: Typecheck und Tests als unveränderte Baseline bestätigen**

Run: `npm run typecheck && npm test`
Expected: typecheck ohne Ausgabe, 684 Tests grün.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(lint): eslint-plugin-obsidianmd auf 0.4.1 (Store-Stand)

Der Store-Review meldet Warnings, die unser lokaler Lint mit 0.3.0 nicht
kennt. Ohne diesen Abgleich fixen wir blind."
```

---

### Task 2: `createEl("span")` → `createSpan()`

**Files:**
- Modify: `src/chat_view.ts:225`
- Modify: `src/context_panel.ts:29,32,85,89`
- Modify: `src/view.ts:12,13`

**Interfaces:**
- Consumes: die Warning-Baseline aus Task 1
- Produces: nichts (rein interne Umstellung, keine Signatur ändert sich)

Es gibt bewusst keinen neuen Test: die Stellen sind bereits durch `tests/chat_view.test.ts`, `tests/context_panel.test.ts` und `tests/hub_view.test.ts` abgedeckt, und der Obsidian-Mock (`tests/__mocks__/obsidian.ts:12`) unterstützt `createSpan` inklusive `cls` und `text`. Die bestehenden Tests sind hier das Sicherheitsnetz — sie müssen grün bleiben.

- [ ] **Step 1: `src/view.ts:12,13` umstellen**

Vorher:

```ts
    row.createEl("span", { cls: "vault-rag-hit-title", text: name });
    row.createEl("span", { cls: "vault-rag-hit-score", text: h.score.toFixed(2) });
```

Nachher:

```ts
    row.createSpan({ cls: "vault-rag-hit-title", text: name });
    row.createSpan({ cls: "vault-rag-hit-score", text: h.score.toFixed(2) });
```

- [ ] **Step 2: `src/chat_view.ts:225` umstellen**

Vorher:

```ts
          const chip = row.createEl("span", { cls: "vault-rag-chat-source", text: p.split("/").pop()?.replace(/\.md$/, "") ?? p });
```

Nachher:

```ts
          const chip = row.createSpan({ cls: "vault-rag-chat-source", text: p.split("/").pop()?.replace(/\.md$/, "") ?? p });
```

- [ ] **Step 3: `src/context_panel.ts:29,32` umstellen**

Vorher:

```ts
    this.countEl = head.createEl("span", { cls: "vault-rag-ctx-count", text: "Kontext (0)" });
```

Nachher:

```ts
    this.countEl = head.createSpan({ cls: "vault-rag-ctx-count", text: "Kontext (0)" });
```

Vorher:

```ts
    this.kEl = kWrap.createEl("span", { cls: "vault-rag-ctx-kval", text: `Auto ${this.autoK}` });
```

Nachher:

```ts
    this.kEl = kWrap.createSpan({ cls: "vault-rag-ctx-kval", text: `Auto ${this.autoK}` });
```

- [ ] **Step 4: `src/context_panel.ts:85,89` umstellen**

Vorher:

```ts
      const chip = el.createEl("span", { cls: "vault-rag-ctx-chip is-pinned", text: `📌 ${this.basename(p)} ✕` });
```

Nachher:

```ts
      const chip = el.createSpan({ cls: "vault-rag-ctx-chip is-pinned", text: `📌 ${this.basename(p)} ✕` });
```

Vorher:

```ts
      const chip = el.createEl("span", { cls: "vault-rag-ctx-chip is-auto", text: `${this.basename(p)} ✕` });
```

Nachher:

```ts
      const chip = el.createSpan({ cls: "vault-rag-ctx-chip is-auto", text: `${this.basename(p)} ✕` });
```

- [ ] **Step 5: Verifizieren**

Run: `npm run lint && npm run typecheck && npm test`

Expected: keine `prefer-create-el`-Meldung mehr, typecheck ohne Ausgabe, 684 Tests grün.

Zur Kontrolle, dass wirklich keine Stelle vergessen wurde:

Run: `grep -rn 'createEl("span"' src/`
Expected: keine Treffer.

- [ ] **Step 6: Commit**

```bash
git add src/chat_view.ts src/context_panel.ts src/view.ts
git commit -m "refactor(ui): createEl(\"span\") durch createSpan ersetzen

Erfuellt obsidianmd/prefer-create-el. Rein mechanisch, kein Verhalten geaendert."
```

---

### Task 3: `minAppVersion` 1.13.0 + `setWarning` → `setDestructive`

**Files:**
- Modify: `manifest.json`
- Modify: `src/settings.ts:135,830,881`

**Interfaces:**
- Consumes: nichts
- Produces: die Zusage `minAppVersion >= 1.13.0`, auf die sich jeder spätere Einsatz von APIs ab 1.13 stützen darf

Reihenfolge ist hier bindend: `setDestructive` existiert erst ab Obsidian 1.13, darf also erst nach der Anhebung eingesetzt werden. Die `obsidian`-devDependency steht bereits auf `^1.13.0`, die Typen sind vorhanden.

- [ ] **Step 1: `manifest.json` anpassen**

Vorher:

```json
  "minAppVersion": "1.7.2",
```

Nachher:

```json
  "minAppVersion": "1.13.0",
```

- [ ] **Step 2: `src/settings.ts:135` umstellen**

Vorher:

```ts
      row.addButton(b => b.setButtonText("Wiederherstellen").setWarning().onClick(() => { this.close(); this.onPick(e.name); }));
```

Nachher:

```ts
      row.addButton(b => b.setButtonText("Wiederherstellen").setDestructive().onClick(() => { this.close(); this.onPick(e.name); }));
```

- [ ] **Step 3: `src/settings.ts:830` umstellen**

Vorher:

```ts
      .addButton(b => b.setButtonText("Neu indizieren").setWarning().onClick(() => {
```

Nachher:

```ts
      .addButton(b => b.setButtonText("Neu indizieren").setDestructive().onClick(() => {
```

- [ ] **Step 4: `src/settings.ts:881` umstellen**

Vorher:

```ts
      .addButton(b => b.setButtonText("Neu generieren").setWarning()
```

Nachher:

```ts
      .addButton(b => b.setButtonText("Neu generieren").setDestructive()
```

- [ ] **Step 5: Verifizieren**

Run: `npm run typecheck && npm run lint && npm test`

Expected: typecheck ohne Ausgabe (beweist, dass `setDestructive` in den Typen existiert), keine `setWarning`-Meldung mehr, 684 Tests grün.

Run: `grep -n "setWarning" src/settings.ts`
Expected: keine Treffer.

- [ ] **Step 6: Commit**

```bash
git add manifest.json src/settings.ts
git commit -m "feat(settings)!: minAppVersion 1.13.0, setWarning -> setDestructive

setDestructive existiert erst ab Obsidian 1.13. Installationen unter 1.13
erhalten kein Update mehr."
```

---

### Task 4: `vault_read_guard` — node:-Imports per Injection entkoppeln

**Files:**
- Modify: `src/mcp/vault_read_guard.ts` (komplett)
- Modify: `src/main.ts:1222-1225`
- Test: `tests/mcp_vault_read_guard.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces:
  ```ts
  export interface GuardIo {
    realpath(p: string): Promise<string>;
    join(...parts: string[]): string;
    sep: string;
  }
  export function makeVaultReadGuard(
    basePath: string,
    read: (rel: string) => Promise<string>,
    io: GuardIo,
  ): (rel: string) => Promise<string>;
  ```
  `io` ist ein **Pflichtargument ohne Default** — ein Default würde den `node:`-Import wieder in die Datei ziehen und den Zweck der Änderung aufheben.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Dieser Test beweist, dass der Guard *das injizierte* `io` benutzt statt `node:fs` direkt. Er braucht kein echtes Dateisystem: das Fake-`realpath` bildet einen Escape ab, den es auf der Platte gar nicht gibt. Solange die Implementierung `node:fs` direkt aufruft, ignoriert sie das Fake und der Test schlägt fehl.

An `tests/mcp_vault_read_guard.test.ts` anhängen (nach dem schließenden `});` der bestehenden `describe`-Gruppe):

```ts
describe("makeVaultReadGuard mit injiziertem io", () => {
  const fakeIo = {
    // Nur "leak.md" zeigt aus dem Vault heraus — rein erfunden, kein echtes FS im Spiel.
    realpath: async (p: string) => (p.endsWith("leak.md") ? "/anderswo/secret.md" : p),
    join: (...parts: string[]) => parts.join("/"),
    sep: "/",
  };
  const read = async (rel: string) => `Inhalt von ${rel}`;

  it("nutzt das injizierte realpath statt node:fs", async () => {
    const guard = makeVaultReadGuard("/vault", read, fakeIo);
    await expect(guard("a.md")).resolves.toBe("Inhalt von a.md");
  });

  it("wirft, wenn das injizierte realpath aus dem Vault herausfuehrt", async () => {
    const guard = makeVaultReadGuard("/vault", read, fakeIo);
    await expect(guard("leak.md")).rejects.toThrow(/Symlink|Vault/);
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `npx vitest run tests/mcp_vault_read_guard.test.ts`

Expected: FAIL. Der Typecheck bzw. Lauf bricht ab, weil `makeVaultReadGuard` bisher nur zwei Parameter hat und `/vault` auf der echten Platte nicht existiert (`ENOENT` aus dem echten `fs.realpath`). Wichtig ist nur, dass die neuen Tests **rot** sind, bevor die Implementierung folgt.

- [ ] **Step 3: `src/mcp/vault_read_guard.ts` umschreiben**

Vollständiger neuer Inhalt der Datei:

```ts
/** Die Node-Operationen, die der Guard braucht. Wird von aussen injiziert, damit diese
 *  Datei keinen node:-Import enthaelt (Obsidian-Mobile laedt keine Node-Builtins). */
export interface GuardIo {
  realpath(p: string): Promise<string>;
  join(...parts: string[]): string;
  sep: string;
}

/** Desktop-only Symlink-Escape-Schutz: liest eine vault-relative Datei nur, wenn ihr
 *  real aufgelöster Pfad unter dem Vault-Root bleibt (adapter.read folgt Symlinks). */
export function makeVaultReadGuard(
  basePath: string,
  read: (rel: string) => Promise<string>,
  io: GuardIo,
): (rel: string) => Promise<string> {
  return async (rel: string) => {
    const full = io.join(basePath, rel);
    const [realFull, realRoot] = await Promise.all([io.realpath(full), io.realpath(basePath)]);
    if (realFull !== realRoot && !realFull.startsWith(realRoot + io.sep)) {
      throw new Error(`Pfad verlässt den Vault (Symlink): "${rel}"`);
    }
    return read(rel);
  };
}
```

- [ ] **Step 4: Bestehenden FS-Integrationstest um das dritte Argument ergänzen**

Der echte Symlink-Test bleibt inhaltlich unverändert erhalten — er injiziert jetzt die echten Node-Module. In `tests/mcp_vault_read_guard.test.ts` oberhalb der ersten `describe`-Gruppe ergänzen:

```ts
const realIo = { realpath: fs.realpath, join: path.join, sep: path.sep };
```

Dann in der bestehenden Gruppe alle drei Vorkommen von `makeVaultReadGuard(vaultDir, read)` ersetzen durch:

```ts
    const guard = makeVaultReadGuard(vaultDir, read, realIo);
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npx vitest run tests/mcp_vault_read_guard.test.ts`
Expected: PASS, 5 Tests (3 bestehende FS/Symlink-Tests + 2 neue).

- [ ] **Step 6: Aufrufer in `src/main.ts:1222-1225` anpassen**

Vorher:

```ts
      const { makeVaultReadGuard } = await import("./mcp/vault_read_guard");
      const adapter = this.app.vault.adapter;
      if (adapter instanceof FileSystemAdapter) {
        this.guardedRead = makeVaultReadGuard(adapter.getBasePath(), (p) => adapter.read(p));
      }
```

Nachher:

```ts
      const { makeVaultReadGuard } = await import("./mcp/vault_read_guard");
      const adapter = this.app.vault.adapter;
      if (adapter instanceof FileSystemAdapter) {
        // Node-Builtins erst hier laden: dieser Pfad ist durch das Platform.isMobile-Return
        // oben bereits als Desktop-only abgesichert.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- desktop-only, siehe Guard oben
        const nodeFs: typeof import("node:fs/promises") = require("node:fs/promises");
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- desktop-only, siehe Guard oben
        const nodePath: typeof import("node:path") = require("node:path");
        this.guardedRead = makeVaultReadGuard(adapter.getBasePath(), (p) => adapter.read(p), {
          realpath: nodeFs.realpath,
          join: nodePath.join,
          sep: nodePath.sep,
        });
      }
```

Das folgt exakt dem Muster, das `src/mcp/http_server.ts:47` bereits für `node:http` verwendet: lazy `require` hinter dem `Platform.isMobile`-Return in `doStartMcpServer` (`src/main.ts:1215`).

- [ ] **Step 7: Verifizieren**

Run: `npm run typecheck && npm run lint && npm test`

Expected: typecheck ohne Ausgabe, keine `node:fs/promises`- oder `node:path`-Meldung mehr für `vault_read_guard.ts`, 686 Tests grün.

Run: `grep -n "node:" src/mcp/vault_read_guard.ts`
Expected: keine Treffer.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/vault_read_guard.ts src/main.ts tests/mcp_vault_read_guard.test.ts
git commit -m "refactor(mcp): Node-IO in den Read-Guard injizieren

Entfernt die node:-Top-Level-Imports aus vault_read_guard.ts und macht die
Guard-Logik pur testbar. Der reale Symlink-Integrationstest bleibt erhalten
und injiziert die echten Node-Module."
```

---

### Task 5: `http_server` — Desktop-Guard für den Linter sichtbar machen

**Files:**
- Modify: `src/mcp/http_server.ts` (Import + Kopf von `startMcpServer`)
- Test: `tests/mcp_http_server.integration.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `startMcpServer()` wirft auf Mobile, statt einen Node-Server zu starten

Beide Linter-Meldungen in dieser Datei betreffen Typpositionen (`import type` in Zeile 3, `typeof import(…)` in Zeile 47) — im Bundle landet davon nichts. Das `require` in Zeile 47 ist bereits desktop-gegated, aber der Guard steht in `src/main.ts:1215` und ist für den Linter unsichtbar. Ein lokaler Guard behebt das und ist zugleich Defense-in-Depth.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `tests/mcp_http_server.integration.test.ts` anhängen:

```ts
describe("startMcpServer auf Mobile", () => {
  it("wirft, statt einen Node-Server zu starten", async () => {
    const { Platform } = await import("obsidian");
    Platform.isMobile = true;
    try {
      await expect(
        startMcpServer({ port: 0, token: "t", tools: new McpTools(deps), version: "0.0.0" }),
      ).rejects.toThrow(/Desktop/);
    } finally {
      Platform.isMobile = false;
    }
  });
});
```

Der Mock (`tests/__mocks__/obsidian.ts:1`) exportiert `Platform` als mutierbares Objekt; das `finally` stellt den Ausgangswert wieder her, damit nachfolgende Tests nicht beeinflusst werden.

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `npx vitest run tests/mcp_http_server.integration.test.ts`
Expected: FAIL — der Server startet trotz `isMobile === true`, es wird nichts geworfen.

- [ ] **Step 3: Guard implementieren**

In `src/mcp/http_server.ts` den `Platform`-Import ergänzen (nach den bestehenden Imports):

```ts
import { Platform } from "obsidian";
```

Und als erste Zeile im Body von `startMcpServer`, **vor** dem `require`:

```ts
export async function startMcpServer(opts: { port: number; token: string; tools: McpTools; version: string }): Promise<McpServerHandle> {
  // Defense-in-Depth: der Aufrufer gated bereits (main.ts), aber node:http darf auf Mobile
  // unter keinen Umständen geladen werden.
  if (Platform.isMobile) throw new Error("MCP-Server ist Desktop-only");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment -- desktop-only, lazy: node:http nie auf Mobile laden (require global ist unbekannten Typs, Signatur via node:http-Typen unten sichergestellt)
  const http: typeof import("node:http") = require("node:http");
```

- [ ] **Step 4: Test laufen lassen**

Run: `npx vitest run tests/mcp_http_server.integration.test.ts`
Expected: PASS, alle Tests der Datei grün.

- [ ] **Step 5: Lint prüfen — Eskalation nur falls nötig**

Run: `npm run lint`

Wenn keine `node:http`-Meldung mehr erscheint: fertig, weiter zu Step 6.

Falls die Meldung bleibt, in dieser Reihenfolge eskalieren und **nach jeder Stufe erneut linten**:

1. **Strukturelle Typen statt `node:http`.** Zeile 3 (`import type { IncomingMessage, ServerResponse } from "node:http"`) durch lokale Interfaces ersetzen. Randbedingung: `StreamableHTTPServerTransport.handleRequest` erwartet laut `node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts:107` ein `IncomingMessage & {…}`, die Typen müssen strukturell kompatibel bleiben — `npm run typecheck` ist hier der Prüfstein und muss grün sein.
2. **Begründetes `eslint-disable-next-line`** mit dem Kommentar, dass ein type-only Import nachweislich keinen Runtime-Code erzeugt und der Runtime-Pfad durch den `Platform.isMobile`-Guard abgesichert ist.

Wird Stufe 2 gezogen, im Commit-Text festhalten, warum Stufe 1 nicht ausgereicht hat.

- [ ] **Step 6: Voll verifizieren**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: typecheck ohne Ausgabe, Lint ohne die vier Ziel-Warnings, 687 Tests grün, Build erzeugt `main.js`.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/http_server.ts tests/mcp_http_server.integration.test.ts
git commit -m "feat(mcp): Platform-Guard in startMcpServer

Macht den bisher nur in main.ts existierenden Desktop-Guard lokal sichtbar
und verhindert als Defense-in-Depth, dass node:http je auf Mobile laedt."
```

---

### Task 6: Changelog und Release-Vorbereitung

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md` (Testzahl)

**Interfaces:**
- Consumes: die Ergebnisse aller vorherigen Tasks
- Produces: nichts

- [ ] **Step 1: Changelog-Eintrag ergänzen**

Oben in `CHANGELOG.md`, im Stil der bestehenden Einträge (den vorhandenen Aufbau vorher ansehen und übernehmen):

```markdown
## 0.16.1

### Geändert
- **minAppVersion auf 1.13.0 angehoben.** Installationen unter Obsidian 1.13 erhalten kein Update mehr. Grund: `setDestructive` und die deklarative Settings-API existieren erst ab 1.13.
- Store-Review-Warnings abgebaut: `createSpan` statt `createEl("span")`, `setDestructive` statt des veralteten `setWarning`, keine `node:`-Top-Level-Imports mehr im Read-Guard.
- MCP-Server wirft jetzt explizit auf Mobile, statt sich allein auf den Guard des Aufrufers zu verlassen.

### Bewusst nicht geändert
Der Store meldet vier Punkte, die Eigenschaften des Plugins bzw. seiner Dependencies sind:
- **Direct Filesystem Access** — `fs.realpath` im Symlink-Escape-Schutz des MCP-Servers, desktop-only und auf diese eine Prüfung begrenzt.
- **Vault Enumeration** — Kernfunktion eines Retrieval-Plugins.
- **Clipboard Access** — ausschließlich `writeText`, immer nutzerinitiiert; es wird nie aus der Zwischenablage gelesen.
- **Dynamic Code Execution** — `new Function` stammt aus `ajv`, gezogen über `@modelcontextprotocol/sdk`; kein Code dieses Plugins.

Offen bleibt `getSettingDefinitions()` (Settings-Suche ab Obsidian 1.13) — dafür ist ein eigener Slice vorgesehen.
```

- [ ] **Step 2: Testzahl in `AGENTS.md` nachziehen**

Die dort dokumentierte Testzahl von 684 auf 687 anheben. Vorher die genaue Stelle suchen:

Run: `grep -n "684" AGENTS.md`

- [ ] **Step 3: Gesamtverifikation**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: alles grün, 687 Tests.

- [ ] **Step 4: Manuelle GUI-Prüfung der Destructive-Buttons**

Aus der Spec: die drei in Task 3 umgestellten Buttons einmal im laufenden Obsidian ansehen. Kein Automat kann das prüfen — `setDestructive` ist eine reine Darstellungsänderung.

Prüfen, dass alle drei rot/destruktiv dargestellt werden und ihre Aktion unverändert auslösen:
1. Einstellungen → „Vault neu indizieren" → Button **Neu indizieren** (öffnet den Bestätigungsdialog)
2. Einstellungen → MCP → **Neu generieren** beim Token (erzeugt neuen Token + Notice)
3. Backup-Wiederherstellen-Modal → **Wiederherstellen** pro Zeile

Da dieser Schritt einen Menschen braucht: hier innehalten und das Ergebnis erfragen, statt ihn stillschweigend als erledigt abzuhaken.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md AGENTS.md
git commit -m "docs(changelog): 0.16.1 — Store-Review-Warnings"
```

- [ ] **Step 6: Version-Bump und Release dem Menschen überlassen**

`npm run version-bump` und `npm run release` **nicht** selbst ausführen. Stattdessen zurückmelden, dass der Branch bereit ist, und die Entscheidung über Merge und Release dem Menschen überlassen.

---

## Abschluss

Nach Task 6 ist der Branch fertig. Zur Integration die Skill `superpowers:finishing-a-development-branch` verwenden: in diesem Repo wird lokal mit `--no-ff` nach `main` gemergt und anschließend released — es wird kein PR geöffnet.
