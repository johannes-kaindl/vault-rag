import { ThinkSplitter } from "./think_splitter";

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

/** Streamt einen OpenAI-kompatiblen SSE-Stream über `XMLHttpRequest` (nicht `fetch`: Obsidian
 *  empfiehlt `requestUrl`, das aber NICHT streamen kann — XHR ist der erlaubte Streaming-Primitive).
 *  Ruft onContent/onReasoning pro Delta; trennt inline <think> via ThinkSplitter; drained am Ende
 *  den Splitter-Rest. Gibt das Akkumulat + das erste Chunk-model zurück. Bricht bei `signal` ab. */
export function streamSSE(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
  onContent: (t: string) => void,
  onReasoning: (t: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; reasoning: string; model: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const splitter = new ThinkSplitter();
    let content = "", reasoning = "", model = "", buffer = "", seen = 0;
    const emit = (c: string, r: string): void => {
      if (c) { content += c; onContent(c); }
      if (r) { reasoning += r; onReasoning(r); }
    };
    const drain = (p: { content: string[]; reasoning: string[]; model?: string }): void => {
      if (!model && p.model) model = p.model;
      for (const r of p.reasoning) emit("", r);
      for (const c of p.content) { const s = splitter.push(c); emit(s.content, s.reasoning); }
    };
    const pump = (): void => {
      const text = xhr.responseText;          // akkumuliert; nur den neuen Tail verarbeiten
      buffer += text.slice(seen);
      seen = text.length;
      const p = parseSSE(buffer);
      buffer = p.rest;
      drain(p);
    };
    const abortError = (): Error => { const e = new Error("Aborted"); e.name = "AbortError"; return e; };

    xhr.open(init.method, url);
    for (const [k, v] of Object.entries(init.headers)) xhr.setRequestHeader(k, v);
    xhr.onprogress = (): void => pump();
    xhr.onerror = (): void => reject(new Error("Chat-Netzwerkfehler"));
    xhr.onabort = (): void => reject(abortError());
    xhr.onload = (): void => {
      pump();
      // Stream-Ende drainen: letzten Buffer parsen + ThinkSplitter-Rest flushen.
      drain(parseSSE(buffer));
      const tail = splitter.flush();
      emit(tail.content, tail.reasoning);
      if (xhr.status < 200 || xhr.status >= 300) reject(new Error(`Chat HTTP ${xhr.status}`));
      else resolve({ content, reasoning, model });
    };
    if (signal) signal.addEventListener("abort", () => xhr.abort());
    xhr.send(init.body);
  });
}
