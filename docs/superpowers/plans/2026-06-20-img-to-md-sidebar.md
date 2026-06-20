# IMG→MD-Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine eigene Obsidian-Sidebar-View für interaktives IMG→MD: erkannte Bilder als Checkbox-Liste, live streamende Transkription pro Bild mit optionalem Gedanken-Block, bewusstes Schreiben (pro Karte + „Alle anlegen").

**Architecture:** Bottom-up. Zuerst der geteilte SSE-Transport (`sse.ts`) als Fundament, dann der streamende Vision-Call, dann der geteilte Schreiber + die reine View-State-Logik, zuletzt die View + das Wiring. Jede Stufe ist grün, bevor die nächste beginnt. View ohne direktes `fetch`/`app.*` — alles über injizierte Closures (headless testbar).

**Tech Stack:** TypeScript (strict, `noImplicitAny`), esbuild (cjs, externals `obsidian`/`electron`), vitest + happy-dom, Obsidian Plugin API, OpenAI-kompatibler lokaler Endpoint (LM Studio/MLX).

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen (Tests dürfen `as any` nutzen wie bestehend).
- **Alle Tests grün nach jeder Änderung** — `npm test` (vitest run). Wächter: `tests/chat_client.test.ts` muss nach dem `streamSSE`-Refactor unverändert grün bleiben.
- **Commits:** Conventional Commits (`feat/fix/refactor/test(scope): …`), deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **View-Vertrag:** kein `fetch`/`app.*` in der View; Vision-Zugriffe als Closures aus `main.ts`. `onClose` cleart alle Timer.
- **`transcribed_by`** kommt aus `response.model` (Streaming: erster SSE-Chunk), Fallback Konstruktor-`model`.
- **Index-Format / bestehende Verträge** unangetastet. `VisionClient.transcribe` (non-stream) bleibt verhaltensgleich.
- **CSS-Klassen** der Sidebar unter eigenem Präfix `vault-rag-img-*` (keine `ctx-`/`chat-`-Kollision).
- Typecheck: `npx tsc --noEmit`. Build: `npm run build`.

---

### Task 1: `parseSSE` nach `sse.ts` umziehen + `model`-Feld

**Files:**
- Create: `src/sse.ts`
- Modify: `src/chat_client.ts` (parseSSE entfernen, aus `./sse` importieren)
- Create: `tests/sse.test.ts`
- Modify: `tests/chat_client.test.ts` (parseSSE-Import + parseSSE-`describe` entfernen — wandert nach `sse.test.ts`)

**Interfaces:**
- Produces: `parseSSE(buffer: string): { content: string[]; reasoning: string[]; model?: string; rest: string; done: boolean }`

- [ ] **Step 1: `src/sse.ts` mit `parseSSE` (inkl. `model`) anlegen**

```ts
/** Akkumuliert OpenAI-SSE-Deltas (content + reasoning_content) aus einem (Teil-)Buffer;
 *  unvollständige letzte Zeile → rest. `model` = erstes im Buffer gesehenes Chunk-`model`-Feld.
 *  Reine Funktion — kein Zustand. */
export function parseSSE(buffer: string): { content: string[]; reasoning: string[]; model?: string; rest: string; done: boolean } {
  const content: string[] = [];
  const reasoning: string[] = [];
  let model: string | undefined;
  let done = false;
  const lines = buffer.split(/\r\n|\n|\r/);
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "[DONE]") { done = true; continue; }
    try {
      const j = JSON.parse(data) as { model?: string; choices?: { delta?: { content?: string; reasoning_content?: string } }[] };
      if (model === undefined && typeof j.model === "string") model = j.model;
      const d = j.choices?.[0]?.delta;
      if (typeof d?.content === "string") content.push(d.content);
      if (typeof d?.reasoning_content === "string") reasoning.push(d.reasoning_content);
    } catch { /* unvollständig — sollte bei kompletten Zeilen nicht passieren */ }
  }
  return { content, reasoning, model, rest, done };
}
```

- [ ] **Step 2: `tests/sse.test.ts` mit den (umgezogenen + erweiterten) parseSSE-Tests anlegen**

```ts
import { describe, it, expect } from "vitest";
import { parseSSE } from "../src/sse";

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
  it("liest model aus dem Chunk (erstes Vorkommen)", () => {
    const r = parseSSE('data: {"model":"qwen2-vl","choices":[{"delta":{"content":"a"}}]}\ndata: {"model":"andere","choices":[{"delta":{"content":"b"}}]}\n');
    expect(r.model).toBe("qwen2-vl");
  });
  it("model ist undefined ohne model-Feld", () => {
    expect(parseSSE('data: {"choices":[{"delta":{"content":"a"}}]}\n').model).toBeUndefined();
  });
});
```

- [ ] **Step 3: In `src/chat_client.ts` die lokale `parseSSE`-Definition entfernen und aus `./sse` importieren**

Ersetze die Zeile `import { ThinkSplitter } from "./think_splitter";` durch:

```ts
import { ThinkSplitter } from "./think_splitter";
import { parseSSE } from "./sse";
```

Lösche den kompletten `parseSSE`-Block (die `export function parseSSE(...) { … }` samt JSDoc, aktuell Zeilen 5–26). `ChatClient.stream` ruft `parseSSE` weiterhin — jetzt aus dem Import. Sonst nichts ändern.

- [ ] **Step 4: In `tests/chat_client.test.ts` den parseSSE-Import und den parseSSE-`describe`-Block entfernen**

Ändere Zeile 2 von `import { parseSSE, ChatClient } from "../src/chat_client";` zu:

```ts
import { ChatClient } from "../src/chat_client";
```

Lösche den gesamten `describe("parseSSE", () => { … });`-Block (aktuell Zeilen 13–43). Die `ChatClient`-Tests bleiben unverändert.

- [ ] **Step 5: Tests laufen lassen — alles grün**

Run: `npx vitest run tests/sse.test.ts tests/chat_client.test.ts`
Expected: PASS (parseSSE-Tests in `sse.test.ts`, ChatClient-Tests unverändert grün).

- [ ] **Step 6: Commit**

```bash
git add src/sse.ts src/chat_client.ts tests/sse.test.ts tests/chat_client.test.ts
git commit -F- <<'EOF'
refactor(sse): parseSSE nach src/sse.ts ziehen + model-Feld

Fundament für den geteilten Streaming-Transport. parseSSE liest zusätzlich
das Chunk-model-Feld (erstes Vorkommen) für transcribed_by beim Streamen.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: `streamSSE` + `ChatClient.stream` darauf umstellen

**Files:**
- Modify: `src/sse.ts` (streamSSE hinzufügen)
- Modify: `src/chat_client.ts:73-120` (`stream` delegiert an `streamSSE`)
- Modify: `tests/sse.test.ts` (streamSSE-Tests)

**Interfaces:**
- Consumes: `parseSSE` (Task 1), `ThinkSplitter` (`./think_splitter`)
- Produces: `streamSSE(res, onContent: (t:string)=>void, onReasoning: (t:string)=>void): Promise<{ content: string; reasoning: string; model: string }>` — erwartet eine bereits geprüfte (`res.ok`) Response; liest den Body, drained Multibyte/Tag-Rest am Ende.

- [ ] **Step 1: streamSSE-Tests in `tests/sse.test.ts` ergänzen (mit Stream-Mock)**

Am Anfang von `tests/sse.test.ts` den Import erweitern und einen Stream-Mock-Helper ergänzen:

```ts
import { describe, it, expect } from "vitest";
import { parseSSE, streamSSE } from "../src/sse";

function streamRes(chunks: string[]): any {
  let i = 0;
  return { ok: true, status: 200, body: { getReader: () => ({
    read: async () => i < chunks.length
      ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
      : { done: true, value: undefined },
  }) } };
}
```

Dann am Ende der Datei:

```ts
describe("streamSSE", () => {
  it("akkumuliert content + ruft onContent pro Delta", async () => {
    const got: string[] = [];
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
    ]), t => got.push(t), () => {});
    expect(got).toEqual(["Hal", "lo"]);
    expect(r.content).toBe("Hallo");
    expect(r.reasoning).toBe("");
  });
  it("routet reasoning_content an onReasoning", async () => {
    const reasoning: string[] = [];
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, t => reasoning.push(t));
    expect(reasoning.join("")).toBe("den");
    expect(r).toMatchObject({ content: "A", reasoning: "den" });
  });
  it("zieht inline <think> in den reasoning-Kanal", async () => {
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"content":"<think>weil</think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, () => {});
    expect(r).toMatchObject({ content: "Antwort", reasoning: "weil" });
  });
  it("verliert keinen Tag-Rest am Stream-Ende (flush)", async () => {
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"content":"Ende <"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, () => {});
    expect(r.content).toBe("Ende <");
  });
  it("liefert model aus dem ersten Chunk", async () => {
    const r = await streamSSE(streamRes([
      'data: {"model":"qwen2-vl","choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, () => {});
    expect(r.model).toBe("qwen2-vl");
  });
  it("model ist '' ohne model-Feld", async () => {
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, () => {});
    expect(r.model).toBe("");
  });
});
```

- [ ] **Step 2: Tests laufen lassen — streamSSE fehlt**

Run: `npx vitest run tests/sse.test.ts`
Expected: FAIL — `streamSSE is not a function` / Importfehler.

- [ ] **Step 3: `streamSSE` in `src/sse.ts` implementieren**

Oben den Import ergänzen und die Funktion unter `parseSSE` anhängen:

```ts
import { ThinkSplitter } from "./think_splitter";
```

```ts
/** Liest einen OpenAI-kompatiblen SSE-Stream aus einer bereits geprüften Response (res.ok).
 *  Ruft onContent/onReasoning pro Delta; trennt inline <think> via ThinkSplitter; drained am
 *  Ende TextDecoder-Multibyte + Splitter-Rest. Gibt das Akkumulat + das erste Chunk-model zurück. */
export async function streamSSE(
  res: { body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } },
  onContent: (t: string) => void,
  onReasoning: (t: string) => void,
): Promise<{ content: string; reasoning: string; model: string }> {
  const reader = (res as unknown as { body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } }).body.getReader();
  const dec = new TextDecoder();
  const splitter = new ThinkSplitter();
  let buffer = "", content = "", reasoning = "", model = "";
  const emit = (c: string, r: string) => {
    if (c) { content += c; onContent(c); }
    if (r) { reasoning += r; onReasoning(r); }
  };
  const drain = (p: { content: string[]; reasoning: string[]; model?: string }) => {
    if (!model && p.model) model = p.model;
    for (const r of p.reasoning) emit("", r);
    for (const c of p.content) { const s = splitter.push(c); emit(s.content, s.reasoning); }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const p = parseSSE(buffer);
    buffer = p.rest;
    drain(p);
    if (p.done) break;
  }
  // Stream-Ende drainen: TextDecoder leeren (Multibyte über die letzte Chunk-Grenze)
  // + ThinkSplitter-Rest flushen — sonst gingen letzte Zeichen/ein angefangenes Tag verloren.
  buffer += dec.decode();
  drain(parseSSE(buffer));
  const tail = splitter.flush();
  emit(tail.content, tail.reasoning);
  return { content, reasoning, model };
}
```

- [ ] **Step 4: streamSSE-Tests grün**

Run: `npx vitest run tests/sse.test.ts`
Expected: PASS.

- [ ] **Step 5: `ChatClient.stream` auf `streamSSE` umstellen**

In `src/chat_client.ts` den Import ergänzen:

```ts
import { parseSSE, streamSSE } from "./sse";
```

Ersetze den Methoden-Rumpf von `stream` (ab `const reader = …` bis `return { content, reasoning };`, aktuell Zeilen 92–119) durch die Delegation. Die Methode lautet danach komplett:

```ts
  async stream(
    messages: ChatMessage[],
    onContent: (t: string) => void,
    onReasoning: (t: string) => void,
    signal?: AbortSignal,
    opts?: { model?: string; temperature?: number },
  ): Promise<{ content: string; reasoning: string }> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts?.model ?? this.model,
        messages,
        stream: true,
        ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Chat HTTP ${res.status}`);
    const { content, reasoning } = await streamSSE(res, onContent, onReasoning);
    return { content, reasoning };
  }
```

Hinweis: `parseSSE` wird in `chat_client.ts` jetzt nicht mehr direkt benutzt — falls der Import-Linter meckert, `parseSSE` aus dem Import entfernen (`import { streamSSE } from "./sse";`). `ThinkSplitter`-Import wird ebenfalls nicht mehr gebraucht und kann entfernt werden.

- [ ] **Step 6: Voller Lauf — Wächter grün**

Run: `npx vitest run tests/sse.test.ts tests/chat_client.test.ts`
Expected: PASS — insbesondere `stream verliert keinen Tag-Rest am Stream-Ende (splitter flush)` und alle Streaming-Tests unverändert grün.

- [ ] **Step 7: Commit**

```bash
git add src/sse.ts src/chat_client.ts tests/sse.test.ts
git commit -F- <<'EOF'
refactor(sse): streamSSE-Transport extrahieren, ChatClient.stream nutzt ihn

Reader-Loop + Multibyte-Drain + ThinkSplitter einmal in streamSSE; gibt
zusätzlich das model zurück. ChatClient.stream baut nur noch Body + fetch
+ ok-Check und delegiert das Body-Lesen. Verhalten unverändert.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: `VisionClient.transcribeStream` (+ geteilter Message-Bau)

**Files:**
- Modify: `src/vision_client.ts`
- Modify: `tests/vision_client.test.ts`

**Interfaces:**
- Consumes: `streamSSE` (Task 2)
- Produces: `VisionClient.transcribeStream(dataUrl: string, prompt: string, onContent: (t:string)=>void, onReasoning: (t:string)=>void, signal?: AbortSignal): Promise<{ content: string; reasoning: string; model: string }>`

- [ ] **Step 1: Tests für `transcribeStream` in `tests/vision_client.test.ts` ergänzen**

Import erweitern und Stream-Mock-Helper ergänzen (oben in der Datei):

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { VisionClient } from "../src/vision_client";

function streamRes(chunks: string[], ok = true, status = 200): any {
  let i = 0;
  return { ok, status, body: { getReader: () => ({
    read: async () => i < chunks.length
      ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
      : { done: true, value: undefined },
  }) } };
}
```

Dann neuen `describe`-Block anhängen:

```ts
describe("VisionClient.transcribeStream", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("streamt content-Deltas und liefert {content,reasoning,model}", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"model":"qwen2-vl","choices":[{"delta":{"content":"# Ti"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"tel"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const got: string[] = [];
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", t => got.push(t), () => {});
    expect(got).toEqual(["# Ti", "tel"]);
    expect(r).toEqual({ content: "# Titel", reasoning: "", model: "qwen2-vl" });
  });
  it("Fallback auf Konstruktor-Modell ohne model im Stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {});
    expect(r.model).toBe("vm");
  });
  it("schickt multimodalen Body mit stream:true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamRes(['data: [DONE]\n\n']));
    vi.stubGlobal("fetch", fetchMock);
    await new VisionClient("http://x", "vm").transcribeStream("data:image/png;base64,AA", "Transkribiere", () => {}, () => {});
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.model).toBe("vm");
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Transkribiere" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
    ]);
  });
  it("wirft bei HTTP-Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([], false, 500)));
    await expect(new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {})).rejects.toThrow("500");
  });
});
```

- [ ] **Step 2: Tests laufen — `transcribeStream` fehlt**

Run: `npx vitest run tests/vision_client.test.ts`
Expected: FAIL — `transcribeStream is not a function`.

- [ ] **Step 3: `src/vision_client.ts` implementieren (geteilter Message-Bau + streamende Variante)**

Komplette neue Datei:

```ts
import { streamSSE } from "./sse";

export class VisionClient {
  constructor(private endpoint: string, private model: string) {}

  /** Multimodale Nachricht (Text-Prompt + Bild als image_url-Data-URL). */
  private buildMessages(dataUrl: string, prompt: string) {
    return [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }];
  }

  /** Non-streaming /v1/chat/completions-Call. Modell autoritativ aus der Response. */
  async transcribe(dataUrl: string, prompt: string, signal?: AbortSignal): Promise<{ content: string; model: string }> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages: this.buildMessages(dataUrl, prompt), stream: false }),
      signal,
    });
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
    const j = await res.json() as { model?: string; choices?: { message?: { content?: string } }[] };
    return { content: j.choices?.[0]?.message?.content ?? "", model: j.model ?? this.model };
  }

  /** Streamende Variante für die Sidebar: liefert content+reasoning live, plus das Modell
   *  aus dem ersten SSE-Chunk (Fallback: Konstruktor-Modell). */
  async transcribeStream(
    dataUrl: string, prompt: string,
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<{ content: string; reasoning: string; model: string }> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages: this.buildMessages(dataUrl, prompt), stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
    const r = await streamSSE(res, onContent, onReasoning);
    return { content: r.content, reasoning: r.reasoning, model: r.model || this.model };
  }
}
```

- [ ] **Step 4: Tests grün (alte + neue)**

Run: `npx vitest run tests/vision_client.test.ts`
Expected: PASS — die bestehenden `transcribe`-Tests (stream:false, content-Array, model aus Response) **und** die neuen `transcribeStream`-Tests.

- [ ] **Step 5: Commit**

```bash
git add src/vision_client.ts tests/vision_client.test.ts
git commit -F- <<'EOF'
feat(vision): transcribeStream (streamende Transkription) via streamSSE

Neue streamende Variante für die IMG→MD-Sidebar; teilt den multimodalen
Message-Bau mit transcribe (non-stream, unverändert). Modell aus dem ersten
SSE-Chunk, Fallback Konstruktor-Modell.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: `transcriptNotePath` (reine Platzierungsregel)

**Files:**
- Modify: `src/img_to_md.ts` (Helper exportieren)
- Modify: `tests/img_to_md.test.ts`

**Interfaces:**
- Produces: `transcriptNotePath(io: { noteExists(p: string): boolean }, sourcePath: string, imagePath: string): string`

- [ ] **Step 1: Test in `tests/img_to_md.test.ts` ergänzen**

Import-Zeile erweitern (Zeile 2):

```ts
import { findImageEmbeds, buildTranscriptNote, replaceEmbed, uniqueNotePath, transcriptNotePath, runImgToMd, SUPPORTED_EXTS } from "../src/img_to_md";
```

Neuen `describe`-Block (z.B. nach `uniqueNotePath`) ergänzen:

```ts
describe("transcriptNotePath", () => {
  it("legt neben die Quellnotiz, Basename des Bildes, Kollisions-Suffix", () => {
    const exists = new Set(["dir/foto.md"]);
    const io = { noteExists: (p: string) => exists.has(p) };
    expect(transcriptNotePath(io, "dir/quelle.md", "dir/img/foto.png")).toBe("dir/foto-2.md");
    expect(transcriptNotePath(io, "quelle.md", "foto.png")).toBe("foto.md");
  });
});
```

- [ ] **Step 2: Test laufen — Funktion fehlt**

Run: `npx vitest run tests/img_to_md.test.ts -t transcriptNotePath`
Expected: FAIL — `transcriptNotePath is not a function`.

- [ ] **Step 3: `transcriptNotePath` in `src/img_to_md.ts` ergänzen**

Direkt nach `uniqueNotePath` (vor `dirOf`/`basenameNoExt` — diese müssen oberhalb stehen; sie sind aktuell unter `uniqueNotePath` definiert, daher die neue Funktion **nach** `basenameNoExt` einfügen, am besten direkt vor `ImgToMdIO`):

```ts
/** Pfad für die Transkript-Notiz: neben der Quellnotiz, Basename des Bildes, kollisionsfrei. */
export function transcriptNotePath(io: { noteExists(p: string): boolean }, sourcePath: string, imagePath: string): string {
  return uniqueNotePath(io, dirOf(sourcePath), basenameNoExt(imagePath));
}
```

- [ ] **Step 4: Test grün**

Run: `npx vitest run tests/img_to_md.test.ts`
Expected: PASS (neuer Block + alle bestehenden).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -F- <<'EOF'
refactor(img-to-md): transcriptNotePath als reine Platzierungsregel

Kapselt dir/basename/uniqueNotePath, damit Command und Sidebar Notizen
identisch platzieren.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: `writeTranscripts` (geteilter batched Schreiber) + `runImgToMd`-Refactor

**Files:**
- Modify: `src/img_to_md.ts`
- Modify: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: `transcriptNotePath`, `buildTranscriptNote`, `replaceEmbed`, `ImgToMdIO` (alle vorhanden)
- Produces: `writeTranscripts(io: ImgToMdIO, sourcePath: string, entries: { raw: string; link: string; content: string; model: string }[]): Promise<{ paths: string[] }>`

- [ ] **Step 1: Tests für `writeTranscripts` in `tests/img_to_md.test.ts` ergänzen**

Import erweitern um `writeTranscripts`:

```ts
import { findImageEmbeds, buildTranscriptNote, replaceEmbed, uniqueNotePath, transcriptNotePath, writeTranscripts, runImgToMd, SUPPORTED_EXTS } from "../src/img_to_md";
```

Neuer `describe`-Block (nutzt das vorhandene `fakeIO`):

```ts
describe("writeTranscripts", () => {
  it("batched: legt Notizen an, ersetzt Embeds, schreibt Quelle einmal", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "a ![[foto.jpg]] b ![[bild.png]]"]] });
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[foto.jpg]]", link: "foto.jpg", content: "# A", model: "vm" },
      { raw: "![[bild.png]]", link: "bild.png", content: "# B", model: "vm" },
    ]);
    expect(r.paths).toEqual(["foto.md", "bild.md"]);
    expect(created["foto.md"]).toContain("# A");
    expect(created["foto.md"]).toContain('transcribed_by: "vm"');
    expect(notes.get("q.md")).toBe("a ![[foto]] b ![[bild]]");
  });
  it("leeres Transkript → diese Notiz wird übersprungen", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"]] });
    const r = await writeTranscripts(io, "q.md", [{ raw: "![[foto.jpg]]", link: "foto.jpg", content: "   ", model: "vm" }]);
    expect(r.paths).toEqual([]);
    expect(Object.keys(created)).toEqual([]);
    expect(notes.get("q.md")).toBe("![[foto.jpg]]");   // unverändert, kein Write
  });
  it("Kollision über mehrere Entries → Zähler (sequenzielle createNote sichtbar)", async () => {
    const { io } = fakeIO({ notes: [["q.md", "![[a/foto.jpg]] ![[b/foto.jpg]]"]], resolveImage: (link: string) => ({ path: link, ext: "jpg" }) });
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[a/foto.jpg]]", link: "a/foto.jpg", content: "A", model: "m" },
      { raw: "![[b/foto.jpg]]", link: "b/foto.jpg", content: "B", model: "m" },
    ]);
    expect(r.paths).toEqual(["foto.md", "foto-2.md"]);
  });
});
```

- [ ] **Step 2: Tests laufen — Funktion fehlt**

Run: `npx vitest run tests/img_to_md.test.ts -t writeTranscripts`
Expected: FAIL — `writeTranscripts is not a function`.

- [ ] **Step 3: `writeTranscripts` in `src/img_to_md.ts` implementieren**

Nach `transcriptNotePath` einfügen:

```ts
/** Schreibt mehrere Transkripte gebündelt: Quelle EINMAL lesen, pro Eintrag Notiz anlegen
 *  + Embed ersetzen (akkumuliert), Quelle EINMAL schreiben. Leere Transkripte werden
 *  übersprungen. Nicht-destruktiv/idempotent; keine Read-Modify-Write-Race. */
export async function writeTranscripts(
  io: ImgToMdIO, sourcePath: string,
  entries: { raw: string; link: string; content: string; model: string }[],
): Promise<{ paths: string[] }> {
  const before = await io.readNote(sourcePath);
  let content = before;
  const sourceName = basenameNoExt(sourcePath);
  const paths: string[] = [];
  for (const e of entries) {
    const transcript = e.content.trim();
    if (!transcript) continue;
    const resolved = io.resolveImage(e.link, sourcePath);
    const imagePath = resolved?.path ?? e.link;
    const newPath = transcriptNotePath(io, sourcePath, imagePath);
    await io.createNote(newPath, buildTranscriptNote({ imageLink: e.link, sourceName, date: io.date(), model: e.model, transcript }));
    content = replaceEmbed(content, e.raw, basenameNoExt(newPath));
    paths.push(newPath);
  }
  if (content !== before) await io.writeNote(sourcePath, content);
  return { paths };
}
```

- [ ] **Step 4: `runImgToMd` auf `writeTranscripts` umstellen**

Ersetze den Rumpf ab `const sourceName = basenameNoExt(sourcePath);` bis zum `return`-Ende (aktuell Zeilen 89–113) durch:

```ts
  let skipped = 0;
  const entries: { raw: string; link: string; content: string; model: string }[] = [];
  for (let i = 0; i < embeds.length; i++) {
    const e = embeds[i];
    const resolved = io.resolveImage(e.link, sourcePath);
    if (!resolved) { io.notify(`Bild nicht gefunden: ${e.link}`); skipped++; continue; }
    if (!SUPPORTED_EXTS.includes(resolved.ext.toLowerCase())) { io.notify(`Format .${resolved.ext} nicht unterstützt (HEIC? iOS auf „Maximal kompatibel"): ${e.link}`); skipped++; continue; }
    io.notify(`Transkribiere Bild ${i + 1}/${embeds.length}…`);
    let res: { content: string; model: string };
    try {
      const dataUrl = await io.readImageDataUrl(resolved.path, resolved.ext);
      res = await io.transcribe(dataUrl);
    } catch (err) { io.notify(`Transkription fehlgeschlagen (${e.link}): ${err instanceof Error ? err.message : String(err)}`); skipped++; continue; }
    if (!res.content.trim()) { io.notify(`Leeres Transkript: ${e.link}`); skipped++; continue; }
    entries.push({ raw: e.raw, link: e.link, content: res.content, model: res.model });
  }
  const { paths } = await writeTranscripts(io, sourcePath, entries);
  io.notify(`${paths.length} Bild(er) transkribiert${skipped ? `, ${skipped} übersprungen` : ""}.`);
  return { transcribed: paths.length, skipped };
```

(Die nun unbenutzten lokalen `const dir = …` / `let updated = …` / `let transcribed = 0` entfallen — sie sind im ersetzten Block enthalten.)

- [ ] **Step 5: Voller img_to_md-Lauf grün (Refactor verhaltensgleich)**

Run: `npx vitest run tests/img_to_md.test.ts`
Expected: PASS — alle bestehenden `runImgToMd`-Tests (Happy-Path, keine Bilder, heic-skip, leeres Transkript, Fehler, onlyRaw, Kollision, Duplikat-Embeds) **und** die neuen `writeTranscripts`-Tests.

- [ ] **Step 6: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -F- <<'EOF'
refactor(img-to-md): geteilter batched writeTranscripts; runImgToMd nutzt ihn

Schreib-Logik (read-once, create+replace, write-once, leer-skip) single-source
und getestet — Command und Sidebar teilen sie. runImgToMd sammelt Transkripte
und schreibt am Ende; Verhalten unverändert (alle Tests grün).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: `img_to_md_state.ts` — reine View-Buchhaltung

**Files:**
- Create: `src/img_to_md_state.ts`
- Create: `tests/img_to_md_state.test.ts`

**Interfaces:**
- Produces:
  - `interface ImgItem { raw: string; link: string; ext: string; supported: boolean }`
  - `type CardStatus = "streaming" | "done" | "error" | "written"`
  - `interface ImgCard { item: ImgItem; index: number; total: number; text: string; reasoning: string; model: string; status: CardStatus; error?: string; writtenPath?: string }`
  - `class ImgToMdState` mit: `items: ImgItem[]`, `cards: ImgCard[]`, `setItems(items)`, `isSelected(link)`, `toggle(link)`, `allSelected()`, `toggleAll()`, `selectedItems()`, `startCards()`, `appendContent(i, t)`, `appendReasoning(i, t)`, `setDone(i)`, `setError(i, msg)`, `markWritten(i, path)`, `doneCardIndices()`, `clearCards()`

- [ ] **Step 1: `tests/img_to_md_state.test.ts` schreiben**

```ts
import { describe, it, expect } from "vitest";
import { ImgToMdState, ImgItem } from "../src/img_to_md_state";

const items: ImgItem[] = [
  { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true },
  { raw: "![[b.jpg]]", link: "b.jpg", ext: "jpg", supported: true },
  { raw: "![[c.heic]]", link: "c.heic", ext: "heic", supported: false },
];

describe("ImgToMdState — Auswahl", () => {
  it("setItems wählt alle unterstützten an, keine unsupported", () => {
    const s = new ImgToMdState(); s.setItems(items);
    expect(s.isSelected("a.png")).toBe(true);
    expect(s.isSelected("b.jpg")).toBe(true);
    expect(s.isSelected("c.heic")).toBe(false);
    expect(s.allSelected()).toBe(true);
  });
  it("toggle kippt unterstützte, ignoriert unsupported", () => {
    const s = new ImgToMdState(); s.setItems(items);
    s.toggle("a.png");
    expect(s.isSelected("a.png")).toBe(false);
    expect(s.allSelected()).toBe(false);
    s.toggle("c.heic");
    expect(s.isSelected("c.heic")).toBe(false);
  });
  it("toggleAll: alle an → alle aus → alle an (nur unterstützte)", () => {
    const s = new ImgToMdState(); s.setItems(items);
    s.toggleAll();
    expect(s.selectedItems()).toEqual([]);
    s.toggleAll();
    expect(s.selectedItems().map(i => i.link)).toEqual(["a.png", "b.jpg"]);
  });
});

describe("ImgToMdState — Karten", () => {
  it("startCards erzeugt Karten für die Auswahl mit index/total", () => {
    const s = new ImgToMdState(); s.setItems(items);
    s.toggle("b.jpg");   // nur a.png ausgewählt
    const cards = s.startCards();
    expect(cards.length).toBe(1);
    expect(cards[0]).toMatchObject({ index: 1, total: 1, status: "streaming", text: "", reasoning: "" });
    expect(cards[0].item.link).toBe("a.png");
  });
  it("append akkumuliert content + reasoning", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();
    s.appendContent(0, "Hal"); s.appendContent(0, "lo");
    s.appendReasoning(0, "weil");
    expect(s.cards[0].text).toBe("Hallo");
    expect(s.cards[0].reasoning).toBe("weil");
  });
  it("setDone: nicht-leer → done, leer → error 'Leeres Transkript'", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();
    s.appendContent(0, "x"); s.setDone(0);
    expect(s.cards[0].status).toBe("done");
    const s2 = new ImgToMdState(); s2.setItems(items); s2.startCards();
    s2.appendContent(0, "   "); s2.setDone(0);
    expect(s2.cards[0].status).toBe("error");
    expect(s2.cards[0].error).toBe("Leeres Transkript");
  });
  it("setError + markWritten setzen Status", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();
    s.setError(0, "Vision HTTP 500");
    expect(s.cards[0]).toMatchObject({ status: "error", error: "Vision HTTP 500" });
    s.markWritten(0, "foto.md");
    expect(s.cards[0]).toMatchObject({ status: "written", writtenPath: "foto.md" });
  });
  it("doneCardIndices liefert nur done-Karten", () => {
    const s = new ImgToMdState();
    s.setItems(items); s.startCards();      // 1 Karte (a.png? nein: beide unterstützten)
    // beide unterstützten ausgewählt → 2 Karten
    expect(s.cards.length).toBe(2);
    s.appendContent(0, "x"); s.setDone(0);
    s.appendContent(1, "y"); s.setDone(1);
    s.markWritten(1, "b.md");
    expect(s.doneCardIndices()).toEqual([0]);
  });
  it("clearCards leert die Karten", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();
    s.clearCards();
    expect(s.cards).toEqual([]);
  });
});
```

- [ ] **Step 2: Tests laufen — Modul fehlt**

Run: `npx vitest run tests/img_to_md_state.test.ts`
Expected: FAIL — Importfehler / `ImgToMdState is not a constructor`.

- [ ] **Step 3: `src/img_to_md_state.ts` implementieren**

```ts
export interface ImgItem { raw: string; link: string; ext: string; supported: boolean }

export type CardStatus = "streaming" | "done" | "error" | "written";

export interface ImgCard {
  item: ImgItem;
  index: number;
  total: number;
  text: string;
  reasoning: string;
  model: string;
  status: CardStatus;
  error?: string;
  writtenPath?: string;
}

/** Reine View-Buchhaltung für die IMG→MD-Sidebar: Bild-Auswahl + Ergebnis-Karten.
 *  Kein DOM, kein I/O — die View rendert daraus, das Wiring liefert die Daten. */
export class ImgToMdState {
  items: ImgItem[] = [];
  cards: ImgCard[] = [];
  private selected = new Set<string>();   // nach link

  setItems(items: ImgItem[]): void {
    this.items = items;
    this.selected = new Set(items.filter(i => i.supported).map(i => i.link));
  }

  isSelected(link: string): boolean { return this.selected.has(link); }

  toggle(link: string): void {
    const it = this.items.find(i => i.link === link);
    if (!it || !it.supported) return;
    if (this.selected.has(link)) this.selected.delete(link); else this.selected.add(link);
  }

  private supported(): ImgItem[] { return this.items.filter(i => i.supported); }

  allSelected(): boolean {
    const s = this.supported();
    return s.length > 0 && s.every(i => this.selected.has(i.link));
  }

  toggleAll(): void {
    if (this.allSelected()) this.selected.clear();
    else this.selected = new Set(this.supported().map(i => i.link));
  }

  selectedItems(): ImgItem[] { return this.supported().filter(i => this.selected.has(i.link)); }

  startCards(): ImgCard[] {
    const sel = this.selectedItems();
    this.cards = sel.map((item, k) => ({
      item, index: k + 1, total: sel.length,
      text: "", reasoning: "", model: "", status: "streaming" as CardStatus,
    }));
    return this.cards;
  }

  appendContent(i: number, t: string): void { const c = this.cards[i]; if (c) c.text += t; }
  appendReasoning(i: number, t: string): void { const c = this.cards[i]; if (c) c.reasoning += t; }

  setDone(i: number): void {
    const c = this.cards[i]; if (!c) return;
    if (c.text.trim()) c.status = "done";
    else { c.status = "error"; c.error = "Leeres Transkript"; }
  }

  setError(i: number, msg: string): void { const c = this.cards[i]; if (c) { c.status = "error"; c.error = msg; } }
  markWritten(i: number, path: string): void { const c = this.cards[i]; if (c) { c.status = "written"; c.writtenPath = path; } }
  doneCardIndices(): number[] { return this.cards.map((c, i) => ({ c, i })).filter(x => x.c.status === "done").map(x => x.i); }
  clearCards(): void { this.cards = []; }
}
```

- [ ] **Step 4: Tests grün**

Run: `npx vitest run tests/img_to_md_state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_state.ts tests/img_to_md_state.test.ts
git commit -F- <<'EOF'
feat(img-to-md): reine View-State-Logik (Auswahl + Karten)

ImgToMdState ohne DOM/I/O: Bild-Auswahl, Toggle-all (nur unterstützte),
Karten mit Delta-Append, Status (streaming/done/error/written).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: `ImgToMdView` — Gerüst, Bild-Liste, Toggle-all

**Files:**
- Create: `src/img_to_md_view.ts`
- Create: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `ImgToMdState`, `ImgItem` (Task 6)
- Produces:
  - `const VIEW_TYPE_IMGMD = "vault-rag-img"`
  - `interface ImgToMdViewDeps { getActivePath: () => string | null; scan: (sourcePath: string) => Promise<ImgItem[]>; transcribeStream: (sourcePath: string, item: ImgItem, onContent: (t:string)=>void, onReasoning: (t:string)=>void, signal: AbortSignal) => Promise<{ content: string; reasoning: string; model: string }>; writeTranscripts: (sourcePath: string, entries: { item: ImgItem; content: string; model: string }[]) => Promise<string[]>; ping: () => Promise<boolean>; listModels: () => Promise<string[]>; getModel: () => string; setModel: (m: string) => void; openPath: (p: string) => void; copyText: (t: string) => void }`
  - `class ImgToMdView extends ItemView` mit public `onOpen()`, `onClose()`, `rescan()`, `refresh()`, `run()`, `writeOne(i)`, `writeAll()`

- [ ] **Step 1: `tests/img_to_md_view.test.ts` (Gerüst + Liste + Toggle) schreiben**

```ts
import { describe, it, expect, vi } from "vitest";
import { ImgToMdView, VIEW_TYPE_IMGMD } from "../src/img_to_md_view";
import { ImgItem } from "../src/img_to_md_state";
import { makeFakeApp } from "./__mocks__/obsidian";

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}

const ITEMS: ImgItem[] = [
  { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true },
  { raw: "![[b.heic]]", link: "b.heic", ext: "heic", supported: false },
];

function mkView(over: any = {}) {
  const calls: any = { written: [], copied: [], opened: [] };
  const deps = {
    getActivePath: over.getActivePath ?? (() => "q.md"),
    scan: over.scan ?? (async () => ITEMS),
    transcribeStream: over.transcribeStream ?? (async (_sp: string, _it: ImgItem, onContent: any) => { onContent("Hal"); onContent("lo"); return { content: "Hallo", reasoning: "", model: "vm" }; }),
    writeTranscripts: over.writeTranscripts ?? (async (_sp: string, entries: any[]) => { calls.written.push(entries); return entries.map((_: any, i: number) => `note-${i}.md`); }),
    ping: over.ping ?? (async () => true),
    listModels: over.listModels ?? (async () => []),
    getModel: over.getModel ?? (() => "vm"),
    setModel: over.setModel ?? vi.fn(),
    openPath: (p: string) => calls.opened.push(p),
    copyText: over.copyText ?? ((t: string) => calls.copied.push(t)),
  };
  const view = new ImgToMdView({ app: makeFakeApp() } as any, deps);
  return { view, calls, deps };
}

describe("ImgToMdView — Gerüst + Liste", () => {
  it("getViewType ist VIEW_TYPE_IMGMD", () => {
    expect(mkView().view.getViewType()).toBe(VIEW_TYPE_IMGMD);
  });
  it("zeigt Verbindungsstatus nach onOpen", async () => {
    const okV = mkView({ ping: async () => true }); await okV.view.onOpen();
    expect(all(okV.view.contentEl, "vault-rag-img-status")[0].textContent).toContain("verbunden");
    const offV = mkView({ ping: async () => false }); await offV.view.onOpen();
    expect(all(offV.view.contentEl, "vault-rag-img-status")[0].textContent).toContain("offline");
  });
  it("listet erkannte Bilder mit Checkbox; unsupported ist disabled", async () => {
    const { view } = mkView(); await view.onOpen();
    const checks = all(view.contentEl, "vault-rag-img-check");
    expect(checks.length).toBe(2);
    expect(checks[0].checked).toBe(true);     // a.png unterstützt + default an
    expect(checks[1].disabled).toBe(true);    // b.heic nicht unterstützt
    expect(checks[1].checked).toBe(false);
  });
  it("Toggle-Button: alle an → 'Alle abwählen', nach Klick 'Alle auswählen'", async () => {
    const { view } = mkView(); await view.onOpen();
    const btn = () => all(view.contentEl, "vault-rag-img-toggle")[0];
    expect(btn().textContent).toBe("Alle abwählen");
    btn().click();
    expect(btn().textContent).toBe("Alle auswählen");
    expect(all(view.contentEl, "vault-rag-img-check")[0].checked).toBe(false);
  });
  it("Modell-Switcher ruft setModel bei Auswahl", async () => {
    const setModel = vi.fn();
    const { view } = mkView({ setModel, listModels: async () => ["x", "y"] });
    await view.onOpen();
    const sel = all(view.contentEl, "vault-rag-img-model")[0];
    sel.value = "y";
    (sel._listeners["change"] ?? []).forEach((cb: any) => cb());
    expect(setModel).toHaveBeenCalledWith("y");
  });
  it("ohne aktive Notiz: leere Liste, Hinweis", async () => {
    const { view } = mkView({ getActivePath: () => null });
    await view.onOpen();
    expect(all(view.contentEl, "vault-rag-img-check").length).toBe(0);
    expect(all(view.contentEl, "vault-rag-img-empty").length).toBe(1);
  });
});
```

- [ ] **Step 2: Tests laufen — View fehlt**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: FAIL — Importfehler.

- [ ] **Step 3: `src/img_to_md_view.ts` — Gerüst, Liste, Toggle, Status, Modell-Switcher**

```ts
import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { ImgToMdState, ImgItem } from "./img_to_md_state";

export const VIEW_TYPE_IMGMD = "vault-rag-img";

export interface ImgToMdViewDeps {
  getActivePath: () => string | null;
  scan: (sourcePath: string) => Promise<ImgItem[]>;
  transcribeStream: (sourcePath: string, item: ImgItem, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal) => Promise<{ content: string; reasoning: string; model: string }>;
  writeTranscripts: (sourcePath: string, entries: { item: ImgItem; content: string; model: string }[]) => Promise<string[]>;
  ping: () => Promise<boolean>;
  listModels: () => Promise<string[]>;
  getModel: () => string;
  setModel: (m: string) => void;
  openPath: (p: string) => void;
  copyText: (t: string) => void;
}

export class ImgToMdView extends ItemView {
  private state = new ImgToMdState();
  private statusEl: HTMLElement | null = null;
  private modelSel: HTMLSelectElement | null = null;
  private listEl: HTMLElement | null = null;
  private cardsEl: HTMLElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private runBtn: HTMLElement | null = null;
  private controller: AbortController | null = null;
  private running = false;

  constructor(leaf: WorkspaceLeaf, private deps: ImgToMdViewDeps) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_IMGMD; }
  getDisplayText(): string { return "IMG → MD"; }
  getIcon(): string { return "scan-text"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl; c.empty(); c.addClass("vault-rag-img-root");
    this.statusEl = c.createDiv({ cls: "vault-rag-img-status" });
    this.statusEl.addEventListener("click", () => void this.refreshStatus());
    this.modelSel = c.createEl("select", { cls: "vault-rag-img-model dropdown" }) as HTMLSelectElement;
    this.modelSel.addEventListener("change", () => this.deps.setModel(this.modelSel?.value ?? ""));
    const head = c.createDiv({ cls: "vault-rag-img-head" });
    this.toggleBtn = head.createEl("button", { cls: "vault-rag-img-toggle", text: "Alle abwählen" });
    this.toggleBtn.addEventListener("click", () => { this.state.toggleAll(); this.renderList(); });
    this.runBtn = head.createEl("button", { cls: "vault-rag-img-run mod-cta", text: "Transkribieren" });
    this.runBtn.addEventListener("click", () => this.onRunClick());
    this.listEl = c.createDiv({ cls: "vault-rag-img-list" });
    this.cardsEl = c.createDiv({ cls: "vault-rag-img-cards" });
    const foot = c.createDiv({ cls: "vault-rag-img-foot" });
    foot.createEl("button", { cls: "vault-rag-img-all", text: "Alle anlegen" }).addEventListener("click", () => void this.writeAll());
    await this.refreshStatus();
    await this.refreshModels();
    await this.rescan();
  }

  async refreshStatus(): Promise<void> {
    const el = this.statusEl; if (!el) return;
    el.setText("Vision-LLM: prüfe…");
    const ok = await this.deps.ping();
    el.setText(ok ? "● Vision-LLM verbunden" : "○ Vision-LLM offline — in den Settings prüfen");
  }

  private async refreshModels(): Promise<void> {
    const sel = this.modelSel; if (!sel) return;
    const cur = this.deps.getModel();
    const models = await this.deps.listModels();
    sel.empty();
    const list = models.includes(cur) ? models : [cur, ...models];
    for (const m of list) { const o = sel.createEl("option", { text: m }) as HTMLOptionElement; o.value = m; }
    sel.value = cur;
  }

  async rescan(): Promise<void> {
    const path = this.deps.getActivePath();
    const items = path ? await this.deps.scan(path) : [];
    this.state.setItems(items);
    this.renderList();
  }

  /** Aktive Notiz gewechselt → Karten der alten Notiz verwerfen + neu scannen. */
  async refresh(): Promise<void> {
    if (this.running) return;
    this.state.clearCards();
    this.renderCards();
    await this.rescan();
  }

  private basename(link: string): string { return link.split("/").pop() ?? link; }

  private renderList(): void {
    const el = this.listEl; if (!el) return; el.empty();
    this.toggleBtn?.setText(this.state.allSelected() ? "Alle abwählen" : "Alle auswählen");
    if (!this.state.items.length) { el.createDiv({ cls: "vault-rag-img-empty", text: "Keine Bilder in dieser Notiz." }); return; }
    for (const item of this.state.items) {
      const row = el.createDiv({ cls: "vault-rag-img-item" });
      const cb = row.createEl("input", { cls: "vault-rag-img-check" }) as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = this.state.isSelected(item.link);
      cb.disabled = !item.supported;
      cb.addEventListener("change", () => { this.state.toggle(item.link); this.renderList(); });
      const label = item.supported ? this.basename(item.link) : `${this.basename(item.link)} — nicht unterstützt`;
      row.createEl("span", { cls: "vault-rag-img-name", text: label });
    }
  }

  private renderCards(): void { /* Task 8 */ const el = this.cardsEl; if (el) el.empty(); }

  private onRunClick(): void { /* Task 8 */ }
  async run(): Promise<void> { /* Task 8 */ }
  async writeOne(_i: number): Promise<void> { /* Task 9 */ }
  async writeAll(): Promise<void> { /* Task 9 */ }

  async onClose(): Promise<void> {
    this.controller?.abort();
    this.contentEl.removeClass("vault-rag-img-root");
  }
}
```

- [ ] **Step 4: Tests grün (Gerüst/Liste/Toggle)**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_view.ts tests/img_to_md_view.test.ts
git commit -F- <<'EOF'
feat(img-to-md): Sidebar-View-Gerüst — Bild-Liste, Checkboxen, Toggle-all

ItemView mit injizierten Closures (headless testbar): Status-Zeile, Vision-
Modell-Switcher, Checkbox-Liste (unsupported disabled), Alle-aus/abwählen.
Streaming + Schreiben folgen in den nächsten Tasks.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: `ImgToMdView` — Transkribieren (Streaming) + Karten

**Files:**
- Modify: `src/img_to_md_view.ts` (`renderCards`, `onRunClick`, `run`)
- Modify: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `deps.transcribeStream`, `ImgToMdState.startCards/appendContent/appendReasoning/setDone/setError`

- [ ] **Step 1: Streaming/Karten-Tests ergänzen**

In `tests/img_to_md_view.test.ts` neuen `describe` anhängen:

```ts
describe("ImgToMdView — Transkribieren", () => {
  it("run streamt in eine Karte, Status done, 'Notiz anlegen' erscheint", async () => {
    const { view } = mkView(); await view.onOpen();
    await view.run();
    const cards = all(view.contentEl, "vault-rag-img-card");
    expect(cards.length).toBe(1);   // nur a.png (b.heic unsupported)
    expect(all(view.contentEl, "vault-rag-img-text")[0].textContent).toBe("Hallo");
    expect(all(view.contentEl, "vault-rag-img-write").length).toBe(1);
  });
  it("Karten-Kopf zeigt 'Bild i/n · name'", async () => {
    const { view } = mkView(); await view.onOpen(); await view.run();
    expect(all(view.contentEl, "vault-rag-img-card-head")[0].textContent).toContain("Bild 1/1");
    expect(all(view.contentEl, "vault-rag-img-card-head")[0].textContent).toContain("a.png");
  });
  it("Kopier-Button kopiert den Transkript-Text", async () => {
    const { view, calls } = mkView(); await view.onOpen(); await view.run();
    all(view.contentEl, "vault-rag-img-copy")[0].click();
    expect(calls.copied).toEqual(["Hallo"]);
  });
  it("Gedanken-Block nur bei reasoning", async () => {
    const noReason = mkView(); await noReason.view.onOpen(); await noReason.view.run();
    expect(all(noReason.view.contentEl, "vault-rag-img-reasoning").length).toBe(0);
    const withReason = mkView({ transcribeStream: async (_sp: string, _it: ImgItem, onC: any, onR: any) => { onR("weil"); onC("Text"); return { content: "Text", reasoning: "weil", model: "vm" }; } });
    await withReason.view.onOpen(); await withReason.view.run();
    expect(all(withReason.view.contentEl, "vault-rag-img-reasoning").length).toBe(1);
  });
  it("Transkriptionsfehler → Karte mit Fehler, kein 'Notiz anlegen'", async () => {
    const { view } = mkView({ transcribeStream: async () => { throw new Error("Vision HTTP 500"); } });
    await view.onOpen(); await view.run();
    expect(all(view.contentEl, "vault-rag-img-error")[0].textContent).toContain("500");
    expect(all(view.contentEl, "vault-rag-img-write").length).toBe(0);
  });
  it("leeres Transkript → Fehler 'Leeres Transkript', kein 'Notiz anlegen'", async () => {
    const { view } = mkView({ transcribeStream: async () => ({ content: "   ", reasoning: "", model: "vm" }) });
    await view.onOpen(); await view.run();
    expect(all(view.contentEl, "vault-rag-img-error")[0].textContent).toContain("Leeres Transkript");
    expect(all(view.contentEl, "vault-rag-img-write").length).toBe(0);
  });
  it("Run-Button wird während des Laufs zu 'Stop'", async () => {
    let release: () => void = () => {};
    const transcribeStream = vi.fn(() => new Promise<{ content: string; reasoning: string; model: string }>(r => { release = () => r({ content: "x", reasoning: "", model: "vm" }); }));
    const { view } = mkView({ transcribeStream });
    await view.onOpen();
    const p = view.run();
    const btn = () => all(view.contentEl, "vault-rag-img-run")[0];
    expect(btn().textContent).toBe("Stop");
    release(); await p;
    expect(btn().textContent).toBe("Transkribieren");
  });
});
```

- [ ] **Step 2: Tests laufen — rot (Stub-Implementierungen)**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: FAIL — Karten/Streaming noch nicht implementiert.

- [ ] **Step 3: `renderCards`, `onRunClick`, `run` implementieren**

Ersetze in `src/img_to_md_view.ts` die drei Stub-Methoden (`renderCards`, `onRunClick`, `run`) durch:

```ts
  private renderCards(): void {
    const el = this.cardsEl; if (!el) return; el.empty();
    for (let i = 0; i < this.state.cards.length; i++) {
      const card = this.state.cards[i];
      const cardEl = el.createDiv({ cls: "vault-rag-img-card" });
      cardEl.createDiv({ cls: "vault-rag-img-card-head", text: `Bild ${card.index}/${card.total} · ${this.basename(card.item.link)}` });
      if (card.reasoning) {
        const live = card.status === "streaming" && card.text === "";
        const det = cardEl.createEl("details", { cls: "vault-rag-img-reasoning" }) as HTMLDetailsElement;
        det.open = live;
        det.createEl("summary", { cls: "vault-rag-img-reasoning-sum", text: live ? "💭 denkt nach…" : "💭 Gedanken" });
        det.createDiv({ cls: "vault-rag-img-reasoning-body", text: card.reasoning });
      }
      if (card.text) cardEl.createDiv({ cls: "vault-rag-img-text", text: card.text });
      if (card.status === "error") cardEl.createDiv({ cls: "vault-rag-img-error", text: card.error ?? "Fehler" });
      if (card.status === "written") {
        const w = cardEl.createDiv({ cls: "vault-rag-img-written", text: `✓ angelegt: ${card.writtenPath}` });
        w.addEventListener("click", () => { if (card.writtenPath) this.deps.openPath(card.writtenPath); });
      }
      if (card.text) {
        const actions = cardEl.createDiv({ cls: "vault-rag-img-card-actions" });
        const copyBtn = actions.createEl("button", { cls: "vault-rag-img-copy clickable-icon", attr: { "aria-label": "Transkript kopieren" } });
        setIcon(copyBtn, "copy");
        copyBtn.addEventListener("click", () => this.deps.copyText(card.text));
        if (card.status === "done") {
          actions.createEl("button", { cls: "vault-rag-img-write", text: "Notiz anlegen" }).addEventListener("click", () => void this.writeOne(i));
        }
      }
    }
  }

  private onRunClick(): void {
    if (this.running) { this.controller?.abort(); return; }
    void this.run();
  }

  async run(): Promise<void> {
    if (this.running) return;
    const path = this.deps.getActivePath();
    if (!path) return;
    const cards = this.state.startCards();
    this.renderCards();
    if (!cards.length) return;
    this.running = true; this.runBtn?.setText("Stop");
    this.controller = new AbortController();
    const signal = this.controller.signal;
    for (let i = 0; i < cards.length; i++) {
      try {
        const r = await this.deps.transcribeStream(
          path, cards[i].item,
          (t) => { this.state.appendContent(i, t); this.renderCards(); },
          (t) => { this.state.appendReasoning(i, t); this.renderCards(); },
          signal,
        );
        cards[i].model = r.model;
        this.state.setDone(i);
      } catch (e) {
        if (signal.aborted) break;   // Stop gedrückt — Rest unten als „Abgebrochen" markieren
        this.state.setError(i, e instanceof Error ? e.message : String(e));
      }
      this.renderCards();
    }
    // Nach Abbruch: noch nicht verarbeitete Karten kennzeichnen.
    for (let i = 0; i < cards.length; i++) if (cards[i].status === "streaming") this.state.setError(i, "Abgebrochen");
    this.running = false; this.runBtn?.setText("Transkribieren");
    this.controller = null;
    this.renderCards();
  }
```

- [ ] **Step 4: Tests grün**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: PASS (Gerüst-Tests aus Task 7 + neue Streaming-Tests).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_view.ts tests/img_to_md_view.test.ts
git commit -F- <<'EOF'
feat(img-to-md): Sidebar-Transkription streamt live in Ergebnis-Karten

run() verarbeitet die angehakten Bilder sequenziell; jede Karte streamt
content (+ optionalen Gedanken-Block), Kopier-Button, Status done/error.
Senden↔Stop-Toggle mit AbortController.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: `ImgToMdView` — Notiz anlegen (einzeln + alle) + Re-Scan

**Files:**
- Modify: `src/img_to_md_view.ts` (`writeOne`, `writeAll`)
- Modify: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `deps.writeTranscripts`, `ImgToMdState.doneCardIndices/markWritten`, `rescan`

- [ ] **Step 1: Schreib-Tests ergänzen**

```ts
describe("ImgToMdView — Notiz anlegen", () => {
  it("'Notiz anlegen' ruft writeTranscripts mit einem Eintrag, Karte → angelegt", async () => {
    const { view, calls } = mkView({ writeTranscripts: async (_sp: string, entries: any[]) => { calls.written.push(entries); return ["foto.md"]; } });
    await view.onOpen(); await view.run();
    all(view.contentEl, "vault-rag-img-write")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0]).toEqual([{ item: ITEMS[0], content: "Hallo", model: "vm" }]);
    expect(all(view.contentEl, "vault-rag-img-written")[0].textContent).toContain("foto.md");
  });
  it("'angelegt'-Zeile öffnet die Notiz per Klick", async () => {
    const { view, calls } = mkView({ writeTranscripts: async () => ["foto.md"] });
    await view.onOpen(); await view.run();
    await view.writeOne(0);
    all(view.contentEl, "vault-rag-img-written")[0].click();
    expect(calls.opened).toEqual(["foto.md"]);
  });
  it("'Alle anlegen' schreibt alle fertigen Karten in einem Batch", async () => {
    const twoItems: ImgItem[] = [
      { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true },
      { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true },
    ];
    const { view, calls } = mkView({ scan: async () => twoItems, writeTranscripts: async (_sp: string, entries: any[]) => { calls.written.push(entries); return entries.map((_: any, i: number) => `n-${i}.md`); } });
    await view.onOpen(); await view.run();
    all(view.contentEl, "vault-rag-img-all")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0].length).toBe(2);
    expect(all(view.contentEl, "vault-rag-img-written").length).toBe(2);
  });
  it("nach Schreiben wird neu gescannt (scan erneut aufgerufen)", async () => {
    const scan = vi.fn(async () => ITEMS);
    const { view } = mkView({ scan, writeTranscripts: async () => ["foto.md"] });
    await view.onOpen();          // scan #1
    await view.run();
    await view.writeOne(0);       // scan #2 (rescan nach Schreiben)
    expect(scan.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Tests laufen — rot**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: FAIL — `writeOne`/`writeAll` sind noch Stubs.

- [ ] **Step 3: `writeOne` + `writeAll` implementieren**

Ersetze die beiden Stub-Methoden:

```ts
  async writeOne(i: number): Promise<void> {
    const path = this.deps.getActivePath();
    const card = this.state.cards[i];
    if (!path || !card || card.status !== "done") return;
    const [created] = await this.deps.writeTranscripts(path, [{ item: card.item, content: card.text.trim(), model: card.model }]);
    if (created) this.state.markWritten(i, created);
    await this.rescan();
    this.renderCards();
  }

  async writeAll(): Promise<void> {
    const path = this.deps.getActivePath();
    if (!path) return;
    const idx = this.state.doneCardIndices();
    if (!idx.length) return;
    const entries = idx.map(i => ({ item: this.state.cards[i].item, content: this.state.cards[i].text.trim(), model: this.state.cards[i].model }));
    const paths = await this.deps.writeTranscripts(path, entries);
    idx.forEach((i, k) => { if (paths[k]) this.state.markWritten(i, paths[k]); });
    await this.rescan();
    this.renderCards();
  }
```

- [ ] **Step 4: Tests grün (voller View-Lauf)**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_view.ts tests/img_to_md_view.test.ts
git commit -F- <<'EOF'
feat(img-to-md): Notiz anlegen (einzeln + alle) + Re-Scan nach Schreiben

writeOne/writeAll nutzen den geteilten writeTranscripts (Batch, write-once);
Karte zeigt „✓ angelegt" (klickbar). Re-Scan nach Schreiben → behandeltes
Bild fällt aus der Liste (kein Doppel-Schreiben).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 10: Wiring in `main.ts` (View registrieren, Deps, Ribbon, Command)

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `ImgToMdView`, `VIEW_TYPE_IMGMD`, `ImgToMdViewDeps` (Task 7); `ImgItem` (Task 6); `findImageEmbeds`, `buildTranscriptNote`, `replaceEmbed`, `transcriptNotePath`, `writeTranscripts`, `SUPPORTED_EXTS` (Tasks 4/5)
- Hinweis: `main.ts` hat keine Unit-Tests — Verifikation über `tsc --noEmit`, `npm test` (Regression) und manuellen Smoke-Test (Task 11).

- [ ] **Step 1: Imports ergänzen**

In `src/main.ts` die bestehenden img-to-md-/vision-Imports erweitern:

```ts
import { runImgToMd, findImageEmbeds, ImgToMdIO, buildTranscriptNote, replaceEmbed, transcriptNotePath, writeTranscripts, SUPPORTED_EXTS } from "./img_to_md";
import { ImgToMdView, VIEW_TYPE_IMGMD, ImgToMdViewDeps } from "./img_to_md_view";
import { ImgItem } from "./img_to_md_state";
```

(Die bisherige Zeile `import { runImgToMd, findImageEmbeds, ImgToMdIO } from "./img_to_md";` wird dadurch ersetzt.)

- [ ] **Step 2: View registrieren + Ribbon + Command (in `onload`, nach dem Chat-Block)**

Direkt nach `this.addCommand({ id: "open-vault-chat", … });` (aktuell Zeile 102) einfügen:

```ts
    this.registerView(VIEW_TYPE_IMGMD, (leaf: WorkspaceLeaf) => new ImgToMdView(leaf, this.makeImgViewDeps()));
    this.addRibbonIcon("scan-text", "IMG → MD", () => this.activateImgMdView());
    this.addCommand({ id: "open-img-md-sidebar", name: "IMG → MD-Sidebar öffnen", callback: () => this.activateImgMdView() });
```

Im bestehenden `active-leaf-change`-Handler (Zeile 123) die Sidebar mit-aktualisieren — ersetze:

```ts
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
```

durch:

```ts
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { this.refresh(); this.refreshImgViews(); }));
```

- [ ] **Step 3: `makeImgViewDeps`, `activateImgMdView`, `refreshImgViews` ergänzen**

Nach `makeImgIO()` (endet Zeile 183) einfügen:

```ts
  private makeImgViewDeps(): ImgToMdViewDeps {
    const visionEndpoint = () => this.settings.visionEndpoint;
    return {
      getActivePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      scan: async (sourcePath: string): Promise<ImgItem[]> => {
        let content: string;
        try { content = await this.app.vault.adapter.read(sourcePath); } catch { return []; }
        const seen = new Set<string>();
        const items: ImgItem[] = [];
        for (const e of findImageEmbeds(content)) {
          if (seen.has(e.link)) continue; seen.add(e.link);
          items.push({ raw: e.raw, link: e.link, ext: e.ext, supported: SUPPORTED_EXTS.includes(e.ext.toLowerCase()) });
        }
        return items;
      },
      transcribeStream: async (sourcePath, item, onContent, onReasoning, signal) => {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(item.link, sourcePath);
        if (!resolved) throw new Error(`Bild nicht gefunden: ${item.link}`);
        const dataUrl = `data:image/${this.mimeOf(resolved.extension)};base64,${arrayBufferToBase64(await this.app.vault.adapter.readBinary(resolved.path))}`;
        return this.visionClient.transcribeStream(dataUrl, this.settings.visionPrompt, onContent, onReasoning, signal);
      },
      writeTranscripts: async (sourcePath, entries) => {
        const { paths } = await writeTranscripts(this.makeImgIO(), sourcePath, entries.map(e => ({ raw: e.item.raw, link: e.item.link, content: e.content, model: e.model })));
        return paths;
      },
      ping: () => new ChatClient(visionEndpoint(), "").ping(),
      listModels: () => new ChatClient(visionEndpoint(), "").listModels(),
      getModel: () => this.settings.visionModel,
      setModel: (m: string) => { this.settings.visionModel = m; void this.saveSettings(); this.reconnectVision(); },
      openPath: this.openPath,
      copyText: (t: string) => { void navigator.clipboard.writeText(t); new Notice("Kopiert"); },
    };
  }

  private refreshImgViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMD)) {
      void (leaf.view as ImgToMdView).refresh();
    }
  }

  async activateImgMdView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMD);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE_IMGMD, active: true });
  }
```

Hinweis: `buildTranscriptNote`, `replaceEmbed`, `transcriptNotePath` werden in `main.ts` nur indirekt über `writeTranscripts` gebraucht — sie müssen NICHT zusätzlich importiert werden. Falls der unbenutzte-Import-Linter anschlägt, im Import aus Step 1 auf die tatsächlich in `main.ts` referenzierten Namen reduzieren (`runImgToMd, findImageEmbeds, ImgToMdIO, writeTranscripts, SUPPORTED_EXTS`).

- [ ] **Step 4: Typecheck + voller Test-Lauf (Regression)**

Run: `npx tsc --noEmit && npm test`
Expected: tsc ohne Fehler; alle Tests grün (Wiring bricht nichts).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -F- <<'EOF'
feat(img-to-md): Sidebar-View verdrahten (registerView, Ribbon, Command, Deps)

Live-Getter-Deps (Vision-Client/Prompt/Endpoint) → reconnectVision greift ohne
View-Neuerzeugung; Modell-Liste/Ping via ChatClient gegen den Vision-Endpoint;
writeTranscripts-Dep mappt Karten auf den geteilten Schreiber. Bestehendes
Batch-Command + Editor-Kontextmenü bleiben.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 11: Styles + Build + manueller Smoke-Test + Abschluss

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Sidebar-Styles in `styles.css` ergänzen** (eigener `vault-rag-img-*`-Präfix)

```css
.vault-rag-img-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.vault-rag-img-status { font-size: 11px; color: var(--text-muted); cursor: pointer; padding: 2px 0; margin-bottom: 6px; flex: 0 0 auto; }
.vault-rag-img-model { width: 100%; margin-bottom: 6px; flex: 0 0 auto; font-size: 12px; }
.vault-rag-img-head { display: flex; gap: 6px; align-items: center; flex: 0 0 auto; margin-bottom: 6px; }
.vault-rag-img-toggle { font-size: 12px; }
.vault-rag-img-list { display: flex; flex-direction: column; gap: 2px; flex: 0 0 auto; max-height: 30vh; overflow-y: auto; margin-bottom: 6px; }
.vault-rag-img-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.vault-rag-img-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-rag-img-empty { color: var(--text-muted); font-size: 12px; padding: 4px 0; }
.vault-rag-img-cards { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex: 1 1 auto; min-height: 0; padding-right: 4px; }
.vault-rag-img-card { border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 8px; }
.vault-rag-img-card-head { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.vault-rag-img-text { white-space: pre-wrap; font-size: 13px; }
.vault-rag-img-error { color: var(--text-error); font-size: 12px; }
.vault-rag-img-written { color: var(--text-accent); font-size: 11px; cursor: pointer; margin-top: 4px; }
.vault-rag-img-reasoning { font-size: 12px; margin: 2px 0; }
.vault-rag-img-reasoning-sum { color: var(--text-muted); cursor: pointer; }
.vault-rag-img-reasoning-body { color: var(--text-faint); white-space: pre-wrap; font-style: italic; padding: 4px 0 4px 12px; border-left: 2px solid var(--background-modifier-border); }
.vault-rag-img-card-actions { display: flex; gap: 4px; margin-top: 4px; }
.vault-rag-img-copy.clickable-icon { color: var(--text-faint); padding: 2px 4px; height: auto; width: auto; }
.vault-rag-img-copy.clickable-icon:hover { color: var(--text-normal); }
.vault-rag-img-write { font-size: 12px; }
.vault-rag-img-foot { flex: 0 0 auto; margin-top: 6px; }
```

- [ ] **Step 2: Build + Typecheck + voller Test-Lauf**

Run: `npm run build && npx tsc --noEmit && npm test`
Expected: Build erzeugt `main.js` fehlerfrei; tsc sauber; alle Tests grün.

- [ ] **Step 3: Manueller Smoke-Test in Obsidian**

Plugin-Bundle deployen (manuell: `main.js`, `manifest.json`, `styles.css` ins Vault-Plugin-Verzeichnis kopieren), Obsidian neu laden. Prüfen:
1. Ribbon „IMG → MD" / Command „IMG → MD-Sidebar öffnen" öffnet die rechte Sidebar.
2. Notiz mit mehreren Bild-Embeds öffnen → Liste zeigt sie (HEIC als „nicht unterstützt", disabled).
3. „Transkribieren" → Text streamt live in die Karte(n); bei Reasoning-Modell erscheint der Gedanken-Block.
4. „Notiz anlegen" legt die Notiz an, ersetzt den Embed; Bild fällt aus der Liste; „✓ angelegt" ist klickbar.
5. „Alle anlegen" schreibt die restlichen fertigen Karten.
6. Modell-Switcher listet Vision-Modelle, Wechsel wirkt.
7. Stop bricht eine laufende Transkription ab.

- [ ] **Step 4: Abschluss-Commit (Styles)**

```bash
git add styles.css
git commit -F- <<'EOF'
style(img-to-md): Sidebar-Styles (vault-rag-img-*)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Finishing** — REQUIRED SUB-SKILL `superpowers:finishing-a-development-branch` (Optionen für Merge/PR/Cleanup; hier: alles bereits auf `main`, lokal). Danach: adversariale Review (requesting-code-review / `/code-review`) über das Gesamt-Diff der Slice, Funde fixen, Cockpit (`§🧭`) fortschreiben.

## Self-Review

**Spec-Abdeckung:**
- UX A⁺-1 (Checkbox-Liste, Toggle-all, sequenzielles Streaming, Karten, „Notiz anlegen"/„Alle anlegen") → Tasks 7/8/9. ✓
- Streaming-Ansatz 2 (`streamSSE` extrahiert, `transcribeStream`) → Tasks 1/2/3. ✓
- `transcribed_by` aus `response.model` (Stream) → `parseSSE.model`/`streamSSE.model`/`transcribeStream` (Tasks 1/2/3) + Karte→`writeTranscripts` (Tasks 8/9/5). ✓
- Schreib-Mechanik (geteilter batched `writeTranscripts`, `transcriptNotePath`) → Tasks 4/5. ✓
- View-State rein (`img_to_md_state`) → Task 6. ✓
- Entschieden: read-only (kein Inline-Edit — nirgends ein Editfeld), Roh-Markdown pre-wrap (`vault-rag-img-text` white-space:pre-wrap), Settings-Status später (kein settings.ts-Task). ✓
- Invarianten: View-Closures (Deps-Interface), `onClose` Timer/Abort, HEIC beide Gates (scan setzt `supported`, Liste disabled), YAML-Escape (über `buildTranscriptNote`), Dedupe (`scan` + runImgToMd), Wächter `chat_client.test.ts` (Task 1/2 Steps prüfen explizit). ✓
- Ribbon/Command/aktivieren + Batch-Command bleibt → Task 10. ✓

**Platzhalter-Scan:** keine TBD/TODO; jeder Code-Schritt zeigt vollständigen Code; Stub-Methoden in Task 7 sind bewusst markiert und werden in Tasks 8/9 ersetzt.

**Typ-Konsistenz:** `ImgItem`/`ImgCard`/`ImgToMdState`-Signaturen identisch zwischen Task 6 (Definition) und 7/8/9 (Nutzung). `writeTranscripts`-Entry `{raw,link,content,model}` konsistent zwischen Task 5 (Definition), Task 9/10 (View-Dep mappt `{item,content,model}` → `{raw,link,content,model}`). `streamSSE`/`transcribeStream`/`parseSSE`-Signaturen konsistent über Tasks 1–3.
