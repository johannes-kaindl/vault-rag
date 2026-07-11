# MCP-Server in-Plugin (HTTP) — Ablösung des stdio-Companion

**Datum:** 2026-07-11
**Status:** Design (brainstorming abgeschlossen, User-approved)
**Slice-Ziel:** Externer LLM-Zugriff (MCP) wird echte Plugin-Funktionalität *und* der Obsidian-Community-Review erreicht **Pass = null Warnings**.

## Motivation

Der 0.12.0-Community-Review warf **5 Warnings**, alle im nicht-gebündelten Node-CLI unter `src/mcp/`
(`node:fs`/`node:path`/`fetch`). Der Review-Bot scannt *alle* `.ts`-Dateien und kann Plugin- von
Companion-Code nicht unterscheiden.

Ursprünglich war „raus-splitten in ein eigenes Repo" geplant. Beim Brainstorming zeigte sich ein
**besserer Weg**: Der externe Zugriff war vom Nutzer als **Plugin-Funktionalität** gedacht
(„andere LLMs/Agents greifen auf Vault-Infos zu"), nicht als manuell zu installierendes Zweit-Tool.
Das TaskNotes-Plugin (`callumalpass/tasknotes`, Community-Directory-gelistet) belegt, dass ein
Obsidian-Plugin einen **in-process HTTP-Server** hosten kann, der einen echten MCP-Server über den
**Streamable-HTTP-Transport** bedient — solange Obsidian läuft. Der Nutzer hat bestätigt: „läuft nur,
solange Obsidian offen ist" ist in Ordnung.

Damit fällt der Split komplett weg. Der MCP-Code kommt **zurück ins Plugin**, die Node-Adapter-Schicht
(die Warnings-Quelle) entfällt ersatzlos, und die geteilten Module (`index.ts`/`retriever.ts`/
`embed_vector.ts`) leben ohnehin schon dort — **kein Vendoring-Problem**.

## Ziele

1. `src/mcp/`-stdio-CLI → in-Plugin HTTP-MCP-Server umbauen.
2. Kein Node-only-Code mehr, der den Review triggert → **Pass**.
3. Externer Zugriff „out of the box": Plugin installieren → Toggle in Settings → Claude Code verbinden.
4. Die **drei bestehenden read-only Tools** (`search`/`related`/`read_note`) unverändert im Verhalten.

## Nicht-Ziele (bewusst geparkt)

- **Write-Tools** (create/append/patch). Andere Sicherheits-/Design-Kategorie (Vault-Mutation durch
  externen Agent, Konflikt mit Live-Indexer, bricht die read-only-Grenze). Später, additiv.
- **Weitere read-Tools** (`list_notes`/`get_backlinks`/`get_tags`/…), MCP **Resources**/**Prompts**.
  YAGNI; die HTTP-MCP-Infrastruktur dieser Slice ist das Fundament für spätere additive Erweiterung.
- **Obsidian-unabhängiger Betrieb** (Server ohne laufendes Obsidian). Der stdio-Modus, der das konnte,
  wird bewusst abgelöst — der Nutzer braucht ihn nicht.
- **LAN-/Remote-Zugriff.** Server bindet ausschließlich auf Loopback.

## Architektur

### Referenz-Muster (TaskNotes, verifiziert)

- **Ein** `node:http`-Server auf `127.0.0.1` (Loopback), bedient eine Route `/mcp`.
- MCP über `StreamableHTTPServerTransport` (stateless mode) aus `@modelcontextprotocol/sdk`
  — exakt das SDK, das vault-rag bereits als devDep hat (0.11.0).
- **Mobile-Gate:** `if (Platform.isMobile || !settings.mcpEnabled) return;` + **dynamischer**
  `import()` des Server-Moduls → `require("node:http")` wird auf Mobile nie geladen.
- `eslint-disable` mit Begründungskommentar an der `require("http")`-Stelle (dokumentierte,
  review-taugliche Ausnahme; `isDesktopOnly` bleibt `false`, Plugin läuft weiter auf Mobile).
- Claude Code verbindet direkt: `claude mcp add --transport http vault-retrieval http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"` — **kein** `mcp-remote`, kein Fremdprozess.

### Modul-Umbau in `src/`

Der bestehende `src/mcp/`-Code ist bereits gut geschnitten: **`McpTools` (tools.ts) ist transport-frei
und IO-injiziert** (`ToolIo`-Interface). Die Kern-Logik bleibt daher weitgehend erhalten; nur die
*Adapter* werden von Node auf Obsidian/Plugin-Objekte getauscht.

| Datei | Aktion |
|---|---|
| `src/mcp/tools.ts` (`McpTools`) | **bleibt** (Kern-Logik). `NodeVaultAdapter`-Konstruktorabhängigkeit + fs-Zugriffe in `readNote`/`currentIndex` werden auf den Obsidian-`VaultAdapter` bzw. den live gehaltenen Index umgestellt (s. u.). |
| `src/mcp/server.ts` (stdio) | **ersetzt** durch neues `src/mcp_server.ts`: `node:http`-Server + `/mcp`-Route + `StreamableHTTPServerTransport`. Tool-Registrierung (`search`/`related`/`read_note` mit denselben zod-Schemas + `wrap`-Fehlerhülle) bleibt inhaltlich identisch. |
| `src/mcp/node_adapter.ts` | **entfällt** — das Plugin liefert `this.app.vault.adapter`. |
| `src/mcp/node_embed.ts` | **entfällt** — `ToolIo.embedQuery` wird über den Plugin-`embedder` (`embed([query])` → `toIndexVector(vecs, index.dim)`) implementiert; `probe` über `embedder.probe()`. Beides via `http.ts`/`requestUrl`, kein node-`fetch`. |
| `src/mcp/config.ts` | **entfällt** — Config kommt aus den im Plugin schon geladenen `this.settings`. |
| `manifest.json` | `isDesktopOnly` bleibt `false`. |

### Index & Endpoint: an Live-Plugin-Objekte anschließen

- **Index:** `main.ts` hält `this.index: VaultIndex | null` (via `loadIndex`, index-guard-klassifiziert)
  live im Speicher. Der Server liest **diesen** Index statt per `fs.stat`-mtime von Platte neu zu laden.
  `McpTools.currentIndex()` wird zu einem Getter auf den vom Plugin injizierten aktuellen `VaultIndex`
  (kein Polling; das Plugin aktualisiert `this.index` bei Reindex/Reload ohnehin). Kein Index →
  klare Fehlermeldung „Index im Plugin (neu) aufbauen".
- **Endpoint:** Der Plugin-`embedder` ist bereits auf einen **erreichbaren** Endpoint verdrahtet
  (`resolveAndReconnectEmbedder`). Die `ensureEndpoint`-Fallback-Schleife in `McpTools` wird dadurch
  überflüssig und **vereinfacht**: `search` nutzt direkt `embedder.embed([query])` → `toIndexVector`.
  (Ein-Retry-/Re-Resolve-Nuance des stdio-Servers ist im Plugin-Kontext bereits durch die
  embedder-Reconnect-Logik abgedeckt — Detail beim Planen.)
- **`read_note`:** Pfad-Guard `resolveNotePath` (vault-relativ, kein Traversal, nur `.md`,
  exclude-Präfix case-insensitiv) **bleibt**. Der Volltext kommt über `VaultAdapter.read(path)` statt
  `fs.readFile`; der `fs.realpath`-Symlink-Escape-Check entfällt, weil der Obsidian-Adapter
  vault-relativ operiert (kein absoluter FS-Pfad mehr, den man verlassen könnte).

## Server-Lifecycle

- **Start:** in `main.ts` `onload` (bzw. `onLayoutReady`), gegated (`Platform.isMobile` / `mcpEnabled`),
  danach dynamischer `import("./mcp_server")` + `start(port, token, deps)`.
- **Stop:** `server.close()` in `onunload` **und** bei Settings-Toggle-off / Port-/Token-Änderung
  (Neustart des Servers).
- **Fehler beim Binden** (Port belegt): laute `Notice` + Statuszeile, Toggle bleibt an, aber Server aus.

## Settings & Sicherheit

Neue Settings-Sektion **„MCP-Server (externer Zugriff)"** in `settings.ts`/`settings_core.ts`:

| Setting | Default | Anmerkung |
|---|---|---|
| `mcpEnabled` | **`false`** (opt-in) | Server ist Angriffsfläche; bewusst aus. |
| `mcpPort` | **`8123`** | eigener Default (nicht TaskNotes' 8080), konfigurierbar. |
| `mcpToken` | **beim Aktivieren automatisch generiert** | leer = jede lokale Browser-Seite könnte zugreifen; Auto-Token vermeidet das. |

- **Bind ausschließlich `127.0.0.1`.**
- **Bearer-Token erzwungen auch auf `/mcp`** (401 ohne/falschen Token).
- **CORS:** nur Loopback-Origins zulassen (kein `*`).
- Settings zeigen die fertige **`claude mcp add …`-Zeile zum Kopieren** (inkl. Port + Token).

## Tools (unverändert, read-only)

1. `search(query, k?, min_similarity?)` — Query-Embedding + Cosinus → `{path, score}[]`.
2. `related(path, k?, min_similarity?)` — offline aus dem Index.
3. `read_note(path)` — Volltext, Pfad-Guard + exclude-Regeln.

Fehler → `isError`-Antwort mit Klartext (bestehende `wrap`-Hülle).

## Build / Release / Doku (Abbau)

- `esbuild.config.mjs`: **zweites MCP-Target entfernen**; `mcp_server.ts` wird in `main.js` gebündelt.
- `package.json`: `build` vereinfachen (nur noch `main.js`). `@modelcontextprotocol/sdk`+`zod`
  **bleiben `devDependencies`** — esbuild bündelt sie in `main.js` (`external: [obsidian, electron]`),
  „Null-Runtime-Deps" bleibt erhalten. Release-Assets bleiben `main.js`/`manifest.json`/`styles.css`.
- `mcp-server.js` aus `.gitignore`/Doku/Release-Notizen entfernen; obsolete stdio-Anleitung raus.
- `AGENTS.md` (Modul-Layout, Gotchas), `README.md`, CHANGELOG, `../REGISTRY.md` (MCP-Muster-Eintrag)
  aktualisieren: „MCP jetzt in-Plugin (HTTP), stdio-CLI entfernt".
- Der 0.11.0-Reviewer-Antwort-Draft wird obsolet — das nächste Release meldet stattdessen
  „Node-CLI entfernt, MCP in-Plugin".

## Testing

- **Tool-Logik-Tests** bleiben node-testbar (McpTools mit gemocktem VaultAdapter + IO), wie heute.
- **Neu:** HTTP-Route-Test — Auth-Guard (401 ohne/falscher Token) + MCP-Handshake gegen
  `StreamableHTTPServerTransport` (in-memory bzw. Loopback-Port im Test) + je ein Tool-Call über HTTP.
- **Mobile-Gate-Test:** bei `Platform.isMobile` wird der Server nicht gestartet / kein `node:http`-Import.
- **Manueller Smoke:** `claude mcp add --transport http …` gegen laufendes Obsidian, ein `search`-Call
  liefert echte Treffer.
- Alle bestehenden Tests bleiben grün; `lint`/`typecheck` 0.

## Bestätigte Detail-Entscheidungen

- Server-Default **aus**, Port **8123**, Token **auto-generiert** — vom User bestätigt.
- Write-Tools + weitere MCP-Funktionen **geparkt** — vom User bestätigt.
- stdio-Server **wird ersetzt** (nicht parallel behalten) — vom User bestätigt.
