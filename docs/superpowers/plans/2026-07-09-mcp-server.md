# MCP-Server auf dem vault-rag-Index — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein lokaler stdio-MCP-Server (`mcp-server.js`) gibt externen LLM-Clients (Claude Code, OpenClaw) read-only-Zugriff auf das vault-rag-Retrieval: `search`, `related`, `read_note`.

**Architecture:** Zweites, headless Frontend auf den bestehenden pure-core-Modulen (`parseIndex`/`Retriever`/`toIndexVector`) — kein neues Retrieval-System. Neuer Code lebt unter `src/mcp/` (Node-Programm, kein Obsidian), wird als zweiter esbuild-Entry zu einem einzelnen `mcp-server.js` gebündelt. Config kommt aus der Plugin-`data.json`; einziges Pflicht-Arg ist der Vault-Pfad.

**Tech Stack:** TypeScript strict · `@modelcontextprotocol/sdk` + `zod` (devDeps, eingebündelt) · Node ≥18 (`fetch`, `AbortSignal.timeout`) · vitest · esbuild.

**Spec:** `docs/superpowers/specs/2026-07-09-mcp-server-design.md`

## Global Constraints

- **Read-only per Konstruktion:** kein Codepfad im MCP-Server schreibt in den Vault. `NodeVaultAdapter.write/writeBinary/mkdir` werfen.
- **Index-Format unveränderlich:** `notes.i8` · `paths.json` · `manifest.json`, dim 256, `INT8_SCALE=127`, mean-Aggregation. Der MCP-Code liest `index.dim` aus dem Manifest statt Konstanten zu duplizieren.
- **Null-Runtime-Deps bleibt:** SDK + zod sind devDependencies und werden von esbuild eingebündelt. `package.json` bekommt KEINE `dependencies`-Sektion.
- **Plugin-Verhalten unangetastet:** `main.js`-Build, Release-Assets und alle 503 Bestands-Tests bleiben identisch. Task 1 ist ein reiner Re-Export-Refactor.
- **Obsidian-Grenze:** `src/mcp/**` importiert NIE `obsidian` oder `./http` (das obsidian.requestUrl kapselt). Netz via Node-`fetch` (nur in `node_embed.ts`), Dateisystem via `node:fs` (nur in `node_adapter.ts`, `config.ts`, `tools.ts`, `server.ts`).
- **stdout gehört dem Protokoll:** Diagnose-Logs im Server NUR über `console.error` (stderr).
- **Fehlertexte deutsch + handlungsleitend** (wie `endpoint_diagnostics.klartext`).
- **Commits:** Conventional Commits, deutsche Beschreibung, **nur berührte Dateien stagen** (nie `git add -A`), Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Nach jedem Task: `npm test` (alle grün), `npm run typecheck`, `npm run lint` (0 Fehler).

## Datei-Landkarte

```
Create:
  src/settings_core.ts        obsidian-freie Settings-Wahrheit (Task 1)
  src/mcp/node_adapter.ts     read-only VaultAdapter über node:fs (Task 2)
  src/mcp/config.ts           data.json → VaultRagSettings + Env-Overrides (Task 3)
  src/mcp/node_embed.ts       fetch-Probe + Query-Embedding (Task 4)
  src/mcp/tools.ts            McpTools: Index-Reload, related/read_note/search (Tasks 5–7)
  src/mcp/server.ts           SDK-Verdrahtung, Arg-Parsing (Task 8)
  tests/mcp_node_adapter.test.ts · tests/mcp_config.test.ts ·
  tests/mcp_node_embed.test.ts · tests/mcp_tools.test.ts
Modify:
  src/settings.ts             Definitionen raus, Re-Export rein (Task 1)
  eslint.config.mjs           obsidianmd-Regeln auf Plugin-Code scopen (Task 2)
  tsconfig.json               types:["node"], resolveJsonModule (Tasks 2/8)
  package.json                devDeps (Tasks 2/8)
  esbuild.config.mjs          zweiter Entry → mcp-server.js (Task 8)
  .gitignore                  mcp-server.js (Task 8)
  README.md · AGENTS.md       Doku (Task 9)
```

---

### Task 1: `settings_core.ts` — obsidian-freie Settings-Wahrheit extrahieren

`src/settings.ts` importiert `obsidian` (SettingTab-UI). Der MCP-Server braucht aber `VaultRagSettings`/`DEFAULT_SETTINGS`/`migrateEndpointList` — die sind pure. Extraktion in ein neues Modul; `settings.ts` re-exportiert, damit Bestandscode (main.ts, Tests) unverändert weiterläuft.

**Files:**
- Create: `src/settings_core.ts`
- Modify: `src/settings.ts` (Definitionen entfernen, Import + Re-Export)

**Interfaces:**
- Consumes: `ApplyMode` aus `src/note_restructurer.ts` (pure, existiert).
- Produces: `src/settings_core.ts` exportiert `interface VaultRagSettings` (Felder unverändert wie heute in settings.ts), `const DEFAULT_SYSTEM_PROMPT: string`, `const DEFAULT_SETTINGS: VaultRagSettings`, `function migrateEndpointList(single: string | undefined, list: string[] | undefined): string[]` — alles byte-identisch zur heutigen Definition. Task 3 importiert von hier.

- [ ] **Step 1: Betroffene Importe inventarisieren (Lesson: auch `tests/` grepen!)**

```bash
grep -rn "DEFAULT_SETTINGS\|migrateEndpointList\|DEFAULT_SYSTEM_PROMPT\|VaultRagSettings" src/ tests/ --include="*.ts" -l
```

Erwartung: mehrere Dateien, alle importieren aus `./settings` bzw. `../src/settings`. Sie bleiben durch den Re-Export gültig — KEINE Import-Fixups nötig. Liste notieren; falls doch eine Datei direkt Interna nutzt, die nicht re-exportiert werden, im Fix-Schritt umbiegen.

- [ ] **Step 2: `src/settings_core.ts` anlegen**

Inhalt: die vier Definitionen **byte-identisch** aus `src/settings.ts` herausschneiden (Interface `VaultRagSettings` mit allen 26 Feldern, `DEFAULT_SYSTEM_PROMPT`, `DEFAULT_SETTINGS`, `migrateEndpointList` inkl. Doc-Kommentaren) plus Kopf:

```ts
import type { ApplyMode } from "./note_restructurer";

/** Obsidian-freie Settings-Wahrheit: Interface, Defaults, Endpoint-Migration.
 *  Von settings.ts (Plugin-UI) re-exportiert und vom MCP-Server (src/mcp/) direkt
 *  importiert — dieses Modul darf NIE obsidian importieren. */
```

- [ ] **Step 3: `src/settings.ts` umstellen**

Die vier Definitionen dort löschen und ersetzen durch:

```ts
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, migrateEndpointList, type VaultRagSettings } from "./settings_core";

export { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, migrateEndpointList };
export type { VaultRagSettings };
```

(Der Import bleibt zusätzlich zum Re-Export nötig, weil settings.ts die Symbole selbst nutzt. Der bisherige `import type { ApplyMode } from "./note_restructurer"` in settings.ts kann bleiben, falls dort noch anderweitig genutzt — prüfen mit `grep -n "ApplyMode" src/settings.ts`; wird er nur noch vom Interface gebraucht, entfernen.)

- [ ] **Step 4: Verifizieren**

```bash
npm test && npm run typecheck && npm run lint
```

Erwartung: 503 Tests grün, 0 Typ-/Lint-Fehler. (Kein neuer Test — reiner Verhaltens-neutraler Refactor; die Bestands-Tests sind das Netz.)

- [ ] **Step 5: Commit**

```bash
git add src/settings_core.ts src/settings.ts
git commit -m "refactor(settings): pure Settings-Wahrheit nach settings_core extrahieren

VaultRagSettings/DEFAULT_SETTINGS/DEFAULT_SYSTEM_PROMPT/migrateEndpointList
byte-identisch in obsidian-freies Modul; settings.ts re-exportiert.
Vorbereitung MCP-Server (braucht Settings ohne obsidian-Import).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `NodeVaultAdapter` (read-only) + Lint/Types-Grundlage für `src/mcp/`

**Files:**
- Create: `src/mcp/node_adapter.ts`
- Modify: `eslint.config.mjs`, `tsconfig.json`, `package.json` (devDep `@types/node`)
- Test: `tests/mcp_node_adapter.test.ts`

**Interfaces:**
- Consumes: `VaultAdapter` aus `src/index.ts` (`read/readBinary/write/writeBinary/mkdir`).
- Produces: `class NodeVaultAdapter implements VaultAdapter`, `constructor(root: string)` — Pfade werden relativ zu `root` aufgelöst. `write/writeBinary/mkdir` werfen `Error("NodeVaultAdapter ist read-only")`. Tasks 5–7 nutzen ihn für den `IndexLoader`.

- [ ] **Step 1: Node-Typen + Lint-Scoping einrichten**

```bash
npm install -D @types/node
```

`tsconfig.json`: `"types": []` → `"types": ["node"]`.

`eslint.config.mjs`: Die Zeile `...obsidianmd.configs.recommended,` ersetzen durch einen gescopten Block, damit die Obsidian-Plugin-Regeln (u. a. fetch-Verbot) NICHT für das Node-Programm gelten:

```js
{ files: ["src/**/*.ts"], ignores: ["src/mcp/**"], extends: [...obsidianmd.configs.recommended] },
```

(Der `sentence-case`-off-Block und der `settings.ts`-Block darunter bleiben unverändert.)

- [ ] **Step 2: Failing Test schreiben** — `tests/mcp_node_adapter.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NodeVaultAdapter } from "../src/mcp/node_adapter";

describe("NodeVaultAdapter", () => {
  let root: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-adapter-"));
    await fs.mkdir(path.join(root, "sub"));
    await fs.writeFile(path.join(root, "sub", "note.md"), "# Hallo");
    await fs.writeFile(path.join(root, "bytes.bin"), Buffer.from([1, 2, 3]));
  });
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("liest Text relativ zum Root", async () => {
    expect(await new NodeVaultAdapter(root).read("sub/note.md")).toBe("# Hallo");
  });
  it("liest Binärdaten als ArrayBuffer", async () => {
    const buf = await new NodeVaultAdapter(root).readBinary("bytes.bin");
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("wirft bei fehlender Datei", async () => {
    await expect(new NodeVaultAdapter(root).read("gibts-nicht.md")).rejects.toThrow();
  });
  it("ist read-only: write/writeBinary/mkdir werfen", async () => {
    const a = new NodeVaultAdapter(root);
    await expect(a.write("x.md", "y")).rejects.toThrow(/read-only/);
    await expect(a.writeBinary("x.bin", new ArrayBuffer(1))).rejects.toThrow(/read-only/);
    await expect(a.mkdir("neu")).rejects.toThrow(/read-only/);
  });
});
```

- [ ] **Step 3: Fail verifizieren**

```bash
npx vitest run tests/mcp_node_adapter.test.ts
```

Erwartung: FAIL — `Cannot find module '../src/mcp/node_adapter'` (o. ä.).

- [ ] **Step 4: Implementieren** — `src/mcp/node_adapter.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { VaultAdapter } from "../index";

/** Read-only VaultAdapter über node:fs — der MCP-Server liest nur, per Konstruktion.
 *  Schreib-Methoden werfen, damit versehentliche Writes sofort auffallen. */
export class NodeVaultAdapter implements VaultAdapter {
  constructor(private root: string) {}
  private abs(p: string): string { return path.join(this.root, p); }
  async read(p: string): Promise<string> { return fs.readFile(this.abs(p), "utf-8"); }
  async readBinary(p: string): Promise<ArrayBuffer> {
    const b = await fs.readFile(this.abs(p));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  // Nicht async (throw statt await) — sonst schlägt @typescript-eslint/require-await an.
  write(): Promise<void> { return Promise.reject(new Error("NodeVaultAdapter ist read-only")); }
  writeBinary(): Promise<void> { return Promise.reject(new Error("NodeVaultAdapter ist read-only")); }
  mkdir(): Promise<void> { return Promise.reject(new Error("NodeVaultAdapter ist read-only")); }
}
```

- [ ] **Step 5: Grün verifizieren + Gesamtlauf**

```bash
npx vitest run tests/mcp_node_adapter.test.ts && npm test && npm run typecheck && npm run lint
```

Erwartung: neuer Test PASS, alle Bestands-Tests grün, lint 0 (insbesondere: kein obsidianmd-Fehler für `src/mcp/`).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/node_adapter.ts tests/mcp_node_adapter.test.ts eslint.config.mjs tsconfig.json package.json package-lock.json
git commit -m "feat(mcp): read-only NodeVaultAdapter + Lint/Types-Grundlage für src/mcp

VaultAdapter über node:fs (write/mkdir werfen); obsidianmd-ESLint-Regeln
auf Plugin-Code gescoped (src/mcp ist ein Node-Programm), @types/node.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `config.ts` — Plugin-`data.json` mitlesen + Env-Overrides

**Files:**
- Create: `src/mcp/config.ts`
- Test: `tests/mcp_config.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `migrateEndpointList`, `VaultRagSettings` aus `../settings_core` (Task 1); `mergeSettings` aus `../vendor/kit/settings`.
- Produces: `interface McpConfig { vaultPath: string; settings: VaultRagSettings }`, `const DATA_JSON_REL = ".obsidian/plugins/vault-retrieval/data.json"`, `async function loadConfig(vaultPath: string, env: Record<string, string | undefined>): Promise<McpConfig>`. Tasks 5–8 konsumieren `McpConfig`.

- [ ] **Step 1: Failing Test schreiben** — `tests/mcp_config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, DATA_JSON_REL } from "../src/mcp/config";
import { DEFAULT_SETTINGS } from "../src/settings_core";

async function makeVault(dataJson?: unknown): Promise<string> {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-cfg-"));
  if (dataJson !== undefined) {
    const p = path.join(vault, DATA_JSON_REL);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(dataJson));
  }
  return vault;
}

describe("loadConfig", () => {
  it("fehlende data.json → Defaults", async () => {
    const cfg = await loadConfig(await makeVault(), {});
    expect(cfg.settings.indexDir).toBe(DEFAULT_SETTINGS.indexDir);
    expect(cfg.settings.embeddingEndpoints).toEqual(DEFAULT_SETTINGS.embeddingEndpoints);
    expect(cfg.settings.embeddingEndpoints).not.toBe(DEFAULT_SETTINGS.embeddingEndpoints); // keine geteilte Referenz
  });
  it("liest gespeicherte Settings und merged über Defaults", async () => {
    const cfg = await loadConfig(await makeVault({ indexDir: "_anders", k: 7 }), {});
    expect(cfg.settings.indexDir).toBe("_anders");
    expect(cfg.settings.k).toBe(7);
    expect(cfg.settings.minSim).toBe(DEFAULT_SETTINGS.minSim);
  });
  it("migriert alte Einzel-Endpoint-Settings zur Liste", async () => {
    const cfg = await loadConfig(await makeVault({ embeddingEndpoint: "http://alt:1111" }), {});
    expect(cfg.settings.embeddingEndpoints).toEqual(["http://alt:1111"]);
  });
  it("leere Endpoint-Liste fällt auf Default zurück", async () => {
    const cfg = await loadConfig(await makeVault({ embeddingEndpoints: [] }), {});
    expect(cfg.settings.embeddingEndpoints).toEqual(DEFAULT_SETTINGS.embeddingEndpoints);
  });
  it("Env-Overrides gewinnen", async () => {
    const cfg = await loadConfig(await makeVault({ embeddingEndpoints: ["http://a:1"], embeddingModel: "m1", indexDir: "_x" }), {
      VAULT_RAG_EMBEDDING_ENDPOINT: "http://env:9",
      VAULT_RAG_EMBEDDING_MODEL: "env-model",
      VAULT_RAG_INDEX_DIR: "_env",
    });
    expect(cfg.settings.embeddingEndpoints).toEqual(["http://env:9"]);
    expect(cfg.settings.embeddingModel).toBe("env-model");
    expect(cfg.settings.indexDir).toBe("_env");
  });
  it("korrupte data.json → Defaults statt Crash", async () => {
    const vault = await makeVault();
    const p = path.join(vault, DATA_JSON_REL);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, "{kaputt");
    const cfg = await loadConfig(vault, {});
    expect(cfg.settings.indexDir).toBe(DEFAULT_SETTINGS.indexDir);
  });
});
```

- [ ] **Step 2: Fail verifizieren**

```bash
npx vitest run tests/mcp_config.test.ts
```

Erwartung: FAIL — Modul `../src/mcp/config` existiert nicht.

- [ ] **Step 3: Implementieren** — `src/mcp/config.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_SETTINGS, migrateEndpointList, type VaultRagSettings } from "../settings_core";
import { mergeSettings } from "../vendor/kit/settings";

export interface McpConfig { vaultPath: string; settings: VaultRagSettings; }

export const DATA_JSON_REL = ".obsidian/plugins/vault-retrieval/data.json";

/** Liest die Plugin-Konfig des Vaults (data.json) und merged sie über die Defaults —
 *  dieselbe Semantik wie main.ts onload (mergeSettings + Endpoint-Listen-Migration).
 *  Fehlende/korrupte data.json → Defaults (related/read_note bleiben nutzbar).
 *  Env-Overrides als Escape-Hatch: VAULT_RAG_EMBEDDING_ENDPOINT/_EMBEDDING_MODEL/_INDEX_DIR. */
export async function loadConfig(vaultPath: string, env: Record<string, string | undefined>): Promise<McpConfig> {
  let loaded: (Partial<VaultRagSettings> & { embeddingEndpoint?: string }) | null = null;
  try {
    loaded = JSON.parse(await fs.readFile(path.join(vaultPath, DATA_JSON_REL), "utf-8")) as typeof loaded;
  } catch {
    loaded = null; // fehlt oder unlesbar/korrupt → Defaults
  }
  const settings = mergeSettings(DEFAULT_SETTINGS, loaded);
  settings.embeddingEndpoints = migrateEndpointList(loaded?.embeddingEndpoint, loaded?.embeddingEndpoints);
  if (!settings.embeddingEndpoints.length) settings.embeddingEndpoints = [...DEFAULT_SETTINGS.embeddingEndpoints];
  if (env.VAULT_RAG_EMBEDDING_ENDPOINT) settings.embeddingEndpoints = [env.VAULT_RAG_EMBEDDING_ENDPOINT];
  if (env.VAULT_RAG_EMBEDDING_MODEL) settings.embeddingModel = env.VAULT_RAG_EMBEDDING_MODEL;
  if (env.VAULT_RAG_INDEX_DIR) settings.indexDir = env.VAULT_RAG_INDEX_DIR;
  return { vaultPath, settings };
}
```

- [ ] **Step 4: Grün verifizieren + Gesamtlauf**

```bash
npx vitest run tests/mcp_config.test.ts && npm test && npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/config.ts tests/mcp_config.test.ts
git commit -m "feat(mcp): loadConfig — Plugin-data.json mitlesen, Env-Overrides

Null Doppel-Konfiguration: Endpoint-Liste/indexDir/Modell kommen aus der
Plugin-Konfig (mergeSettings + Endpoint-Migration wie main.ts onload);
VAULT_RAG_*-Env als Escape-Hatch. Korrupte data.json → Defaults.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `node_embed.ts` — fetch-Probe + Query-Embedding

**Files:**
- Create: `src/mcp/node_embed.ts`
- Test: `tests/mcp_node_embed.test.ts`

**Interfaces:**
- Consumes: `classifyEndpointStatus`, `EndpointStatus` aus `../vendor/kit/endpoint_diagnostics`; `toIndexVector` aus `../embed_vector`.
- Produces:
  - `async function nodeProbe(baseUrl: string, timeoutMs = 5000): Promise<EndpointStatus>` — GET `<baseUrl>/v1/models` via Node-fetch, Klassifikation über `classifyEndpointStatus`.
  - `async function embedQueryVector(endpoint: string, model: string, text: string, dim: number): Promise<Float32Array>` — POST `/v1/embeddings`, dann `toIndexVector([vec], dim)` (derselbe Vektorraum wie der Index).
  - Task 7 injiziert beide als `ToolIo` in `McpTools`; Task 8 verdrahtet sie real.

**Node-Gotcha (im Test abgedeckt):** Bei Node-`fetch` steckt der Fehlercode (ECONNREFUSED/ENOTFOUND) nicht in `error.message` (die ist nur „fetch failed"), sondern in `error.cause.code` — die Message für `classifyEndpointStatus` muss beides zusammensetzen.

- [ ] **Step 1: Failing Test schreiben** — `tests/mcp_node_embed.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { nodeProbe, embedQueryVector } from "../src/mcp/node_embed";

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("nodeProbe", () => {
  it("200 + Modell-Listen-Form → ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: [] })));
    expect((await nodeProbe("http://x:1")).kind).toBe("ok");
  });
  it("200 ohne data-Form → not-an-llm-api", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { hello: 1 })));
    expect((await nodeProbe("http://x:1")).kind).toBe("not-an-llm-api");
  });
  it("ECONNREFUSED in cause.code → refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }));
    expect((await nodeProbe("http://x:1")).kind).toBe("refused");
  });
  it("TimeoutError → timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    }));
    expect((await nodeProbe("http://x:1")).kind).toBe("timeout");
  });
});

describe("embedQueryVector", () => {
  it("bettet ein und transformiert in den Index-Vektorraum (truncate+normalisiert)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: [{ embedding: [3, 4, 0, 0, 99, 99] }] })));
    const v = await embedQueryVector("http://x:1", "m", "query", 4);
    expect(v.length).toBe(4);                       // auf dim truncated (Matryoshka)
    expect(v[0]).toBeCloseTo(0.6); expect(v[1]).toBeCloseTo(0.8); // L2-normalisiert
  });
  it("HTTP-Fehler → Error mit Status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, {})));
    await expect(embedQueryVector("http://x:1", "m", "q", 4)).rejects.toThrow(/500/);
  });
  it("ungültiges Response-Schema → Error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: "quatsch" })));
    await expect(embedQueryVector("http://x:1", "m", "q", 4)).rejects.toThrow(/Schema/);
  });
});
```

- [ ] **Step 2: Fail verifizieren**

```bash
npx vitest run tests/mcp_node_embed.test.ts
```

Erwartung: FAIL — Modul existiert nicht.

- [ ] **Step 3: Implementieren** — `src/mcp/node_embed.ts`:

```ts
import { classifyEndpointStatus, type EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { toIndexVector } from "../embed_vector";

/** Erreichbarkeits-Probe via Node-fetch (GET /v1/models) mit Klartext-Diagnose —
 *  Node-Pendant zu http.ts probeEndpoint (das obsidian.requestUrl nutzt).
 *  Node-Gotcha: der Fehlercode steckt in error.cause.code, nicht in der Message. */
export async function nodeProbe(baseUrl: string, timeoutMs = 5000): Promise<EndpointStatus> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) });
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    return classifyEndpointStatus({ kind: "response", status: res.status, body });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") return classifyEndpointStatus({ kind: "timeout" });
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const message = `${String((e as Error).message ?? e)} ${cause?.code ?? cause?.message ?? ""}`;
    return classifyEndpointStatus({ kind: "error", message });
  }
}

/** Query-Text → Vektor im Index-Raum: POST /v1/embeddings, dann toIndexVector
 *  (truncate auf Index-dim + L2-Norm) — exakt die Transformation der Notiz-Vektoren. */
export async function embedQueryVector(endpoint: string, model: string, text: string, dim: number): Promise<Float32Array> {
  const res = await fetch(`${endpoint}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: [text] }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Embedding fehlgeschlagen: HTTP ${res.status}`);
  const data = await res.json() as { data?: { embedding?: number[] }[] };
  const emb = data?.data?.[0]?.embedding;
  if (!Array.isArray(emb)) throw new Error("Embedding: ungültiges Response-Schema (data fehlt)");
  return toIndexVector([new Float32Array(emb)], dim);
}
```

- [ ] **Step 4: Grün verifizieren + Gesamtlauf**

```bash
npx vitest run tests/mcp_node_embed.test.ts && npm test && npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/node_embed.ts tests/mcp_node_embed.test.ts
git commit -m "feat(mcp): Node-fetch-Probe + Query-Embedding im Index-Vektorraum

nodeProbe klassifiziert via classifyEndpointStatus (cause.code-Gotcha von
Node-fetch abgedeckt); embedQueryVector nutzt toIndexVector mit index.dim.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `McpTools` — Index-Laden mit mtime-Reload + `related`

**Files:**
- Create: `src/mcp/tools.ts`
- Test: `tests/mcp_tools.test.ts`

**Interfaces:**
- Consumes: `IndexLoader`, `VaultIndex` aus `../index`; `Retriever`, `Hit` aus `../retriever`; `NodeVaultAdapter` (Task 2); `McpConfig` (Task 3); `EndpointStatus` aus `../vendor/kit/endpoint_diagnostics`.
- Produces:
  - `interface ToolIo { probe(endpoint: string): Promise<EndpointStatus>; embedQuery(endpoint: string, model: string, text: string, dim: number): Promise<Float32Array> }`
  - `interface HitList { hits: { path: string; score: number }[] }`
  - `class McpTools { constructor(cfg: McpConfig, io: ToolIo); related(a: { path: string; k?: number; min_similarity?: number }): Promise<HitList> }`
  - Tasks 6/7 erweitern dieselbe Klasse um `readNote`/`search`; Task 8 instanziiert sie.

**Test-Fixture (wird von Tasks 5–7 geteilt — einmal anlegen):** Kopf von `tests/mcp_tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { McpTools, type ToolIo } from "../src/mcp/tools";
import { loadConfig } from "../src/mcp/config";
import type { McpConfig } from "../src/mcp/config";

/** Mini-Vault mit Index (dim 4): Vektoren pro Pfad, int8-quantisiert wie das Plugin. */
async function makeVaultWithIndex(vecs: Record<string, number[]>): Promise<string> {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-tools-"));
  const dir = path.join(vault, "_vaultrag");
  await fs.mkdir(dir, { recursive: true });
  await writeIndex(dir, vecs);
  return vault;
}

async function writeIndex(dir: string, vecs: Record<string, number[]>): Promise<void> {
  const paths = Object.keys(vecs);
  const dim = vecs[paths[0]].length;
  const i8 = new Int8Array(paths.length * dim);
  paths.forEach((p, r) => vecs[p].forEach((v, c) => { i8[r * dim + c] = Math.round(v * 127); }));
  await fs.writeFile(path.join(dir, "notes.i8"), Buffer.from(i8.buffer));
  await fs.writeFile(path.join(dir, "paths.json"), JSON.stringify(paths));
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({
    schema_version: 1, embedding_model: "test", index_dim: dim, scale: 127,
    count: paths.length, granularity: "note", quant: "int8",
  }));
}

const NO_NET: ToolIo = {
  probe: async () => { throw new Error("kein Netz im Test"); },
  embedQuery: async () => { throw new Error("kein Netz im Test"); },
};

async function makeTools(vault: string, io: ToolIo = NO_NET): Promise<{ tools: McpTools; cfg: McpConfig }> {
  const cfg = await loadConfig(vault, {});
  return { tools: new McpTools(cfg, io), cfg };
}
```

- [ ] **Step 1: Failing Tests schreiben** — an den Fixture-Kopf anhängen:

```ts
describe("McpTools.related", () => {
  it("liefert Nachbarn sortiert, ohne die Notiz selbst, Scores gerundet", async () => {
    const vault = await makeVaultWithIndex({
      "a.md": [1, 0, 0, 0], "fast-a.md": [0.9, 0.1, 0, 0], "quer.md": [0, 0, 1, 0],
    });
    const { tools } = await makeTools(vault);
    const r = await tools.related({ path: "a.md", min_similarity: 0.5 });
    expect(r.hits.map(h => h.path)).toEqual(["fast-a.md"]);
    expect(r.hits[0].score).toBeCloseTo(Math.round(r.hits[0].score * 1000) / 1000, 10);
  });
  it("unbekannter Pfad → Klartext-Fehler", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const { tools } = await makeTools(vault);
    await expect(tools.related({ path: "gibts-nicht.md" })).rejects.toThrow(/nicht im Index/);
  });
  it("fehlender Index → Klartext-Fehler mit Aufbau-Hinweis", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-leer-"));
    const { tools } = await makeTools(vault);
    await expect(tools.related({ path: "a.md" })).rejects.toThrow(/Index im Plugin/);
  });
  it("lädt den Index bei manifest-mtime-Änderung neu", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0], "b.md": [1, 0, 0, 0] });
    const { tools } = await makeTools(vault);
    expect((await tools.related({ path: "a.md" })).hits.map(h => h.path)).toEqual(["b.md"]);
    await new Promise(r => setTimeout(r, 10)); // mtime-Auflösung
    await writeIndex(path.join(vault, "_vaultrag"), { "a.md": [1, 0, 0, 0], "neu.md": [1, 0, 0, 0] });
    expect((await tools.related({ path: "a.md" })).hits.map(h => h.path)).toEqual(["neu.md"]);
  });
});
```

- [ ] **Step 2: Fail verifizieren**

```bash
npx vitest run tests/mcp_tools.test.ts
```

Erwartung: FAIL — Modul `../src/mcp/tools` existiert nicht.

- [ ] **Step 3: Implementieren** — `src/mcp/tools.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IndexLoader, VaultIndex } from "../index";
import { Retriever, Hit } from "../retriever";
import type { EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { NodeVaultAdapter } from "./node_adapter";
import type { McpConfig } from "./config";

/** Netz-Zugriffe injiziert (Node-fetch in node_embed.ts) → Handler bleiben ohne Netz testbar. */
export interface ToolIo {
  probe(endpoint: string): Promise<EndpointStatus>;
  embedQuery(endpoint: string, model: string, text: string, dim: number): Promise<Float32Array>;
}

export interface HitList { hits: { path: string; score: number }[] }

/** Transport-freie Tool-Handler des MCP-Servers — server.ts ist nur die dünne SDK-Schale. */
export class McpTools {
  private index: VaultIndex | null = null;
  private manifestMtimeMs = 0;
  private adapter: NodeVaultAdapter;

  constructor(private cfg: McpConfig, private io: ToolIo) {
    this.adapter = new NodeVaultAdapter(cfg.vaultPath);
  }

  /** Index lazy laden + bei manifest.json-mtime-Änderung neu (das Plugin schreibt
   *  manifest.json als Letztes = fertiger Stand; derselbe Reload-Trigger wie im Plugin). */
  private async currentIndex(): Promise<VaultIndex> {
    const manifestPath = path.join(this.cfg.vaultPath, this.cfg.settings.indexDir, "manifest.json");
    let mtime: number;
    try {
      mtime = (await fs.stat(manifestPath)).mtimeMs;
    } catch {
      throw new Error(`Kein Index unter "${this.cfg.settings.indexDir}/" gefunden — Index im Plugin (neu) aufbauen.`);
    }
    if (!this.index || mtime !== this.manifestMtimeMs) {
      try {
        this.index = await new IndexLoader(this.adapter, this.cfg.settings.indexDir).load();
      } catch (e) {
        throw new Error(`Index unlesbar: ${String((e as Error).message ?? e)} — Index im Plugin (neu) aufbauen.`);
      }
      this.manifestMtimeMs = mtime;
    }
    return this.index;
  }

  private opts(k: number | undefined, minSim: number | undefined) {
    return {
      k: k ?? this.cfg.settings.k,
      minSim: minSim ?? this.cfg.settings.minSim,
      exclude: this.cfg.settings.exclude,
    };
  }

  private static toHitList(hits: Hit[]): HitList {
    return { hits: hits.map(h => ({ path: h.path, score: Math.round(h.score * 1000) / 1000 })) };
  }

  async related(a: { path: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const index = await this.currentIndex();
    if (index.rowFor(a.path) < 0) {
      throw new Error(`Notiz nicht im Index: "${a.path}" — nicht indexiert (exclude-Regel?) oder noch nicht embedded.`);
    }
    return McpTools.toHitList(new Retriever(index).related(a.path, this.opts(a.k, a.min_similarity)));
  }
}
```

- [ ] **Step 4: Grün verifizieren + Gesamtlauf**

```bash
npx vitest run tests/mcp_tools.test.ts && npm test && npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp_tools.test.ts
git commit -m "feat(mcp): McpTools mit mtime-Reload + related-Tool

Index lazy über IndexLoader/NodeVaultAdapter, Reload bei manifest.json-
mtime-Änderung (Plugin-Trigger-Semantik); related offline ohne Embedding-
Call, Klartext-Fehler bei fehlendem Index/Pfad.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `read_note` + Path-Guard

**Files:**
- Modify: `src/mcp/tools.ts` (Funktion `resolveNotePath` + Methode `readNote`)
- Test: `tests/mcp_tools.test.ts` (erweitern)

**Interfaces:**
- Consumes: Fixture + `McpTools` aus Task 5.
- Produces:
  - `function resolveNotePath(vaultRoot: string, rel: string, exclude: string[]): string` — wirft bei Guard-Verstoß, sonst absoluter Pfad. Exportiert (direkt testbar).
  - `McpTools.readNote(a: { path: string }): Promise<{ path: string; content: string }>`

- [ ] **Step 1: Failing Tests schreiben** — in `tests/mcp_tools.test.ts` ergänzen (Import um `resolveNotePath` erweitern):

```ts
describe("resolveNotePath (Guard)", () => {
  const root = "/vault";
  it("akzeptiert vault-relative .md-Pfade", () => {
    expect(resolveNotePath(root, "sub/notiz.md", [])).toBe(path.join(root, "sub/notiz.md"));
  });
  it("weist absolute Pfade ab", () => {
    expect(() => resolveNotePath(root, "/etc/passwd.md", [])).toThrow(/vault-relativ/i);
  });
  it("weist ..-Traversal ab (auch versteckt)", () => {
    expect(() => resolveNotePath(root, "../geheim.md", [])).toThrow(/verlässt/);
    expect(() => resolveNotePath(root, "sub/../../geheim.md", [])).toThrow(/verlässt/);
  });
  it("weist Nicht-Markdown ab", () => {
    expect(() => resolveNotePath(root, "bild.png", [])).toThrow(/\.md/);
  });
  it("weist exclude-Präfixe ab", () => {
    expect(() => resolveNotePath(root, "Templates/t.md", ["Templates/"])).toThrow(/Ausschluss/);
  });
});

describe("McpTools.readNote", () => {
  it("liest den Volltext einer Notiz", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    await fs.writeFile(path.join(vault, "a.md"), "# Inhalt");
    const { tools } = await makeTools(vault);
    expect(await tools.readNote({ path: "a.md" })).toEqual({ path: "a.md", content: "# Inhalt" });
  });
  it("fehlende Datei → Klartext-Fehler", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const { tools } = await makeTools(vault);
    await expect(tools.readNote({ path: "fehlt.md" })).rejects.toThrow(/nicht gefunden/);
  });
});
```

- [ ] **Step 2: Fail verifizieren**

```bash
npx vitest run tests/mcp_tools.test.ts
```

Erwartung: FAIL — `resolveNotePath`/`readNote` existieren nicht.

- [ ] **Step 3: Implementieren** — in `src/mcp/tools.ts` ergänzen:

```ts
/** Path-Guard für read_note: vault-relativ, kein Traversal, nur .md, exclude respektiert.
 *  Was vom Index ausgeschlossen ist, gibt der Server auch nicht als Volltext heraus. */
export function resolveNotePath(vaultRoot: string, rel: string, exclude: string[]): string {
  if (path.isAbsolute(rel)) throw new Error(`Nur vault-relative Pfade erlaubt: "${rel}"`);
  const norm = path.normalize(rel).split(path.sep).join("/");
  if (norm === ".." || norm.startsWith("../")) throw new Error(`Pfad verlässt den Vault: "${rel}"`);
  if (!norm.endsWith(".md")) throw new Error(`Nur Markdown-Notizen (.md) lesbar: "${rel}"`);
  const hit = exclude.find(e => e && norm.startsWith(e));
  if (hit) throw new Error(`Pfad liegt unter Ausschluss-Präfix "${hit}": "${rel}"`);
  return path.join(vaultRoot, norm);
}
```

Und die Methode in `McpTools`:

```ts
  async readNote(a: { path: string }): Promise<{ path: string; content: string }> {
    const abs = resolveNotePath(this.cfg.vaultPath, a.path, this.cfg.settings.exclude);
    try {
      return { path: a.path, content: await fs.readFile(abs, "utf-8") };
    } catch {
      throw new Error(`Notiz nicht gefunden: "${a.path}"`);
    }
  }
```

- [ ] **Step 4: Grün verifizieren + Gesamtlauf**

```bash
npx vitest run tests/mcp_tools.test.ts && npm test && npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp_tools.test.ts
git commit -m "feat(mcp): read_note mit Path-Guard

resolveNotePath: vault-relativ, kein ..-Traversal, nur .md, exclude-
Präfixe verweigert (was der Index nicht kennt, liefert der Server nicht).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `search` — Endpoint-Auflösung mit Cache + genau 1 Retry

**Files:**
- Modify: `src/mcp/tools.ts` (Methoden `ensureEndpoint` + `search`)
- Test: `tests/mcp_tools.test.ts` (erweitern)

**Interfaces:**
- Consumes: `normalizeEndpoint` aus `../vendor/kit/endpoint`; `ToolIo` (Task 5).
- Produces: `McpTools.search(a: { query: string; k?: number; min_similarity?: number }): Promise<HitList>`. Endpoint-Semantik wie im Plugin: erster erreichbarer aus der Liste gewinnt, wird gecacht; bei Embed-Fehler genau EIN Re-Resolve + Retry.

- [ ] **Step 1: Failing Tests schreiben** — in `tests/mcp_tools.test.ts` ergänzen:

```ts
describe("McpTools.search", () => {
  const okStatus = { reachable: true, kind: "ok", klartext: "Verbunden" } as const;
  const downStatus = { reachable: false, kind: "refused", klartext: "Verbindung abgelehnt — Server läuft nicht oder Port falsch." } as const;

  it("bettet die Query ein und rankt gegen den Index", async () => {
    const vault = await makeVaultWithIndex({ "treffer.md": [1, 0, 0, 0], "daneben.md": [0, 1, 0, 0] });
    const io: ToolIo = {
      probe: async () => okStatus,
      embedQuery: async () => new Float32Array([1, 0, 0, 0]),
    };
    const { tools } = await makeTools(vault, io);
    const r = await tools.search({ query: "egal", min_similarity: 0.5 });
    expect(r.hits.map(h => h.path)).toEqual(["treffer.md"]);
  });
  it("nimmt den ersten erreichbaren Endpoint (Fallback-Liste) und cached ihn", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const cfg = await loadConfig(vault, {});
    cfg.settings.embeddingEndpoints = ["http://tot:1", "http://lebt:2/v1"];
    const probed: string[] = [];
    const usedEndpoints: string[] = [];
    const tools = new McpTools(cfg, {
      probe: async ep => { probed.push(ep); return ep.includes("lebt") ? okStatus : downStatus; },
      embedQuery: async ep => { usedEndpoints.push(ep); return new Float32Array([1, 0, 0, 0]); },
    });
    await tools.search({ query: "q" });
    await tools.search({ query: "q2" });
    expect(usedEndpoints).toEqual(["http://lebt:2", "http://lebt:2"]); // normalisiert (/v1 gestrippt) + gecacht
    expect(probed.filter(p => p.includes("lebt")).length).toBe(1);      // zweiter Call ohne Re-Probe
  });
  it("kein Endpoint erreichbar → Fehler listet Klartext-Diagnosen", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const { tools } = await makeTools(vault, {
      probe: async () => downStatus,
      embedQuery: async () => { throw new Error("unerreichbar"); },
    });
    await expect(tools.search({ query: "q" })).rejects.toThrow(/Verbindung abgelehnt/);
  });
  it("Embed-Fehler → genau ein Re-Resolve + Retry", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    let embedCalls = 0;
    const { tools } = await makeTools(vault, {
      probe: async () => okStatus,
      embedQuery: async () => {
        embedCalls++;
        if (embedCalls === 1) throw new Error("Verbindung riss");
        return new Float32Array([1, 0, 0, 0]);
      },
    });
    const r = await tools.search({ query: "q" });
    expect(embedCalls).toBe(2);
    expect(r.hits.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Fail verifizieren**

```bash
npx vitest run tests/mcp_tools.test.ts
```

Erwartung: FAIL — `search` existiert nicht.

- [ ] **Step 3: Implementieren** — in `src/mcp/tools.ts`: Import ergänzen (`import { normalizeEndpoint } from "../vendor/kit/endpoint";`), Feld `private activeEndpoint: string | null = null;` in der Klasse, dann:

```ts
  /** Erster erreichbarer Endpoint der Fallback-Liste (normalisiert), gecacht.
   *  Nicht erreichbar → Fehler mit Klartext-Diagnose PRO Endpoint (classify-Klassen). */
  private async ensureEndpoint(): Promise<string> {
    if (this.activeEndpoint) return this.activeEndpoint;
    const failures: string[] = [];
    for (const raw of this.cfg.settings.embeddingEndpoints) {
      if (!raw?.trim()) continue;
      const ep = normalizeEndpoint(raw);
      const status = await this.io.probe(ep);
      if (status.reachable) { this.activeEndpoint = ep; return ep; }
      failures.push(`${ep}: ${status.klartext}`);
    }
    throw new Error(`Kein Embedding-Endpunkt erreichbar.\n${failures.join("\n")}`);
  }

  async search(a: { query: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const index = await this.currentIndex();
    const embedOnce = async () =>
      this.io.embedQuery(await this.ensureEndpoint(), this.cfg.settings.embeddingModel, a.query, index.dim);
    let vec: Float32Array;
    try {
      vec = await embedOnce();
    } catch {
      this.activeEndpoint = null; // Plugin-Semantik: genau EIN Re-Resolve + Retry
      vec = await embedOnce();
    }
    return McpTools.toHitList(new Retriever(index).search(vec, this.opts(a.k, a.min_similarity)));
  }
```

- [ ] **Step 4: Grün verifizieren + Gesamtlauf**

```bash
npx vitest run tests/mcp_tools.test.ts && npm test && npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp_tools.test.ts
git commit -m "feat(mcp): search-Tool mit Endpoint-Fallback-Cache + 1-Retry

Erster erreichbarer Endpoint gewinnt (normalisiert, gecacht); Embed-
Fehler → genau ein Re-Resolve+Retry (Plugin-Semantik); unreachable →
Klartext-Diagnose pro Endpoint.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `server.ts` + SDK + esbuild-Target + Smoke

**Files:**
- Create: `src/mcp/server.ts`
- Modify: `package.json` (devDeps `@modelcontextprotocol/sdk`, `zod`), `esbuild.config.mjs`, `tsconfig.json` (`resolveJsonModule`), `.gitignore` (`mcp-server.js`)

**Interfaces:**
- Consumes: `loadConfig` (Task 3), `McpTools` (Tasks 5–7), `nodeProbe`/`embedQueryVector` (Task 4), Plugin-`manifest.json` (Version).
- Produces: gebündeltes `mcp-server.js` — `node mcp-server.js <vault-pfad>`, MCP über stdio mit den Tools `search`/`related`/`read_note`.

- [ ] **Step 1: Dependencies + Configs**

```bash
npm install -D @modelcontextprotocol/sdk zod
```

`tsconfig.json` compilerOptions ergänzen: `"resolveJsonModule": true`.

`.gitignore`: Zeile `mcp-server.js` ergänzen (unter `main.js`).

`esbuild.config.mjs` komplett ersetzen durch:

```js
import esbuild from "esbuild";
const prod = process.argv[2] === "production";
const common = { bundle: true, sourcemap: prod ? false : "inline", logLevel: "info" };
const plugin = await esbuild.context({
  ...common, entryPoints: ["src/main.ts"], format: "cjs",
  target: "es2020", external: ["obsidian", "electron"], outfile: "main.js",
});
// MCP-Server: ESM (package.json type:module), Node-Builtins bleiben external via platform:node.
// Banner-Shim, weil eingebündelte CJS-Deps unter ESM sonst an dynamischem require scheitern.
const mcp = await esbuild.context({
  ...common, entryPoints: ["src/mcp/server.ts"], format: "esm",
  platform: "node", target: "node18", outfile: "mcp-server.js",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
if (prod) { await plugin.rebuild(); await mcp.rebuild(); process.exit(0); }
else { await plugin.watch(); await mcp.watch(); }
```

- [ ] **Step 2: `src/mcp/server.ts` implementieren**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import { loadConfig } from "./config";
import { McpTools } from "./tools";
import { nodeProbe, embedQueryVector } from "./node_embed";
import manifest from "../../manifest.json";

/** Dünne SDK-Schale um McpTools: Arg-Parsing, Tool-Registrierung, Fehler → isError.
 *  stdout gehört dem Protokoll — Diagnose ausschließlich über stderr. */
const vaultPath = process.argv[2];
if (!vaultPath || !fs.existsSync(vaultPath)) {
  console.error("Usage: node mcp-server.js /pfad/zum/vault  (Vault-Ordner muss existieren)");
  process.exit(1);
}

const cfg = await loadConfig(vaultPath, process.env);
const tools = new McpTools(cfg, { probe: nodeProbe, embedQuery: embedQueryVector });
const server = new McpServer({ name: "vault-retrieval", version: manifest.version });

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

await server.connect(new StdioServerTransport());
console.error(`vault-retrieval MCP ${manifest.version} bereit — Vault: ${vaultPath}`);
```

Hinweis für den Implementer: Sollte die installierte SDK-Version eine abweichende `registerTool`-Signatur haben (die API hieß früher `server.tool(...)`), gilt die SDK-eigene Typsignatur — der Handler-Inhalt bleibt identisch. `npm run typecheck` ist der Schiedsrichter.

- [ ] **Step 3: Bauen + Usage-Smoke**

```bash
npm run build
node mcp-server.js; echo "exit=$?"
```

Erwartung: Build erzeugt `main.js` UND `mcp-server.js`; der Aufruf ohne Arg druckt die Usage-Zeile auf stderr und `exit=1`.

- [ ] **Step 4: Protokoll-Smoke (Handshake + tools/list)**

```bash
mkdir -p /tmp/vaultrag-smoke-vault
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node mcp-server.js /tmp/vaultrag-smoke-vault | tr ',' '\n' | grep -o '"name":"[a-z_]*"' | sort -u
```

Erwartung: die drei Zeilen `"name":"read_note"`, `"name":"related"`, `"name":"search"` (Reihenfolge egal). Damit ist bewiesen: Bundle lauffähig, Handshake ok, Tools registriert.

- [ ] **Step 5: Gesamtlauf**

```bash
npm test && npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts esbuild.config.mjs tsconfig.json .gitignore package.json package-lock.json
git commit -m "feat(mcp): stdio-Server — 3 Tools über den vault-rag-Index

@modelcontextprotocol/sdk + zod eingebündelt (zweiter esbuild-Entry →
mcp-server.js, Node-ESM); search/related/read_note registriert, Fehler
als isError-Klartext, stderr-Diagnose. Usage- + Handshake-Smoke grün.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Doku — README, AGENTS.md

**Files:**
- Modify: `README.md` (neue Sektion, englisch — README ist EN-kanonisch), `AGENTS.md` (Modul-Layout + Commands, deutsch)

- [ ] **Step 1: README-Sektion ergänzen** (nach der Config-Tabelle / vor Contributing; Wortlaut):

```markdown
## MCP server (use your index from Claude Code & other agents)

The plugin's embedding index doubles as a retrieval backend for MCP clients
(Claude Code, OpenClaw, …). A bundled stdio server exposes three read-only tools:

| Tool | What it does | Needs endpoint? |
|---|---|---|
| `search` | Semantic search over the vault (query → `{path, score}` hits) | yes (embeds the query) |
| `related` | Notes related to a given note (straight from the index) | no — works offline |
| `read_note` | Full markdown text of a note (`.md` only, excludes respected) | no — works offline |

Build once (`npm run build` produces `mcp-server.js`), then register it,
e.g. in Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "vault-retrieval": {
      "command": "node",
      "args": ["/path/to/vault-rag/mcp-server.js", "/path/to/your/vault"]
    }
  }
}
```

Configuration (endpoints, index folder, excludes) is read from the plugin's
own settings (`.obsidian/plugins/vault-retrieval/data.json`) — change it in
Obsidian, the server follows. Env overrides: `VAULT_RAG_EMBEDDING_ENDPOINT`,
`VAULT_RAG_EMBEDDING_MODEL`, `VAULT_RAG_INDEX_DIR`. One server instance per vault.
The server never writes to your vault.
```

- [ ] **Step 2: AGENTS.md aktualisieren**

Im Modul-Layout-Block (`src/`) nach `hub_view.ts` ergänzen:

```
settings_core.ts  Obsidian-freie Settings-Wahrheit: VaultRagSettings · DEFAULT_SETTINGS ·
                  migrateEndpointList — von settings.ts re-exportiert, vom MCP-Server direkt genutzt.
mcp/              Headless stdio-MCP-Server (2. esbuild-Entry → mcp-server.js, Node-Programm,
                  NIE obsidian importieren): server.ts (SDK-Schale) · tools.ts (search/related/
                  read_note, mtime-Reload) · config.ts (liest Plugin-data.json) ·
                  node_adapter.ts (read-only VaultAdapter) · node_embed.ts (fetch-Probe/-Embedding).
```

Im Commands-Block die Build-Zeile ergänzen um: `# baut main.js UND mcp-server.js`. In den Gotchas ergänzen:

```
- **`mcp-server.js`** ist Build-Artefakt (gitignored) — der MCP-Server für externe Clients
  (`node mcp-server.js <vault>`); Spec `docs/superpowers/specs/2026-07-09-mcp-server-design.md`.
  obsidianmd-ESLint-Regeln gelten für `src/mcp/**` bewusst nicht (Node-Programm, fetch erlaubt).
```

- [ ] **Step 3: Verifizieren + Commit**

```bash
npm test && npm run typecheck && npm run lint
git add README.md AGENTS.md
git commit -m "docs: MCP-Server dokumentieren (README-Sektion + AGENTS.md-Layout)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Abschluss (nach Task 9)

- Finale Whole-Branch-Review (superpowers:requesting-code-review) + User-GUI-/CLI-Smoke: `.mcp.json` im echten Setup gegen den Pallas-Vault, `search`/`related`/`read_note` aus Claude Code aufrufen.
- Danach Release-Entscheidung (0.11.0) — separater Schritt, `npm run release` (Codeberg-500-Gotcha: einfach nochmal laufen lassen).
