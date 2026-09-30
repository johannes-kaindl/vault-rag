import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { Capabilities, fetchCapabilities } from "./capabilities";
import { checkResponse, type Deviation, type FamilyId, type ResponseFacts, type ThinkingLevel } from "./vendor/kit/sampling-profiles";
import { httpJson, probeEndpoint } from "./http";
import { authHeaders } from "./endpoint_config";
import { EndpointStatus, extractModelIds } from "./vendor/kit/endpoint_diagnostics";
import { readLabApi } from "./vendor/kit-obsidian/lab-client";
import { createChatClient, type ChatClient as KitChatClient, type ChatResult } from "./vendor/kit-obsidian/chat-client";
import { requestUrlTransport, xhrSseTransport } from "./vendor/kit-obsidian/chat-transport";
import { ChatHttpError, ChatTimeoutError } from "./chat_error";
import { t } from "./vendor/kit/i18n";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; reasoning?: string; sources?: string[]; error?: string }

/** Was ueber die Antwort zu pruefen ist (`checkResponse`): die Familie und die Denk-Stufe, mit
 *  der die Anfrage gebaut wurde, und wohin die Abweichungen gehen. */
export interface ResponseCheck {
  family: FamilyId | null;
  thinking: ThinkingLevel;
  report: (ds: Deviation[]) => void;
}

/** Sampling-Felder einer Anfrage, wie sie der Body traegt (`temperature`, `top_p`, `max_tokens`, ...). */
export type RequestParams = Record<string, number | string>;

/** Antwort oder Fehler des Kit-Clients als Tatsachen fuer `checkResponse`. `null`, wenn gar keine
 *  Server-Antwort vorlag (Abbruch, Netzfehler, Frist) — dafuer hat die Pruefung keine Aussage. */
function responseFactsOf(res: ChatResult): ResponseFacts | null {
  if (res.ok) {
    return {
      status: 200, finishReason: res.finishReason ?? null, content: res.content, reasoning: res.reasoning,
      ...(res.model !== undefined ? { responseModel: res.model } : {}),
    };
  }
  switch (res.kind) {
    case "truncated":
      return { status: 200, finishReason: "length", content: res.partial, reasoning: res.reasoning };
    case "http":
    case "overflow":
      return { status: res.status ?? 0, errorText: res.body ?? res.detail, content: "", reasoning: res.reasoning };
    default:
      return null;
  }
}

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

/** Fristen des Kit-Clients. Vor Welle 11 gab es keine. Der Idle-Timeout misst Stille, nicht Dauer;
 *  bis zum ersten Chunk gilt mehr, weil LM Studio ein Modell beim ersten Aufruf erst lädt
 *  (JIT, Minuten) und dabei nichts sendet. */
const IDLE_TIMEOUT_MS = 120_000;
const FIRST_CHUNK_TIMEOUT_MS = 600_000;

export class ChatClient {
  private endpoint: string;
  /** Ein Kit-Client je Instanz, und eine Instanz gehört zu EINEM Endpunkt (main.ts baut sie beim
   *  Endpunktwechsel neu): die Weigerung eines Servers, den XHR-Stream zu beantworten, hängt am Client. */
  private readonly kit: KitChatClient = createChatClient({
    transport: xhrSseTransport,
    fallbackTransport: requestUrlTransport,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    firstChunkTimeoutMs: FIRST_CHUNK_TIMEOUT_MS,
  });
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
    opts?: { model?: string; params?: RequestParams; check?: ResponseCheck; trace?: { feature: string; app: unknown; contextPaths?: string[]; promptTemplate?: string; turnId?: string } },
  ): Promise<{ content: string; reasoning: string; finishReason?: string }> {
    const effectiveModel = opts?.model ?? this.model;
    // Die Sampling-Werte kommen fertig vom Aufrufer: `request_profile.ts` baut sie aus der
    // Kit-Tabelle (Kit-Vertrag `params`). Hier wird nichts mehr entschieden.
    const params: RequestParams = { ...(opts?.params ?? {}) };
    const res = await this.kit.complete({
      endpoint: { url: this.endpoint, ...(this.apiKey ? { apiKey: this.apiKey } : {}) },
      model: effectiveModel,
      messages,
      params,
      ...(signal ? { signal } : {}),
      onToken: onContent,
      onReasoning,
    });
    // ttftMs = Zeit bis zum ERSTEN BYTE (auch Reasoning). Bis 0.35 war es der erste Content-Token —
    // Verhaltenswechsel im Lab-Log (Kit 0.42.0, `chat-client` § Telemetrie).
    const started = res.timing.startedAt;
    const ttft = res.timing.firstChunkAt !== undefined ? res.timing.firstChunkAt - started : undefined;
    const latency = res.timing.endedAt - started;
    // Abweichung zwischen Profil und Antwort (z. B. Denken trotz „aus“, HTTP 400): melden, nie
    // werfen — die Pruefung darf eine Antwort nicht mitreissen.
    if (opts?.check) {
      try {
        const facts = responseFactsOf(res);
        if (facts) opts.check.report(checkResponse({ family: opts.check.family, thinking: opts.check.thinking }, facts));
      } catch { /* siehe oben */ }
    }

    if (res.ok || res.kind === "truncated") {
      // „Abgeschnitten OHNE Text“ war hier immer ein Ergebnis mit finishReason "length" (der
      // Aufrufer zeigt den Hinweis); der Kit-Client nennt den Fall einen Fehler, wir geben ihn
      // unverändert als Ergebnis weiter.
      const out = res.ok
        ? { content: res.content, reasoning: res.reasoning, ...(res.finishReason !== undefined ? { finishReason: res.finishReason } : {}) }
        : { content: res.partial, reasoning: res.reasoning, finishReason: "length" };
      this.reportToLab(opts, messages, out, latency, ttft);
      return out;
    }

    // Auch der gescheiterte Lauf wird gemeldet — er ist der interessante Debug-Fall, samt Teiltext.
    const err = this.failure(res);
    this.reportToLab(opts, messages, { content: res.partial, reasoning: res.reasoning, errorRaw: err }, latency, ttft);
    throw err;
  }

  /** Kit-`kind` → der Fehler, den die Aufrufer schon kennen: `ChatHttpError` (Status + Rohbody, die
   *  Anzeige übersetzt sie in `chat_error.ts`), `AbortError`, `ChatTimeoutError`, sonst der
   *  übersetzte Netzfehlertext. `detail` (Servermeldung) bleibt im Body bzw. im Lab-Log. */
  private failure(res: Extract<ChatResult, { ok: false }>): Error {
    switch (res.kind) {
      case "http":
      case "overflow":
        return new ChatHttpError(res.status ?? 0, res.body ?? res.detail);
      case "aborted": {
        const e = new Error("Aborted");
        e.name = "AbortError";
        return e;
      }
      case "timeout":
        return new ChatTimeoutError(
          (res.timing.firstChunkAt === undefined ? FIRST_CHUNK_TIMEOUT_MS : IDLE_TIMEOUT_MS) / 1000);
      default:
        return new Error(t("sse.networkError"));
    }
  }

  /** Meldet einen Aufruf ans LLM Lab, falls es installiert ist. Fire-and-forget:
   *  `log()` ist synchron und darf nie werfen — ein `try` steht trotzdem hier, weil ein
   *  fremdes Plugin nicht unser Vertrauen verdient, nur weil es unsere Signatur erfuellt. */
  private reportToLab(
    opts: { model?: string; trace?: { feature: string; app: unknown; contextPaths?: string[]; promptTemplate?: string; turnId?: string } } | undefined,
    messages: ChatMessage[],
    result: { content: string; reasoning?: string; finishReason?: string; errorRaw?: unknown },
    latencyMs: number,
    ttftMs?: number,
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
        latencyMs,
        ...(ttftMs !== undefined ? { ttftMs } : {}),
        ...(this.apiKey ? { secrets: [this.apiKey] } : {}),
        ...(opts.trace.contextPaths?.length ? { contextPaths: opts.trace.contextPaths } : {}),
        ...(opts.trace.promptTemplate ? { promptTemplate: opts.trace.promptTemplate } : {}),
        ...(opts.trace.turnId ? { turnId: opts.trace.turnId } : {}),
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
