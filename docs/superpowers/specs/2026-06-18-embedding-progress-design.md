# Design: Embedding-Fortschrittsanzeige (Slice A+)

**Datum:** 2026-06-18  
**Repo:** `/Users/Shared/code/vault-rag`  
**Status:** Approved

---

## Kontext

Das Plugin hat seit Slice A+ Live-Embedding via Ollama. Der User sieht dabei nicht, ob gerade etwas eingebettet wird, wie viele Notizen bereits eingebettet sind und wie viele noch ausstehen. Dieses Feature fügt zwei Anzeigeoberflächen hinzu.

---

## Ziel

1. **Settings-Tab** zeigt live: läuft gerade ein Embedding-Vorgang, N eingebettete Notizen, M ausstehende.
2. **Obsidian-Statusleiste** (optional, via Toggle): zeigt dieselbe Info kompakter.

---

## State-Design

### `EmbeddingProgress` (in `main.ts`, public)

```typescript
export interface EmbeddingProgress {
  isEmbedding: boolean;   // true während handleModify/drainPending läuft
  embeddedNotes: number;  // = liveIndexer.noteCount
  pendingNotes: number;   // = pendingQueue.size
}
```

Das Plugin hält `embeddingProgress: EmbeddingProgress` als public property. State wird nach jeder Embedding-Operation synchronisiert.

### `isEmbedding`-Lifecycle
- Wird mit `try { this.embeddingProgress.isEmbedding = true; ... } finally { this.embeddingProgress.isEmbedding = false; }` in `handleModify()` und `drainPending()` geklammert.
- Der Debounce-Timer in `scheduleEmbed` setzt `isEmbedding` **nicht** — nur der tatsächliche Embedding-Vorgang.

### `liveIndexer.noteCount` (neuer public getter)
```typescript
get noteCount(): number { return this.noteVectors.size; }
```

### Progress-Sync
Nach `liveIndexer.update()`, `liveIndexer.remove()`, `liveIndexer.rename()` und am Ende von `drainPending()` wird `embeddingProgress.embeddedNotes` und `embeddingProgress.pendingNotes` aktualisiert (private Hilfsmethode `syncProgress()`).

---

## Settings-Tab: Progress-Sektion

- Rendered nach dem Embedding-Endpoint/Modell-Block, vor dem alten Status-Badge.
- Zeigt drei Read-only-Zeilen:
  - `Status: Embedding läuft…` / `Status: Bereit`
  - `Eingebettet: 4 459 Notizen`
  - `Ausstehend: 3 Notizen`
- Refresh via `setInterval(updateProgress, 2000)` in `display()`, gestoppt in `hide()`.
- Das Interval-Handle wird als Instanzvariable gespeichert (kein Memory-Leak).
- `hide()` überschreibt `PluginSettingTab.hide()` um das Interval zu stoppen.

### Toggle: Statusleiste
- Neues `Setting` mit Toggle:
  ```
  "Fortschritt in Statusleiste"
  "Zeigt Embedding-Status in der unteren Obsidian-Leiste"
  ```
- Beim Toggle → `plugin.setStatusBarVisible(v)` aufrufen.

---

## Settings-Feld

```typescript
export interface VaultRagSettings {
  // ... bestehende Felder
  showStatusBar: boolean;   // neu, Default: false
}
```

Default: `false` (Statusleiste nicht sichtbar by default).

---

## Statusleisten-Item

- In `main.ts`: `private statusBarEl: HTMLElement | null = null;`
- `setStatusBarVisible(show: boolean)`: erstellt oder entfernt das Item.
- Item-Text wird via `updateStatusBar()` gesetzt, aufgerufen von `syncProgress()`.
- Format: `↻ embedding…` / `● 4 459 | ⏳ 3` / `● 4 459`
- Nur wenn `showStatusBar === true`.

---

## Dateien

| Datei | Änderungen |
|---|---|
| `src/settings.ts` | `showStatusBar` in Interface+Default; Progress-Sektion in `display()`; `hide()` override; Toggle |
| `src/live_indexer.ts` | `get noteCount()` |
| `src/main.ts` | `embeddingProgress` public field; `syncProgress()`; `isEmbedding` try/finally; `statusBarEl`; `setStatusBarVisible()`; `updateStatusBar()` |

---

## Tests

- `tests/settings.test.ts`: `showStatusBar`-Default = false
- `tests/live_indexer.test.ts`: `noteCount` nach `update()`/`remove()`
- `tests/main.test.ts` (neu oder erweiterter Mock): `embeddingProgress`-State nach Operationen; `isEmbedding`-Flag-Lifecycle; `syncProgress`-Aufruf

---

## Nicht in Scope

- Fortschritt pro Chunk (nur per Note)
- ETA / Zeitschätzung
- Notifications / Toasts
- Fehleranzahl in der Statusleiste
