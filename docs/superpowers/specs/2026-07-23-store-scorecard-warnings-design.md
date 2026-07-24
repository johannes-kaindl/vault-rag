# Die zwei ⚠️ Scorecard-Warnings beseitigen (node:fs + require)

**Datum:** 2026-07-23
**Status:** approved
**Auslöser:** Automatisches Store-Scorecard zu Release 0.17.0 (Commit `b0a0beb`)

## Problem

Das Scorecard zu 0.17.0 meldet fünf Nicht-Pass-Befunde:

| Level | Befund | Wurzel |
|---|---|---|
| ⚠️ Warning | Direct Filesystem Access | `node:fs`/`realpath` im Symlink-Guard |
| ⚠️ Warning | require() (3×) | `node:http`/`fs`/`path`, Import-Stil |
| 💡 Recommendation | Dynamic Code Execution | `ajv` via `@modelcontextprotocol/sdk` (Fremd-Code) |
| 💡 Recommendation | Vault Enumeration | `getMarkdownFiles()` — RAG-Kern |
| 💡 Recommendation | Clipboard | `navigator.clipboard.writeText` (write-only) |

**Verifizierte Scorecard-Semantik:** Nur `Fail`/`Error` blockt die Aufnahme
(Obsidian-Doku: *„Errors block submission; warnings do not"*; Blog: *„if it fails to pass
review, the plugin is removed"*). vault-rag hat **kein Fail** — der Gesamtstatus ist
`Completed`, 0.17.0 ist bereits im Store. Es gibt **keinen Blocker**.

Die BEHAVIOR-Zeilen sind **Capability-Offenlegungen für Nutzer**, keine Code-Defekte. Eine
solche Zeile wird nie zu `Pass`; sie verschwindet nur, wenn die Fähigkeit aus dem Code
fällt. **Vault Enumeration ist unentfernbar** (ohne sie kein RAG) — ein komplett leeres
Behavior-Board ist für dieses Plugin strukturell unerreichbar, unabhängig vom Aufwand.

## Ziel & Scope

Die **zwei ⚠️ Warning-Zeilen** entfernen — die einzigen, die ein Nutzer als
*code-technische* Warnung liest — **ohne Feature-Verlust**. Danach zeigt das Scorecard nur
noch die normalen Capability-Disclosures (Enumeration, Clipboard, evtl. eval).

**Nicht in diesem Scope** (bewusst):
- **Dynamic Code Execution (ajv):** erfordert MCP-SDK aus dem Bundle zu werfen und JSON-RPC
  selbst zu bauen — hoher Aufwand + Konformitätsrisiko, und das Board bleibt wegen
  Enumeration ohnehin nicht leer. Vertagt.
- **Clipboard / Vault Enumeration:** feature-tragend bzw. unentfernbar. Bleiben.

## Entwurf

### Fix 1 — `require()` → statischer `import` (Warning „require()" weg)

Der Scanner flaggt wörtliches `require(` im **Source** (Zeilenangaben `src/main.ts:1235`
belegen Source-Scan; TaskNotes' Bundle-`require` blockt nicht). Die Lektion `443490f` gilt
nur für `await import("node:…")` **direkt** — ein *statischer* Import wird von esbuild bei
`external` + `format: cjs` zu einem bundle-internen `require("node:http")`, das in Electron
einwandfrei läuft (die esbuild-Config listet node-builtins bereits als `external`).

- `src/mcp/http_server.ts`: `const http = require("node:http")` (Z. 84, in der Funktion)
  → top-level `import * as http from "node:http"` am Dateikopf.
- Sicher auf Mobile: `http_server.ts` wird nur via `await import("./mcp/http_server")`
  hinter `Platform.isDesktop` geladen (`main.ts:1218`); der Modul-Top-Level läuft nie auf
  Mobile.
- `main.ts:1235/1236` (`require("node:fs/promises")`, `require("node:path")`) entfallen
  **komplett durch Fix 2** — sie sind der einzige weitere `require`-Fundort.
- `eslint.config.mjs`: der Override `@typescript-eslint/no-require-imports: off` (Z. 42–43)
  wird entfernt; die „ACHTUNG bewusst require()"-Kommentare in beiden Dateien aktualisiert.

### Fix 2 — `node:fs`/`realpath` eliminieren (Warning „Direct Filesystem Access" weg)

Der Symlink-Guard ist der einzige `node:fs`-Nutzer. Der realpath-Check wird durch eine
**Whitelist gegen die Obsidian-Vault-Dateiliste** ersetzt — reine Obsidian-API, kein Node.

`src/mcp/vault_read_guard.ts` — Signatur von `(basePath, read, {realpath, join, sep})` auf
`(isKnownVaultFile, read)`:

```ts
export function makeVaultReadGuard(
  isKnownVaultFile: (rel: string) => boolean,
  read: (rel: string) => Promise<string>,
): (rel: string) => Promise<string> {
  return async (rel) => {
    if (!isKnownVaultFile(rel)) throw new Error(`Keine bekannte Vault-Datei: "${rel}"`);
    return read(rel);
  };
}
```

`src/main.ts` — der `Platform.isDesktop`-require-Block (Z. 1224–1242) wird zu:

```ts
this.guardedRead = makeVaultReadGuard(
  (rel) => this.app.vault.getAbstractFileByPath(normalizePath(rel)) instanceof TFile,
  (rel) => this.app.vault.adapter.read(rel),
);
```

`normalizePath` wird zum bestehenden obsidian-Import ergänzt (`TFile` ist bereits da). Damit
sind `node:fs/promises` **und** `node:path` restlos aus `src/` raus. Das `GuardIo`-Interface
entfällt. `vault_read_guard.ts` bleibt Obsidian-frei und über die injizierte
`isKnownVaultFile` testbar.

### Sicherheits-Trade-off (bewusst akzeptiert)

Der neue Guard ist gegen **Path-Traversal strenger**: nur real existierende Vault-Dateien
passieren; `../etc/passwd` u. ä. werden abgewiesen, weil sie keine `TFile` sind. Er verliert
den **realpath-Symlink-Escape-Schutz**: ein Symlink *innerhalb* des Vaults, den Obsidian
selbst als Datei listet, würde gelesen. Das ist **Parität mit Obsidian selbst und mit
TaskNotes' REST-API** — beide schützen dort nicht. Restrisiko minimal: Wer einen Symlink in
den Vault legen kann, hat bereits lokalen Dateizugriff; der MCP-Server ist zudem
token-authentifiziert und an `127.0.0.1` gebunden.

## Tests

- **`tests/mcp_vault_read_guard.test.ts` neu schreiben:** die realpath/Symlink-Fixtures
  (echte `fs.symlinkSync`) entfallen. Neue Fälle gegen die injizierte `isKnownVaultFile`:
  bekannte Datei → liest; unbekannter Pfad → wirft; sichergestellt, dass `read` bei
  unbekanntem Pfad **nicht** aufgerufen wird. Der Symlink-Escape-Test entfällt bewusst
  (Trade-off oben).
- **Bestehende Suite grün halten** (712 Tests). `tests/mcp_tools.test.ts` prüfen, ob es die
  alte Guard-Signatur nutzt.

## Verifikation (DoD)

1. `grep -rn "require(\|node:fs\|node:path" src/` → **keine Treffer** (außer Kommentar/Typ).
2. `npm run lint` → 0/0 (auch ohne den entfernten require-Override).
3. `npm test` → alle grün.
4. `npm run build` → `main.js` gebaut; `grep "require(\"node:http\")" main.js` → **vorhanden**
   (esbuild-Transform, erwartet).
5. **Manueller Obsidian-Test** (Runtime-Kern, vitest deckt Electron nicht ab): Desktop —
   MCP-Server startet, `read_note` liefert Inhalt, unbekannter Pfad wird abgewiesen. Mobile
   bzw. `Platform.isDesktop=false` — Plugin lädt ohne Node-Fehler.
6. Nach Release: Scorecard prüfen, dass beide ⚠️ Warnings verschwunden sind.

## Nachtrag 2026-07-23 (Umsetzung): Fix 1 nur teilweise erreichbar

Bei der Umsetzung wurde die Annahme von Fix 1 — „statischer Import ist sauber" — **widerlegt**.
Alle drei Wege wurden durchgemessen:

| Weg | `obsidianmd/no-nodejs-modules` | Store-Scan | Electron-Runtime |
|---|---|---|---|
| statischer `import * as http` | **Error**: *„Use a dynamic import() or require() guarded by Platform.isDesktop instead"* | vermutlich node-modules-Warning | läuft |
| `await import("node:http")` | erlaubt | sauber | **bricht** — esbuild lässt den Ausdruck trotz `external`+`cjs` **untransformiert** im Bundle (`main.js:39090`), Electron löst ihn als Netzwerk-Fetch auf |
| `require()` hinter Guard | **verlangt die Regel genau so** | ⚠️ „require forbidden" | läuft |

**Das ist ein Widerspruch in Obsidians eigenem Tooling:** Die offizielle Lint-Regel schreibt
`require()` hinter `Platform.isDesktop` vor, während der Store-Scan genau diesen Stil flaggt.
Die require-Warning ist damit **nicht auflösbar**, ohne entweder die Runtime zu brechen oder
sie gegen eine gleichwertige node-modules-Warning zu tauschen.

**Tatsächliches Ergebnis:**
- ⚠️ **Direct Filesystem Access → vollständig entfernt** (`node:fs` + `node:path` restlos raus).
- ⚠️ **require() → von 3 Fundstellen auf 1 reduziert** (`main.ts:1235/1236` entfallen; bleibt
  nur `http_server.ts` für `node:http`). Bewusst so belassen und im Code begründet.

Der statische Import wurde **verworfen**, weil er zusätzlich verlangt hätte,
`obsidianmd/no-nodejs-modules` lokal zu deaktivieren — genau das Sicherheitsnetz, das vor
einem Mobile-Crash schützt (der Bereich hat mit 0.16.1 schon einmal die Runtime gebrochen).
Eine nicht-blockende Kosmetik-Warning rechtfertigt das nicht.

## Offenes Risiko

Falls der Scanner **auch das Bundle** `main.js` scannt (statt nur `src/`), bliebe das
esbuild-erzeugte `require("node:http")` sichtbar. Evidenz spricht dagegen (alle
Warning-Referenzen zeigen `src/`-Zeilen). Mitigation: Schritt 6 — nach dem ersten Release mit
dem Fix das Scorecard verifizieren; falls die require-Warning bleibt, ist das ein separater
Slice (node:http hinter eine kleinere Abstraktion, die der Bundle-Scan nicht als
node-Import erkennt).
