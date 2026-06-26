# Index-Ordner ausblenden + wählbarer Speicherort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Index-Ordner per Toggle aus dem Datei-Explorer ausblenden (CSS) und seinen Speicherort konfigurierbar machen — ohne Index-Format, Sync oder iPhone-Offline anzutasten.

**Architecture:** Zwei neue pure-core-Module (`index_dir.ts` für CSS/Pfad-Helfer, `index_migrate.ts` für Datei-Copy + Cleanup-Entscheidung), getestet in Node. Die Obsidian-Schicht (`settings.ts`-UI + `main.ts`) verdrahtet sie: ein injiziertes `<style>`-Element versteckt den Ordner via `data-path`, ein „Übernehmen"-Button migriert den Index bei Pfad-Wechsel (Copy → re-wire → Cleanup mit Sicherheits-Check).

**Tech Stack:** TypeScript (strict), Obsidian Plugin API, esbuild, vitest + happy-dom, eslint-plugin-obsidianmd.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Tests:** vitest; nach jeder Änderung müssen **alle** Tests grün bleiben. Obsidian-Mock unter `tests/__mocks__/obsidian.ts`; pure-core-Module importieren **nie** `obsidian`.
- **Lint:** `eslint-plugin-obsidianmd`; **kein** `eslint-disable`, **kein** `innerHTML`/`insertAdjacentHTML` (CSS via `textContent`), DOM via `createEl`. Leere `catch`-Blöcke nur mit erklärendem Kommentar (Projekt-Konvention, vgl. `live_indexer.ts:61`).
- **CSS-Hide:** `display: none` (nicht `visibility`/`opacity` — Explorer-Virtualisierung), **kein** `:has()` (Mobile-WebView), Attributwert via `JSON.stringify` escapen, Selektor auf `.nav-folder-title[data-path=…]` + `+ .nav-folder-children`.
- **`VaultAdapter`-Interface (`src/index.ts:11-17`) NICHT ändern** — Cleanup/Listing läuft über die Obsidian-Schicht (`this.app.vault.adapter` = voller DataAdapter mit `list`/`remove`/`rmdir`).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt; **nur berührte Dateien stagen — nie `git add -A`**. Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** `feat/hide-index-folder` (existiert bereits, Spec liegt dort).
- **`hideIndexFolder` Default = `true`** (sane default; CHANGELOG-Hinweis für bestehende Nutzer).

---

### Task 1: Pfad-/CSS-Helfer (`src/index_dir.ts`)

**Files:**
- Create: `src/index_dir.ts`
- Test: `tests/index_dir.test.ts`

**Interfaces:**
- Produces:
  - `normalizeIndexDir(raw: string): string` — trimmt, entfernt Trailing-Slashes.
  - `isDotPath(raw: string): boolean` — true wenn normalisierter Pfad mit `.` beginnt.
  - `buildHideCss(indexDir: string, hide: boolean): string` — CSS-Regel oder `""`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/index_dir.test.ts
import { describe, it, expect } from "vitest";
import { normalizeIndexDir, isDotPath, buildHideCss } from "../src/index_dir";

describe("normalizeIndexDir", () => {
  it("trimmt und entfernt Trailing-Slashes", () => {
    expect(normalizeIndexDir("  _vaultrag/  ")).toBe("_vaultrag");
    expect(normalizeIndexDir("a/b//")).toBe("a/b");
    expect(normalizeIndexDir("_vaultrag")).toBe("_vaultrag");
  });
});

describe("isDotPath", () => {
  it("erkennt Dot-Präfix", () => {
    expect(isDotPath(".vaultrag")).toBe(true);
    expect(isDotPath("  .foo/ ")).toBe(true);
    expect(isDotPath("_vaultrag")).toBe(false);
  });
});

describe("buildHideCss", () => {
  it("hide=false → leerer String", () => {
    expect(buildHideCss("_vaultrag", false)).toBe("");
  });
  it("leerer/whitespace Pfad → leerer String", () => {
    expect(buildHideCss("", true)).toBe("");
    expect(buildHideCss("   ", true)).toBe("");
  });
  it("hide=true → display:none-Regel auf Titel + Kinder", () => {
    const css = buildHideCss("_vaultrag", true);
    expect(css).toContain('.nav-folder-title[data-path="_vaultrag"]');
    expect(css).toContain("+ .nav-folder-children");
    expect(css).toContain("display: none");
    expect(css).not.toContain(":has(");
  });
  it("escapt Sonderzeichen/Leerzeichen via JSON.stringify", () => {
    expect(buildHideCss("99 System/idx", true)).toContain('[data-path="99 System/idx"]');
  });
  it("normalisiert Trailing-Slash im Selektor", () => {
    expect(buildHideCss("_vaultrag/", true)).toContain('[data-path="_vaultrag"]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index_dir.test.ts`
Expected: FAIL mit „Cannot find module '../src/index_dir'" o.ä.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/index_dir.ts

/** Trimmt und entfernt Trailing-Slashes — kanonische Form für Vergleiche und data-path. */
export function normalizeIndexDir(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** Pfade mit `.`-Präfix werden von Obsidian Sync ignoriert (außer `.obsidian`). */
export function isDotPath(raw: string): boolean {
  return normalizeIndexDir(raw).startsWith(".");
}

/**
 * CSS, das den Index-Ordner aus dem Datei-Explorer ausblendet.
 * `data-path` ist internes Obsidian-Markup (kein API) — bricht es, taucht der Ordner nur
 * kosmetisch wieder auf (kein Datenverlust). Ohne `:has()` (Mobile), `display:none`
 * (Explorer-Virtualisierung), Attributwert via JSON.stringify escaped.
 */
export function buildHideCss(indexDir: string, hide: boolean): string {
  const p = normalizeIndexDir(indexDir);
  if (!hide || p === "") return "";
  const sel = `.nav-folder-title[data-path=${JSON.stringify(p)}]`;
  return `${sel},\n${sel} + .nav-folder-children { display: none; }`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/index_dir.test.ts`
Expected: PASS (alle Fälle grün)

- [ ] **Step 5: Commit**

```bash
git add src/index_dir.ts tests/index_dir.test.ts
git commit -m "feat(index): Pfad-Helfer + CSS-Hide-Generator (pure-core)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Index-Migration + Cleanup-Entscheidung (`src/index_migrate.ts`)

**Files:**
- Create: `src/index_migrate.ts`
- Test: `tests/index_migrate.test.ts`

**Interfaces:**
- Consumes: `VaultAdapter` (`src/index.ts`), `normalizeIndexDir` (Task 1).
- Produces:
  - `INDEX_ALL_FILES: string[]` — Basenames aller Index-Dateien.
  - `migrateIndex(adapter: VaultAdapter, from: string, to: string): Promise<void>` — kopiert die Index-Dateien; `from===to` (normalisiert) → no-op; fehlende Dateien werden übersprungen.
  - `onlyContainsIndexFiles(files: string[], folders: string[]): boolean` — true, wenn das Listing (volle Pfade) ausschließlich bekannte Index-Dateien und keine Unterordner enthält.

- [ ] **Step 1: Write the failing test**

```ts
// tests/index_migrate.test.ts
import { describe, it, expect } from "vitest";
import { VaultAdapter } from "../src/index";
import { migrateIndex, onlyContainsIndexFiles, INDEX_ALL_FILES } from "../src/index_migrate";

function makeMemAdapter(seed: Record<string, string | ArrayBuffer> = {}): VaultAdapter & { store: Map<string, string | ArrayBuffer>; mkdirs: string[] } {
  const store = new Map<string, string | ArrayBuffer>(Object.entries(seed));
  const mkdirs: string[] = [];
  return {
    read: async (p: string) => { if (!store.has(p)) throw new Error("not found: " + p); return store.get(p) as string; },
    readBinary: async (p: string) => { if (!store.has(p)) throw new Error("not found: " + p); return store.get(p) as ArrayBuffer; },
    write: async (p: string, d: string) => { store.set(p, d); },
    writeBinary: async (p: string, d: ArrayBuffer) => { store.set(p, d); },
    mkdir: async (p: string) => { mkdirs.push(p); },
    store,
    mkdirs,
  };
}

describe("migrateIndex", () => {
  it("kopiert binär + text von alt nach neu und legt das Zielverzeichnis an", async () => {
    const bin = new Int8Array([1, 2, 3]).buffer;
    const a = makeMemAdapter({
      "_vaultrag/notes.i8": bin,
      "_vaultrag/paths.json": '["a.md"]',
      "_vaultrag/manifest.json": '{"count":1}',
      "_vaultrag/pending.json": "[]",
    });
    await migrateIndex(a, "_vaultrag", "99_System/idx");
    expect(a.mkdirs).toContain("99_System/idx");
    expect(a.store.get("99_System/idx/notes.i8")).toBe(bin);
    expect(a.store.get("99_System/idx/paths.json")).toBe('["a.md"]');
    expect(a.store.get("99_System/idx/manifest.json")).toBe('{"count":1}');
    expect(a.store.get("99_System/idx/pending.json")).toBe("[]");
  });

  it("überspringt fehlende Dateien ohne Fehler", async () => {
    const a = makeMemAdapter({ "_vaultrag/notes.i8": new ArrayBuffer(0) });
    await expect(migrateIndex(a, "_vaultrag", "x")).resolves.toBeUndefined();
    expect(a.store.get("x/notes.i8")).toBeInstanceOf(ArrayBuffer);
    expect(a.store.has("x/paths.json")).toBe(false);
  });

  it("from === to (normalisiert) ist no-op", async () => {
    const a = makeMemAdapter({ "_vaultrag/notes.i8": new ArrayBuffer(0) });
    const before = a.store.size;
    await migrateIndex(a, "_vaultrag", "_vaultrag/");
    expect(a.store.size).toBe(before);
    expect(a.mkdirs).toHaveLength(0);
  });
});

describe("onlyContainsIndexFiles", () => {
  it("nur Index-Dateien, keine Unterordner → true", () => {
    const files = INDEX_ALL_FILES.map(f => `_vaultrag/${f}`);
    expect(onlyContainsIndexFiles(files, [])).toBe(true);
  });
  it("fremde Datei → false", () => {
    expect(onlyContainsIndexFiles(["_vaultrag/notes.i8", "_vaultrag/meine-notiz.md"], [])).toBe(false);
  });
  it("Unterordner vorhanden → false", () => {
    expect(onlyContainsIndexFiles(["_vaultrag/notes.i8"], ["_vaultrag/sub"])).toBe(false);
  });
  it("leeres Listing → true (Ordner darf gelöscht werden)", () => {
    expect(onlyContainsIndexFiles([], [])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index_migrate.test.ts`
Expected: FAIL mit „Cannot find module '../src/index_migrate'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/index_migrate.ts
import { VaultAdapter } from "./index";
import { normalizeIndexDir } from "./index_dir";

const INDEX_BINARY_FILES = ["notes.i8"];
// manifest.json bewusst zuletzt (Reload-Trigger-Konvention, vgl. live_indexer.persist)
const INDEX_TEXT_FILES = ["paths.json", "pending.json", "manifest.json"];

/** Alle Index-Dateien als Basenames — für Migration und Cleanup-Sicherheitscheck. */
export const INDEX_ALL_FILES: string[] = [...INDEX_BINARY_FILES, ...INDEX_TEXT_FILES];

/**
 * Kopiert die Index-Dateien von `from` nach `to` (Copy, kein Move) — kein Reindex,
 * kein In-Memory-Risiko. Fehlende Dateien werden still übersprungen.
 */
export async function migrateIndex(adapter: VaultAdapter, from: string, to: string): Promise<void> {
  const src = normalizeIndexDir(from);
  const dst = normalizeIndexDir(to);
  if (dst === "" || src === dst) return;
  await adapter.mkdir(dst);
  for (const f of INDEX_BINARY_FILES) {
    try { await adapter.writeBinary(`${dst}/${f}`, await adapter.readBinary(`${src}/${f}`)); }
    catch { /* fehlende Datei überspringen */ }
  }
  for (const f of INDEX_TEXT_FILES) {
    try { await adapter.write(`${dst}/${f}`, await adapter.read(`${src}/${f}`)); }
    catch { /* fehlende Datei überspringen */ }
  }
}

/**
 * True, wenn ein Verzeichnis-Listing ausschließlich bekannte Index-Dateien (Basenames)
 * und keine Unterordner enthält → sicher zu löschen. `files`/`folders` sind volle Pfade
 * (Obsidian `DataAdapter.list`-Format).
 */
export function onlyContainsIndexFiles(files: string[], folders: string[]): boolean {
  if (folders.length > 0) return false;
  const known = new Set(INDEX_ALL_FILES);
  return files.every(p => known.has(p.split("/").pop() ?? p));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/index_migrate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index_migrate.ts tests/index_migrate.test.ts
git commit -m "feat(index): migrateIndex + Cleanup-Sicherheitscheck (pure-core)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Setting `hideIndexFolder` (Daten)

**Files:**
- Modify: `src/settings.ts:7-31` (Interface `VaultRagSettings`), `src/settings.ts:37-61` (`DEFAULT_SETTINGS`)
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `VaultRagSettings.hideIndexFolder: boolean` (Default `true`).

- [ ] **Step 1: Write the failing test**

Ergänze in `tests/settings.test.ts` zwei neue Tests (im `describe("settings", …)`-Block):

```ts
  it("hideIndexFolder-Default ist true", () => {
    expect(DEFAULT_SETTINGS.hideIndexFolder).toBe(true);
  });

  it("Default-Merge ergänzt fehlendes hideIndexFolder aus altem data.json (Backward-Compat)", () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, { k: 30 } as Partial<VaultRagSettings>);
    expect(merged.hideIndexFolder).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `DEFAULT_SETTINGS.hideIndexFolder` ist `undefined`, erwartet `true`.

- [ ] **Step 3: Write minimal implementation**

In `src/settings.ts`, Interface `VaultRagSettings` (nach `indexDir: string;`, Zeile 10):

```ts
  indexDir: string;
  hideIndexFolder: boolean;
```

In `DEFAULT_SETTINGS` (nach `indexDir: "_vaultrag",`, Zeile 40):

```ts
  indexDir: "_vaultrag",
  hideIndexFolder: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): hideIndexFolder-Setting (Default true)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Verdrahtung in `main.ts` (CSS-Injektion + Pfad-Wechsel)

**Files:**
- Modify: `src/main.ts` (Importe; Feld `hideStyleEl`; `onload`-Aufruf; neue Methoden `refreshIndexFolderHiding`, `changeIndexDir`, `cleanupIndexDir`)
- Modify: `src/settings.ts:66-78` (`VaultRagPluginHost` um zwei Methoden erweitern)

**Interfaces:**
- Consumes: `buildHideCss` (Task 1), `migrateIndex`/`onlyContainsIndexFiles` (Task 2), `normalizeIndexDir` (Task 1), `LiveIndexer`/`PendingQueue` (bestehend), `this.settings.hideIndexFolder`/`indexDir` (Task 3).
- Produces (auf `VaultRagPlugin`, im Host-Interface deklariert):
  - `refreshIndexFolderHiding(): void`
  - `changeIndexDir(newDir: string): Promise<void>`

> **Hinweis:** `VaultRagPlugin` erfüllt `VaultRagPluginHost` strukturell (Übergabe bei `new VaultRagSettingTab(this.app, this)`, `main.ts:62`). Interface-Erweiterung (settings.ts) und Implementierung (main.ts) müssen **zusammen** committet werden, sonst bricht `tsc`. Dieser Task ist „by-inspection" (Obsidian-Schicht, kein DOM-Unit-Test) — Verifikation über `typecheck`/`lint`/`build`/bestehende Tests + manueller Smoke.

- [ ] **Step 1: Host-Interface erweitern**

In `src/settings.ts`, Interface `VaultRagPluginHost` (nach `reindexVault(): Promise<void>;`, Zeile 77):

```ts
  reindexVault(): Promise<void>;
  refreshIndexFolderHiding(): void;
  changeIndexDir(newDir: string): Promise<void>;
```

- [ ] **Step 2: Importe + Feld in `main.ts`**

Nach den bestehenden Imports (z.B. nach Zeile 20) ergänzen:

```ts
import { buildHideCss, normalizeIndexDir } from "./index_dir";
import { migrateIndex, onlyContainsIndexFiles } from "./index_migrate";
```

Als Plugin-Feld (nach `private statusBarEl: HTMLElement | null = null;`, Zeile 48):

```ts
  private hideStyleEl: HTMLStyleElement | null = null;
```

- [ ] **Step 3: Aufruf in `onload`**

Am Ende von `onload`, nach `if (this.settings.showStatusBar) this.setStatusBarVisible(true);` (Zeile 220):

```ts
    if (this.settings.showStatusBar) this.setStatusBarVisible(true);
    this.refreshIndexFolderHiding();
```

- [ ] **Step 4: Methoden implementieren**

Nach `reconnectChat()` (nach Zeile 231) einfügen:

```ts
  /** CSS-Regel, die den Index-Ordner im Datei-Explorer aus-/einblendet. Idempotent. */
  refreshIndexFolderHiding(): void {
    if (!this.hideStyleEl) {
      // document.head reicht (Explorer lebt im Hauptfenster); Cleanup bei Plugin-Unload.
      this.hideStyleEl = document.head.createEl("style", { attr: { id: "vault-rag-hide-index" } });
      this.register(() => { this.hideStyleEl?.remove(); this.hideStyleEl = null; });
    }
    this.hideStyleEl.textContent = buildHideCss(this.settings.indexDir, this.settings.hideIndexFolder);
  }

  /**
   * Verlegt den Index-Ordner: Dateien kopieren (kein Reindex) → Komponenten neu verdrahten
   * → Hide-CSS aktualisieren → alten Ordner aufräumen (nur wenn er ausschließlich unsere
   * Dateien enthält). Reihenfolge strikt B-vor-A (kein Datenverlust, vgl. Reindex-Lehre).
   */
  async changeIndexDir(newDir: string): Promise<void> {
    const oldDir = normalizeIndexDir(this.settings.indexDir);
    const target = normalizeIndexDir(newDir);
    if (target === "" || target === oldDir) return;
    await migrateIndex(this.app.vault.adapter, oldDir, target);
    this.settings.indexDir = target;
    await this.saveSettings();
    this.liveIndexer = new LiveIndexer(this.app.vault.adapter, target, this.embedder, this.settings.embeddingModel);
    this.pendingQueue = new PendingQueue(this.app.vault.adapter, target);
    await this.pendingQueue.load();
    await this.loadIndex();
    this.refreshIndexFolderHiding();
    await this.cleanupIndexDir(oldDir);
  }

  /** Löscht den alten Index-Ordner — nur wenn er ausschließlich unsere Index-Dateien enthält. */
  private async cleanupIndexDir(dir: string): Promise<void> {
    try {
      const listing = await this.app.vault.adapter.list(dir);
      if (!onlyContainsIndexFiles(listing.files ?? [], listing.folders ?? [])) {
        new Notice(`Alter Index-Ordner „${dir}" enthält weitere Dateien — bitte manuell prüfen.`);
        return;
      }
      for (const f of listing.files ?? []) await this.app.vault.adapter.remove(f);
      await this.app.vault.adapter.rmdir(dir, false);
    } catch (e) {
      console.warn("vault-rag: cleanupIndexDir failed", e);
    }
  }
```

- [ ] **Step 5: Verifizieren — Typecheck, Lint, Tests, Build**

Run:
```bash
npm run typecheck && npm run lint && npm test && npm run build
```
Expected: tsc 0 Fehler · ESLint 0 Fehler · alle Tests grün · `main.js` gebaut.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/settings.ts
git commit -m "feat(index): CSS-Hide + Pfad-Wechsel-Migration verdrahten

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Settings-UI (Pfad-Eingabe + Ausblenden-Toggle)

**Files:**
- Modify: `src/settings.ts` (`display()` Index-Sektion Zeile 184-185; neue Methoden `buildIndexDir`, `buildHideIndexFolder`)

**Interfaces:**
- Consumes: `normalizeIndexDir`/`isDotPath` (Task 1), `plugin.changeIndexDir`/`refreshIndexFolderHiding` (Task 4), `FolderSuggest` (bestehend, `settings.ts:81`), `Notice` (bereits importiert, Zeile 1).

> **Hinweis:** „by-inspection" (Settings-UI, kein DOM-Unit-Test). **Wichtig:** Der Pfad-Wechsel löst Migration + Cleanup aus — er darf **nicht** bei jedem Tastendruck (`onChange`) feuern, sondern erst bei explizitem „Übernehmen"-Klick.

- [ ] **Step 1: Import ergänzen**

In `src/settings.ts`, oberster Import-Block:

```ts
import { normalizeIndexDir, isDotPath } from "./index_dir";
```

- [ ] **Step 2: Builder-Methoden hinzufügen**

In `VaultRagSettingTab`, vor `buildReindexButton` (vor Zeile 616) einfügen:

```ts
  private buildIndexDir(s: Setting): void {
    let typed = this.plugin.settings.indexDir;
    s.setName("Index-Ordner")
      .setDesc('Wo der Vektor-Index gespeichert wird. Synct cross-device (inkl. iPhone) nur mit der Obsidian-Sync-Option „Sync all other types". Ein Pfad mit „." am Anfang wird von Obsidian Sync ignoriert.')
      .addText(t => {
        t.setPlaceholder("_vaultrag").setValue(this.plugin.settings.indexDir);
        t.onChange((v: string) => { typed = v; });
        new FolderSuggest(this.app, t.inputEl).onSelect((path: string) => { typed = path; t.setValue(path); });
      })
      .addButton(b => b.setButtonText("Übernehmen").onClick(async () => {
        const norm = normalizeIndexDir(typed);
        if (norm === "" || norm === normalizeIndexDir(this.plugin.settings.indexDir)) return;
        if (isDotPath(norm)) new Notice('Index-Ordner beginnt mit „." — synct dann nicht cross-device (auch nicht aufs iPhone).');
        b.setButtonText("Verschiebe…"); b.setDisabled(true);
        try {
          await this.plugin.changeIndexDir(norm);
          new Notice(`Index verschoben nach „${norm}".`);
          this.display();
        } finally { b.setButtonText("Übernehmen"); b.setDisabled(false); }
      }));
  }

  private buildHideIndexFolder(s: Setting): void {
    s.setName("Index-Ordner im Datei-Explorer ausblenden")
      .setDesc("Versteckt den Index-Ordner kosmetisch im Datei-Explorer. Daten, Sync und Suche bleiben unberührt. Standardmäßig an.")
      .addToggle(t => t.setValue(this.plugin.settings.hideIndexFolder).onChange(async (v: boolean) => {
        this.plugin.settings.hideIndexFolder = v;
        await this.plugin.saveSettings();
        this.plugin.refreshIndexFolderHiding();
      }));
  }
```

- [ ] **Step 3: In `display()` einhängen**

In `display()`, Index-Sektion (Zeile 184-185) ändern von:

```ts
    sec("Index");
    this.buildReindexButton(new Setting(containerEl));
```

zu:

```ts
    sec("Index");
    this.buildIndexDir(new Setting(containerEl));
    this.buildHideIndexFolder(new Setting(containerEl));
    this.buildReindexButton(new Setting(containerEl));
```

- [ ] **Step 4: Verifizieren — Typecheck, Lint, Tests, Build**

Run:
```bash
npm run typecheck && npm run lint && npm test && npm run build
```
Expected: tsc 0 Fehler · ESLint 0 Fehler · alle Tests grün · `main.js` gebaut.

- [ ] **Step 5: Manueller Smoke-Test (in-place reload)**

In Obsidian (Plugin hart neu laden):
1. Settings → vault-rag → Index: **„Index-Ordner im Datei-Explorer ausblenden"** ist **an** (Default). Der `_vaultrag`-Ordner ist im Explorer **nicht** sichtbar.
2. Toggle **aus** → Ordner erscheint im Explorer. Toggle **an** → verschwindet wieder (ohne Reload).
3. Pfad in „Index-Ordner" auf z.B. `99_System/idx` ändern → **„Übernehmen"** klicken → Notice „Index verschoben"; alter `_vaultrag`-Ordner ist weg, neuer Pfad trägt den Index; Related-Notes/Suche funktionieren weiter (kein Reindex nötig).
4. Mobile (falls greifbar): Ordner ebenfalls ausgeblendet.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): UI für Index-Pfad + Ausblenden-Toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Dokumentation (README + AGENTS + CHANGELOG)

**Files:**
- Modify: `README.md` (Config-Tabelle/Settings-Abschnitt)
- Modify: `AGENTS.md` (Gotchas)
- Modify: `CHANGELOG.md` (neuer Eintrag)

**Interfaces:** keine (reine Doku).

- [ ] **Step 1: README — neue Settings dokumentieren**

In der Settings-/Config-Übersicht von `README.md` zwei Zeilen ergänzen (an die bestehende Tabelle/Liste angepasst):
- **Index folder** — Speicherort des Vektor-Index (Default `_vaultrag`). Cross-device-Sync braucht die Obsidian-Sync-Option „Sync all other types".
- **Hide index folder in file explorer** — blendet den Ordner kosmetisch aus (Default an).

- [ ] **Step 2: AGENTS.md — Gotcha ergänzen**

Im Abschnitt „Gotchas" von `AGENTS.md` ergänzen:

```markdown
- **Index-Ordner-Hide ist rein kosmetisch (CSS):** `buildHideCss` (`index_dir.ts`) injiziert eine
  `display:none`-Regel auf `.nav-folder-title[data-path=…]`. `data-path` ist internes Obsidian-Markup
  (kein API) — bricht es bei einem Update, taucht der Ordner nur wieder auf (kein Datenverlust).
- **Pfad-Wechsel migriert per Copy:** `changeIndexDir` (`main.ts`) kopiert via `migrateIndex` an den
  neuen Ort (kein Reindex), verdrahtet `LiveIndexer`/`PendingQueue` neu und löscht den alten Ordner
  nur, wenn er ausschließlich Index-Dateien enthält (`onlyContainsIndexFiles`).
```

- [ ] **Step 3: CHANGELOG — Eintrag**

In `CHANGELOG.md` einen neuen „Unreleased"-Abschnitt (oder analog zum bestehenden Stil) ergänzen:

```markdown
### Hinzugefügt
- Index-Ordner ist konfigurierbar (Setting „Index-Ordner") und wird standardmäßig im Datei-Explorer
  ausgeblendet (Setting „Index-Ordner im Datei-Explorer ausblenden", Default an).

### Geändert
- **Hinweis für bestehende Nutzer:** Der bisher sichtbare `_vaultrag`-Ordner wird nach dem Update im
  Datei-Explorer ausgeblendet (rein kosmetisch; jederzeit im Setting abschaltbar; Daten und Sync
  unberührt).
```

- [ ] **Step 4: Verifizieren**

Run: `npm test`
Expected: alle Tests grün (Doku-Änderungen brechen nichts).

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md CHANGELOG.md
git commit -m "docs: Index-Ordner-Setting + Ausblenden dokumentieren

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (durchgeführt)

**Spec-Abdeckung:**
- §5.1 Settings (indexDir editierbar + hideIndexFolder Default true) → Task 3 (Daten) + Task 5 (UI). ✓
- §5.2 CSS-Hide (pure `buildHideCss` + `<style>`-Injektion) → Task 1 + Task 4. ✓
- §5.3 Pfad-Wechsel (`migrateIndex` + Re-Wire + Cleanup mit Sicherheits-Check) → Task 2 + Task 4. ✓
- §7 Tests (buildHideCss, migrateIndex, Settings-Default, Dot-Pfad) → Task 1/2/3 Tests. ✓
- §8 Risiken (data-path-Kommentar, Sync-Hinweis, B-vor-A-Reihenfolge) → in Code-Kommentaren + README/AGENTS (Task 6). ✓
- §5.1 CHANGELOG-Hinweis bestehende Nutzer → Task 6 Step 3. ✓

**Platzhalter-Scan:** keine TBD/TODO; jeder Code-Schritt zeigt vollständigen Code. ✓

**Typ-Konsistenz:** `normalizeIndexDir`/`isDotPath`/`buildHideCss` (Task 1) ↔ Nutzung in Task 4/5 stimmen überein; `migrateIndex`/`onlyContainsIndexFiles`/`INDEX_ALL_FILES` (Task 2) ↔ Nutzung in Task 4 stimmen überein; `hideIndexFolder` (Task 3) ↔ Task 4/5; Host-Methoden (`refreshIndexFolderHiding`/`changeIndexDir`) im Interface (Task 4 Step 1) ↔ Implementierung (Task 4 Step 4) ↔ Aufruf (Task 5). ✓
