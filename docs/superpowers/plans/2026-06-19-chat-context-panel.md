# Chat: Unified Live-Kontext-Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die 3 Chat-Modi durch eine editierbare Live-Kontext-Liste über der Eingabe ersetzen (Pins + Auto-RAG, live beim Tippen, fix beim Senden).

**Architecture:** Retrieval wandert in `ContextPanel` (Live-Vorschau); `buildContext` + `ChatSession` bekommen nur noch eine fixe Pfadliste. Sequenz hält den Build an jeder Task-Grenze grün: erst additiv (buildContext, ContextPanel, note_picker), dann der atomare Umschalt-Task, dann Cleanup.

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`ItemView`, `FuzzySuggestModal`), vitest + happy-dom.

## Global Constraints

- TypeScript strict + `noImplicitAny`; Obsidian-Mock unter `tests/__mocks__/obsidian.ts`, kein echter obsidian-Import im Test.
- `ContextPanel` ist timer-frei (Debounce lebt in `ChatView`) → unit-testbar.
- `RETRIEVE_N = autoK + 20` (Puffer fürs Nachrücken). Auto-Treffer = Rangliste ohne (pinned ∪ excluded), erste `autoK`.
- `autoK`-Default = `settings.chatK`. Ausschlüsse Reset beim Senden; Pins bleiben über Fragen.
- `embed`/`search`-Wiring in `main` snapshot-guarded (wie `runSearch`).
- Nach jedem Task: `npx tsc --noEmit` (exit 0) + `npm run build` + `npx vitest run` grün.
- Commits: Conventional Commits, nur berührte Dateien, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `buildContext` (additiv neben `assembleContext`)

**Files:**
- Modify: `src/context_source.ts` (Funktion ergänzen, altes vorerst lassen)
- Test: `tests/context_source.test.ts` (Block ergänzen)

**Interfaces:**
- Produces: `buildContext(paths: string[], deps: { read: (p: string) => Promise<string>; budget: number }): Promise<ContextResult>` — liest jede Notiz, kürzt anteilig aufs Budget, `read`-Fehler überspringt. `ContextResult` (bestehend) wiederverwenden.

- [ ] **Step 1: Failing test**

In `tests/context_source.test.ts` ans Ende ergänzen:
```typescript
import { buildContext } from "../src/context_source";

describe("buildContext", () => {
  const read = async (p: string) => `Inhalt von ${p}`;
  it("baut Kontext aus gegebenen Pfaden + sources", async () => {
    const r = await buildContext(["a.md", "b.md"], { read, budget: 1000 });
    expect(r.sources).toEqual(["a.md", "b.md"]);
    expect(r.text).toContain("## a.md");
    expect(r.text).toContain("Inhalt von a.md");
  });
  it("kürzt pro Notiz aufs Budget", async () => {
    const r = await buildContext(["a.md", "b.md"], { read: async () => "x".repeat(5000), budget: 100 });
    expect(r.text.length).toBeLessThan(300);
  });
  it("überspringt nicht lesbare Notizen", async () => {
    const r = await buildContext(["a.md", "b.md"], { read: async (p) => { if (p === "a.md") throw new Error("weg"); return "ok"; }, budget: 1000 });
    expect(r.sources).toEqual(["b.md"]);
  });
  it("leere Pfadliste → leerer Kontext", async () => {
    const r = await buildContext([], { read, budget: 1000 });
    expect(r).toEqual({ text: "", sources: [] });
  });
});
```

- [ ] **Step 2: FAIL** — `cd /Users/Shared/code/vault-rag && npx vitest run tests/context_source.test.ts 2>&1 | tail -6` → `buildContext` fehlt.

- [ ] **Step 3: Implementierung** — in `src/context_source.ts` ergänzen (bestehendes vorerst belassen):
```typescript
export async function buildContext(
  paths: string[],
  deps: { read: (p: string) => Promise<string>; budget: number },
): Promise<ContextResult> {
  const perNote = paths.length > 0 ? Math.floor(deps.budget / paths.length) : deps.budget;
  const blocks: string[] = [];
  const sources: string[] = [];
  for (const p of paths) {
    let text: string;
    try { text = await deps.read(p); } catch { continue; }
    blocks.push(`## ${p}\n${text.slice(0, perNote)}`);
    sources.push(p);
  }
  return { text: blocks.join("\n\n"), sources };
}
```

- [ ] **Step 4: PASS** — gleiche vitest-Zeile, alle grün.

- [ ] **Step 5: Commit** — `git add src/context_source.ts tests/context_source.test.ts && git commit -m "feat(chat): buildContext(paths) — Kontext aus fixer Pfadliste"` (mit Trailer).

---

### Task 2: `ContextPanel` (neu, timer-frei)

**Files:**
- Create: `src/context_panel.ts`
- Test: `tests/context_panel.test.ts`

**Interfaces:**
- Produces:
  - `interface ContextPanelDeps { embed: (q: string) => Promise<Float32Array>; search: (vec: Float32Array, n: number) => string[]; getActivePath: () => string | null; pickNote: () => Promise<string | null> }`
  - `class ContextPanel` mit `pinned: string[]`, `excluded: Set<string>`, `autoDocs: string[]`, `autoK: number`; `mount(el)`, `setQuery(q): Promise<void>`, `pin(p)`, `unpin(p)`, `excludeAuto(p)`, `addActive()`, `addViaPicker(): Promise<void>`, `setAutoK(n)`, `currentPaths(): string[]`, `reset()`.

- [ ] **Step 1: Failing test**

`tests/context_panel.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { ContextPanel, ContextPanelDeps } from "../src/context_panel";

function deps(over: Partial<ContextPanelDeps> = {}): ContextPanelDeps {
  return {
    embed: async () => new Float32Array([1, 0]),
    search: () => ["a.md", "b.md", "c.md", "d.md"],
    getActivePath: () => "aktiv.md",
    pickNote: async () => "gewaehlt.md",
    ...over,
  };
}

describe("ContextPanel", () => {
  it("setQuery füllt autoDocs bis autoK", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("eine frage");
    expect(p.autoDocs).toEqual(["a.md", "b.md"]);
  });
  it("Query <3 Zeichen → keine autoDocs", async () => {
    const p = new ContextPanel(deps(), 3);
    await p.setQuery("ab");
    expect(p.autoDocs).toEqual([]);
  });
  it("excludeAuto → nächst-ähnlicher rückt nach", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("frage");
    p.excludeAuto("a.md");
    expect(p.autoDocs).toEqual(["b.md", "c.md"]);
  });
  it("pin schließt aus den autoDocs aus, currentPaths = pinned+auto", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("frage");
    p.pin("a.md");
    expect(p.autoDocs).toEqual(["b.md", "c.md"]);
    expect(p.currentPaths()).toEqual(["a.md", "b.md", "c.md"]);
  });
  it("addActive pinnt die aktive Notiz; addViaPicker pinnt die gewählte", async () => {
    const p = new ContextPanel(deps(), 1);
    p.addActive();
    await p.addViaPicker();
    expect(p.pinned).toEqual(["aktiv.md", "gewaehlt.md"]);
  });
  it("setAutoK rechnet neu", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("frage");
    p.setAutoK(4);
    expect(p.autoDocs).toEqual(["a.md", "b.md", "c.md", "d.md"]);
    p.setAutoK(0);
    expect(p.autoDocs).toEqual([]);
  });
  it("embed-Fehler → autoDocs leer, Pins bleiben", async () => {
    const p = new ContextPanel(deps({ embed: async () => { throw new Error("offline"); } }), 2);
    p.pin("x.md");
    await p.setQuery("frage");
    expect(p.autoDocs).toEqual([]);
    expect(p.currentPaths()).toEqual(["x.md"]);
  });
  it("reset leert Ausschlüsse (Pins bleiben)", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("frage");
    p.excludeAuto("a.md");
    expect(p.autoDocs).toEqual(["b.md", "c.md"]);
    p.reset();
    expect(p.autoDocs).toEqual(["a.md", "b.md"]);
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run tests/context_panel.test.ts 2>&1 | tail -6` → Modul fehlt.

- [ ] **Step 3: Implementierung**

`src/context_panel.ts`:
```typescript
export interface ContextPanelDeps {
  embed: (q: string) => Promise<Float32Array>;
  search: (vec: Float32Array, n: number) => string[];
  getActivePath: () => string | null;
  pickNote: () => Promise<string | null>;
}

const MIN_QUERY = 3;
const BUFFER = 20;

export class ContextPanel {
  pinned: string[] = [];
  excluded = new Set<string>();
  autoDocs: string[] = [];
  private ranked: string[] = [];
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;

  constructor(private deps: ContextPanelDeps, public autoK: number) {}

  mount(el: HTMLElement): void {
    el.empty();
    const head = el.createDiv({ cls: "vault-rag-ctx-head" });
    this.countEl = head.createEl("span", { cls: "vault-rag-ctx-count", text: "Kontext (0)" });
    const kWrap = head.createDiv({ cls: "vault-rag-ctx-k" });
    kWrap.createEl("button", { cls: "vault-rag-ctx-kdec", text: "−" }).addEventListener("click", () => this.setAutoK(this.autoK - 1));
    this.kEl = kWrap.createEl("span", { cls: "vault-rag-ctx-kval", text: `Auto ${this.autoK}` });
    kWrap.createEl("button", { cls: "vault-rag-ctx-kinc", text: "+" }).addEventListener("click", () => this.setAutoK(this.autoK + 1));
    head.createEl("button", { cls: "vault-rag-ctx-active", text: "+ Aktive Notiz" }).addEventListener("click", () => this.addActive());
    head.createEl("button", { cls: "vault-rag-ctx-pick", text: "+ Notiz" }).addEventListener("click", () => void this.addViaPicker());
    this.listEl = el.createDiv({ cls: "vault-rag-ctx-list" });
    this.render();
  }
  private kEl: HTMLElement | null = null;

  async setQuery(q: string): Promise<void> {
    const query = q.trim();
    if (query.length < MIN_QUERY) { this.ranked = []; this.recompute(); return; }
    try {
      const vec = await this.deps.embed(query);
      this.ranked = this.deps.search(vec, this.autoK + BUFFER);
    } catch { this.ranked = []; }
    this.recompute();
  }

  private recompute(): void {
    this.autoDocs = this.ranked.filter(p => !this.pinned.includes(p) && !this.excluded.has(p)).slice(0, this.autoK);
    this.render();
  }

  pin(path: string): void { if (!this.pinned.includes(path)) { this.pinned.push(path); this.recompute(); } }
  unpin(path: string): void { this.pinned = this.pinned.filter(p => p !== path); this.recompute(); }
  excludeAuto(path: string): void { this.excluded.add(path); this.recompute(); }
  addActive(): void { const p = this.deps.getActivePath(); if (p) this.pin(p); }
  async addViaPicker(): Promise<void> { const p = await this.deps.pickNote(); if (p) this.pin(p); }
  setAutoK(n: number): void { this.autoK = Math.max(0, n); this.kEl?.setText(`Auto ${this.autoK}`); this.recompute(); }
  currentPaths(): string[] { return [...new Set([...this.pinned, ...this.autoDocs])]; }
  reset(): void { this.excluded.clear(); this.recompute(); }

  private render(): void {
    const el = this.listEl; if (!el) return; el.empty();
    this.countEl?.setText(`Kontext (${this.currentPaths().length})`);
    for (const p of this.pinned) {
      const chip = el.createEl("span", { cls: "vault-rag-ctx-chip is-pinned", text: `📌 ${this.basename(p)} ✕` });
      chip.addEventListener("click", () => this.unpin(p));
    }
    for (const p of this.autoDocs) {
      const chip = el.createEl("span", { cls: "vault-rag-ctx-chip is-auto", text: `${this.basename(p)} ✕` });
      chip.addEventListener("click", () => this.excludeAuto(p));
    }
  }

  private basename(p: string): string { return p.split("/").pop()?.replace(/\.md$/, "") ?? p; }
}
```

- [ ] **Step 4: PASS** — `npx vitest run tests/context_panel.test.ts 2>&1 | tail -6` → 8 grün.

- [ ] **Step 5: Commit** — `git add src/context_panel.ts tests/context_panel.test.ts && git commit -m "feat(chat): ContextPanel — editierbare Live-Kontext-Liste (Pins + Auto-Fill)"`.

---

### Task 3: `note_picker.ts` (FuzzySuggestModal)

**Files:**
- Create: `src/note_picker.ts`

**Interfaces:**
- Produces: `pickNote(app: App): Promise<string | null>` — Fuzzy-Picker über `getMarkdownFiles()`; abgebrochen → `null`. (UI; nur in `main` importiert → Mock braucht kein `FuzzySuggestModal`.)

- [ ] **Step 1: Implementierung** (kein Unit-Test — Obsidian-Modal; Verifikation via Build):

`src/note_picker.ts`:
```typescript
import { App, FuzzySuggestModal, TFile } from "obsidian";

class NotePicker extends FuzzySuggestModal<TFile> {
  private picked = false;
  constructor(app: App, private resolve: (p: string | null) => void) {
    super(app);
    this.setPlaceholder("Notiz zum Kontext hinzufügen…");
  }
  getItems(): TFile[] { return this.app.vault.getMarkdownFiles(); }
  getItemText(f: TFile): string { return f.path; }
  onChooseItem(f: TFile): void { this.picked = true; this.resolve(f.path); }
  onClose(): void { super.onClose(); if (!this.picked) this.resolve(null); }
}

export function pickNote(app: App): Promise<string | null> {
  return new Promise(resolve => new NotePicker(app, resolve).open());
}
```

- [ ] **Step 2: Build grün** — `npm run build 2>&1 | tail -3` → keine Fehler.

- [ ] **Step 3: Commit** — `git add src/note_picker.ts && git commit -m "feat(chat): note_picker — Fuzzy-Picker für Kontext-Notizen"`.

---

### Task 4: Umschalt-Task — ChatSession + ChatView + main auf Pfadlisten-Modell (atomar)

**Files:**
- Modify: `src/chat_session.ts`, `src/chat_view.ts`, `src/main.ts`, `styles.css`
- Modify: `tests/chat_session.test.ts`, `tests/chat_view.test.ts`

Atomar, weil der Interface-Wechsel (`send(query, paths)`, kein `mode`/`picked`) alle drei Dateien zugleich betrifft — sonst rote Zwischen-Builds.

**Interfaces:**
- `ChatSessionDeps.assemble: (paths: string[]) => Promise<ContextResult>`; `ChatSession.send(query: string, paths: string[], onToken): Promise<{ sources; error? }>`; `mode`/`picked` entfallen.
- `ChatViewDeps` + `{ embed, search, pickNote, autoK }`; Modi-Buttons + `renderPicked` entfallen; `ContextPanel` über der Eingabe.

- [ ] **Step 1: `chat_session.ts` — `send(query, paths, onToken)`** (ersetze Signatur + assemble-Aufruf; Rest identisch):
```typescript
import { ChatClient, ChatMessage } from "./chat_client";
import { ContextResult } from "./context_source";

const SYSTEM_PREAMBLE =
  "Du beantwortest Fragen gegroundet in den bereitgestellten Notizen des Nutzers. " +
  "Wenn die Antwort nicht aus ihnen hervorgeht, sag das offen. Antworte knapp und auf Deutsch.";

export interface ChatSessionDeps {
  client: ChatClient;
  assemble: (paths: string[]) => Promise<ContextResult>;
}

export class ChatSession {
  messages: ChatMessage[] = [];
  private controller: AbortController | null = null;
  constructor(private deps: ChatSessionDeps) {}

  async send(query: string, paths: string[], onToken: (t: string) => void): Promise<{ sources: string[]; error?: string }> {
    this.messages.push({ role: "user", content: query });
    const assistant: ChatMessage = { role: "assistant", content: "" };
    this.messages.push(assistant);

    let ctx: ContextResult;
    try { ctx = await this.deps.assemble(paths); }
    catch { assistant.error = "Kontext konnte nicht geladen werden."; return { sources: [], error: assistant.error }; }

    const system: ChatMessage = { role: "system", content: ctx.text ? `${SYSTEM_PREAMBLE}\n\n${ctx.text}` : SYSTEM_PREAMBLE };
    const history = this.messages.slice(0, -2).filter(m => m.content.length > 0).map(m => ({ role: m.role, content: m.content }));
    const sent: ChatMessage[] = [system, ...history, { role: "user", content: query }];

    this.controller = new AbortController();
    try {
      const full = await this.deps.client.stream(sent, t => { assistant.content += t; onToken(t); }, this.controller.signal);
      assistant.content = full;
      assistant.sources = ctx.sources;
      if (full.trim() === "") assistant.error = "Leere Antwort vom Chat-LLM — Endpoint/Modell in den Settings prüfen.";
      return { sources: ctx.sources };
    } catch (e) {
      const aborted = (e as { name?: string })?.name === "AbortError";
      if (!aborted) assistant.error = "Chat-LLM nicht erreichbar (lokal/VPN).";
      return { sources: ctx.sources, error: aborted ? undefined : assistant.error };
    }
  }

  reset(): void { this.abort(); this.messages = []; }
  abort(): void { this.controller?.abort(); }
}
```

- [ ] **Step 2: `chat_view.ts` — ContextPanel hosten, Modi/Picked raus** (vollständige neue Datei):
```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";
import { ChatSession } from "./chat_session";
import { ContextPanel, ContextPanelDeps } from "./context_panel";

export const VIEW_TYPE_CHAT = "vault-rag-chat";

export interface ChatViewDeps extends ContextPanelDeps {
  session: ChatSession;
  openPath: (path: string) => void;
  ping: () => Promise<boolean>;
  autoK: number;
}

export class ChatView extends ItemView {
  private panel: ContextPanel;
  private messagesEl: HTMLElement | null = null;
  private workingEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendBtn: HTMLElement | null = null;
  private timer: ReturnType<typeof window.setInterval> | null = null;
  private debTimer: ReturnType<typeof window.setTimeout> | null = null;
  private workStart = 0;
  private running = false;

  constructor(leaf: WorkspaceLeaf, private deps: ChatViewDeps) {
    super(leaf);
    this.panel = new ContextPanel(deps, deps.autoK);
  }
  getViewType(): string { return VIEW_TYPE_CHAT; }
  getDisplayText(): string { return "Vault Chat"; }
  getIcon(): string { return "message-square"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl; c.empty();
    this.statusEl = c.createDiv({ cls: "vault-rag-chat-status" });
    this.statusEl.addEventListener("click", () => void this.refreshStatus());
    this.messagesEl = c.createDiv({ cls: "vault-rag-chat-messages" });
    this.workingEl = c.createDiv({ cls: "vault-rag-chat-working" });
    this.panel.mount(c.createDiv({ cls: "vault-rag-chat-context" }));
    const row = c.createDiv({ cls: "vault-rag-chat-input-row" });
    const input = row.createEl("input", { cls: "vault-rag-chat-input" }) as HTMLInputElement;
    input.type = "text"; input.placeholder = "Frag deinen Vault…";
    this.inputEl = input;
    input.addEventListener("input", () => this.scheduleQuery(input.value ?? ""));
    input.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") void this.submit(); });
    this.sendBtn = row.createEl("button", { cls: "vault-rag-chat-send", text: "Senden" });
    this.sendBtn.addEventListener("click", () => this.onSendClick());
    row.createEl("button", { cls: "vault-rag-chat-new", text: "Neu" }).addEventListener("click", () => this.newChat());
    this.renderMessages();
    await this.refreshStatus();
  }

  private scheduleQuery(q: string): void {
    if (this.debTimer !== null) window.clearTimeout(this.debTimer);
    this.debTimer = window.setTimeout(() => void this.panel.setQuery(q), 400);
  }

  async refreshStatus(): Promise<void> {
    const el = this.statusEl; if (!el) return;
    el.setText("Chat-LLM: prüfe…");
    const ok = await this.deps.ping();
    el.setText(ok ? "● Chat-LLM verbunden" : "○ Chat-LLM offline — in den Settings prüfen");
  }

  newChat(): void {
    this.deps.session.reset();
    this.stopWorking();
    this.running = false; this.sendBtn?.setText("Senden");
    this.workingEl?.setText("");
    this.renderMessages();
  }

  private onSendClick(): void {
    if (this.running) { this.deps.session.abort(); return; }
    void this.submit();
  }

  async submit(): Promise<void> {
    if (this.running) return;
    const q = (this.inputEl?.value ?? "").trim();
    if (!q) return;
    if (this.inputEl) this.inputEl.value = "";
    const paths = this.panel.currentPaths();
    this.running = true; this.sendBtn?.setText("Stop");
    const pending = this.deps.session.send(q, paths, () => this.renderMessages());
    this.renderMessages();
    this.startWorking();
    await pending;
    this.stopWorking();
    this.running = false; this.sendBtn?.setText("Senden");
    this.panel.reset();
    this.renderMessages();
  }

  private startWorking(): void {
    const el = this.workingEl; if (!el) return;
    this.workStart = Date.now();
    const tick = () => el.setText(`● generiert… ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
    tick();
    this.timer = window.setInterval(tick, 100);
  }
  private stopWorking(): void {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    if (this.workStart && this.workingEl) this.workingEl.setText(`✓ Antwort in ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
  }

  private renderMessages(): void {
    const el = this.messagesEl; if (!el) return; el.empty();
    for (const m of this.deps.session.messages) {
      if (m.content) el.createDiv({ cls: `vault-rag-chat-msg is-${m.role}`, text: m.content });
      if (m.error) el.createDiv({ cls: "vault-rag-chat-state", text: m.error });
      if (m.sources && m.sources.length) {
        const row = el.createDiv({ cls: "vault-rag-chat-sources" });
        for (const p of m.sources) {
          const chip = row.createEl("span", { cls: "vault-rag-chat-source", text: p.split("/").pop()?.replace(/\.md$/, "") ?? p });
          chip.addEventListener("click", () => this.deps.openPath(p));
        }
      }
    }
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    if (this.debTimer !== null) { window.clearTimeout(this.debTimer); this.debTimer = null; }
  }
}
```

- [ ] **Step 3: `main.ts` — ChatView-Registrierung umverdrahten**

Importe (ergänzen/ändern): `import { buildContext } from "./context_source";` (statt `assembleContext, ChatMode, ContextResult`), `import { pickNote } from "./note_picker";`. `ChatMode`/`ContextResult`/`assembleContext`-Import entfernen; `toIndexVector` bleibt.

Die `registerView(VIEW_TYPE_CHAT, …)` ersetzen durch:
```typescript
    this.registerView(VIEW_TYPE_CHAT, (leaf: WorkspaceLeaf) => new ChatView(leaf, {
      session: new ChatSession({
        client: this.chatClient,
        assemble: (paths) => buildContext(paths, {
          read: (p) => this.app.vault.adapter.read(p),
          budget: this.settings.contextCharBudget,
        }),
      }),
      openPath: this.openPath,
      ping: () => this.chatClient.ping(),
      getActivePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      embed: async (q) => {
        const index = this.index;
        if (!index) throw new Error("kein Index");
        const vecs = await this.embedder.embed([q]);
        if (vecs.length === 0) throw new Error("embed: leere Antwort");
        return toIndexVector(vecs, index.dim);
      },
      search: (vec, n) => {
        const retriever = this.retriever;
        return retriever ? retriever.search(vec, { k: n, minSim: this.settings.minSim, exclude: this.settings.exclude }).map(h => h.path) : [];
      },
      pickNote: () => pickNote(this.app),
      autoK: this.settings.chatK,
    }));
```
Die alte private Methode `assembleChatContext(...)` **entfernen** (wird nicht mehr gebraucht).

- [ ] **Step 4: Tests anpassen**

`tests/chat_session.test.ts` — `mkSession` + Aufrufe auf neue Signatur. Ersetze die Datei-Inhalte der `send`-Aufrufe: `assemble` ist jetzt `(paths) => …`, `send(q, paths, onToken)`. Konkret:
```typescript
function mkSession(streamImpl?: any, assembleImpl?: any) {
  const client: any = { ping: async () => true, stream: streamImpl ?? (async (_m: any, onToken: (t: string) => void) => { onToken("Hi"); onToken("!"); return "Hi!"; }) };
  const assemble = assembleImpl ?? vi.fn(async () => ({ text: "ctx", sources: ["a.md"] }));
  return { s: new ChatSession({ client, assemble }), assemble };
}
```
und in jedem `s.send("…", () => {})` ein Pfad-Argument einfügen: `s.send("frage", ["a.md"], t => …)`. Der Multi-Turn-Test prüft statt `toHaveBeenCalledWith("auto-rag", …)` jetzt `expect(assemble).toHaveBeenCalledWith(["a.md"])`. Sync-Push-Test: `s.send("frage", [], () => {})`. Reset-Test: `s.send("a", [], () => {})`.

`tests/chat_view.test.ts` — `mkView`-Mock-Session ohne `mode`/`picked`; Deps um `embed`/`search`/`pickNote`/`autoK` ergänzen; Modi-/Picked-Tests entfernen; Send-Test prüft, dass `session.send` mit `(query, paths, onToken)` aufgerufen wird:
```typescript
function mkView(opts: { send?: any; ping?: any; activePath?: string | null } = {}) {
  const session: any = {
    messages: [],
    send: opts.send ?? vi.fn(async (q: string, _paths: string[], onToken: (t: string) => void) => {
      session.messages.push({ role: "user", content: q });
      const a: any = { role: "assistant", content: "" }; session.messages.push(a);
      onToken("Ant"); a.content = "Antwort"; a.sources = ["notes/a.md"];
      return { sources: ["notes/a.md"] };
    }),
    abort: vi.fn(), reset: vi.fn(() => { session.messages = []; }),
  };
  const opened: string[] = [];
  const view = new ChatView({ app: makeFakeApp() } as any, {
    session, openPath: (p: string) => opened.push(p),
    ping: opts.ping ?? (async () => true),
    getActivePath: () => (opts.activePath !== undefined ? opts.activePath : "aktiv.md"),
    embed: async () => new Float32Array([1, 0]),
    search: () => ["x.md"],
    pickNote: async () => null,
    autoK: 3,
  });
  return { view, session, opened };
}
```
Tests behalten: getViewType, „submit rendert user+assistant + Quellen-Chip", Multi-Turn-Quellen, Fehler-Zustand, leere Eingabe, Status, Senden→Stop-Toggle, Neuer Chat. Entfernen: `setMode`, `picked-notes`-Picker-Test. Im Send-Test ergänzen: `expect(session.send).toHaveBeenCalledWith("frage", expect.any(Array), expect.any(Function))`.

- [ ] **Step 5: Styles** — in `styles.css` ergänzen (alte `.vault-rag-chat-modes`/`-mode`/`-picked*` dürfen bleiben oder weg):
```css
.vault-rag-chat-context { border-top: 1px solid var(--background-modifier-border); padding-top: 6px; margin-top: 6px; }
.vault-rag-ctx-head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.vault-rag-ctx-k { display: flex; align-items: center; gap: 2px; }
.vault-rag-ctx-list { display: flex; flex-wrap: wrap; gap: 4px; }
.vault-rag-ctx-chip { font-size: 11px; padding: 2px 6px; border-radius: 10px; cursor: pointer; background: var(--background-modifier-border); }
.vault-rag-ctx-chip.is-pinned { background: var(--interactive-accent); color: var(--text-on-accent); }
```

- [ ] **Step 6: Gate** — `npx tsc --noEmit; echo $?` (0) · `npm run build 2>&1 | tail -3` · `npx vitest run 2>&1 | tail -8` (alle grün). Erwartung: `context_source.ts` hat noch das alte `assembleContext` (unbenutzt) — kompiliert, Cleanup folgt in Task 5.

- [ ] **Step 7: Commit** — `git add src/chat_session.ts src/chat_view.ts src/main.ts styles.css tests/chat_session.test.ts tests/chat_view.test.ts && git commit -m "feat(chat): Unified Kontext-Panel statt 3 Modi (Pfadlisten-Modell)"`.

---

### Task 5: Cleanup — altes 3-Modi-`context_source` entfernen

**Files:**
- Modify: `src/context_source.ts` (altes raus), `tests/context_source.test.ts` (3-Modi-Tests raus)

- [ ] **Step 1: Entfernen** aus `src/context_source.ts`: `type ChatMode`, `interface ContextDeps`, `function assembleContext`. Behalten: `interface ContextResult`, `function buildContext`.

- [ ] **Step 2: Tests bereinigen** — in `tests/context_source.test.ts` den alten `describe("assembleContext", …)`-Block entfernen; `buildContext`-Block bleibt. Import auf `buildContext` reduzieren.

- [ ] **Step 3: Gate** — `npx tsc --noEmit; echo $?` (0; kein toter Verweis auf `ChatMode`/`assembleContext` mehr) · `npm run build` · `npx vitest run 2>&1 | tail -8` (alle grün).

- [ ] **Step 4: Commit** — `git add src/context_source.ts tests/context_source.test.ts && git commit -m "refactor(chat): altes 3-Modi-context_source entfernt"`.

---

## Post-Implementation
- Plugin neu laden → Chat öffnen: Kontext-Liste über der Eingabe; beim Tippen füllen sich Auto-Treffer; `× ` entfernt + rückt nach; „+ Aktive Notiz"/„+ Notiz" pinnen; `Auto`-Stepper; Senden nutzt die gezeigte Liste; nach dem Senden Ausschlüsse zurückgesetzt, Pins bleiben.
- Thinking-Slice (`reasoning_content`) als nächstes.

## Self-Review
**1. Spec-Coverage:** buildContext (T1) · ContextPanel: Pins+Auto+live+exclude+backfill+autoK+reset (T2) · Fuzzy-Picker (T3, ersetzt D&D) · Layout/Modi-Wegfall/send(paths)/Wiring (T4) · 3-Modi-Entfernung (T5). Alle Spec-Abschnitte abgedeckt.
**2. Placeholder-Scan:** kein TBD/TODO; vollständiger Code je Step.
**3. Typ-Konsistenz:** `ContextPanelDeps`/`buildContext(paths,{read,budget})`/`ChatSessionDeps.assemble:(paths)`/`send(query,paths,onToken)`/`currentPaths()` durchgängig über T1–T5. `RETRIEVE_N = autoK+20` in ContextPanel; `search(vec,n)` einheitlich (n = autoK+BUFFER). Snapshot-Guards im main-Wiring.
