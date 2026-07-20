# Store-Review-Warnings abbauen (0.16.1)

**Datum:** 2026-07-20
**Status:** approved
**Auslöser:** Community-Store-Review zu Release 0.16.0 (Commit `091a44d`)

## Problem

Das Store-Review meldet vier Befunde der Kategorie **Warning** und mehrere der Kategorie
**Recommendation**. Die Warnings sind adressierbar; die Recommendations sind überwiegend
bewusste Eigenschaften des Plugins oder stammen aus Dependencies.

Zentrale Beobachtung: **`npm run lint` ist lokal grün, obwohl der Store vier Warnings meldet.**
Die auslösenden Regeln stecken erst in `eslint-plugin-obsidianmd` 0.4.x; installiert ist 0.3.0.
Ohne Upgrade fixen wir blind und erfahren das Ergebnis erst beim nächsten Store-Review.

## Befundanalyse

| Store-Meldung | Realität im Code | Handlung |
|---|---|---|
| `prefer-create-el`, 7 Stellen | Kein `document.createElement` vorhanden — alle Treffer sind `createEl("span", …)`, wofür die Regel `createSpan(…)` verlangt | fixen |
| `node:http` in `http_server.ts:3,47` | Beides Typpositionen (`import type`, `typeof import(…)`); im Bundle landet nichts. Das `require` in Z. 47 ist bereits desktop-gegated, der Guard steht aber in `main.ts` und ist für den Linter unsichtbar | Guard lokal sichtbar machen |
| `node:fs/promises`, `node:path` in `vault_read_guard.ts:1,2` | Echte Top-Level-Runtime-Imports | entkoppeln |
| `getSettingDefinitions()` fehlt | Betrifft 926 Zeilen `settings.ts` mit dynamischen Zeilen (Live-Status, Intervalle, Modell-Probing) | **vertagt** — eigener Slice |
| `setWarning` deprecated, 3 Stellen | `setDestructive` existiert erst ab Obsidian 1.13 | fixen, nach minAppVersion-Anhebung |
| `display()` deprecated, 11 Stellen | Entfällt erst mit der Settings-API-Migration | vertagt, mit dem Settings-Slice |
| Direct Filesystem Access | `vault_read_guard` nutzt `fs.realpath` für den Symlink-Escape-Schutz — desktop-only, engstmöglicher Scope | dokumentierter Nicht-Fix |
| Vault Enumeration | Kernfunktion eines Retrieval-Plugins | dokumentierter Nicht-Fix |
| Clipboard Access | Nur `writeText`, nutzerinitiiert (`main.ts:371`, `settings.ts:919`); kein Lesen | dokumentierter Nicht-Fix |
| Dynamic Code Execution | `new Function` stammt aus `ajv`, gezogen über `@modelcontextprotocol/sdk` — nicht unser Code | dokumentierter Nicht-Fix |

## Entwurf

### Schritt 0 — Fundament: Linter auf Store-Stand

`eslint-plugin-obsidianmd` **0.3.0 → 0.4.1** (devDependency). Danach ist `npm run lint` die
Ground Truth: die vier Store-Warnings müssen lokal reproduzierbar sein, bevor irgendetwas
gefixt wird, und jeder folgende Schritt wird gegen diesen Lint verifiziert.

Falls 0.4.1 die Store-Meldungen **nicht** reproduziert, ist das ein Stopp-Signal: dann fixen
wir gegen eine unbekannte Regelversion und die Annahmen dieser Spec müssen neu geprüft werden.

### Schritt 1 — `minAppVersion` 1.7.2 → 1.13.0

In `manifest.json`. Voraussetzung für Schritt 3 und für den späteren Settings-Slice.
Nutzerseitig sichtbare Änderung: Installationen unter Obsidian 1.13 erhalten kein Update mehr.
Gehört in den Changelog.

### Schritt 2 — `prefer-create-el`

7× `createEl("span", {…})` → `createSpan({…})`:

- `src/chat_view.ts:225`
- `src/context_panel.ts:29,32,85,89`
- `src/view.ts:12,13`

Rein mechanisch, keine Verhaltensänderung. Der Obsidian-Test-Mock
(`tests/__mocks__/obsidian.ts:12`) unterstützt `createSpan` bereits; bestehende Tests
(`chat_view.test.ts`, `context_panel.test.ts`, `hub_view.test.ts`) decken die Stellen ab.

### Schritt 3 — `setWarning` → `setDestructive`

3 Stellen in `src/settings.ts` (135, 830, 881). Erst nach Schritt 1 zulässig, da
`setDestructive` ab Obsidian 1.13 existiert.

### Schritt 4 — node:-Imports

**`src/mcp/vault_read_guard.ts` — Injection statt Top-Level-Import.**

Die Signatur wird um ein drittes Argument erweitert:

```ts
export interface GuardIo { realpath(p: string): Promise<string>; join(...parts: string[]): string; sep: string; }
export function makeVaultReadGuard(basePath: string, read: (rel: string) => Promise<string>, io: GuardIo): (rel: string) => Promise<string>
```

Damit verschwindet jede `node:`-Referenz aus der Datei und die Guard-Logik wird pur.
`src/main.ts:1222` lädt das Modul ohnehin schon per `await import(…)` hinter
`Platform.isMobile` (Z. 1215) und reicht dort die echten Module rein.

`io` ist ein **Pflichtargument ohne Default** — ein Default würde den `node:`-Import wieder
in die Datei ziehen und damit den Zweck der Änderung aufheben.

**`src/mcp/http_server.ts` — Guard lokal sichtbar machen.**

Ein explizites `if (Platform.isMobile) throw new Error(…)` am Anfang von `startMcpServer()`.
Das macht den bislang nur in `main.ts` existierenden Guard für den Linter sichtbar und ist
zugleich sinnvolle Defense-in-Depth.

Eskalationsstufen, falls das die Regel nicht befriedigt (in dieser Reihenfolge):

1. Minimale strukturelle Typen statt `node:http` — Randbedingung: `handleRequest` des SDK
   erwartet `IncomingMessage & {…}`, die Typen müssen strukturell kompatibel bleiben.
2. Begründetes `eslint-disable-next-line` mit Kommentar, dass ein type-only Import
   nachweislich keinen Runtime-Code erzeugt.

## Präzisierung während der Umsetzung (2026-07-20, nach Task 4)

**Wie `obsidianmd/no-nodejs-modules` tatsächlich prüft.** Maßgeblich ist die Regelquelle
`node_modules/eslint-plugin-obsidianmd/dist/lib/rules/noNodejsModules.js` (Plugin 0.4.1) — nicht
ihre Testfälle, die nur ungeschützte Fälle abdecken und den Eindruck erwecken, die Regel sei
kontextblind. Sie ist es nicht:

- `CallExpression` (`require`) und `ImportExpression` (dynamisches `import`) laufen durch
  `isGuardedByPlatformIsDesktop`. Ein Aufruf innerhalb von `if (Platform.isDesktop) { … }` wird
  akzeptiert; zwischenliegende Blöcke unterbrechen die Vorfahren-Suche nicht.
- `hasGuardAtFunctionStart` akzeptiert zusätzlich exklusiv `!Platform.isDesktop` als **erste**
  Anweisung einer Funktion. Ein `if (Platform.isMobile || …) return;` erfüllt das **nicht** —
  daran scheiterte der erste Versuch in `doStartMcpServer`.
- Nur statische `ImportDeclaration` wird bedingungslos gemeldet, unabhängig von jedem Guard.

Daraus folgt die Umsetzungsregel für diesen Slice: **Node-Builtins innerhalb eines
`if (Platform.isDesktop)`-Blocks laden** (bzw. hinter einem `!Platform.isDesktop`-Throw als erster
Anweisung). Der Guard ist entscheidend, nicht die Lade-Syntax — `isGuardedByPlatformIsDesktop`
gilt für `CallExpression` (`require`) genauso wie für `ImportExpression` (`await import`). Ein
Override, der die Regel für eine ganze Datei abschaltet, ist ausdrücklich **kein** akzeptabler
Ersatz: er würde in `src/main.ts` gerade den Fall verstecken, der Mobile wirklich bricht — einen
künftigen Top-Level-`import` eines Node-Builtins.

> [!warning] `await import()` von Node-Builtins ist in Obsidian zur Laufzeit kaputt
> Empirisch belegt am 2026-07-20 in laufendem Obsidian. Der erste Umsetzungsversuch stellte
> `require("node:…")` auf `await import("node:…")` um — beides erfüllt die Lint-Regel, und alle
> 688 Tests, Lint, Typecheck und Build waren grün. Im echten Obsidian schlug der MCP-Start dann
> fehl mit:
>
> `⚠ MCP-Server konnte nicht starten (Failed to fetch dynamically imported module: node:fs/promises)`
>
> Grund: Obsidian lädt `main.js` als CommonJS. Ein dynamisches `import()` wird dort von
> Electron/Chromium als **Netzwerk-Fetch** aufgelöst, nicht über den require-Mechanismus; für
> `node:`-Builtins scheitert das. `esbuild` reicht das `import()` unverändert durch, weil die
> Builtins als `external` markiert sind.
>
> **Verbindlich: `require("node:…")` innerhalb des `Platform.isDesktop`-Guards verwenden.** Der
> dafür nötige Verzicht auf `@typescript-eslint/no-require-imports` (enger Datei-Override, ohne
> `obsidianmd/no-nodejs-modules` anzurühren) ist der korrekte Preis. Ein funktionierendes Feature
> schlägt eine saubere Lint-Zeile.
>
> **Vitest kann diesen Fehler nicht fangen** — die Tests laufen unter Node, wo
> `import("node:fs/promises")` trivial funktioniert. Jede Änderung am Ladeweg von Node-Builtins
> braucht daher einen manuellen Start in echtem Obsidian, bevor sie als fertig gilt.

Für `src/mcp/http_server.ts:3` bleibt die statische Form `import type { … } from "node:http"` damit
der einzige irreduzible Fall. Er ist nur durch Entfernen des Imports lösbar — also durch die in
Schritt 4 vorgesehene Eskalationsstufe 1 (strukturelle Typen). Das ist Aufgabe von Task 5.

Der Kurs aus Schritt 4 (Injection statt Top-Level-Import) bleibt unabhängig davon richtig:
`vault_read_guard.ts` wird dadurch pur und ohne echtes Dateisystem testbar. Der Symlink-Guard
selbst stand zur Disposition und wurde bewusst behalten — er schließt ein real gefixtes Leck
(Symlink im Vault → Fremdinhalt an externe MCP-Agents).

## Nicht im Scope

- **`getSettingDefinitions()`** — eigener Slice. Offene Frage für dessen Brainstorming: Lassen
  sich die dynamischen Settings-Zeilen (Live-Embedding-Status mit Intervall, Modell-Probing,
  MCP-Token-Toggle) deklarativ überhaupt abbilden, oder braucht es einen Mischbetrieb aus
  `getSettingDefinitions()` und `display()`?
- **`display()`-Deprecation** — fällt mit demselben Slice.
- Jede Änderung an Vault-Enumeration, Clipboard-Nutzung oder dem `fs`-basierten Symlink-Guard.

## Verifikation

- `npm run lint` mit 0.4.1: grün, und die vier Warnings waren vor den Fixes reproduzierbar
- Volle Testsuite (688 Tests): grün
- `npm run build`: grün
- Manuelle GUI-Prüfung der drei Destructive-Buttons in den Settings

## Risiken

| Risiko | Abfederung |
|---|---|
| 0.4.1 reproduziert die Store-Warnings nicht | Stopp-Signal in Schritt 0 — Annahmen neu prüfen, statt blind weiterzufixen |
| `setDestructive` fehlt in den installierten Obsidian-Typen | `obsidian`-devDependency steht bereits auf `^1.13.0` |
| minAppVersion-Anhebung schließt Nutzer aus | Bewusste, vom Nutzer bestätigte Entscheidung; Changelog-Eintrag |
| Injection bricht den Symlink-Integrationstest | `tests/mcp_vault_read_guard.test.ts` bleibt inhaltlich unverändert und injiziert `fs.realpath`/`path.join`/`path.sep` — der reale FS/Symlink-Test bleibt erhalten |
