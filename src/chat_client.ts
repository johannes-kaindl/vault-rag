export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; sources?: string[]; error?: string }

/** Akkumuliert OpenAI-SSE-Deltas aus einem (Teil-)Buffer; unvollständige letzte Zeile → rest. */
export function parseSSE(buffer: string): { deltas: string[]; rest: string; done: boolean } {
  const deltas: string[] = [];
  let done = false;
  const lines = buffer.split(/\r\n|\n|\r/);
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "[DONE]") { done = true; continue; }
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const d = j.choices?.[0]?.delta?.content;
      if (typeof d === "string") deltas.push(d);
    } catch { /* unvollständig — sollte bei kompletten Zeilen nicht passieren */ }
  }
  return { deltas, rest, done };
}

export class ChatClient {
  constructor(private endpoint: string, private model: string) {}

  async ping(): Promise<boolean> {
    try { return (await fetch(`${this.endpoint}/v1/models`)).ok; } catch { return false; }
  }

  async stream(messages: ChatMessage[], onToken: (t: string) => void, signal?: AbortSignal): Promise<string> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Chat HTTP ${res.status}`);
    const reader = (res as unknown as { body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } }).body.getReader();
    const dec = new TextDecoder();
    let buffer = "", full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const p = parseSSE(buffer);
      buffer = p.rest;
      for (const d of p.deltas) { full += d; onToken(d); }
      if (p.done) break;
    }
    return full;
  }
}
