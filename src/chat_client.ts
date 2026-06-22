import { streamSSE } from "./sse";
import { normalizeEndpoint } from "./endpoint";
import { Capabilities, fetchCapabilities } from "./capabilities";
import { suppressParams } from "./reasoning";
import { httpJson } from "./http";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; reasoning?: string; sources?: string[]; error?: string }

export interface ModelInfo {
  id: string;
  contextLength?: number;
  loadedContextLength?: number;
  quantization?: string;
  arch?: string;
  state?: string;
}

export class ChatClient {
  private endpoint: string;
  constructor(endpoint: string, private model: string) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  async ping(): Promise<boolean> {
    try { return (await httpJson({ url: `${this.endpoint}/v1/models` })).status === 200; } catch { return false; }
  }

  /** Verfügbare Modelle vom OpenAI-kompatiblen Endpoint (GET /v1/models). [] bei Fehler/Offline. */
  async listModels(): Promise<string[]> {
    try {
      const { status, json } = await httpJson({ url: `${this.endpoint}/v1/models` });
      if (status !== 200) return [];
      const j = json as { data?: { id?: string }[] };
      return (j.data ?? []).map(m => m.id).filter((x): x is string => typeof x === "string").sort();
    } catch { return []; }
  }

  /** Best-effort Modell-Details via LM Studios GET /api/v0/models. null wenn nicht verfügbar. */
  async modelInfo(model: string): Promise<ModelInfo | null> {
    try {
      const { status, json } = await httpJson({ url: `${this.endpoint}/api/v0/models` });
      if (status !== 200) return null;
      const j = json as { data?: Record<string, unknown>[] };
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

  async fetchCapabilities(model: string): Promise<Capabilities | null> {
    return fetchCapabilities(this.endpoint, model);
  }

  async stream(
    messages: ChatMessage[],
    onContent: (t: string) => void,
    onReasoning: (t: string) => void,
    signal?: AbortSignal,
    opts?: { model?: string; temperature?: number; suppressThinking?: boolean },
  ): Promise<{ content: string; reasoning: string }> {
    // Streaming-SSE braucht fetch (requestUrl kann nicht streamen) — bewusste Ausnahme.
    // eslint-disable-next-line no-restricted-globals
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts?.model ?? this.model,
        messages,
        stream: true,
        ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
        ...suppressParams(opts?.suppressThinking ?? false),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Chat HTTP ${res.status}`);
    const { content, reasoning } = await streamSSE(res, onContent, onReasoning);
    return { content, reasoning };
  }
}
