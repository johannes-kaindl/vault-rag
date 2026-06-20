# Vision / IMG→MD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eingebettete Fotos per lokalem Vision-Modell nach Markdown transkribieren, neue Notiz anlegen (Frontmatter-Ref + Foto oben + Transkript), Quellnotiz-Link durch Embed der neuen Notiz ersetzen.

**Architecture:** Reiner Kern (`findImageEmbeds`/`buildTranscriptNote`/`replaceEmbed`/`uniqueNotePath`/`runImgToMd` über `ImgToMdIO`) + `VisionClient`; Obsidian-API nur in `main.ts`.

**Tech Stack:** TS strict, vitest, Obsidian API (`vault.create/modify`, `metadataCache.getFirstLinkpathDest`, `adapter.readBinary`, `arrayBufferToBase64`, `editor-menu`).

## Global Constraints

- Alle Tests nach jeder Änderung grün. Conventional Commits, nur berührte Dateien stagen, AI-Trailer.
- Reiner Kern Node-testbar (Fake-IO/fetch-Stub); `main.ts` nur tsc-geprüft (kein main-Test).
- Nicht-destruktiv: kein Löschen/Verschieben; Quellnotiz nur bei Änderung schreiben; idempotent.
- Befehle: `npx vitest run tests/<datei>` · `npm test` · `npm run build` · `npx tsc --noEmit`.

---

### Task 1: `VisionClient`

**Files:** Create `src/vision_client.ts` · Test `tests/vision_client.test.ts`

**Interfaces:** Produces `class VisionClient { constructor(endpoint, model); transcribe(dataUrl, prompt, signal?): Promise<string> }`.

- [ ] **Step 1: Failing test** — `tests/vision_client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { VisionClient } from "../src/vision_client";

describe("VisionClient", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("transcribe schickt text+image_url, non-streaming, und parst content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "# Titel" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await new VisionClient("http://x", "vm").transcribe("data:image/jpeg;base64,AAAA", "Transkribiere");
    expect(out).toBe("# Titel");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("vm");
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Transkribiere" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
  });
  it("transcribe wirft bei HTTP-Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(new VisionClient("http://x", "vm").transcribe("d", "p")).rejects.toThrow("500");
  });
  it("transcribe liefert '' bei fehlendem content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) }));
    expect(await new VisionClient("http://x", "vm").transcribe("d", "p")).toBe("");
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run tests/vision_client.test.ts` — Modul fehlt).
- [ ] **Step 3: Implement** — `src/vision_client.ts`:

```ts
export class VisionClient {
  constructor(private endpoint: string, private model: string) {}

  async transcribe(dataUrl: string, prompt: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
        stream: false,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? "";
  }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(vision): VisionClient — multimodaler Transkriptions-Call`.

---

### Task 2: `img_to_md` reine Funktionen

**Files:** Create `src/img_to_md.ts` · Test `tests/img_to_md.test.ts`

**Interfaces:** Produces `IMAGE_EXTS`, `SUPPORTED_EXTS`, `ImageEmbed`, `findImageEmbeds`, `buildTranscriptNote`, `replaceEmbed`, `uniqueNotePath` (Signaturen unten).

- [ ] **Step 1: Failing test** — `tests/img_to_md.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findImageEmbeds, buildTranscriptNote, replaceEmbed, uniqueNotePath, SUPPORTED_EXTS } from "../src/img_to_md";

describe("findImageEmbeds", () => {
  it("findet wikilink- und markdown-Bild-Embeds, filtert Extensions", () => {
    const c = "text\n![[foto.jpg]]\n![[notiz]]\n![alt](bilder/x.png)\n![web](https://e/x.png)";
    const r = findImageEmbeds(c);
    expect(r.map(e => e.link)).toEqual(["foto.jpg", "bilder/x.png"]);
    expect(r[0]).toEqual({ raw: "![[foto.jpg]]", link: "foto.jpg", ext: "jpg" });
  });
  it("ignoriert # und | im Wikilink", () => {
    expect(findImageEmbeds("![[foto.png|200]]")[0].link).toBe("foto.png");
  });
  it("erkennt heic (für Skip-Warnung)", () => {
    expect(findImageEmbeds("![[IMG.heic]]")[0].ext).toBe("heic");
    expect(SUPPORTED_EXTS.includes("heic")).toBe(false);
  });
});

describe("buildTranscriptNote", () => {
  it("baut Frontmatter + Foto-Embed oben + Transkript", () => {
    const note = buildTranscriptNote({ imageLink: "foto.jpg", sourceName: "Notiz", date: "2026-06-20", model: "vm", transcript: "# H\nAbsatz" });
    expect(note).toContain('source_image: "[[foto.jpg]]"');
    expect(note).toContain('source_note: "[[Notiz]]"');
    expect(note).toContain("created: 2026-06-20");
    expect(note).toContain("transcribed_by: vm");
    expect(note).toContain("![[foto.jpg]]");
    expect(note.indexOf("![[foto.jpg]]")).toBeLessThan(note.indexOf("# H"));
  });
});

describe("replaceEmbed", () => {
  it("ersetzt alle Vorkommen literal durch Notiz-Embed", () => {
    expect(replaceEmbed("a ![[foto.jpg]] b ![[foto.jpg]]", "![[foto.jpg]]", "foto")).toBe("a ![[foto]] b ![[foto]]");
  });
});

describe("uniqueNotePath", () => {
  it("hängt Zähler an bei Kollision", () => {
    const exists = new Set(["dir/foto.md", "dir/foto-2.md"]);
    const io = { noteExists: (p: string) => exists.has(p) };
    expect(uniqueNotePath(io, "dir", "foto")).toBe("dir/foto-3.md");
    expect(uniqueNotePath(io, "", "neu")).toBe("neu.md");
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `src/img_to_md.ts` (reine Funktionen; Orchestrator folgt in Task 3):

```ts
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif"];
export const SUPPORTED_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];

export interface ImageEmbed { raw: string; link: string; ext: string }

function extOf(link: string): string {
  const clean = link.split("#")[0].split("|")[0].trim();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

export function findImageEmbeds(content: string): ImageEmbed[] {
  const out: ImageEmbed[] = [];
  let m: RegExpExecArray | null;
  const wiki = /!\[\[([^\]]+?)\]\]/g;
  while ((m = wiki.exec(content)) !== null) {
    const link = m[1].split("#")[0].split("|")[0].trim();
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext });
  }
  const md = /!\[[^\]]*\]\(([^)]+?)\)/g;
  while ((m = md.exec(content)) !== null) {
    const link = m[1].trim();
    if (/^https?:\/\//i.test(link)) continue;
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext });
  }
  return out;
}

export function buildTranscriptNote(o: { imageLink: string; sourceName: string; date: string; model: string; transcript: string }): string {
  return [
    "---",
    `source_image: "[[${o.imageLink}]]"`,
    `source_note: "[[${o.sourceName}]]"`,
    `created: ${o.date}`,
    `transcribed_by: ${o.model}`,
    "---",
    `![[${o.imageLink}]]`,
    "",
    o.transcript,
    "",
  ].join("\n");
}

export function replaceEmbed(content: string, raw: string, newBasename: string): string {
  return content.split(raw).join(`![[${newBasename}]]`);
}

export function uniqueNotePath(io: { noteExists(p: string): boolean }, dir: string, base: string): string {
  const join = (n: string) => (dir ? `${dir}/${n}.md` : `${n}.md`);
  if (!io.noteExists(join(base))) return join(base);
  let i = 2;
  while (io.noteExists(join(`${base}-${i}`))) i++;
  return join(`${base}-${i}`);
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(vision): img_to_md reine Funktionen (Embeds finden, Notiz bauen, ersetzen)`.

---

### Task 3: `runImgToMd` Orchestrator + `ImgToMdIO`

**Files:** Modify `src/img_to_md.ts` · Test `tests/img_to_md.test.ts`

**Interfaces:** Consumes Task 2. Produces `ImgToMdIO`, `runImgToMd(io, sourcePath, opts?): Promise<{transcribed, skipped}>`.

- [ ] **Step 1: Failing test** — am Ende von `tests/img_to_md.test.ts` ergänzen:

```ts
import { runImgToMd } from "../src/img_to_md";

function fakeIO(over: any = {}) {
  const notes = new Map<string, string>(over.notes ?? []);
  const created: Record<string, string> = {};
  const notices: string[] = [];
  const io: any = {
    model: "vm", date: () => "2026-06-20",
    readNote: async (p: string) => notes.get(p) ?? "",
    writeNote: async (p: string, c: string) => { notes.set(p, c); },
    createNote: async (p: string, c: string) => { created[p] = c; notes.set(p, c); },
    noteExists: (p: string) => notes.has(p),
    resolveImage: over.resolveImage ?? ((link: string) => ({ path: link, ext: link.split(".").pop() })),
    readImageDataUrl: async () => "data:image/jpeg;base64,AAAA",
    transcribe: over.transcribe ?? (async () => "# Transkript"),
    notify: (m: string) => notices.push(m),
  };
  return { io, created, notices, notes };
}

describe("runImgToMd", () => {
  it("Happy-Path: legt Notiz an, ersetzt Link, schreibt Quellnotiz", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "vor\n![[foto.jpg]]\nnach"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 1, skipped: 0 });
    expect(created["foto.md"]).toContain("# Transkript");
    expect(notes.get("q.md")).toBe("vor\n![[foto]]\nnach");
  });
  it("keine Bilder → Notice, kein Schreiben", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "nur text"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r.transcribed).toBe(0);
    expect(Object.keys(created)).toEqual([]);
  });
  it("nicht unterstütztes Format → skip", async () => {
    const { io, created, notices } = fakeIO({ notes: [["q.md", "![[IMG.heic]]"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 0, skipped: 1 });
    expect(Object.keys(created)).toEqual([]);
    expect(notices.some(n => n.includes("nicht unterstützt"))).toBe(true);
  });
  it("leeres Transkript → keine Notiz", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"]], transcribe: async () => "   " });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 0, skipped: 1 });
    expect(Object.keys(created)).toEqual([]);
  });
  it("Transkriptions-Fehler → skip, kein Crash", async () => {
    const { io } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"]], transcribe: async () => { throw new Error("offline"); } });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 0, skipped: 1 });
  });
  it("onlyRaw verarbeitet nur das eine Embed", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "![[a.jpg]]\n![[b.jpg]]"]] });
    await runImgToMd(io, "q.md", { onlyRaw: "![[b.jpg]]" });
    expect(Object.keys(created)).toEqual(["b.md"]);
  });
  it("Namens-Kollision → Zähler", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"], ["foto.md", "alt"]] });
    await runImgToMd(io, "q.md");
    expect(created["foto-2.md"]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — am Ende von `src/img_to_md.ts` ergänzen:

```ts
function dirOf(path: string): string { const i = path.lastIndexOf("/"); return i >= 0 ? path.slice(0, i) : ""; }
function basenameNoExt(path: string): string { const b = path.slice(path.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(0, d) : b; }

export interface ImgToMdIO {
  model: string;
  date: () => string;
  readNote(path: string): Promise<string>;
  writeNote(path: string, content: string): Promise<void>;
  createNote(path: string, content: string): Promise<void>;
  noteExists(path: string): boolean;
  resolveImage(link: string, sourcePath: string): { path: string; ext: string } | null;
  readImageDataUrl(path: string, ext: string): Promise<string>;
  transcribe(dataUrl: string): Promise<string>;
  notify(msg: string): void;
}

export async function runImgToMd(io: ImgToMdIO, sourcePath: string, opts?: { onlyRaw?: string }): Promise<{ transcribed: number; skipped: number }> {
  const content = await io.readNote(sourcePath);
  let embeds = findImageEmbeds(content);
  if (opts?.onlyRaw) embeds = embeds.filter(e => e.raw === opts.onlyRaw);
  if (!embeds.length) { io.notify("Keine (passenden) Bilder in dieser Notiz."); return { transcribed: 0, skipped: 0 }; }
  const sourceName = basenameNoExt(sourcePath);
  const dir = dirOf(sourcePath);
  let updated = content;
  let transcribed = 0, skipped = 0;
  for (let i = 0; i < embeds.length; i++) {
    const e = embeds[i];
    const resolved = io.resolveImage(e.link, sourcePath);
    if (!resolved) { io.notify(`Bild nicht gefunden: ${e.link}`); skipped++; continue; }
    if (!SUPPORTED_EXTS.includes(resolved.ext.toLowerCase())) { io.notify(`Format .${resolved.ext} nicht unterstützt (HEIC? iOS auf „Maximal kompatibel"): ${e.link}`); skipped++; continue; }
    io.notify(`Transkribiere Bild ${i + 1}/${embeds.length}…`);
    let transcript: string;
    try {
      const dataUrl = await io.readImageDataUrl(resolved.path, resolved.ext);
      transcript = (await io.transcribe(dataUrl)).trim();
    } catch { io.notify(`Transkription fehlgeschlagen: ${e.link}`); skipped++; continue; }
    if (!transcript) { io.notify(`Leeres Transkript: ${e.link}`); skipped++; continue; }
    const newPath = uniqueNotePath(io, dir, basenameNoExt(resolved.path));
    await io.createNote(newPath, buildTranscriptNote({ imageLink: e.link, sourceName, date: io.date(), model: io.model, transcript }));
    updated = replaceEmbed(updated, e.raw, basenameNoExt(newPath));
    transcribed++;
  }
  if (updated !== content) await io.writeNote(sourcePath, updated);
  io.notify(`${transcribed} Bild(er) transkribiert${skipped ? `, ${skipped} übersprungen` : ""}.`);
  return { transcribed, skipped };
}
```

- [ ] **Step 4: Run → PASS** (gesamte `img_to_md.test.ts`).
- [ ] **Step 5: Commit** `feat(vision): runImgToMd Orchestrator über ImgToMdIO`.

---

### Task 4: Settings — Vision-Felder + UI

**Files:** Modify `src/settings.ts` · Test `tests/settings.test.ts`

**Interfaces:** Produces `visionEndpoint`/`visionModel`/`visionPrompt` + `DEFAULT_VISION_PROMPT`.

- [ ] **Step 1: Failing test** — in `tests/settings.test.ts` ergänzen:

```ts
  it("hat Vision-Defaults", () => {
    expect(DEFAULT_SETTINGS.visionEndpoint).toBe("http://localhost:8080");
    expect(DEFAULT_SETTINGS.visionModel).toBe("");
    expect(DEFAULT_SETTINGS.visionPrompt).toContain("Markdown");
  });
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `src/settings.ts`: Interface + Defaults + Const + UI.
  Interface (nach `chatInputPosition`): `visionEndpoint: string; visionModel: string; visionPrompt: string;`
  Const (vor `DEFAULT_SETTINGS`):
  ```ts
  export const DEFAULT_VISION_PROMPT =
    "Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften, Absätze, " +
    "**Hervorhebungen**, Listen und Tabellen. Gib nur das Markdown aus, keine Kommentare.";
  ```
  Defaults (nach `chatInputPosition: "bottom",`): `visionEndpoint: "http://localhost:8080", visionModel: "", visionPrompt: DEFAULT_VISION_PROMPT,`
  UI (`display()`, neue Sektion nach der Status-Sektion oder vor ihr — Chat-Block nach `chatConnSetting`):
  ```ts
    new Setting(containerEl).setName("Vision (IMG→MD)").setHeading();
    new Setting(containerEl)
      .setName("Vision Endpoint")
      .setDesc("OpenAI-kompatibler Server mit Vision-Modell (z.B. LM Studio)")
      .addText(t => t.setPlaceholder("http://localhost:8080").setValue(this.plugin.settings.visionEndpoint)
        .onChange(async (v: string) => { this.plugin.settings.visionEndpoint = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision?.(); }));
    const visModelSetting = new Setting(containerEl).setName("Vision Modell").setDesc("Vision-fähiges Modell (Qwen2-VL, Llama-3.2-Vision …)");
    void new ChatClient(this.plugin.settings.visionEndpoint, "").listModels().then((models: string[]) => {
      const cur = this.plugin.settings.visionModel;
      if (models.length) {
        const list = cur && !models.includes(cur) ? [cur, ...models] : models;
        visModelSetting.addDropdown(d => {
          list.forEach((m: string) => d.addOption(m, m));
          if (cur) d.setValue(cur);
          d.onChange(async (v: string) => { this.plugin.settings.visionModel = v; await this.plugin.saveSettings(); });
        });
      } else {
        visModelSetting.addText(t => t.setPlaceholder("qwen2-vl").setValue(cur)
          .onChange(async (v: string) => { this.plugin.settings.visionModel = v.trim(); await this.plugin.saveSettings(); }));
        visModelSetting.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.display()));
      }
    });
    new Setting(containerEl)
      .setName("Transkriptions-Prompt")
      .setDesc("Anweisung an das Vision-Modell. Der Bild-Inhalt wird mitgeschickt.")
      .addTextArea(t => t.setValue(this.plugin.settings.visionPrompt)
        .onChange(async (v: string) => { this.plugin.settings.visionPrompt = v; await this.plugin.saveSettings(); }));
  ```
  (Import `ChatClient` ist in `settings.ts` noch nicht vorhanden → `import { ChatClient } from "./chat_client";` ergänzen.)

- [ ] **Step 4: Run → PASS** (`tests/settings.test.ts`) + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(vision): Vision-Settings (Endpoint, Modell-Dropdown, Prompt)` (zusammen mit Task 5 möglich).

---

### Task 5: `main.ts` — VisionClient, IO, Command, Kontextmenü

**Files:** Modify `src/main.ts`

**Interfaces:** Consumes Task 1–4.

- [ ] **Step 1:** Imports ergänzen: `Editor, Menu, arrayBufferToBase64` aus `"obsidian"`; `import { VisionClient } from "./vision_client";` · `import { runImgToMd, findImageEmbeds, ImgToMdIO } from "./img_to_md";`
- [ ] **Step 2:** Feld + Init: `visionClient!: VisionClient;` ; in `onload()` nach `this.chatClient = …`: `this.visionClient = new VisionClient(this.settings.visionEndpoint, this.settings.visionModel);` ; Methode `reconnectVision(): void { this.visionClient = new VisionClient(this.settings.visionEndpoint, this.settings.visionModel); }`
- [ ] **Step 3:** IO-Factory + mime-Helfer (in der Klasse):

```ts
  private mimeOf(ext: string): string { const e = ext.toLowerCase(); return e === "jpg" ? "jpeg" : e; }

  private makeImgIO(): ImgToMdIO {
    return {
      model: this.settings.visionModel,
      date: () => new Date().toISOString().slice(0, 10),
      readNote: (p) => this.app.vault.adapter.read(p),
      writeNote: async (p, c) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) await this.app.vault.modify(f, c); else await this.app.vault.adapter.write(p, c);
      },
      createNote: async (p, c) => { await this.app.vault.create(p, c); },
      noteExists: (p) => this.app.vault.getAbstractFileByPath(p) != null,
      resolveImage: (link, src) => { const f = this.app.metadataCache.getFirstLinkpathDest(link, src); return f ? { path: f.path, ext: f.extension } : null; },
      readImageDataUrl: async (p, ext) => `data:image/${this.mimeOf(ext)};base64,${arrayBufferToBase64(await this.app.vault.adapter.readBinary(p))}`,
      transcribe: (dataUrl) => this.visionClient.transcribe(dataUrl, this.settings.visionPrompt),
      notify: (m) => { new Notice(m); },
    };
  }
```

- [ ] **Step 4:** Command + Kontextmenü (in `onload()`, bei den anderen `addCommand`/`registerEvent`):

```ts
    this.addCommand({ id: "img-to-md", name: "IMG → MD: Bilder der Notiz transkribieren", callback: () => {
      const f = this.app.workspace.getActiveFile();
      if (!f) { new Notice("Keine aktive Notiz."); return; }
      void runImgToMd(this.makeImgIO(), f.path);
    }});
    this.registerEvent(this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
      const embeds = findImageEmbeds(editor.getLine(editor.getCursor().line));
      const f = this.app.workspace.getActiveFile();
      if (!embeds.length || !f) return;
      const raw = embeds[0].raw;
      menu.addItem(item => item.setTitle("IMG → MD").setIcon("scan-text").onClick(() => void runImgToMd(this.makeImgIO(), f.path, { onlyRaw: raw })));
    }));
```

- [ ] **Step 5:** `npm test` + `npm run build` + `npx tsc --noEmit` grün. Commit `feat(vision): IMG→MD-Command + Editor-Kontextmenü + Obsidian-IO`.

---

## Self-Review

- **Spec-Coverage:** VisionClient (T1) · pure Kern (T2) · Orchestrator+IO (T3) · Settings (T4) · Command/Menü/IO (T5). HEIC-Skip (T3-Test) · Kollision (T2/T3) · onlyRaw (T3). ✓
- **Placeholder:** keine — jeder Code-Step vollständig.
- **Typ-Konsistenz:** `ImgToMdIO` (T3) = IO-Factory (T5); `ImageEmbed.raw` (T2) = `onlyRaw`-Filter (T3) = Menü (T5); `VisionClient.transcribe` (T1) = IO.transcribe (T5); `findImageEmbeds` (T2) in Menü (T5).
- **Grün-Gruppierung:** T1, T2 additiv (neue Files). T3 erweitert img_to_md (grün). T4+T5 zusammen committen (Settings-UI nutzt ChatClient-Import; main nutzt T1–T4) — beide tsc-geprüft, T4 hat Default-Test.
