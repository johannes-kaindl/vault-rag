# Deklarative Settings-Migration (`getSettingDefinitions`)

**Datum:** 2026-07-23
**Status:** approved
**Auslöser:** Store-Review-Vertagung aus 0.16.1 (`docs/superpowers/specs/2026-07-20-store-review-warnings-design.md`) — `getSettingDefinitions()` fehlt, `display()` deprecated (11 Stellen). Beide Befunde wurden bewusst in diesen eigenen Slice verschoben.

## Problem

`settings.ts` (927 Zeilen) rendert den Settings-Tab imperativ über das seit Obsidian 1.13
deprecated `display()`. Zwei Konsequenzen:

1. **Nicht durchsuchbar.** Ab 1.13 indexiert Obsidian nur Settings, die über die deklarative
   API `getSettingDefinitions()` gemeldet werden, für die globale Settings-Suche. Unser Tab
   erscheint dort nicht.
2. **Deprecation-Schuld.** `display()` (11 Stellen) ist der einzige Render-Einstieg und bleibt
   deprecated, bis die Migration ihn ablöst.

Die im Store-Review offene Vorfrage — **ob die vielen dynamischen Zeilen (Live-Status-Poll,
async Modell-Probing, Token-Toggle, MCP-Snippet) überhaupt deklarativ abbildbar sind** — ist
mit dieser Spec beantwortet: **ja**, über den imperativen `render`-Escape-Hatch der API.

## API-Befund (Obsidian 1.13.1, installiert)

`PluginSettingTab` bietet ab 1.13:

- **`getSettingDefinitions(): SettingDefinitionItem[]`** — ersetzt `display()`. Liefert es ein
  **nicht-leeres** Array, wird `display()` **gar nicht mehr aufgerufen** (`obsidian.d.ts:6633`).
  Die Migration ist damit **atomar** — kein zeilenweises Nebeneinander.
- **`getControlValue(key)` / `setControlValue(key, value)`** — Lese-/Schreibpfad je Control-`key`.
  Default liest/schreibt `settings[key]`; wir überschreiben beide, um Coercion und Seiteneffekte
  unterzubringen.
- Bausteine: `SettingDefinitionControl` (`toggle`/`slider`/`text`/`textarea`/`number`/`dropdown`/
  `file`/`folder`), `SettingDefinitionRender` (`render: (setting, group) => void | cleanup`),
  `SettingDefinitionAction` (Button-Zeile), `SettingDefinitionEmpty` (nur Info), `SettingDefinitionGroup`
  (`type:"group"` mit `heading`).
- **`SettingSliderControl.displayFormat?: (value) => string`** (seit 1.13.1) — zeigt den Wert
  inline neben dem Slider, ersetzt unser bisheriges „Wert im Namen".
- **`this.update()`** liest die Definitions neu (Struktur-Refresh) — ersetzt die bisherigen
  `this.display()`-Refresh-Aufrufe.

## Dach-Kontext (Referenz)

Recherche über die vier Nachbar-Plugins mit `getSettingDefinitions`-Treffer ergab: **nur
`markdown-presentation` ist wirklich migriert**; `vault-crews`, `yijing-oracle` und
`local-image-generator` haben bewusst **nicht** migriert (dokumentiert in Inline-Kommentaren).
`markdown-presentation/src/settings.ts` ist damit die einzige echte Referenz.

Übernommene, dach-weit geteilte Konventionen:

- Flaches Array aus `type:"group"`-Objekten mit `heading` (native Sektionen). **Kein
  `SettingDefinitionPage`, kein collapsibles Vendor-Kit** — der dach-weite Abschied vom Einklappen
  (Suche ersetzt Zuklappen).
- `getControlValue`/`setControlValue` als **switch-Map** überschreiben (nicht Default) — dort
  leben Coercion, Trim-auf-Default und Seiteneffekte.
- Einfache Felder deklarativ, **alles Async/Imperative über `render`-Hatch** mit dem
  `hostFor(setting)`-Trick.
- Endpoint-/Listen-Editoren **von Hand im render-Hatch**, nicht `SettingDefinitionList`.
- Tests prüfen die **Definitions-Struktur pure** (jeder Control-`key` existiert in
  `DEFAULT_SETTINGS` und round-trippt), kein Rendering-Test.

## Warum kein `display()`-Fallback (Abweichung vom Piloten)

`markdown-presentation` hält `display()` als `<1.13`-Fallback, weil seine `minAppVersion` 1.8.7
ist. Bei vault-rag steht `versions.json` so, dass **nur 0.16.1 → 1.13.0** verlangt; alle älteren
Einträge bleiben auf 0.16.0. Jeder Nutzer, der je eine Version **mit** `getSettingDefinitions`
bekommt, läuft folglich auf **≥ 1.13**. → **Reine deklarative API, `display()` entfällt ganz.**
Keine Doppel-Wahrheit (Definitions + imperativer Walker) zu pflegen — sauberer als der Pilot.

## Entscheidungen (vom Nutzer bestätigt)

1. **Ambition: voll-nativ.** collapsibleSection weicht nativen Groups; maximale Nutzung der API.
2. **Collapse wird aufgegeben.** Native `SettingDefinitionGroup` kennt kein Einklappen; die 7
   Sektionen sind dauerhaft offen. Obsidians globale Settings-Suche ersetzt das Zuklappen. Der
   `collapsible`-Vendor-Kit-Import entfällt (nur in `settings.ts` genutzt).
3. **Endpoint-Editor: handgebaut im render-Hatch** (Dach-Kanon, kein `SettingDefinitionList`).
   Der bestehende `buildEndpointList` (Status-Icon, Probe, Aktiv-Markierung, Warn-Icon,
   Preset-Buttons, blur-Semantik) wandert 1:1 in einen render-Hatch; Generation-Counter gegen
   überlappende Probes.
4. **Kontext-Budget-Slider bleibt render-Hatch** (nicht deklarativ), damit die Kopplung des
   `max` ans Modell-Fenster (`updateBudgetMax` aus `showInfo`) erhalten bleibt. Die eine Zeile
   ist dann nicht suchbar — bewusst in Kauf genommen gegen Feature-Verlust.

## Architektur

`getSettingDefinitions()` wird die **einzige Wahrheit**. Es entfallen: `display()`, `rerender()`,
`resetRenderState()`, `resolvedOnOpen`-Logik in ihrer bisherigen Form (der Endpunkt-Resolve-beim-
Öffnen wird beibehalten, aber an den neuen Lebenszyklus gehängt), der collapsibleSection-Aufbau.

`getControlValue(key)` / `setControlValue(key, value)` als switch-Maps. `setControlValue` ist der
Ort für `saveSettings()` **plus** Seiteneffekt je Key:

| Key | Seiteneffekt in `setControlValue` |
|---|---|
| `k`, `minSim` | `refresh()` |
| `showStatusBar` | `setStatusBarVisible(v)` |
| `hideIndexFolder` | `refreshIndexFolderHiding()` |
| `templateDir` | Trailing-Slash-Normalisierung + `refreshSmartApplyRanking()` |
| `exclude` | Split/Trim/Filter-Coercion |

Coercions (`exclude`-Split, `templateDir`-Normalisierung) wandern als **pure Helfer nach
`settings_core.ts`** → direkt unit-testbar, obsidian-frei.

### Sektionen (7 Groups, bisherige Reihenfolge)

Suche · Live-Embedding · Index · Index-Robustheit · MCP-Server · Chat · Smart Apply.

### Zeilen-Klassifikation

**Rein deklarativ (von der Settings-Suche indexiert):**

| Control | Zeilen |
|---|---|
| `slider` + `displayFormat` | k, minSim (%), Debounce, chatK, Temperatur, Smart-Apply-Temperatur, Smart-Apply-MaxTokens |
| `toggle` (+ Set-Seiteneffekt) | Statusleiste, Index-ausblenden, Enter-sendet, Thinking-unterdrücken, Smart-Apply-an, Smart-Apply-Suppress |
| `dropdown` | Eingabe-Position, Smart-Apply-Standardmodus |
| `textarea` | System-Prompt |
| `text` (+ Set-Coercion) | Ausschluss-Pfade |
| `folder` (nativer Vault-Suggester) | Vorlagen-Ordner — der `FolderSuggest`-Wrapper entfällt hier |
| `empty` (nur Info) | Smart-Apply-Verbindungshinweis |
| `action` | „Testen" (Thinking), „Backups…", „Neu indizieren" |

**render-Hatch (dynamisch/async, nicht suchbar):**

- Embedding- & Chat-**Endpoint-Listen** (handgebaut, Generation-Counter)
- **Embedding-Status-Poll** (2 s) → render-Hatch gibt **cleanup-Funktion** zurück (`clearInterval`);
  zusätzlich defensiv in `hide()`
- Async **Modell-Dropdowns** (Embedding, Chat, Smart-Apply) + **Modelldetails** + **Fähigkeiten-Chips**
- **Index-Ordner** (FolderSuggest + teurer „Übernehmen"-Button — keine Persistierung pro Tastendruck)
- **Index-Zustand** (dynamische Desc via `indexHealthReadout` + dynamisch disabled)
- **Kontext-Budget-Slider** (modell-gekoppeltes `max`)
- **komplette MCP-Sektion** (bedingte Zeilen bei `mcpEnabled`, Token mask/toggle, Port-debounce-
  Restart, Selbsttest, Client-Dropdown, Snippet-`<pre>`)

### `hostFor(setting)`-Trick

render-Hatches, die **mehrere** Rows zeichnen (Endpoint-Listen, MCP-Sektion, Robustheit), leeren
`setting.settingEl` und entfernen die `.setting-item`-Klasse, damit der Host ein neutraler
Block-Container wird (sonst würden verschachtelte `.setting-item` zu Flex-Kindern der
Zwei-Spalten-Row). Die Desc muss im Hatch **selbst neu gesetzt** werden, da `hostFor` sie leert.

### Re-Evaluieren

Alle bisherigen `this.display()`-Refresh-Aufrufe → **`this.update()`**: Endpoint-blur,
Preset-Klick, Trash, „Verbindung prüfen", MCP-Toggle, Token-Rotation, Token-anzeigen/verbergen,
Port-Restart, Index-Ordner-Wechsel, Client-Dropdown-Wechsel.

## Tests

Neue **pure Definitions-Struktur-Tests** (`tests/settings.test.ts` umgebaut):

- `getSettingDefinitions()` mit Fake-Host aufrufen, Groups flachklopfen (`type === "group"`).
- Jeder Control-`key` existiert in `DEFAULT_SETTINGS`.
- Jeder Control-`key` **round-trippt** durch `getControlValue`/`setControlValue`.
- Set-Seiteneffekte gezielt: z.B. `showStatusBar` → `setStatusBarVisible` aufgerufen; `k` →
  `refresh` aufgerufen; `templateDir` → normalisiert + `refreshSmartApplyRanking`.
- Ausgelagerte Coercion-Helfer (`exclude`-Split, `templateDir`-Normalisierung) separat pure.

Die render-Hatches werden **nicht** gerendert-getestet (Dach-Kanon). Ihre pure Logik
(`applyEndpointEdit` u.a.) ist bereits abgedeckt und bleibt. Der Obsidian-Mock
(`tests/__mocks__/obsidian.ts`) muss `PluginSettingTab` so bereitstellen, dass die überschriebenen
Methoden als pure Funktionen aufrufbar sind (Subklassen-Override, wie im Piloten — der Mock stellt
`getSettingDefinitions` nicht selbst bereit).

## Fallstricke

- **Atomar:** `getSettingDefinitions` ersetzt `display()` komplett — halb migrieren geht nicht.
- **Blur statt onChange** bei den Endpoint-Addern (bleibt, bereits im Code): `onChange` feuert
  pro Tastendruck und würde jeden Zwischenstand als Eintrag anhängen.
- **Cleanup nicht garantiert beim Fenster-Zerstören** (`obsidian.d.ts:6280`) → Poll-Cleanup
  zusätzlich defensiv in `hide()`.
- **Desc-Verlust im render-Hatch** durch `hostFor` → Desc dort selbst neu setzen.
- **Fokus-Verlust bei Re-Render:** async Re-Detect (Reachability) nicht bei jedem Tastendruck,
  sondern beim Verlassen des Felds; `update()` nur bei echten Struktur-Änderungen.

## Zuschnitt

Ein Slice, ein Rutsch (atomar erzwungen). Voller Zyklus:
`brainstorming → writing-plans → subagent-driven-development → whole-branch-review → Fix-Welle`.
**Manuelle GUI-Abnahme durch Jay** ist Pflicht (Ladeweg-Regel aus dem 0.16.1-Gotcha gilt sinngemäß
für den Render-Weg): Settings-Suche testen, alle dynamischen Zeilen (Live-Status, Modell-Probing,
MCP-Token/Snippet, Endpoint-Listen) in echtem Obsidian prüfen.

## Nicht in diesem Slice (bewusst)

- `SettingDefinitionList` für die Endpoint-Listen (verworfen zugunsten render-Hatch).
- `SettingDefinitionPage` (navigierbare Unterseiten) — im ganzen Dach ungenutzt; MCP/Robustheit
  bleiben inline-Groups.
- Suchbarkeit des Budget-Sliders (render-Hatch-bedingt).

---

## NACHTRAG (2026-07-23): Prämissen-Korrektur — zweigleisig für 1.12.7

**Status:** approved (Nutzer-Entscheidung nach dem Whole-Branch-Review).

### Warum die ursprüngliche Prämisse falsch war

Die Spec oben nahm an: „kein `display()`-Fallback nötig, weil `minAppVersion` 1.13.0 → jeder Nutzer
mit `getSettingDefinitions` läuft ≥1.13." Das ist falsch: **Obsidian 1.13 ist bislang nur als
Catalyst-Preview verfügbar.** Die Mehrheit der Nutzer läuft auf ≤1.12, wo `getSettingDefinitions()`
nicht existiert und Obsidian weiterhin `display()` aufruft. Die reine deklarative Migration (Tasks 1–9)
hätte diesen Nutzern **gar keine Settings-UI** gelassen — und der `minAppVersion 1.13.0`-Stand aus
0.16.1 liefert Updates faktisch nur an Catalyst-Nutzer aus (versions.json hält alle anderen auf 0.16.0).

### Entscheidung: zweigleisig (markdown-presentation-Muster)

`getSettingDefinitions()` bleibt die **eine Wahrheit**. Zusätzlich ein schlanker `display()`-Fallback,
der dieselbe Struktur imperativ rendert:

- **`display() { this.renderImperative(); }`** — Obsidian ruft es nur auf ≤1.12 auf (bei non-leerem
  `getSettingDefinitions` überspringt 1.13+ es, obsidian.d.ts). Der Override ist **warning-frei**:
  `no-deprecated` flaggt Aufrufe, nicht Definitionen; belegt durch `markdown-presentation` (display +
  getSettingDefinitions, Lint sauber). obsidian.d.ts segnet display() explizit als <1.13-Fallback ab.
- **`renderImperative()`** durchläuft `getSettingDefinitions()` und rendert jeden Definition-Typ mit
  der klassischen `Setting`-API: `group`→`setHeading()`+items · `control`→`addSlider/addToggle/addText/
  addTextArea/addDropdown` (+FolderSuggest bei `folder`), gebunden an `get/setControlValue` ·
  `render`→ruft den render-Hatch mit frischer `Setting` (Hatches sind bereits klassische API) ·
  `action`→`addButton(name).onClick(action)` · `empty`→`setName/setDesc`.
- **`displayFormat` als eine Wahrheit:** der native 1.13.1-Pfad zeigt den Slider-Wert inline; der
  Fallback nutzt **denselben** `displayFormat`-Callback und platziert den Wert im Namen
  (`setName(\`${name}: ${displayFormat(v)}\`)`). Kein doppelter Formatierungscode.

### `minAppVersion` → 1.12.7

manifest.json `1.13.0`→`1.12.7`; versions.json bekommt einen Eintrag für die nächste Version → 1.12.7.
Korrigiert zugleich das 0.16.1-Ausschluss-Problem.

### 1.13-only-APIs warning-frei absichern (kein `setWarning`, kein eslint-disable)

Jays Anforderung „keine Warnings" wird durch **Vermeidung** erfüllt (apple-health-Philosophie), nicht
durch Unterdrückung:

- **`setDestructive()`** (2 Stellen: `RestoreBackupModal`, MCP-„Neu generieren") ist 1.13-only und
  crasht auf 1.12.7. Ersetzt durch einen Runtime-Feature-Check-Helfer:
  `typeof b.setDestructive === "function" ? b.setDestructive() : b.buttonEl.addClass("mod-warning")`.
  `mod-warning` ist reine DOM-Klasse (keine API) → kein `no-deprecated`-Treffer; roter Look auf allen
  Versionen. **Kein `setWarning` (deprecated), kein `requireApiVersion`, kein Lint-Override.**
- **`displayFormat`** (1.13.1): native API ignoriert es auf <1.13.1; der Fallback nutzt es im Namen.

### Tests

Struktur-Tests bleiben. Neu: ein `renderImperative`-Smoke-Test über alle 7 Gruppen (jeder
Definition-Typ rendert ohne Crash). Der Obsidian-Mock (`tests/__mocks__/obsidian.ts`) bekommt
`Setting`-Stubs für `addSlider/addToggle/addText/addTextArea/addDropdown/addButton` (+ `ButtonComponent`
mit `setButtonText/onClick/setClass/buttonEl`).

### Warning-Freiheit ist Abnahmekriterium

`npm run lint` (`eslint src`) muss **0 Warnings, 0 Errors** bleiben — verifiziert nach jeder Änderung,
nicht nur am Ende. GUI-Abnahme dann auf **beiden** Pfaden (Catalyst 1.13 nativ + eine ≤1.12-Instanz
für den Fallback, falls verfügbar).
