import { streamSSE } from "./sse";
import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { Capabilities, fetchCapabilities } from "./capabilities";
import { suppressParams } from "./vendor/kit/reasoning";
import { httpJson, probeEndpoint } from "./http";
import { authHeaders } from "./endpoint_config";
import { EndpointStatus, extractModelIds } from "./vendor/kit/endpoint_diagnostics";
import { readLabApi } from "./lab_client";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; reasoning?: string; sources?: string[]; error?: string }

export interface ModelInfo {
  id: string;
  contextLength?: number;
  loadedContextLength?: number;
  quantization?: string;
  arch?: string;
  state?: string;
}

/** Fehler → einzeiliger String fuers Lab-Log. `String(e)` allein wäre bei einem Nicht-Error
 *  (kein `message`, kein sinnvolles `toString`) nur „[object Object]" — und lint (no-base-to-string)
 *  verbietet es ohnehin auf `unknown`. Wirft nie: der Aufrufer steht selbst im Telemetrie-`try`. */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return "unknown error"; }
}

export class ChatClient {
  private endpoint: string;
  constructor(endpoint: string, private model: string, private apiKey?: string) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  /** Erreichbarkeit + Klartext-Diagnose des Endpunkts. */
  async probe(): Promise<EndpointStatus> {
    return probeEndpoint(this.endpoint, this.apiKey);
  }

  /** Boolean-Kurzform für Aufrufer (Resolver), die nur Erreichbarkeit brauchen.
   *  Verschärft: 200 allein genügt nicht — probe() verlangt die /v1/models-Form (siehe probeEndpoint). */
  async ping(): Promise<boolean> {
    return (await this.probe()).reachable;
  }

  /** Verfügbare Modelle vom OpenAI-kompatiblen Endpoint (GET /v1/models). [] bei Fehler/Offline. */
  async listModels(): Promise<string[]> {
    try {
      const { status, json } = await httpJson({ url: `${this.endpoint}/v1/models`, headers: authHeaders(this.apiKey) });
      if (status !== 200) return [];
      return extractModelIds(json).sort();
    } catch { return []; }
  }

  /** Best-effort Modell-Details via LM Studios GET /api/v0/models. null wenn nicht verfügbar. */
  async modelInfo(model: string): Promise<ModelInfo | null> {
    try {
      const { status, json } = await httpJson({ url: `${this.endpoint}/api/v0/models`, headers: authHeaders(this.apiKey) });
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
    return fetchCapabilities(this.endpoint, model, this.apiKey);
  }

  async stream(
    messages: ChatMessage[],
    onContent: (t: string) => void,
    onReasoning: (t: string) => void,
    signal?: AbortSignal,
    opts?: { model?: string; temperature?: number; suppressThinking?: boolean; maxTokens?: number; trace?: { feature: string; app: unknown } },
  ): Promise<{ content: string; reasoning: string; finishReason?: string }> {
    const body = JSON.stringify({
      model: opts?.model ?? this.model,
      messages,
      stream: true,
      ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts?.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
      ...suppressParams(opts?.suppressThinking ?? false),
    });
    const started = Date.now();
    // ttftMs misst den ersten CONTENT-Token, nicht den ersten Token ueberhaupt: bei einem
    // denkenden Modell, das zuerst reasoning streamt, liegt der Wert entsprechend spaeter als
    // das erste Byte auf der Leitung. Bewusst so — es ist der nutzersichtbare erste Token —,
    // aber llm-lab dokumentiert das Feld als „time to first token"; die Abweichung gehoert
    // hierher geschrieben statt spaeter entdeckt zu werden.
    let firstToken: number | undefined;
    // Mitgeschrieben fuer den FEHLERPFAD: `streamSSE` wirft bei Abbruch/Netzfehler und verwirft
    // dabei sein Akkumulat. Genau dieser Teiltext ist der Debug-Wert ("das Modell hat bis zum
    // Abbruch Quelltext produziert statt zu antworten") — ohne Puffer meldete der catch-Zweig
    // content:"" und die Zusage darunter war nur halb eingeloest.
    let seenContent = "";
    let seenReasoning = "";
    const timedContent = (tk: string): void => {
      firstToken ??= Date.now();
      seenContent += tk;
      onContent(tk);
    };
    const seenOnReasoning = (tk: string): void => {
      seenReasoning += tk;
      onReasoning(tk);
    };
    try {
      const { content, reasoning, finishReason } = await streamSSE(
        `${this.endpoint}/v1/chat/completions`,
        { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(this.apiKey) }, body },
        timedContent, seenOnReasoning, signal,
      );
      this.reportToLab(opts, messages, { content, reasoning, finishReason }, started, firstToken);
      return { content, reasoning, finishReason };
    } catch (e) {
      // Auch der gescheiterte Lauf wird gemeldet — er ist der interessante Debug-Fall. Der rohe
      // Fehler bleibt bis in den guarded Block unangetastet: ein String(e) mit werfendem
      // toString darf den echten Fehler nicht durch einen TypeError ersetzen — und ohne
      // konfigurierten `trace` laeuft String(e) hier gar nicht erst (Guard lebt im Callee).
      this.reportToLab(opts, messages, { content: seenContent, reasoning: seenReasoning, errorRaw: e }, started, firstToken);
      throw e;
    }
  }

  /** Meldet einen Aufruf ans LLM Lab, falls es installiert ist. Fire-and-forget:
   *  `log()` ist synchron und darf nie werfen — ein `try` steht trotzdem hier, weil ein
   *  fremdes Plugin nicht unser Vertrauen verdient, nur weil es unsere Signatur erfuellt. */
  private reportToLab(
    opts: { model?: string; trace?: { feature: string; app: unknown } } | undefined,
    messages: ChatMessage[],
    result: { content: string; reasoning?: string; finishReason?: string; errorRaw?: unknown },
    started: number,
    firstToken?: number,
  ): void {
    if (!opts?.trace) return;
    try {
      const { errorRaw, ...rest } = result;
      const ret: unknown = readLabApi(opts.trace.app)?.log({
        plugin: "vault-retrieval",
        feature: opts.trace.feature,
        model: opts.model ?? this.model,
        endpointUrl: this.endpoint,
        messages,
        latencyMs: Date.now() - started,
        ...(firstToken ? { ttftMs: firstToken - started } : {}),
        ...rest,
        ...(errorRaw !== undefined ? { error: describeError(errorRaw) } : {}),
      });
      // Der Vertrag sagt: synchron zurueckgegebene id. Ein fremdes Plugin verdient trotzdem
      // keinen blinden Vorschuss — `Promise.resolve` ist fuer eine normale id ein No-op
      // (bereits aufgeloest), faengt aber eine etwaige rejectende Promise ab, bevor sie als
      // unhandled rejection den Chat mitreissen koennte.
      void Promise.resolve(ret).catch(() => {});
    } catch { /* Telemetrie darf einen Chat nie mitreissen. */ }
  }
}
