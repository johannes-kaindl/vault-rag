# Spec: Index-Ordner im Explorer ausblenden + wählbarer Speicherort

- **Datum:** 2026-06-26
- **Status:** Design freigegeben (User), bereit für writing-plans
- **Repo:** vault-rag (Plugin-id `vault-retrieval`)
- **Auslöser:** Der Index-Ordner `_vaultrag/` ist im Datei-Explorer sichtbar und stört.

## 1. Problem & Ausgangslage

Das Plugin schreibt den note-level Vektor-Index in einen sichtbaren Nicht-Dot-Ordner `_vaultrag/`
im Vault-Root (Dateien `notes.i8`, `paths.json`, `manifest.json`, `pending.json`). Der Ordner-Eintrag
stört im Datei-Explorer. Ziel: den Ordner aus dem Explorer fernhalten, **ohne** das Kern-Feature von
vault-rag zu brechen.

**Kern-Constraint (nicht verhandelbar):** vault-rags Alleinstellungsmerkmal ist, dass der **fertige
Index als Sync-Artefakt** auf alle Geräte inkl. iPhone synct und die Suche dort **ohne Embedder, ohne
Netz** läuft (Brute-Force-Cosinus auf int8-Vektoren). Der Index **muss** also cross-device sync-bar
bleiben. Der User hat bestätigt: iPhone-Offline ist eine harte Anforderung.

## 2. Recherche-Erkenntnisse, die das Design tragen

Drei Recherche-Runden (offizielle Obsidian-Doku, GitHub-Quellcode etablierter Plugins, Foren) haben
das ursprünglich angedachte Vorhaben („Index in den Plugin-Ordner `.obsidian/plugins/<id>/` verschieben")
**widerlegt** und den jetzigen Ansatz begründet:

- **Plugin-Ordner ist tabu:** Obsidian Sync synct dort nur eine Whitelist (`main.js`/`manifest.json`/
  `styles.css`/`data.json`) und kann Fremddateien **löschen** (advanced-slides #271); eine Plugin-Deinstallation
  löscht den ganzen Ordner. Ein Index dort käme aufs iPhone nicht zuverlässig an oder würde zerstört.
- **Dot-Ordner syncen nicht:** Obsidian Sync ignoriert alle Dot-Ordner **außer `.obsidian`** (offizielles
  Doku-Zitat). Ein `.vaultrag/` würde nie aufs iPhone synchronisieren → bräche das Offline-Feature.
- **„Versteckt" und „gesynct" schließen sich bei Obsidian Sync aus:** Der einzige zuverlässig gesyncte,
  plugin-neutrale Ort ist ein **sichtbarer Nicht-Dot-Ordner/-Datei** im Vault. vault-rags `_vaultrag/`
  ist sichtbar **genau weil** es gesynct werden soll — der sichtbare Preis für ein Feature, das kein
  anderes Plugin bietet (Smart Connections/Copilot/Similar Notes bauen den Index pro Gerät neu).
- **Das eigentliche Problem ist der *Ordner-Eintrag*, nicht die Dateien:** Das Obsidian-Setting
  „Detect all file extensions" ist Default **AUS** → Dateien mit unbekannten Endungen (`.i8`, `.json`)
  sind **schon unsichtbar**. **Ordner sind dagegen immer sichtbar**, unabhängig vom Inhalt.
- **„Excluded files" löst es nicht:** Es blendet nur aus Suche/Graph/Backlinks aus (offizieller Text),
  **nicht** aus dem Datei-Explorer-Baum. Außerdem bräuchte das programmatische Setzen die undokumentierte
  API `setConfig('userIgnoreFilters')` (Lint-Grauzone, Review-Risiko).
- **CSS-Hide ist der etablierte, saubere Weg:** Obsidian setzt ein `data-path`-Attribut auf
  `.nav-folder-title`. Eine CSS-Regel `display:none` darauf entfernt den Ordner-Eintrag **echt** aus dem
  Explorer. Präzedenz: das im Community-Store abgenommene Plugin **„Explorer Hider"** macht exakt das.
  Lint-konform via injiziertem `<style>` + `textContent` (kein `innerHTML`), mobile-tauglich (kein `:has()`).
- **Einzeldatei mit unbekannter Endung wurde geprüft und verworfen:** Sie versteckt nur bei
  Default-Setting (sichtbar sobald „Detect all" AN — was vault-rags technische Zielgruppe überdurchschnittlich
  oft hat), erzwingt einen **Breaking Change am Index-Format + Migration auf allen Geräten**, erhöht die
  Sync-Last (monolithisch statt Shards) und bringt **keinen** Sync-Vorteil (beide Ansätze brauchen
  denselben „Sync all other types"-Toggle). Smart Composers `.smtcmp_vector_db.tar.gz` ist eine **Dot-Datei**
  (versteckt via Punkt, synct **nicht**) — kein Präzedenzfall für „unbekannte Endung versteckt + synct".

## 3. Gewählter Ansatz

**Index-Format, Speichermechanik und Sync bleiben unverändert.** Wir fügen zwei Settings und eine
CSS-Injektion hinzu:

1. **Ausblenden-Toggle** (`hideIndexFolder`): blendet den Index-Ordner per CSS aus dem Datei-Explorer
   aus — robust gegen das „Detect all"-Setting, lint-konform, auf Desktop und iPhone.
2. **Wählbarer Speicherort** (`indexDir` in der UI editierbar): der User kann den Index-Ordner verlegen
   (z. B. in einen bestehenden System-Ordner). Beim Wechsel wird der Index **sicher migriert** (Datei-Copy,
   kein Reindex).

Dies passt zu vault-rags Architektur (pure-core hinter `VaultAdapter`, dünne Obsidian-Schicht) und zur
Best-Practices-Präferenz des Users (testbar, idiomatisch, keine riskanten Format-Brüche).

## 4. Verworfene Alternativen (mit Grund)

| Alternative | Verworfen, weil |
|---|---|
| Index in den Plugin-Ordner | Sync-Whitelist + Lösch-Risiko + Deinstall-Lifecycle → bricht iPhone-Offline |
| Dot-Ordner `.vaultrag/` | Obsidian Sync ignoriert Dot-Ordner → bricht iPhone-Offline |
| Einzeldatei, unbekannte Endung | Breaking Change + Migration; versteckt nur bei Default-Setting; höhere Sync-Last; kein Sync-Vorteil |
| „Excluded files"-Integration | Versteckt nicht im Explorer; braucht undokumentierte API (Lint-/Review-Risiko) |
| `VaultAdapter`-Interface erweitern (delete/rename) | Nicht nötig — Cleanup läuft über die Obsidian-Schicht (`this.app.vault.adapter`) |

## 5. Detail-Design

### 5.1 Settings (`src/settings.ts`)

**Interface `VaultRagSettings`:**
- `indexDir: string` — existiert bereits (Default `"_vaultrag"`). **Neu: in der UI editierbar.**
- `hideIndexFolder: boolean` — **neu, Default `true`** (sane default: der Index-Ordner ist ein derived,
  internes Artefakt, das die meisten Nutzer nie brauchen — „standardmäßig aufgeräumt, bei Bedarf sichtbar
  machen"). Wer den Ordner sehen will, schaltet den Toggle ab. **CHANGELOG-Hinweis nötig:** bestehende
  Nutzer sehen ihren bisher sichtbaren `_vaultrag/`-Ordner nach dem Update nicht mehr (rein kosmetisch,
  jederzeit abschaltbar, keine Daten betroffen).

**`VaultRagSettingTab.display()`** — in der bestehenden **Index-Sektion** (neben dem Reindex-Button):
- **Pfad-Eingabe für `indexDir`:** Text-Setting mit Ordner-Autocomplete (`AbstractInputSuggest` —
  bereits im Code für den Smart-Apply-Vorlagen-Picker vorhanden) + Trailing-Slash-Normalisierung.
  **Validierung/Warnung** bei Dot-Präfix-Pfad: „beginnt mit `.` → wird von Obsidian Sync ignoriert,
  Index synct dann nicht cross-device".
- **Toggle `hideIndexFolder`:** Beschriftung „Index-Ordner im Datei-Explorer ausblenden", Hilfetext
  erklärt, dass der Ordner nur kosmetisch verborgen wird (Daten bleiben, Sync bleibt).

### 5.2 CSS-Hide

**`src/explorer_hide.ts` (neu, pure-core, obsidian-frei, testbar):**
```ts
export function buildHideCss(indexDir: string, hide: boolean): string;
```
- Liefert `""` wenn `hide === false` **oder** `indexDir` leer/normalisiert leer.
- Sonst (mit `p` = normalisierter Pfad ohne Trailing-Slash, `s = JSON.stringify(p)` für Escaping):
  ```css
  .nav-folder-title[data-path=${s}],
  .nav-folder-title[data-path=${s}] + .nav-folder-children { display: none; }
  ```
- Bewusst **ohne `:has()`** (mobile-WebView-Kompatibilität) und mit `display:none` (nicht `visibility`/
  `opacity` — sonst stört es die Explorer-Virtualisierung). `data-path` ist der vault-relative Pfad
  **ohne** Trailing-Slash (z. B. `_vaultrag`), passend zu Obsidians Attributwert.

**`src/main.ts` (Obsidian-Schicht):**
- Im `onload`: ein `<style>`-Element erzeugen via `createEl("style", { attr: { id: "vaultrag-hide-index" } })`,
  Inhalt ausschließlich über `textContent` (nie `innerHTML` → Lint). Cleanup registrieren:
  `this.register(() => styleEl.remove())`.
- Methode `refreshIndexFolderHiding()`: `styleEl.textContent = buildHideCss(this.settings.indexDir, this.settings.hideIndexFolder)`.
- Aufgerufen: einmal im `onload` (nach Settings-Load) **und** bei jeder relevanten Settings-Änderung
  (Toggle *oder* Pfad).

### 5.3 Wählbarer Speicherort + Pfad-Wechsel-Migration

**`src/index_migrate.ts` (neu, pure-core, obsidian-frei, testbar):** eigenes Modul (statt `live_indexer.ts`
zu vergrößern), konsistent mit der Ein-Zweck-Modul-Konvention.
```ts
export async function migrateIndex(adapter: VaultAdapter, from: string, to: string): Promise<void>;
```
- `mkdir(to)`, dann für jede bekannte Index-Datei (`notes.i8` binär, `paths.json`, `manifest.json`,
  `pending.json`) **read von `from` → write nach `to`**; fehlende Datei wird übersprungen (try/catch
  pro Datei). Kopiert die **echten persistierten Dateien** → kein Reindex, kein In-Memory-Risiko, instant.
- `from === to` (nach Normalisierung) → no-op.

**`src/main.ts` — Ablauf bei `indexDir`-Änderung A→B (Settings-Callback):**
1. Normalisieren; wenn unverändert → nichts tun.
2. `await migrateIndex(adapter, A, B)` (kopiert den Index an den neuen Ort).
3. Index-Komponenten auf B umstellen: `LiveIndexer`/`PendingQueue`/`IndexLoader` mit `B` neu verdrahten
   (analog zur bestehenden `reconnectEmbedder`-Logik) und neu laden — so bleibt der In-Memory-Stand konsistent.
4. CSS-Regel auf B aktualisieren (`refreshIndexFolderHiding`).
5. **Alten Ordner A aufräumen (User-bestätigte Empfehlung):** nach erfolgreicher Migration die bekannten
   Index-Dateien in A entfernen und `rmdir(A)` — **nur** wenn A nach dem Entfernen leer ist bzw.
   ausschließlich unsere Dateien enthielt (Sicherheits-Check, damit kein fremder Ordnerinhalt gelöscht
   wird). Schlägt der Check fehl → A stehen lassen + **Notice** „Alter Index unter A kann manuell gelöscht
   werden". Durchgeführt über die Obsidian-Schicht (`this.app.vault.adapter.remove/rmdir`) — **kein**
   `VaultAdapter`-Interface-Umbau.

**Reihenfolge-Garantie (Datenverlust-Lehre 2026-06-26):** Erst an B schreiben + verifizieren, **dann**
A löschen. Nie A vor erfolgreichem B-Write anfassen.

## 6. Komponenten / berührte Dateien

| Datei | Änderung |
|---|---|
| `src/settings.ts` | `hideIndexFolder` ins Interface + `DEFAULT_SETTINGS`; UI: Pfad-Eingabe (Autocomplete + Dot-Warnung) + Ausblenden-Toggle in der Index-Sektion |
| `src/explorer_hide.ts` *(neu)* | pure `buildHideCss(indexDir, hide)` |
| `src/index_migrate.ts` *(neu)* | pure `migrateIndex(adapter, from, to)` |
| `src/main.ts` | `<style>`-Element + `refreshIndexFolderHiding()`; Pfad-Wechsel-Orchestrierung (migrate → re-wire → hide-refresh → cleanup); Notice-Pfad |
| `tests/explorer_hide.test.ts` *(neu)* | `buildHideCss`-Fälle |
| `tests/index_migrate.test.ts` *(neu)* | `migrateIndex`-Fälle |
| `tests/settings.test.ts` | Default `hideIndexFolder: false` |
| `README.md` / `AGENTS.md` | neue Settings + Hinweis „Sync all other types" + Gotcha CSS-`data-path` |

## 7. Tests (TDD, vitest + happy-dom; Obsidian-Mock)

- **`buildHideCss`:** (a) `hide=false` → `""`; (b) `hide=true` → korrekte Regel inkl.
  `+ .nav-folder-children`; (c) Escaping eines Pfads mit Sonderzeichen/Leerzeichen via `JSON.stringify`;
  (d) verschachtelter Pfad (`99_System/vaultrag` → nur dieser Ordner, nicht der Parent); (e) leerer/Whitespace-Pfad → `""`.
- **`migrateIndex`:** (a) kopiert alle vorhandenen Dateien (binär + text) korrekt (in-memory-Adapter-Mock,
  wie bestehend); (b) fehlende Datei wird übersprungen, kein Throw; (c) `from === to` → no-op; (d) `mkdir(to)`
  wird aufgerufen.
- **Settings:** Default `hideIndexFolder === true`; bestehende Defaults unberührt.
- **Dot-Pfad-Validierung:** pure Helper (z. B. `isDotPath(p)` / Warn-Bedingung) wird getestet.
- **Nicht test-pflichtig (by-inspection):** DOM-Injektion in `main.ts`, Settings-UI-Verdrahtung,
  Obsidian-`rmdir`-Cleanup (Obsidian-Schicht, kein DOM-Mock) — analog zur bestehenden Konvention.

## 8. Risiken & Gotchas

- **`data-path` ist internes Markup** (kein offizielles API). Ein Obsidian-Update könnte es brechen.
  Folge wäre rein **kosmetisch** (Ordner taucht wieder auf), **kein Datenverlust**. Akzeptiert; im Code
  kommentieren.
- **Sync-Voraussetzung unverändert:** Der Index (egal welcher Pfad) synct nur, wenn der Nutzer in Obsidian
  Sync „Sync all other types" aktiviert hat — das gilt heute schon und wird in der Doku festgehalten.
- **Pfad-Wechsel + Cleanup:** Sicherheits-Check vor `rmdir`, Reihenfolge B-vor-A strikt einhalten
  (Datenverlust-Lehre). Bei Unsicherheit A stehen lassen + Notice.
- **Verschachtelter Index-Pfad:** Das CSS versteckt nur den Index-(Unter-)Ordner, nicht dessen Parent —
  gewolltes Verhalten.

## 9. Bewusste Scope-Schnitte (YAGNI)

- **Kein** Einzeldatei-/Container-Format (Breaking Change ohne Nutzen über CSS-Hide hinaus).
- **Keine** „Excluded files"-Integration (undokumentierte API, Lint-/Review-Risiko, geringer Nutzen für
  Nicht-Markdown-Index-Dateien).
- **Keine** `VaultAdapter`-Interface-Erweiterung (Cleanup über Obsidian-Schicht).
- **Kein** automatischer Sync-Toggle-Eingriff (Obsidian-Settings bleiben Nutzerhoheit).
