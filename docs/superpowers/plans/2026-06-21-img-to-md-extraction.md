# IMG→MD-Ausgliederung (`image-to-markdown`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IMG→MD vollständig aus vault-rag in ein neues, eigenständiges Plugin `image-to-markdown` verlagern; vault-rag auf den RAG-Kern zurückschneiden; beide Repos grün.

**Architecture:** Neues Obsidian-Plugin-Repo `/Users/Shared/code/obsidian-plugins/image-to-markdown` (Scaffold gespiegelt von vault-rag). IMG→MD-Module wandern verbatim; der SSE-Transport (`sse.ts` + `think_splitter.ts`) wird **kopiert** (bleibt auch in vault-rag, da `ChatClient` ihn braucht); die generischen `ping`/`listModels`-Helfer ziehen aus `ChatClient` schlank an `VisionClient`. vault-rag wird danach von aller IMG→MD-Verdrahtung befreit.

**Tech Stack:** TypeScript (strict, noImplicitAny) · esbuild · vitest + happy-dom · Obsidian Plugin API.

## Global Constraints

- TS **strict + noImplicitAny**; keine `any`-Casts für neue Typen (Bestand mit `as any` darf 1:1 mitwandern).
- Tests: vitest + happy-dom; Obsidian-Mock unter `tests/__mocks__/obsidian.ts` (kein echter `obsidian`-Import im Test).
- Grünzustand nach jeder Task: betroffene Tests grün; finale Tasks zusätzlich `npx tsc --noEmit` + `npm run build`.
- Conventional Commits (deutsch erlaubt). **Nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Neue manifest-`id`: **`image-to-markdown`**; Display-Name **"Image to Markdown"**.
- `minAppVersion`, esbuild/tsconfig/vitest-Konfig: 1:1 von vault-rag übernehmen (Werte verbatim).
- vault-rag-Änderungen laufen auf Branch `feat/extract-img-to-md` (Default-Branch `main` nicht direkt committen); Merge erst nach grün + Smoke-Test.

---

### Task 1: `image-to-markdown` scaffolden (grüne Toolchain)

**Files:**
- Create: `../image-to-markdown/package.json`, `esbuild.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `manifest.json`, `versions.json`
- Create: `../image-to-markdown/tests/__mocks__/obsidian.ts` (Kopie aus vault-rag)
- Create: `../image-to-markdown/tests/scaffold.test.ts`

**Interfaces:**
- Produces: lauffähige `npm test` / `npm run build` / `npx tsc --noEmit`-Toolchain im neuen Repo.

- [ ] **Step 1: Repo + git init.** `mkdir -p /Users/Shared/code/obsidian-plugins/image-to-markdown && git -C /Users/Shared/code/obsidian-plugins/image-to-markdown init`.
- [ ] **Step 2: Konfig spiegeln.** `package.json` (name `image-to-markdown`, version `0.1.0`, description „Bilder einer Notiz per lokalem Vision-LLM nach Markdown transkribieren.", scripts `dev`/`build`/`test` wie vault-rag, devDeps verbatim aus vault-rag), `esbuild.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (inkl. `main.js`, `node_modules`, `data.json`) — alle aus vault-rag kopiert, nur `package.json`-name/description geändert.
- [ ] **Step 3: manifest.json + versions.json.** `manifest.json`: `id: "image-to-markdown"`, `name: "Image to Markdown"`, `version: "0.1.0"`, `minAppVersion` von vault-rag, `description`, `author`/`authorUrl` von vault-rag, `isDesktopOnly: false`. `versions.json`: `{ "0.1.0": "<minAppVersion>" }`.
- [ ] **Step 4: Mock + Scaffold-Test kopieren.** `tests/__mocks__/obsidian.ts` aus vault-rag verbatim; `tests/scaffold.test.ts` aus vault-rag verbatim.
- [ ] **Step 5: Deps installieren.** `npm install` im neuen Repo.
- [ ] **Step 6: Toolchain grün.** Run: `npm test` (Scaffold-Test PASS), `npx tsc --noEmit` (clean).
- [ ] **Step 7: Commit.** `git add -A && git commit -m "chore: scaffold image-to-markdown plugin"` (frisches Repo → `-A` hier ok).

---

### Task 2: Geteilten Transport kopieren (sse + think_splitter)

**Files:**
- Create: `../image-to-markdown/src/sse.ts`, `src/think_splitter.ts`
- Create: `../image-to-markdown/tests/sse.test.ts`, `tests/think_splitter.test.ts`

**Interfaces:**
- Produces: `streamSSE(res, onContent, onReasoning)`, `parseSSE(buffer)`, `ThinkSplitter`.

- [ ] **Step 1: Dateien kopieren.** `src/sse.ts`, `src/think_splitter.ts` und ihre Tests verbatim aus vault-rag. Keine Import-Änderungen nötig (`sse.ts` importiert nur `./think_splitter`).
- [ ] **Step 2: Tests grün.** Run: `npx vitest run tests/sse.test.ts tests/think_splitter.test.ts` → PASS.
- [ ] **Step 3: Commit.** `git add src/sse.ts src/think_splitter.ts tests/sse.test.ts tests/think_splitter.test.ts && git commit -m "feat: kopiere SSE-Transport (sse + think_splitter)"`.

---

### Task 3: IMG→MD-Kern kopieren (`img_to_md.ts`)

**Files:**
- Create: `../image-to-markdown/src/img_to_md.ts`, `tests/img_to_md.test.ts`

**Interfaces:**
- Produces: `findImageEmbeds`, `buildTranscriptNote`, `replaceEmbed`, `uniqueNotePath`, `transcriptNotePath`, `writeTranscripts`, `runImgToMd`, `ImgToMdIO`, `IMAGE_EXTS`, `SUPPORTED_EXTS`, `ImageEmbed`.

- [ ] **Step 1: Kopieren.** `src/img_to_md.ts` + `tests/img_to_md.test.ts` verbatim aus vault-rag (keine Obsidian-Imports → unverändert).
- [ ] **Step 2: Tests grün.** Run: `npx vitest run tests/img_to_md.test.ts` → PASS.
- [ ] **Step 3: Commit.** `git add src/img_to_md.ts tests/img_to_md.test.ts && git commit -m "feat: kopiere IMG→MD-Kern (img_to_md)"`.

---

### Task 4: View-State kopieren (`img_to_md_state.ts`)

**Files:**
- Create: `../image-to-markdown/src/img_to_md_state.ts`, `tests/img_to_md_state.test.ts`

**Interfaces:**
- Produces: `ImgToMdState`, `ImgItem`, `ImgCard`, `CardStatus`.

- [ ] **Step 1: Kopieren.** Beide Dateien verbatim aus vault-rag (keine Obsidian-Imports).
- [ ] **Step 2: Tests grün.** Run: `npx vitest run tests/img_to_md_state.test.ts` → PASS.
- [ ] **Step 3: Commit.** `git add src/img_to_md_state.ts tests/img_to_md_state.test.ts && git commit -m "feat: kopiere IMG→MD View-State"`.

---

### Task 5: `VisionClient` kopieren + `ping`/`listModels` ergänzen

**Files:**
- Create: `../image-to-markdown/src/vision_client.ts`, `tests/vision_client.test.ts`

**Interfaces:**
- Consumes: `streamSSE` aus `./sse`.
- Produces: `VisionClient` mit `transcribe`, `transcribeStream`, **neu** `ping(): Promise<boolean>` und `listModels(): Promise<string[]>`.

- [ ] **Step 1: Kopieren.** `src/vision_client.ts` + `tests/vision_client.test.ts` verbatim aus vault-rag.
- [ ] **Step 2: Failing test schreiben.** In `tests/vision_client.test.ts` ergänzen:

```ts
it("ping() liefert true bei ok-Response auf /v1/models", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => { calls.push(url); return { ok: true } as Response; }) as typeof fetch;
  const c = new VisionClient("http://x:8080", "m");
  expect(await c.ping()).toBe(true);
  expect(calls[0]).toBe("http://x:8080/v1/models");
});

it("listModels() liefert sortierte ids, [] bei Fehler", async () => {
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: [{ id: "b" }, { id: "a" }] }) }) as Response) as typeof fetch;
  const c = new VisionClient("http://x:8080", "m");
  expect(await c.listModels()).toEqual(["a", "b"]);
  globalThis.fetch = (async () => ({ ok: false }) as Response) as typeof fetch;
  expect(await c.listModels()).toEqual([]);
});
```

- [ ] **Step 3: Run → FAIL** (`ping`/`listModels` existieren nicht). Run: `npx vitest run tests/vision_client.test.ts`.
- [ ] **Step 4: Implementieren.** In `src/vision_client.ts` der Klasse hinzufügen (verbatim aus `ChatClient`):

```ts
async ping(): Promise<boolean> {
  try { return (await fetch(`${this.endpoint}/v1/models`)).ok; } catch { return false; }
}

async listModels(): Promise<string[]> {
  try {
    const r = await fetch(`${this.endpoint}/v1/models`);
    if (!r.ok) return [];
    const j = await r.json() as { data?: { id?: string }[] };
    return (j.data ?? []).map(m => m.id).filter((x): x is string => typeof x === "string").sort();
  } catch { return []; }
}
```

- [ ] **Step 5: Run → PASS.** `npx vitest run tests/vision_client.test.ts`.
- [ ] **Step 6: Commit.** `git add src/vision_client.ts tests/vision_client.test.ts && git commit -m "feat: VisionClient + ping/listModels (ohne ChatClient-Abhängigkeit)"`.

---

### Task 6: Sidebar-View kopieren (`img_to_md_view.ts`)

**Files:**
- Create: `../image-to-markdown/src/img_to_md_view.ts`, `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `ImgToMdState`, `ImgItem` aus `./img_to_md_state`.
- Produces: `ImgToMdView`, `VIEW_TYPE_IMGMD`, `ImgToMdViewDeps`.

- [ ] **Step 1: Kopieren.** Beide Dateien verbatim aus vault-rag. `VIEW_TYPE_IMGMD` bleibt `"vault-rag-img"`? → **ändern auf `"image-to-markdown-view"`** (eigener View-Typ, kein vault-rag-Namespace). Test-Referenzen entsprechend anpassen, falls vorhanden (grep `vault-rag-img` im Test).
- [ ] **Step 2: CSS-Klassen.** Die View nutzt `vault-rag-img-*`-Klassen. Beibehalten ist ok (nur Strings), aber für Sauberkeit auf `img2md-*` umbenennen ist optional — **entscheidung: beibehalten** (YAGNI; Styles kommen in Task 7 mit). Test prüfen ob Klassennamen asserted werden; falls ja, konsistent halten.
- [ ] **Step 3: Tests grün.** Run: `npx vitest run tests/img_to_md_view.test.ts` → PASS.
- [ ] **Step 4: Commit.** `git add src/img_to_md_view.ts tests/img_to_md_view.test.ts && git commit -m "feat: kopiere IMG→MD-Sidebar-View"`.

---

### Task 7: Settings + Styles

**Files:**
- Create: `../image-to-markdown/src/settings.ts`, `styles.css`

**Interfaces:**
- Produces: `ImageToMarkdownSettings`, `DEFAULT_SETTINGS`, `DEFAULT_VISION_PROMPT`, `ImageToMarkdownSettingTab`.

- [ ] **Step 1: Settings schreiben.** Schlankes `settings.ts` mit nur den Vision-Feldern:

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import type ImageToMarkdownPlugin from "./main";
import { VisionClient } from "./vision_client";

export interface ImageToMarkdownSettings {
  visionEndpoint: string;
  visionModel: string;
  visionPrompt: string;
}

export const DEFAULT_VISION_PROMPT = /* verbatim aus vault-rag settings.ts:29 */ "";

export const DEFAULT_SETTINGS: ImageToMarkdownSettings = {
  visionEndpoint: "http://localhost:8080",
  visionModel: "",
  visionPrompt: DEFAULT_VISION_PROMPT,
};

export class ImageToMarkdownSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ImageToMarkdownPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this; containerEl.empty();
    new Setting(containerEl).setName("Vision (IMG→MD)").setHeading();
    new Setting(containerEl)
      .setName("Vision Endpoint")
      .setDesc("OpenAI-kompatibler Server mit Vision-Modell (z.B. LM Studio)")
      .addText(t => t.setPlaceholder("http://localhost:8080").setValue(this.plugin.settings.visionEndpoint)
        .onChange(async (v: string) => { this.plugin.settings.visionEndpoint = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision(); }));
    const visModelSetting = new Setting(containerEl).setName("Vision Modell").setDesc("Vision-fähiges Modell (Qwen2-VL, Llama-3.2-Vision …)");
    void new VisionClient(this.plugin.settings.visionEndpoint, "").listModels().then((models: string[]) => {
      const cur = this.plugin.settings.visionModel;
      const list = models.includes(cur) || !cur ? models : [cur, ...models];
      if (list.length) {
        visModelSetting.addDropdown(d => {
          for (const m of list) d.addOption(m, m);
          d.setValue(cur);
          d.onChange(async (v: string) => { this.plugin.settings.visionModel = v; await this.plugin.saveSettings(); this.plugin.reconnectVision(); });
        });
      } else {
        visModelSetting.addText(t => t.setPlaceholder("(Endpoint offline)").setValue(cur)
          .onChange(async (v: string) => { this.plugin.settings.visionModel = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision(); }));
      }
    });
    new Setting(containerEl).setName("Vision Prompt")
      .setDesc("Anweisung an das Vision-Modell. Der Bild-Inhalt wird mitgeschickt.")
      .addTextArea(t => t.setValue(this.plugin.settings.visionPrompt)
        .onChange(async (v: string) => { this.plugin.settings.visionPrompt = v; await this.plugin.saveSettings(); }));
  }
}
```

  *Hinweis:* `DEFAULT_VISION_PROMPT`-Wert verbatim aus vault-rag `src/settings.ts:29` übernehmen. Dropdown-Logik an vault-rag `settings.ts:307-319` orientieren (nur `ChatClient`→`VisionClient` getauscht).
- [ ] **Step 2: Styles.** Die `vault-rag-img-*`-Regeln aus vault-rag `styles.css` verbatim nach `image-to-markdown/styles.css` kopieren (per grep `vault-rag-img` extrahieren).
- [ ] **Step 3: tsc grün.** Run: `npx tsc --noEmit` (main.ts fehlt noch → erst nach Task 8 voll grün; hier nur settings.ts-Syntax prüfen, ggf. zusammen mit Task 8 verifizieren).
- [ ] **Step 4: Commit.** `git add src/settings.ts styles.css && git commit -m "feat: Vision-Settings + Sidebar-Styles"`.

---

### Task 8: Plugin-Entry `main.ts` (Verdrahtung)

**Files:**
- Create: `../image-to-markdown/src/main.ts`

**Interfaces:**
- Consumes: alles aus Tasks 2-7.
- Produces: `ImageToMarkdownPlugin` (default export).

- [ ] **Step 1: main.ts schreiben.** Nur die IMG→MD-Orchestrierung aus vault-rag `main.ts` (Zeilen 16-19, 34, 54, 105-128, 167-235, makeImgIO/makeImgViewDeps/refreshImgViews/activateImgMdView/reconnectVision). Kern:

```ts
import { Plugin, WorkspaceLeaf, TFile, Notice, Editor, Menu, arrayBufferToBase64 } from "obsidian";
import { DEFAULT_SETTINGS, ImageToMarkdownSettings, ImageToMarkdownSettingTab } from "./settings";
import { VisionClient } from "./vision_client";
import { runImgToMd, findImageEmbeds, ImgToMdIO, writeTranscripts, SUPPORTED_EXTS } from "./img_to_md";
import { ImgToMdView, VIEW_TYPE_IMGMD, ImgToMdViewDeps } from "./img_to_md_view";
import { ImgItem } from "./img_to_md_state";

export default class ImageToMarkdownPlugin extends Plugin {
  settings!: ImageToMarkdownSettings;
  visionClient!: VisionClient;

  private openPath = (p: string): void => {
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
  };

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.visionClient = new VisionClient(this.settings.visionEndpoint, this.settings.visionModel);
    this.addSettingTab(new ImageToMarkdownSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_IMGMD, (leaf: WorkspaceLeaf) => new ImgToMdView(leaf, this.makeImgViewDeps()));
    this.addRibbonIcon("scan-text", "IMG → MD", () => this.activateImgMdView());
    this.addCommand({ id: "open-img-md-sidebar", name: "IMG → MD-Sidebar öffnen", callback: () => this.activateImgMdView() });
    this.addCommand({ id: "img-to-md", name: "IMG → MD: Bilder der Notiz transkribieren", callback: () => {
      const f = this.app.workspace.getActiveFile();
      if (!f) { new Notice("Keine aktive Notiz."); return; }
      void runImgToMd(this.makeImgIO(), f.path);
    } });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
      const cur = editor.getCursor();
      const line = editor.getLine(cur.line);
      const embeds = findImageEmbeds(line);
      const f = this.app.workspace.getActiveFile();
      if (!embeds.length || !f) return;
      let chosen = embeds[0];
      for (const e of embeds) {
        const start = line.indexOf(e.raw);
        if (start >= 0 && cur.ch >= start && cur.ch <= start + e.raw.length) { chosen = e; break; }
      }
      const raw = chosen.raw;
      menu.addItem(item => item.setTitle("IMG → MD").setIcon("scan-text").onClick(() => void runImgToMd(this.makeImgIO(), f.path, { onlyRaw: raw })));
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshImgViews()));
  }

  onunload() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMD).forEach(l => l.detach());
  }

  reconnectVision(): void {
    this.visionClient = new VisionClient(this.settings.visionEndpoint, this.settings.visionModel);
  }

  private mimeOf(ext: string): string { const e = ext.toLowerCase(); return e === "jpg" ? "jpeg" : e; }

  // makeImgIO / makeImgViewDeps / refreshImgViews / activateImgMdView:
  // verbatim aus vault-rag main.ts:173-235 übernehmen, ABER in makeImgViewDeps
  // ping/listModels über this.visionClient statt new ChatClient(...):
  //   ping: () => new VisionClient(this.settings.visionEndpoint, "").ping(),
  //   listModels: () => new VisionClient(this.settings.visionEndpoint, "").listModels(),

  async saveSettings() { await this.saveData(this.settings); }
}
```

  *Wichtig:* `makeImgIO`, `makeImgViewDeps`, `refreshImgViews`, `activateImgMdView` verbatim aus vault-rag `main.ts:173-235` übernehmen — **nur** die `ChatClient`-Aufrufe in `makeImgViewDeps` (Zeilen 215-216) durch `VisionClient` ersetzen. `onunload` mit `detach()` ist neu (Obsidian-Submission-Hygiene).
- [ ] **Step 2: Build + tsc grün.** Run: `npm run build` (erzeugt `main.js`), `npx tsc --noEmit` (clean).
- [ ] **Step 3: Volle Suite grün.** Run: `npm test` → alle PASS.
- [ ] **Step 4: Commit.** `git add src/main.ts && git commit -m "feat: Plugin-Entry image-to-markdown"`.

---

### Task 9: Repo-Doku `image-to-markdown` (README/LICENSE/CHANGELOG)

**Files:**
- Create: `../image-to-markdown/README.md`, `LICENSE`, `CHANGELOG.md`

- [ ] **Step 1: LICENSE.** AGPL-3.0 aus vault-rag verbatim kopieren.
- [ ] **Step 2: README.** Kurz: was es tut (Bilder einer Notiz → Markdown-Transkript via lokalem Vision-LLM), Sidebar + Command + Kontextmenü, Settings (Endpoint/Modell/Prompt), HEIC-Hinweis, Default-Port `:8080`. Verweis auf vault-rag als Schwester-Plugin.
- [ ] **Step 3: CHANGELOG.** `## 0.1.0` — „Ausgegliedert aus vault-rag 0.2.0. IMG→MD-Sidebar (streamend), Command, Editor-Kontextmenü."
- [ ] **Step 4: Commit.** `git add README.md LICENSE CHANGELOG.md && git commit -m "docs: README/LICENSE/CHANGELOG"`.

---

### Task 10: vault-rag entkernen (IMG→MD entfernen)

**Files:**
- Delete: `src/vision_client.ts`, `src/img_to_md.ts`, `src/img_to_md_state.ts`, `src/img_to_md_view.ts` (+ ihre 4 Tests)
- Modify: `src/main.ts`, `src/settings.ts`, `styles.css`

**Interfaces:**
- Produces: vault-rag ohne jede vision/img-Referenz.

- [ ] **Step 1: Branch.** `git checkout -b feat/extract-img-to-md`.
- [ ] **Step 2: Module + Tests löschen.** `git rm src/vision_client.ts src/img_to_md.ts src/img_to_md_state.ts src/img_to_md_view.ts tests/vision_client.test.ts tests/img_to_md.test.ts tests/img_to_md_state.test.ts tests/img_to_md_view.test.ts`.
- [ ] **Step 3: main.ts bereinigen.** Entfernen: Imports Zeilen 16-19; Feld `visionClient!` (34); Init (54); Registrierung/Commands/Kontextmenü (105-127); `refreshImgViews()`-Call im active-leaf-change-Handler (128 → wird `() => this.refresh()`); `reconnectVision` (167-169); `mimeOf` (171, nur von img genutzt → prüfen via grep, dann löschen); `makeImgIO`/`makeImgViewDeps`/`refreshImgViews`/`activateImgMdView` (173-235). `ChatClient`-Import bleibt (Chat nutzt ihn). `arrayBufferToBase64` aus dem obsidian-Import entfernen, falls sonst ungenutzt (grep).
- [ ] **Step 4: settings.ts bereinigen.** Vision-Felder im Interface (20-22), DEFAULTs (49-51), `DEFAULT_VISION_PROMPT` (29), Vision-Sektion im SettingTab (298-328) entfernen. `reconnectVision`-Referenzen weg.
- [ ] **Step 5: styles.css bereinigen.** `vault-rag-img-*`-Regeln entfernen.
- [ ] **Step 6: grep-sauber verifizieren.** Run: `grep -rniE 'vision|img_to_md|imgtomd|transcrib|scan-text' src/ tests/ styles.css` → **keine Treffer** (außer ggf. unverfänglichem in Kommentaren — prüfen).
- [ ] **Step 7: Grün.** Run: `npm test` (RAG-Teilmenge PASS), `npx tsc --noEmit` (clean), `npm run build` (ok).
- [ ] **Step 8: Commit.** `git add src/main.ts src/settings.ts styles.css && git commit -m "refactor: IMG→MD nach image-to-markdown ausgegliedert (entkernt vault-rag)"` (gelöschte Dateien sind via `git rm` bereits gestaged).

---

### Task 11: vault-rag-Doku nachziehen

**Files:**
- Modify: `AGENTS.md`, `CHANGELOG.md`

- [ ] **Step 1: AGENTS.md.** Modul-Layout-Sektion: vision/img-Zeilen entfernen; „Project character"/Slices ggf. Hinweis „IMG→MD ausgegliedert nach image-to-markdown". Test-Zahl (195 → neue Zahl nach `npm test`).
- [ ] **Step 2: CHANGELOG.md.** Eintrag `## [Unreleased]` (oder nächste Version): „**Breaking:** IMG→MD nach eigenständiges Plugin `image-to-markdown` ausgegliedert."
- [ ] **Step 3: Commit.** `git add AGENTS.md CHANGELOG.md && git commit -m "docs: AGENTS/CHANGELOG nach IMG→MD-Ausgliederung"`.

---

### Task 12: Abschluss / Merge-Gate

- [ ] **Step 1: Beide Repos final grün.** image-to-markdown: `npm test` + `npx tsc --noEmit` + `npm run build`. vault-rag (Branch): dito.
- [ ] **Step 2: DoD-Check** gegen die Spec (grep-sauber, funktionale Parität).
- [ ] **Step 3: Smoke-Test durch Johannes** (beide Plugins in Obsidian laden) **bevor** der vault-rag-Branch nach `main` gemergt wird.
- [ ] **Step 4: Merge** `feat/extract-img-to-md` → `main` (fast-forward) nach Freigabe. image-to-markdown-Remote-Push (Codeberg/GitHub) = separater, User-getriggerter Schritt.

## Self-Review

- **Spec coverage:** Dependency-Graph (alle 4 Module + Settings + Verdrahtung) → Tasks 3-8, 10. Transport kopieren → Task 2 + Task 5 (ping/listModels). vault-rag-Bereinigung → Task 10. Doku → Tasks 9, 11. Repo-Setup → Task 1. DoD → Task 12. ✓ keine Lücke.
- **Placeholder scan:** `DEFAULT_VISION_PROMPT` + Styles + makeImgIO/Deps verweisen auf verbatim-Quellen im Repo (konkret, kein Hand-Waving). ✓
- **Type consistency:** `VIEW_TYPE_IMGMD` von `"vault-rag-img"` → `"image-to-markdown-view"` in Task 6 (View + ggf. Test). `VisionClient.ping/listModels`-Signaturen identisch zu ChatClient. `ImageToMarkdownSettings`/`reconnectVision` konsistent zwischen settings.ts (Task 7) und main.ts (Task 8). ✓
