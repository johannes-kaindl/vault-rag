# Embedding-Fortschrittsanzeige Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embedding-Fortschritt im Plugin sichtbar machen — in den Settings (live N/M-Anzeige + Embed-Status) und optional in der Obsidian-Statusleiste (Toggle).

**Architecture:** Plugin hält public `embeddingProgress`-State, den Settings-Tab via `setInterval` poollt. Ein optional erstelltes `StatusBarItem` zeigt dieselbe Info kompakt. `LiveIndexer` bekommt einen `noteCount`-Getter.

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`addStatusBarItem`, `PluginSettingTab.hide`), vitest

## Global Constraints

- TypeScript strict mode, noImplicitAny — keine `any`-Casts für neue Typen
- `VaultAdapter` Interface-Definition in `src/index.ts` — nicht ändern
- Kein neues npm-Paket
- Alle bestehenden Tests müssen nach jedem Task grün bleiben
- `showStatusBar` Default = `false`
- `isEmbedding` via `try/finally` geklammert (kein finally-Vergessen)
- Status-Bar-Text-Format: `↻ embedding…` / `● N | ⏳ M` (M=pending, N=embedded) / `● N`
- Settings-Tab-Refresh-Interval: 2000 ms
- `setInterval` in `display()`, gestoppt in `hide()` — kein Memory-Leak

---

### Task 1: `noteCount`-Getter + Settings-Default

**Files:**
- Modify: `src/live_indexer.ts` (Getter nach `rename()`)
- Modify: `src/settings.ts` (Interface + Default)
- Modify: `tests/settings.test.ts`
- Modify: `tests/live_indexer.test.ts`

**Interfaces:**
- Produces: `LiveIndexer.noteCount: number` (public getter)
- Produces: `VaultRagSettings.showStatusBar: boolean` (Default false)

- [ ] **Step 1: Failing test — noteCount Getter**

In `tests/live_indexer.test.ts`, füge nach den bestehenden Tests hinzu:

```typescript
it("noteCount gibt die Anzahl der bekannten Notizen zurück", async () => {
  const indexer = new LiveIndexer(mockAdapter, "_vaultrag", mockEmbedder, "qwen3-embedding:8b");
  expect(indexer.noteCount).toBe(0);
  // update fügt eine Notiz hinzu
  mockEmbedder.embed.mockResolvedValue([new Float32Array(256).fill(0.1)]);
  await indexer.update("a.md", "Hallo Welt das ist ein Text");
  expect(indexer.noteCount).toBe(1);
  indexer.remove("a.md");
  expect(indexer.noteCount).toBe(0);
});
```

- [ ] **Step 2: Test ausführen — erwartet FAIL**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && npx vitest run tests/live_indexer.test.ts 2>&1 | tail -10
```
Erwartet: Fehler wegen `noteCount` nicht vorhanden.

- [ ] **Step 3: Getter implementieren**

In `src/live_indexer.ts`, füge nach der `rename()`-Methode ein:

```typescript
get noteCount(): number { return this.noteVectors.size; }
```

- [ ] **Step 4: Failing test — showStatusBar Default**

In `tests/settings.test.ts`:

```typescript
it("showStatusBar-Default ist false", () => {
  expect(DEFAULT_SETTINGS.showStatusBar).toBe(false);
});
```

- [ ] **Step 5: Test ausführen — erwartet FAIL**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && npx vitest run tests/settings.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: `showStatusBar` in Interface + Default ergänzen**

In `src/settings.ts`, `VaultRagSettings` Interface:
```typescript
export interface VaultRagSettings {
  k: number;
  minSim: number;
  indexDir: string;
  exclude: string[];
  embeddingEndpoint: string;
  embeddingModel: string;
  showStatusBar: boolean;
}
```

`DEFAULT_SETTINGS`:
```typescript
export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  exclude: ["Templates/", "Archive/", ".trash/"],
  embeddingEndpoint: "http://localhost:11434",
  embeddingModel: "qwen3-embedding:8b",
  showStatusBar: false,
};
```

- [ ] **Step 7: Alle Tests grün**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && npx vitest run 2>&1 | tail -15
```
Erwartet: alle Tests PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && git add src/live_indexer.ts src/settings.ts tests/live_indexer.test.ts tests/settings.test.ts && git commit -m "feat(progress): noteCount-Getter + showStatusBar-Setting"
```

---

### Task 2: `EmbeddingProgress`-State + `syncProgress` in `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `LiveIndexer.noteCount` (aus Task 1)
- Consumes: `PendingQueue.size` (bereits vorhanden)
- Produces: `VaultRagPlugin.embeddingProgress: EmbeddingProgress` (public)
- Produces: `VaultRagPlugin.syncProgress()` (private, zum Testen exportierbar via public in Tests)

Hinweis: Da `main.ts` ein Obsidian-Plugin ist (kein reiner Unittest), werden Main-Tests über den bestehenden Mock-Adapter-Pattern aufgebaut. Es gibt aktuell keine `tests/main.test.ts` — diesen Task direkt in der Implementierung validieren via TypeScript-Compiler (Build) und manuellem Check. Wenn ein `tests/main.test.ts` existiert, dort testen; sonst: Build + alle anderen Tests grün.

- [ ] **Step 1: `EmbeddingProgress`-Interface + public field**

Am Anfang von `src/main.ts`, nach den Imports, füge ein (vor der Klasse):

```typescript
export interface EmbeddingProgress {
  isEmbedding: boolean;
  embeddedNotes: number;
  pendingNotes: number;
}
```

In der Klasse `VaultRagPlugin`, nach `private debounceTimers`:

```typescript
embeddingProgress: EmbeddingProgress = {
  isEmbedding: false,
  embeddedNotes: 0,
  pendingNotes: 0,
};
```

- [ ] **Step 2: `syncProgress()`-Methode**

Füge eine private Hilfsmethode am Ende der Klasse ein (vor `activateView`):

```typescript
private syncProgress(): void {
  this.embeddingProgress.embeddedNotes = this.liveIndexer.noteCount;
  this.embeddingProgress.pendingNotes = this.pendingQueue.size;
}
```

- [ ] **Step 3: `isEmbedding` in `handleModify` via try/finally**

`handleModify` erhält einen `try/finally`-Wrapper um den Embedding-Block:

```typescript
private async handleModify(path: string): Promise<void> {
  if (this.settings.exclude.some(e => path.startsWith(e))) return;
  if (path.startsWith(this.settings.indexDir + "/")) return;
  let content: string;
  try { content = await this.app.vault.adapter.read(path); } catch { return; }

  if (await this.embedder.ping()) {
    this.embeddingProgress.isEmbedding = true;
    try {
      await this.liveIndexer.update(path, content);
      this.index = this.liveIndexer.buildIndex();
      this.retriever = new Retriever(this.index);
      await this.liveIndexer.persist();
      this.syncProgress();
      this.refresh();
    } catch {
      await this.pendingQueue.add(path);
      this.syncProgress();
    } finally {
      this.embeddingProgress.isEmbedding = false;
    }
  } else {
    await this.pendingQueue.add(path);
    this.syncProgress();
  }
}
```

- [ ] **Step 4: `syncProgress` in `handleDelete` und `handleRename`**

`handleDelete`:
```typescript
private async handleDelete(path: string): Promise<void> {
  if (!(await this.embedder.ping())) return;
  this.liveIndexer.remove(path);
  this.index = this.liveIndexer.buildIndex();
  this.retriever = new Retriever(this.index);
  await this.liveIndexer.persist();
  this.syncProgress();
  this.refresh();
}
```

`handleRename`:
```typescript
private async handleRename(newPath: string, oldPath: string): Promise<void> {
  if (await this.embedder.ping()) {
    this.liveIndexer.rename(oldPath, newPath);
    this.index = this.liveIndexer.buildIndex();
    this.retriever = new Retriever(this.index);
    await this.liveIndexer.persist();
    this.syncProgress();
    this.refresh();
  } else {
    await this.pendingQueue.add(newPath);
    this.syncProgress();
  }
}
```

- [ ] **Step 5: `isEmbedding` in `drainPending` via try/finally**

```typescript
private async drainPending(): Promise<void> {
  const paths = this.pendingQueue.drain();
  this.embeddingProgress.isEmbedding = true;
  try {
    for (const path of paths) {
      try {
        const content = await this.app.vault.adapter.read(path);
        await this.liveIndexer.update(path, content);
      } catch { /* Datei gelöscht oder unlesbar — überspringen */ }
    }
    this.index = this.liveIndexer.buildIndex();
    this.retriever = new Retriever(this.index);
    await this.liveIndexer.persist();
    this.syncProgress();
    this.refresh();
  } finally {
    this.embeddingProgress.isEmbedding = false;
  }
}
```

- [ ] **Step 6: `syncProgress` nach `loadIndex`**

Am Ende von `loadIndex()`, nach `this.refresh()`:
```typescript
this.syncProgress();
```

(Statt: nur nach dem try-Block, also innerhalb des `try`.)

- [ ] **Step 7: TypeScript-Build**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && npm run build 2>&1 | tail -20
```
Erwartet: Build erfolgreich, keine TS-Fehler.

- [ ] **Step 8: Alle Tests grün**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && npx vitest run 2>&1 | tail -15
```

- [ ] **Step 9: Commit**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && git add src/main.ts && git commit -m "feat(progress): EmbeddingProgress-State + syncProgress in Plugin"
```

---

### Task 3: Settings-Tab — Progress-Sektion + Toggle

**Files:**
- Modify: `src/settings.ts`

**Interfaces:**
- Consumes: `plugin.embeddingProgress: EmbeddingProgress` (aus Task 2)
- Consumes: `plugin.setStatusBarVisible(show: boolean)` (aus Task 4, wird hier aufgerufen — das Interface muss passen; setStatusBarVisible existiert aber erst nach Task 4, daher: hier `plugin.setStatusBarVisible?.(v)` mit optionalem Chaining)

Hinweis: Obsidian-APIs (`setInterval`, `clearInterval`, DOM-Manipulation via `containerEl`) sind im Plugin-Kontext verfügbar. Im Test-Mock (`tests/__mocks__/obsidian.ts`) sind diese nicht gemockt — der Settings-Tab wird nicht in Unit-Tests instanziiert. Tests für den Tab entfallen; manuelles Testen in Obsidian.

- [ ] **Step 1: Interval-Handle als Instanzvariable**

In `VaultRagSettingTab`, nach dem Constructor:

```typescript
private refreshInterval: ReturnType<typeof window.setInterval> | null = null;
```

- [ ] **Step 2: `hide()`-Override**

Füge nach dem Constructor, vor `display()` ein:

```typescript
hide(): void {
  if (this.refreshInterval !== null) {
    window.clearInterval(this.refreshInterval);
    this.refreshInterval = null;
  }
}
```

- [ ] **Step 3: Progress-Sektion in `display()` ergänzen**

In `display()`, nach dem Embedding-Modell-Block und **vor** dem alten Status-Badge-Block, füge ein:

```typescript
// Fortschritts-Sektion
containerEl.createEl("h3", { text: "Embedding-Fortschritt" });

const progressStatusEl = containerEl.createDiv({ cls: "vault-rag-progress-status" });
const progressEmbeddedEl = containerEl.createDiv({ cls: "vault-rag-progress-embedded" });
const progressPendingEl = containerEl.createDiv({ cls: "vault-rag-progress-pending" });

const updateProgress = () => {
  const p = this.plugin.embeddingProgress;
  if (!p) return;
  progressStatusEl.setText(p.isEmbedding ? "↻ Embedding läuft…" : "● Bereit");
  progressEmbeddedEl.setText(`Eingebettet: ${p.embeddedNotes.toLocaleString("de-DE")} Notizen`);
  progressPendingEl.setText(`Ausstehend: ${p.pendingNotes.toLocaleString("de-DE")} Notizen`);
};

updateProgress();
this.refreshInterval = window.setInterval(updateProgress, 2000);
```

- [ ] **Step 4: Toggle für Statusleiste**

Nach der Progress-Sektion, vor dem alten Status-Badge:

```typescript
new Setting(containerEl)
  .setName("Fortschritt in Statusleiste")
  .setDesc("Zeigt Embedding-Status in der unteren Obsidian-Leiste")
  .addToggle(t =>
    t.setValue(this.plugin.settings.showStatusBar).onChange(async (v: boolean) => {
      this.plugin.settings.showStatusBar = v;
      await this.plugin.saveSettings();
      this.plugin.setStatusBarVisible?.(v);
    }));
```

- [ ] **Step 5: Build**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && npm run build 2>&1 | tail -20
```

- [ ] **Step 6: Alle Tests grün**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && npx vitest run 2>&1 | tail -15
```

- [ ] **Step 7: Commit**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && git add src/settings.ts && git commit -m "feat(progress): Progress-Sektion + Statusleisten-Toggle in Settings"
```

---

### Task 4: Statusleisten-Item in `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `embeddingProgress` (aus Task 2)
- Consumes: `settings.showStatusBar` (aus Task 1)
- Produces: `setStatusBarVisible(show: boolean)` (public)

Obsidian API: `this.addStatusBarItem()` gibt ein `HTMLElement` zurück. Text setzen via `.setText()`. Entfernen via `.remove()`.

- [ ] **Step 1: `statusBarEl`-Instanzvariable**

In der Klasse `VaultRagPlugin`, nach `embeddingProgress`:

```typescript
private statusBarEl: HTMLElement | null = null;
```

- [ ] **Step 2: `updateStatusBar()`-Methode**

```typescript
private updateStatusBar(): void {
  if (!this.statusBarEl) return;
  const p = this.embeddingProgress;
  if (p.isEmbedding) {
    this.statusBarEl.setText("↻ embedding…");
  } else if (p.pendingNotes > 0) {
    this.statusBarEl.setText(`● ${p.embeddedNotes.toLocaleString("de-DE")} | ⏳ ${p.pendingNotes}`);
  } else {
    this.statusBarEl.setText(`● ${p.embeddedNotes.toLocaleString("de-DE")}`);
  }
}
```

- [ ] **Step 3: `setStatusBarVisible()`-Methode**

```typescript
setStatusBarVisible(show: boolean): void {
  if (show && !this.statusBarEl) {
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();
  } else if (!show && this.statusBarEl) {
    this.statusBarEl.remove();
    this.statusBarEl = null;
  }
}
```

- [ ] **Step 4: `syncProgress()` um `updateStatusBar()` erweitern**

In der bestehenden `syncProgress()`-Methode, am Ende anfügen:

```typescript
private syncProgress(): void {
  this.embeddingProgress.embeddedNotes = this.liveIndexer.noteCount;
  this.embeddingProgress.pendingNotes = this.pendingQueue.size;
  this.updateStatusBar();
}
```

- [ ] **Step 5: StatusBar beim Laden initialisieren**

In `onload()`, nach `await this.loadIndex()`:

```typescript
if (this.settings.showStatusBar) this.setStatusBarVisible(true);
```

- [ ] **Step 6: Build**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && npm run build 2>&1 | tail -20
```

- [ ] **Step 7: Alle Tests grün**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && npx vitest run 2>&1 | tail -15
```

- [ ] **Step 8: Commit**

```bash
cd /Users/Shared/code/obsidian-plugins/vault-rag && git add src/main.ts && git commit -m "feat(progress): Statusleisten-Item + setStatusBarVisible"
```

---

## Post-Implementation

Nach allen Tasks: build-Output prüfen (`main.js` in Plugin-Symlink vorhanden), Plugin in Obsidian neu laden, Settings öffnen und Progress-Sektion manuell verifizieren.
