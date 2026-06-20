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

export interface ModelInfo {
  id: string;
  contextLength?: number;
  loadedContextLength?: number;
  quantization?: string;
  arch?: string;
  state?: string;
}

export class ChatClient {
  constructor(private endpoint: string, private model: string) {}

  async ping(): Promise<boolean> {
    try { return (await fetch(`${this.endpoint}/v1/models`)).ok; } catch { return false; }
  }

  /** Verfügbare Modelle vom OpenAI-kompatiblen Endpoint (GET /v1/models). [] bei Fehler/Offline. */
  async listModels(): Promise<string[]> {
    try {
      const r = await fetch(`${this.endpoint}/v1/models`);
      if (!r.ok) return [];
      const j = await r.json() as { data?: { id?: string }[] };
      return (j.data ?? []).map(m => m.id).filter((x): x is string => typeof x === "string").sort();
    } catch { return []; }
  }

  /** Best-effort Modell-Details via LM Studios GET /api/v0/models. null wenn nicht verfügbar. */
  async modelInfo(model: string): Promise<ModelInfo | null> {
    try {
      const r = await fetch(`${this.endpoint}/api/v0/models`);
      if (!r.ok) return null;
      const j = await r.json() as { data?: Record<string, unknown>[] };
      const m = (j.data ?? []).find(x => x.id === model);
      if (!m) return null;
      return {
        id: model,
        contextLength: typeof m.max_context_length === "number" ? m.max_context_length : undefined,
        loadedContextLength: typeof m.loaded_context_length === "number" ? m.loaded_context_length : undefined,
        quantization: typeof m.quantization === "string" ? m.quantization : undefined,
        arch: typeof m.arch === "string" ? m.arch : undefined,
        state: typeof m.state === "string" ? m.state : undefined,
      };
    } catch { return null; }
  }

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
