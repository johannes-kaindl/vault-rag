import { ThinkSplitter } from "./think_splitter";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; reasoning?: string; sources?: string[]; error?: string }

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

export class ChatClient {
  constructor(private endpoint: string, private model: string) {}

  async ping(): Promise<boolean> {
    try { return (await fetch(`${this.endpoint}/v1/models`)).ok; } catch { return false; }
  }

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
    const emit = (c: string, r: string) => {
      if (c) { content += c; onContent(c); }
      if (r) { reasoning += r; onReasoning(r); }
    };
    const drain = (p: { content: string[]; reasoning: string[] }) => {
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
    // Stream-Ende sauber drainen: TextDecoder leeren (Multibyte über die letzte Chunk-Grenze)
    // + im ThinkSplitter gepufferten Tag-Rest flushen — sonst gingen letzte Zeichen verloren.
    buffer += dec.decode();
    drain(parseSSE(buffer));
    const tail = splitter.flush();
    emit(tail.content, tail.reasoning);
    return { content, reasoning };
  }
}
