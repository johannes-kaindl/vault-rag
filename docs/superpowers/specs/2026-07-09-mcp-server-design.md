# MCP-Server auf dem vault-rag-Index — Design

**Datum:** 2026-07-09 · **Status:** freigegeben (Brainstorming-Session mit Johannes)

## Ziel

Externe LLM-Clients (Claude Code, OpenClaw) bekommen über einen lokalen MCP-Server
(stdio) Zugriff auf das vault-rag-Retrieval: semantische Suche, Related-Notes und
Notiz-Volltext. Der Server ist ein **zweites, headless Frontend** auf denselben
pure-core-Modulen wie das Plugin — kein neues Retrieval-System, kein zweites
Embedding-System (Abgrenzung: der eingefrorene hyperforge-FastMCP-Server mit
eigenem Qdrant-Index, Stand April).

**Warum das trägt:** Der `_vaultrag/`-Index (`notes.i8` + `paths.json` +
`manifest.json`) liegt als normale Dateien im Vault, wird vom Plugin live gepflegt
und ist ohne Obsidian lesbar. Die Kern-Module (`parseIndex`, `Retriever`,
`toIndexVector`) sind obsidian-frei und node-lauffähig.

## Entscheidungen (Brainstorming)

| Frage | Entscheidung |
|---|---|
| Tool-Scope | `search` + `related` + `read_note` (read-only) |
| Transport | Nur stdio, lokal. HTTP später nachrüstbar (hyperforge-ADR-004 als Blaupause) |
| Standort | Im vault-rag-Repo als zweites Build-Target (Präzedenzfall Smart Apply: „es ist RAG") |
| Implementierung | Offizielles `@modelcontextprotocol/sdk` (devDependency, eingebündelt) |
| Config | Plugin-`data.json` mitlesen; Vault-Pfad einziges Pflicht-Arg; Env-Overrides |

## Architektur

```
src/mcp/
  server.ts        Entry: MCP-SDK (stdio), registriert 3 Tools, Arg-Parsing (Vault-Pfad)
  node_adapter.ts  VaultAdapter über Node-fs (nur read/readBinary; write/mkdir werfen —
                   der Server ist per Konstruktion read-only)
  node_embed.ts    Dünner Node-fetch-Call auf POST /v1/embeddings (statt http.ts, das
                   obsidian.requestUrl kapselt) + reuse toIndexVector/endpoint-Utils
  config.ts        Liest <vault>/.obsidian/plugins/vault-retrieval/data.json, merged mit
                   DEFAULT_SETTINGS (mergeSettings inkl. migrateEndpointList), Env-Overrides
```

**Direkt wiederverwendet, unverändert:** `IndexLoader`/`parseIndex`/`VaultIndex`
(`index.ts`), `Retriever` (`retriever.ts`), `toIndexVector` (`embed_vector.ts`),
`resolveActiveEndpoint`/`normalizeEndpoint`/`classifyEndpointStatus` (`vendor/kit`).

**Build:** zweiter esbuild-Entry `src/mcp/server.ts` → `mcp-server.js`
(Node-Target, gitignored wie `main.js`). Das SDK wird eingebündelt — die
Null-Runtime-Deps-Eigenschaft des Repos bleibt. Plugin-Release-Assets unberührt.

**Index-Aktualität:** vor jedem Tool-Call `manifest.json`-mtime prüfen, bei
Änderung Index neu laden. Das Plugin schreibt `manifest.json` als Letztes
(= fertiger Stand) — derselbe Reload-Trigger wie im Plugin.

## Die drei Tools

### `search` — semantische Suche

- **Input:** `query` (string, Pflicht) · `k` (optional; Default = Settings-`k`,
  Werksdefault 20) · `min_similarity` (optional; Default = Settings-`minSim`,
  Werksdefault 0.3).
- **Ablauf:** Query via Embedding-Endpoint einbetten → `toIndexVector(256)` →
  `retriever.search()`.
- **Output:** Liste `{path, score}` — bewusst schlank; der Client entscheidet, was er liest.
- **Online-only** (braucht den Embedding-Endpoint, wie die Plugin-Suche).

### `related` — Nachbarn einer Notiz

- **Input:** `path` (Vault-relativ, Pflicht) · `k` · `min_similarity` (optional).
- **Ablauf:** `retriever.related(path)` — Vektor kommt aus dem Index, **kein
  Embedding-Call** → funktioniert komplett offline.
- Pfad nicht im Index → klare Fehlermeldung mit Hinweis (nicht indexiert /
  exclude-Regel / noch nicht embedded) statt leerer Liste.

### `read_note` — Notiz-Volltext

- **Input:** `path` (Vault-relativ, Pflicht).
- **Output:** Markdown-Inhalt + Pfad.
- **Guards:** Pfad wird gegen den Vault-Root aufgelöst und muss darin bleiben
  (kein `../`-Traversal, keine absoluten Pfade); nur `.md`-Dateien; Pfade unter
  den `exclude`-Präfixen der Settings werden verweigert (was vom Index
  ausgeschlossen ist, gibt der Server auch nicht als Volltext heraus).

**Gemeinsam:** `exclude` aus den Plugin-Settings gilt für alle drei Tools (bei
search/related filtert der Retriever). Scores auf 3 Nachkommastellen gerundet,
Ergebnisse als kompaktes JSON im Tool-Result-Text.

## Config & Startup

- Aufruf: `node mcp-server.js /pfad/zum/vault` — Vault-Pfad einziges Pflicht-Argument.
- `config.ts` liest die Plugin-`data.json`, merged mit `DEFAULT_SETTINGS`. Fehlt
  `data.json`, laufen die Defaults (`related`/`read_note` sofort nutzbar; `search`
  meldet ggf. Endpoint-Fehler).
- **Env-Overrides:** `VAULT_RAG_EMBEDDING_ENDPOINT` · `VAULT_RAG_EMBEDDING_MODEL` ·
  `VAULT_RAG_INDEX_DIR`.
- Endpoint-Auflösung via `resolveActiveEndpoint` über die `embeddingEndpoints`-Liste
  (erster erreichbarer gewinnt) — dieselbe Fallback-Semantik wie im Plugin.

## Fehlerbehandlung

- Alle Fehler als MCP-Tool-Errors mit Klartext; Endpoint-Fehler über die
  `classifyEndpointStatus`-Klassen (refused / unknown-host / timeout /
  not-an-llm-api) aus dem Kit.
- Fehlender/korrupter Index → Fehlermeldung mit Hinweis „Index im Plugin (neu) aufbauen".
- Tool-Fehler crashen den Server-Prozess nicht. stderr für Diagnose-Logs
  (stdout gehört dem Protokoll).

## Testing

Node-testbar wie der Rest des Repos (vitest):

- `node_adapter` gegen fs-Fixtures (inkl. write/mkdir-wirft-Assertion).
- `config`: data.json-Merge, fehlende Datei, Env-Overrides.
- Path-Guard: `../`-Traversal, absolute Pfade, Nicht-`.md`, exclude-Präfixe.
- Tool-Handler mit gemocktem Embedder gegen einen Mini-Fixture-Index
  (search/related/read_note happy path + Fehlerfälle).
- Der SDK-Transport selbst wird **nicht** getestet (fremdes Protokoll) — die
  Handler werden transport-frei geschnitten und direkt getestet.

## Lint/Typecheck

- `src/mcp/` läuft im selben `tsc --noEmit`.
- ESLint: obsidianmd-Regeln (z. B. fetch-Verbot) für `src/mcp/**` per Override
  deaktiviert — sie gelten nur für Plugin-Code; der MCP-Code ist ein Node-Programm.

## Client-Anbindung (Doku im README)

- Claude Code: Eintrag in `.mcp.json` → `node …/mcp-server.js <vault>`.
- OpenClaw: analoge MCP-Config (stdio).
- Pro Vault eine Server-Instanz.

## Bewusst NICHT im Scope (YAGNI)

- HTTP-Transport / Bearer-Auth / Daemon (später nachrüstbar).
- Schreib-Tools (classify/promote/…) — Vault-Writes von externen LLMs brauchen
  eigene Guard-Rails.
- Chunk-level Retrieval (der Index ist note-level; das ist sein Format).
- npm-Publish / eigenes Package (Start aus dem lokalen Repo).
