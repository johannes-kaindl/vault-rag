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

## Korrektur während der Umsetzung (2026-07-20, nach Task 4)

**Die node:-Warning ist nicht eliminierbar, nur verschiebbar.** Diese Spec ging davon aus, dass
Injection bzw. ein sichtbarer Platform-Guard die Meldung beseitigt. Das ist falsch.

Belegt an der Regel-Implementierung: `obsidianmd/no-nodejs-modules` ist `eslint-plugin-import`s
`no-nodejs-modules` unter neuem Namen (`node_modules/eslint-plugin-obsidianmd/dist/tests/importRules.test.js`).
Ihre Testfälle zeigen, dass sie **jeden** node:-Import und jedes `require` eines Node-Moduls
kontextfrei flaggt — `const path = require('path')` ist dort explizit ein Invalid-Fall. Eine
Erkennung von `Platform.isDesktop`-Guards existiert nicht; die Formulierung „Use a dynamic
import() or require() guarded by Platform.isDesktop" im Store-Review ist Prosa für den
menschlichen Leser, nicht das Prüfkriterium der Regel. Die einzigen Auswege wären die
`allow`-Option der Regel oder ein Override — beides wirkt nur lokal, nicht im Store-Review.

Solange das Plugin `fs.realpath` für den Symlink-Escape-Schutz braucht, bleibt also mindestens
eine node:-Meldung bestehen. Entschieden (vom Nutzer, 2026-07-20): **Kurs beibehalten.** Begründung:

- `vault_read_guard.ts` wird durch die Injection pur und ohne echtes Dateisystem testbar — ein
  Qualitätsgewinn, der unabhängig von der Warning trägt.
- Die node:-Nutzung sitzt danach konzentriert in `src/main.ts`, unmittelbar unter dem
  `Platform.isMobile`-Return, statt verstreut als Top-Level-Import in einem Modul. Für den
  **menschlichen** Store-Reviewer ist genau das das entscheidende Argument.
- Der Symlink-Guard aufzugeben stand zur Wahl und wurde verworfen: er schließt ein real
  gefixtes Leck (Symlink im Vault → Fremdinhalt an externe MCP-Agents).

Folge für den Scope: Die verbleibende node:-Meldung wird ein **fünfter dokumentierter Nicht-Fix**
im Changelog, gleichrangig mit `fs`, Vault-Enumeration, Clipboard und `new Function`. Der Slice
beseitigt damit zwei der vier Warnings vollständig (`prefer-create-el`, `setWarning`), verbessert
die dritte strukturell (node:) und vertagt die vierte bewusst (`getSettingDefinitions`).

## Nicht im Scope

- **`getSettingDefinitions()`** — eigener Slice. Offene Frage für dessen Brainstorming: Lassen
  sich die dynamischen Settings-Zeilen (Live-Embedding-Status mit Intervall, Modell-Probing,
  MCP-Token-Toggle) deklarativ überhaupt abbilden, oder braucht es einen Mischbetrieb aus
  `getSettingDefinitions()` und `display()`?
- **`display()`-Deprecation** — fällt mit demselben Slice.
- Jede Änderung an Vault-Enumeration, Clipboard-Nutzung oder dem `fs`-basierten Symlink-Guard.

## Verifikation

- `npm run lint` mit 0.4.1: grün, und die vier Warnings waren vor den Fixes reproduzierbar
- Volle Testsuite (684 Tests): grün
- `npm run build`: grün
- Manuelle GUI-Prüfung der drei Destructive-Buttons in den Settings

## Risiken

| Risiko | Abfederung |
|---|---|
| 0.4.1 reproduziert die Store-Warnings nicht | Stopp-Signal in Schritt 0 — Annahmen neu prüfen, statt blind weiterzufixen |
| `setDestructive` fehlt in den installierten Obsidian-Typen | `obsidian`-devDependency steht bereits auf `^1.13.0` |
| minAppVersion-Anhebung schließt Nutzer aus | Bewusste, vom Nutzer bestätigte Entscheidung; Changelog-Eintrag |
| Injection bricht den Symlink-Integrationstest | `tests/mcp_vault_read_guard.test.ts` bleibt inhaltlich unverändert und injiziert `fs.realpath`/`path.join`/`path.sep` — der reale FS/Symlink-Test bleibt erhalten |
