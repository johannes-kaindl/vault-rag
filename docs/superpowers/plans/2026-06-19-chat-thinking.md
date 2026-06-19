# Chat: Thinking sichtbar machen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reasoning-Modelle streamen ihr „Denken"; das Plugin greift es ab (zwei Quellen) und zeigt es in einem aufklappbaren „💭 Gedanken"-Block über jeder Antwort.

**Architecture:** `parseSSE` bleibt rein und liest zusätzlich `delta.reasoning_content`. Ein stateful `ThinkSplitter` zieht `<think>…</think>` aus dem Content-Strom. `ChatClient.stream` routet beide Kanäle über zwei Callbacks; `ChatSession` akkumuliert Reasoning am `ChatMessage` (ephemer, nie ans LLM zurück); `ChatView` rendert den `<details>`-Block.

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`<details>`/`<summary>`), vitest + happy-dom.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Tests:** vitest + happy-dom; Obsidian-Mock `tests/__mocks__/obsidian.ts`; nach jeder Änderung **alle** Tests grün.
- **Reasoning NIE ans LLM zurück** — der an `stream` gesendete History-Aufbau bleibt `{role, content}`-only.
- **Commits:** Conventional Commits, deutsche Beschreibung; **nur berührte Dateien stagen**; Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Befehle: `npx vitest run tests/<datei>` (eine Datei) · `npm test` (alle) · `npm run build` · `npx tsc --noEmit`.

---

### Task 1: `parseSSE` liest `reasoning_content`

**Files:**
- Modify: `src/chat_client.ts:3-21` (`parseSSE`)
- Test: `tests/chat_client.test.ts:13-32` (`describe("parseSSE")`)

**Interfaces:**
- Produces: `parseSSE(buffer: string): { content: string[]; reasoning: string[]; rest: string; done: boolean }` (Feld `deltas` → `content`; neues Feld `reasoning`).

- [ ] **Step 1: Bestehende parseSSE-Tests auf `content` umstellen + reasoning-Tests ergänzen**

Ersetze den `describe("parseSSE", …)`-Block (`tests/chat_client.test.ts:13-32`) durch:

```ts
describe("parseSSE", () => {
  it("extrahiert content-Deltas aus data-Zeilen", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"Hal"}}]}\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n');
    expect(r.content).toEqual(["Hal", "lo"]);
    expect(r.reasoning).toEqual([]);
    expect(r.done).toBe(false);
    expect(r.rest).toBe("");
  });
  it("extrahiert reasoning_content-Deltas", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\ndata: {"choices":[{"delta":{"reasoning_content":"ke"}}]}\n');
    expect(r.reasoning).toEqual(["den", "ke"]);
    expect(r.content).toEqual([]);
  });
  it("trennt content und reasoning im selben Buffer", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"reasoning_content":"r"}}]}\ndata: {"choices":[{"delta":{"content":"c"}}]}\n');
    expect(r.reasoning).toEqual(["r"]);
    expect(r.content).toEqual(["c"]);
  });
  it("setzt done bei [DONE]", () => {
    expect(parseSSE("data: [DONE]\n").done).toBe(true);
  });
  it("verarbeitet \\r\\n-Zeilenenden", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"a"}}]}\r\ndata: {"choices":[{"delta":{"content":"b"}}]}\r\n');
    expect(r.content).toEqual(["a", "b"]);
  });
  it("unvollständige letzte Zeile bleibt in rest", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: {"cho');
    expect(r.content).toEqual(["x"]);
    expect(r.rest).toBe('data: {"cho');
  });
});
```

- [ ] **Step 2: Test laufen lassen → schlägt fehl**

Run: `npx vitest run tests/chat_client.test.ts`
Expected: FAIL (`r.content` undefined; `parseSSE` liefert noch `deltas`).

- [ ] **Step 3: `parseSSE` implementieren**

Ersetze `src/chat_client.ts:3-21` durch:

```ts
/** Akkumuliert OpenAI-SSE-Deltas (content + reasoning_content) aus einem (Teil-)Buffer;
 *  unvollständige letzte Zeile → rest. Reine Funktion — kein Zustand. */
export function parseSSE(buffer: string): { content: string[]; reasoning: string[]; rest: string; done: boolean } {
  const content: string[] = [];
  const reasoning: string[] = [];
  let done = false;
  const lines = buffer.split(/\r\n|\n|\r/);
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "[DONE]") { done = true; continue; }
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string; reasoning_content?: string } }[] };
      const d = j.choices?.[0]?.delta;
      if (typeof d?.content === "string") content.push(d.content);
      if (typeof d?.reasoning_content === "string") reasoning.push(d.reasoning_content);
    } catch { /* unvollständig — sollte bei kompletten Zeilen nicht passieren */ }
  }
  return { content, reasoning, rest, done };
}
```

- [ ] **Step 4: Test laufen lassen → grün**

Run: `npx vitest run tests/chat_client.test.ts`
Expected: PASS für `describe("parseSSE")`. (Die `describe("ChatClient")`-Tests schlagen noch fehl — wird in Task 3 angefasst; sie nutzen die alte `stream`-Signatur/`p.deltas`. **Nicht** als Regression werten; Step ist erfüllt wenn alle `parseSSE`-its grün sind.)

- [ ] **Step 5: Commit**

```bash
git add src/chat_client.ts tests/chat_client.test.ts
git commit -m "feat(chat): parseSSE liest reasoning_content (Feld deltas→content)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `ThinkSplitter` (`<think>`-Tags aus dem Content-Strom)

**Files:**
- Create: `src/think_splitter.ts`
- Test: `tests/think_splitter.test.ts`

**Interfaces:**
- Produces: `class ThinkSplitter { push(text: string): { content: string; reasoning: string } }` — stateful über aufeinanderfolgende `push`-Aufrufe.

- [ ] **Step 1: Failing test schreiben**

Erstelle `tests/think_splitter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ThinkSplitter } from "../src/think_splitter";

describe("ThinkSplitter", () => {
  it("Plaintext ohne Tags → alles content", () => {
    expect(new ThinkSplitter().push("hallo welt")).toEqual({ content: "hallo welt", reasoning: "" });
  });
  it("ganzer Block in einem push", () => {
    expect(new ThinkSplitter().push("a<think>b</think>c")).toEqual({ content: "ac", reasoning: "b" });
  });
  it("Text vor und zwischen Blöcken", () => {
    expect(new ThinkSplitter().push("intro<think>r</think>done")).toEqual({ content: "introdone", reasoning: "r" });
  });
  it("mehrere Blöcke", () => {
    expect(new ThinkSplitter().push("a<think>x</think>b<think>y</think>c")).toEqual({ content: "abc", reasoning: "xy" });
  });
  it("Tag über push-Grenzen gesplittet", () => {
    const s = new ThinkSplitter();
    const r1 = s.push("a<thi");
    const r2 = s.push("nk>b</thi");
    const r3 = s.push("nk>c");
    expect(r1).toEqual({ content: "a", reasoning: "" });
    expect(r2).toEqual({ content: "", reasoning: "b" });
    expect(r3).toEqual({ content: "c", reasoning: "" });
  });
  it("geöffnetes <think> ohne Close → reasoning", () => {
    expect(new ThinkSplitter().push("<think>noch am denken")).toEqual({ content: "", reasoning: "noch am denken" });
  });
  it("einzelnes < das kein Tag ist bleibt content", () => {
    const s = new ThinkSplitter();
    const r1 = s.push("a <");
    const r2 = s.push("b > c");
    expect(r1.content + r2.content).toBe("a <b > c");
    expect(r1.reasoning + r2.reasoning).toBe("");
  });
});
```

- [ ] **Step 2: Test laufen lassen → schlägt fehl**

Run: `npx vitest run tests/think_splitter.test.ts`
Expected: FAIL ("Cannot find module '../src/think_splitter'").

- [ ] **Step 3: `ThinkSplitter` implementieren**

Erstelle `src/think_splitter.ts`:

```ts
const OPEN = "<think>";
const CLOSE = "</think>";

/** Zustandsbehafteter Splitter: zieht <think>…</think> aus einem Token-Strom (Content-Kanal).
 *  Tags dürfen über push-Grenzen gesplittet sein — ein angefangenes Tag wird gepuffert. */
export class ThinkSplitter {
  private inside = false;
  private buf = "";

  push(text: string): { content: string; reasoning: string } {
    let s = this.buf + text;
    this.buf = "";
    let content = "";
    let reasoning = "";
    while (s.length > 0) {
      const tag = this.inside ? CLOSE : OPEN;
      const idx = s.indexOf(tag);
      if (idx >= 0) {
        const before = s.slice(0, idx);
        if (this.inside) reasoning += before; else content += before;
        this.inside = !this.inside;
        s = s.slice(idx + tag.length);
        continue;
      }
      // Kein vollständiges Tag: ein evtl. angefangenes Tag am Ende puffern.
      const partial = partialSuffixLen(s, tag);
      const safe = s.length - partial;
      const emit = s.slice(0, safe);
      if (this.inside) reasoning += emit; else content += emit;
      this.buf = s.slice(safe);
      s = "";
    }
    return { content, reasoning };
  }
}

/** Länge des längsten Suffixes von `s`, das ein echter Präfix von `tag` ist. */
function partialSuffixLen(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (s.slice(s.length - n) === tag.slice(0, n)) return n;
  }
  return 0;
}
```

- [ ] **Step 4: Test laufen lassen → grün**

Run: `npx vitest run tests/think_splitter.test.ts`
Expected: PASS (alle 7 its).

- [ ] **Step 5: Commit**

```bash
git add src/think_splitter.ts tests/think_splitter.test.ts
git commit -m "feat(chat): ThinkSplitter — <think>-Tags aus dem Content-Strom (chunk-robust)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `ChatClient.stream` routet beide Kanäle

**Files:**
- Modify: `src/chat_client.ts:23-52` (`ChatClient.stream`)
- Test: `tests/chat_client.test.ts:34-56` (`describe("ChatClient")`)

**Interfaces:**
- Consumes: `parseSSE` (Task 1), `ThinkSplitter` (Task 2).
- Produces: `stream(messages: ChatMessage[], onContent: (t: string) => void, onReasoning: (t: string) => void, signal?: AbortSignal): Promise<{ content: string; reasoning: string }>`.

- [ ] **Step 1: ChatClient-Tests auf neue Signatur umstellen + Reasoning-Routing-Test**

Ersetze den `describe("ChatClient", …)`-Block (`tests/chat_client.test.ts:34-56`) durch:

```ts
describe("ChatClient", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("stream akkumuliert content und gibt {content,reasoning} zurück", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const content: string[] = [];
    const res = await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], t => content.push(t), () => {});
    expect(content).toEqual(["Hal", "lo"]);
    expect(res).toEqual({ content: "Hallo", reasoning: "" });
  });
  it("stream routet reasoning_content an onReasoning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"ke"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const reasoning: string[] = []; const content: string[] = [];
    const res = await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], c => content.push(c), r => reasoning.push(r));
    expect(reasoning.join("")).toBe("denke");
    expect(content.join("")).toBe("Antwort");
    expect(res).toEqual({ content: "Antwort", reasoning: "denke" });
  });
  it("stream zieht inline <think> in den reasoning-Kanal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"content":"<think>weil</think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const res = await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {});
    expect(res).toEqual({ content: "Antwort", reasoning: "weil" });
  });
  it("stream wirft bei HTTP-Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([], false, 500)));
    await expect(new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "x" }], () => {}, () => {})).rejects.toThrow("500");
  });
  it("ping true bei 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    expect(await new ChatClient("http://localhost:8080", "qwen3").ping()).toBe(true);
  });
});
```

- [ ] **Step 2: Test laufen lassen → schlägt fehl**

Run: `npx vitest run tests/chat_client.test.ts`
Expected: FAIL (alte `stream` gibt `string` zurück, kein `onReasoning`-Param).

- [ ] **Step 3: `stream` implementieren**

Füge oben in `src/chat_client.ts` den Import hinzu (nach Zeile 1):

```ts
import { ThinkSplitter } from "./think_splitter";
```

Ersetze die `stream`-Methode (`src/chat_client.ts:30-51`) durch:

```ts
  async stream(
    messages: ChatMessage[],
    onContent: (t: string) => void,
    onReasoning: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<{ content: string; reasoning: string }> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Chat HTTP ${res.status}`);
    const reader = (res as unknown as { body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } }).body.getReader();
    const dec = new TextDecoder();
    const splitter = new ThinkSplitter();
    let buffer = "", content = "", reasoning = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const p = parseSSE(buffer);
      buffer = p.rest;
      for (const r of p.reasoning) { reasoning += r; onReasoning(r); }
      for (const c of p.content) {
        const split = splitter.push(c);
        if (split.content) { content += split.content; onContent(split.content); }
        if (split.reasoning) { reasoning += split.reasoning; onReasoning(split.reasoning); }
      }
      if (p.done) break;
    }
    return { content, reasoning };
  }
```

- [ ] **Step 4: Test laufen lassen → grün**

Run: `npx vitest run tests/chat_client.test.ts`
Expected: PASS (alle `parseSSE`- und `ChatClient`-its). `tests/chat_session.test.ts` schlägt jetzt fehl (alte stream-Mocks) — wird in Task 4 angefasst.

- [ ] **Step 5: Commit**

```bash
git add src/chat_client.ts tests/chat_client.test.ts
git commit -m "feat(chat): ChatClient.stream routet content+reasoning über zwei Callbacks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ChatMessage.reasoning` + `ChatSession` akkumuliert

**Files:**
- Modify: `src/chat_client.ts:1` (`ChatMessage`-Interface)
- Modify: `src/chat_session.ts:42-47` (`send`-Streamaufruf + Empty-Guard)
- Test: `tests/chat_session.test.ts` (Mocks auf neue Signatur + Reasoning-Tests)

**Interfaces:**
- Consumes: `stream(messages, onContent, onReasoning, signal): Promise<{content, reasoning}>` (Task 3).
- Produces: `ChatMessage.reasoning?: string`; `assistant.reasoning` wird gesetzt; History an `stream` bleibt `{role, content}`-only.

- [ ] **Step 1: `mkSession`-Mock + Tests umstellen, Reasoning-Test ergänzen**

In `tests/chat_session.test.ts` ersetze `mkSession` (Zeilen 4-8) durch:

```ts
function mkSession(streamImpl?: any, assembleImpl?: any) {
  const client: any = { ping: async () => true, stream: streamImpl ?? (async (_m: any, onContent: (t: string) => void) => { onContent("Hi"); onContent("!"); return { content: "Hi!", reasoning: "" }; }) };
  const assemble = assembleImpl ?? vi.fn(async () => ({ text: "ctx", sources: ["a.md"] }));
  return { s: new ChatSession({ client, assemble }), assemble };
}
```

Ersetze die „leere Antwort"-it (Zeilen 40-44) durch:

```ts
  it("leere Antwort → Hinweis", async () => {
    const { s } = mkSession(async () => ({ content: "", reasoning: "" }));
    await s.send("x", ["a.md"], () => {});
    expect(s.messages[1].error).toContain("Leere Antwort");
  });
```

Ersetze die „pusht die User-Nachricht synchron"-it (Zeilen 45-54), Zeile mit `stream: async () => ""`:

```ts
    const client: any = { ping: async () => true, stream: async () => ({ content: "", reasoning: "" }) };
```

Ersetze die „fehlgeschlagener Turn"-it (Zeilen 62-75) durch:

```ts
  it("fehlgeschlagener Turn landet nicht im Folge-Verlauf", async () => {
    let captured: any[] = [];
    let call = 0;
    const stream = async (msgs: any[], onContent: (t: string) => void) => {
      captured = msgs;
      if (call++ === 0) throw new Error("boom");
      onContent("ok"); return { content: "ok", reasoning: "" };
    };
    const { s } = mkSession(stream);
    await s.send("Qf", ["a.md"], () => {});
    await s.send("Qn", ["a.md"], () => {});
    const userContents = captured.filter((m: any) => m.role === "user").map((m: any) => m.content);
    expect(userContents).toEqual(["Qn"]);
  });
```

Ergänze am Ende des `describe("ChatSession")` (vor der schließenden `});`) zwei neue its:

```ts
  it("akkumuliert reasoning am Assistenten", async () => {
    const stream = async (_m: any, onContent: (t: string) => void, onReasoning: (t: string) => void) => {
      onReasoning("den"); onReasoning("ke"); onContent("Antwort");
      return { content: "Antwort", reasoning: "denke" };
    };
    const { s } = mkSession(stream);
    await s.send("frage", ["a.md"], () => {});
    expect(s.messages[1].reasoning).toBe("denke");
    expect(s.messages[1].content).toBe("Antwort");
  });
  it("reasoning fließt NICHT in die Folge-History ans LLM", async () => {
    let captured: any[] = [];
    const stream = async (msgs: any[], onContent: (t: string) => void, onReasoning: (t: string) => void) => {
      captured = msgs;
      onReasoning("geheim"); onContent("Antwort");
      return { content: "Antwort", reasoning: "geheim" };
    };
    const { s } = mkSession(stream);
    await s.send("eins", ["a.md"], () => {});
    await s.send("zwei", ["a.md"], () => {});
    expect(captured.some((m: any) => "reasoning" in m)).toBe(false);
    const assistantTurn = captured.find((m: any) => m.role === "assistant");
    expect(assistantTurn.content).toBe("Antwort");
  });
```

- [ ] **Step 2: Test laufen lassen → schlägt fehl**

Run: `npx vitest run tests/chat_session.test.ts`
Expected: FAIL (`s.messages[1].reasoning` undefined; `send` setzt es noch nicht).

- [ ] **Step 3: `ChatMessage.reasoning` + `send` implementieren**

In `src/chat_client.ts:1` ergänze das Feld im Interface:

```ts
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; reasoning?: string; sources?: string[]; error?: string }
```

In `src/chat_session.ts` ersetze den `try`-Block des Streamaufrufs (`src/chat_session.ts:42-47`) durch:

```ts
    try {
      // onToken = reiner Re-Render-Notifier (View ignoriert das Argument).
      // reasoning wird am Assistenten akkumuliert, aber NIE in `history` (oben) aufgenommen.
      const result = await this.deps.client.stream(
        sent,
        c => { assistant.content += c; onToken(c); },
        r => { assistant.reasoning = (assistant.reasoning ?? "") + r; onToken(r); },
        this.controller.signal,
      );
      assistant.content = result.content;
      assistant.reasoning = result.reasoning || undefined;
      assistant.sources = ctx.sources;
      if (result.content.trim() === "") assistant.error = "Leere Antwort vom Chat-LLM — Endpoint/Modell in den Settings prüfen.";
      return { sources: ctx.sources };
```

- [ ] **Step 4: Test laufen lassen → grün**

Run: `npx vitest run tests/chat_session.test.ts`
Expected: PASS (alle its inkl. der zwei neuen).

- [ ] **Step 5: Commit**

```bash
git add src/chat_client.ts src/chat_session.ts tests/chat_session.test.ts
git commit -m "feat(chat): ChatSession akkumuliert reasoning ephemer (nie ans LLM zurück)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `ChatView` rendert den Gedanken-Block + CSS

**Files:**
- Modify: `src/chat_view.ts:97-125` (`startWorking`-Tick + `renderMessages`)
- Modify: `styles.css` (Reasoning-Block-Styles)
- Test: `tests/chat_view.test.ts` (drei neue its)

**Interfaces:**
- Consumes: `ChatMessage.reasoning?: string` (Task 4).
- Produces: `<details class="vault-rag-chat-reasoning">` mit `.open` ⟺ live; Summary `vault-rag-chat-reasoning-sum`; Body `vault-rag-chat-reasoning-body`.

- [ ] **Step 1: Failing tests schreiben**

Ergänze in `tests/chat_view.test.ts` am Ende des `describe("ChatView")` (vor der schließenden `});`) drei its:

```ts
  it("rendert aufklappbaren Gedanken-Block, zugeklappt wenn Antwort da", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    session.messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "Antwort", reasoning: "weil X" },
    ];
    (view as any).renderMessages();
    const blocks = all(view.contentEl, "vault-rag-chat-reasoning");
    expect(blocks.length).toBe(1);
    expect(blocks[0].open).toBe(false);
    expect(all(view.contentEl, "vault-rag-chat-reasoning-body")[0].textContent).toBe("weil X");
    expect(all(view.contentEl, "vault-rag-chat-reasoning-sum")[0].textContent).toContain("Gedanken");
  });
  it("Gedanken-Block ist offen + 'denkt nach' während des Denkens", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    session.messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "", reasoning: "denke gerade" },
    ];
    (view as any).renderMessages();
    expect(all(view.contentEl, "vault-rag-chat-reasoning")[0].open).toBe(true);
    expect(all(view.contentEl, "vault-rag-chat-reasoning-sum")[0].textContent).toContain("denkt nach");
  });
  it("kein Gedanken-Block ohne reasoning", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    session.messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "Antwort" },
    ];
    (view as any).renderMessages();
    expect(all(view.contentEl, "vault-rag-chat-reasoning").length).toBe(0);
  });
```

- [ ] **Step 2: Test laufen lassen → schlägt fehl**

Run: `npx vitest run tests/chat_view.test.ts`
Expected: FAIL (kein `vault-rag-chat-reasoning`-Element).

- [ ] **Step 3: `renderMessages` + Tick implementieren**

Ersetze `renderMessages` (`src/chat_view.ts:112-125`) durch:

```ts
  private renderMessages(): void {
    const el = this.messagesEl; if (!el) return; el.empty();
    const msgs = this.deps.session.messages;
    const last = msgs[msgs.length - 1];
    for (const m of msgs) {
      if (m.role === "assistant" && m.reasoning) {
        const live = m === last && m.content === "" && !m.error;
        const det = el.createEl("details", { cls: "vault-rag-chat-reasoning" }) as HTMLDetailsElement;
        det.open = live;
        det.createEl("summary", { cls: "vault-rag-chat-reasoning-sum", text: live ? "💭 denkt nach…" : "💭 Gedanken" });
        det.createDiv({ cls: "vault-rag-chat-reasoning-body", text: m.reasoning });
      }
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
```

Ersetze in `startWorking` (`src/chat_view.ts:97-103`) die `tick`-Definition durch eine phasenbewusste:

```ts
  private startWorking(): void {
    const el = this.workingEl; if (!el) return;
    this.workStart = Date.now();
    const tick = () => {
      const msgs = this.deps.session.messages;
      const live = msgs[msgs.length - 1];
      const thinking = !!live && live.role === "assistant" && live.content === "" && !!(live.reasoning ?? "");
      const phase = thinking ? "denkt nach" : "generiert";
      el.setText(`● ${phase}… ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
    };
    tick();
    this.timer = window.setInterval(tick, 100);
  }
```

- [ ] **Step 4: Test laufen lassen → grün**

Run: `npx vitest run tests/chat_view.test.ts`
Expected: PASS (alle its inkl. der drei neuen).

- [ ] **Step 5: CSS ergänzen**

Füge an `styles.css` an:

```css
.vault-rag-chat-reasoning { font-size: 12px; margin: 2px 0; }
.vault-rag-chat-reasoning-sum { color: var(--text-muted); cursor: pointer; }
.vault-rag-chat-reasoning-body { color: var(--text-faint); white-space: pre-wrap; font-style: italic; padding: 4px 0 4px 12px; border-left: 2px solid var(--background-modifier-border); }
```

- [ ] **Step 6: Volle Suite + Build + Typecheck**

Run: `npm test && npm run build && npx tsc --noEmit`
Expected: alle Tests grün, Build erzeugt `main.js`, `tsc` ohne Fehler.

- [ ] **Step 7: Commit**

```bash
git add src/chat_view.ts styles.css tests/chat_view.test.ts
git commit -m "feat(chat): Gedanken-Block (aufklappbar, live-offen) + phasenbewusster Timer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec-Coverage:**
- „beide Kanäle" → Task 1 (`reasoning_content`) + Task 2/3 (`<think>` via ThinkSplitter in stream). ✓
- „aufklappbar, live offen, auto-zu" → Task 5 (`det.open = live`). ✓
- „phasenbewusster Timer" → Task 5 (`startWorking`-Tick). ✓
- „Reasoning nie ans LLM zurück" → Task 4 (History-Aufbau unverändert + Test). ✓
- „ephemer am ChatMessage" → Task 4 (`reasoning?`). ✓
- „kein Settings-Toggle / keine Pro-Block-Dauer" → nicht eingeplant (bewusst). ✓
- Edge: normales Modell ohne Reasoning → kein Block (Task 5 dritter Test). ✓ Empty-Content+Reasoning → Guard auf `result.content` (Task 4). ✓

**Placeholder-Scan:** kein TBD/TODO; jeder Code-Step zeigt vollständigen Code.

**Typ-Konsistenz:** `parseSSE` → `{content[], reasoning[], rest, done}` (T1) konsistent in `stream` (T3); `stream` → `{content, reasoning}` (T3) konsistent in `ChatSession` (T4); `ChatMessage.reasoning?` (T4) konsistent in `ChatView` (T5); CSS-Klassen `vault-rag-chat-reasoning(-sum/-body)` konsistent zwischen T5-Code und -Tests.

**Reihenfolge-Hinweis:** Nach T1/T3 sind zwischenzeitlich andere Test-Dateien rot (alte Signaturen) — in den jeweiligen Steps explizit als erwartet vermerkt; volle Suite ist erst nach T5/Step 6 wieder grün.
