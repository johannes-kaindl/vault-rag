import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { Capabilities, fetchCapabilities } from "./capabilities";
import type { ModeId } from "./vendor/kit/sampling-profiles";
import { httpJson, probeEndpoint } from "./http";
import { authHeaders, type EndpointConfig } from "./endpoint_config";
import type { EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
import { readLabApi } from "./vendor/kit-obsidian/lab-client";
import { redactMessages, JIT_FIRST_CHUNK_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS } from "./vendor/kit-obsidian/chat-client";
import type { LlmConnection, LlmResult } from "./vendor/kit-obsidian/llm-connection";
import { ChatHttpError, ChatTimeoutError } from "./chat_error";
import { t } from "./vendor/kit/i18n";

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

/** Was ein Aufruf ans Lab mitgibt (Feature-Name, Kontext-Pfade, stabiler Prompt-Anteil, Turn-Id). */
export interface ChatTrace { feature: string; app: unknown; contextPaths?: string[]; promptTemplate?: string; turnId?: string }

/** Die Chat-Fassade des Plugins über der Kit-Verbindung (`createLlmConnection`): Endpunkt, Schlüssel,
 *  Transport, Fristen, Anfrage-Parameter und Antwortprüfung entscheidet die Verbindung. Hier bleibt,
 *  was die Aufrufer kennen: die Fehlerarten (`ChatHttpError`, `ChatTimeoutError`, `AbortError`), die
 *  Hilfsabfragen am aktiven Endpunkt (Probe, Modellliste, Modelldetails, Fähigkeiten) und die Meldung
 *  an das LLM Lab. */
export class ChatClient {
  constructor(private readonly llm: Pick<LlmConnection, "complete" | "resolve" | "models">) {}

  /** Der aktive Endpunkt mit Schlüssel (nur im Speicher), oder null, wenn die Verbindung keinen kennt. */
  private async active(): Promise<EndpointConfig | null> {
    return (await this.llm.resolve()).config;
  }

  /** Erreichbarkeit + Klartext-Diagnose des aktiven Endpunkts. */
  async probe(): Promise<EndpointStatus> {
    const cfg = await this.active();
    if (!cfg) return { reachable: false, kind: "unknown", klartext: "" };
    return probeEndpoint(normalizeEndpoint(cfg.url), cfg.apiKey);
  }

  /** Boolean-Kurzform für Aufrufer, die nur Erreichbarkeit brauchen.
   *  Verschärft: 200 allein genügt nicht — probe() verlangt die /v1/models-Form (siehe probeEndpoint). */
  async ping(): Promise<boolean> {
    return (await this.probe()).reachable;
  }

  /** Verfügbare Modelle des aktiven Endpunkts (Manager-Liste oder GET /v1/models). [] bei Fehler/Offline. */
  async listModels(): Promise<string[]> {
    try {
      return [...(await this.llm.models()).models].sort();
    } catch { return []; }
  }

  /** Best-effort Modell-Details via LM Studios GET /api/v0/models. null wenn nicht verfügbar. */
  async modelInfo(model: string): Promise<ModelInfo | null> {
    try {
      const cfg = await this.active();
      if (!cfg) return null;
      const { status, json } = await httpJson({ url: `${normalizeEndpoint(cfg.url)}/api/v0/models`, headers: authHeaders(cfg.apiKey) });
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
    const cfg = await this.active();
    if (!cfg) return null;
    return fetchCapabilities(normalizeEndpoint(cfg.url), model, cfg.apiKey);
  }

  async stream(
    messages: ChatMessage[],
    onContent: (t: string) => void,
    onReasoning: (t: string) => void,
    signal?: AbortSignal,
    opts?: { model?: string; mode?: ModeId; restoreContent?: "text" | "json"; trace?: ChatTrace },
  ): Promise<{ content: string; reasoning: string; finishReason?: string }> {
    const res = await this.llm.complete({ messages }, {
      onToken: onContent,
      onReasoning,
      ...(signal ? { signal } : {}),
      // Ein leeres Feature-Modell (Smart Apply ohne eigene Wahl) lässt die Verbindung das Zeilen-Modell nehmen.
      ...(opts?.model?.trim() ? { model: opts.model.trim() } : {}),
      ...(opts?.mode ? { mode: opts.mode } : {}),
      ...(opts?.restoreContent ? { restoreContent: opts.restoreContent } : {}),
    });
    // ttftMs = Zeit bis zum ERSTEN BYTE (auch Reasoning). Bis 0.35 war es der erste Content-Token —
    // Verhaltenswechsel im Lab-Log (Kit 0.42.0, `chat-client` § Telemetrie).
    const started = res.timing.startedAt;
    const ttft = res.timing.firstChunkAt !== undefined ? res.timing.firstChunkAt - started : undefined;
    const latency = res.timing.endedAt - started;

    if (res.ok) {
      // „Abgeschnitten OHNE Text“ ist ein Ergebnis mit finishReason "length" (Policy `result` der
      // Verbindung); der Aufrufer zeigt den Hinweis.
      const out = { content: res.content, reasoning: res.reasoning, ...(res.finishReason !== undefined ? { finishReason: res.finishReason } : {}) };
      this.reportToLab(opts, messages, res, out, latency, ttft);
      return out;
    }

    // Auch der gescheiterte Lauf wird gemeldet — er ist der interessante Debug-Fall, samt Teiltext.
    const err = this.failure(res);
    this.reportToLab(opts, messages, res, { content: res.partial, reasoning: res.reasoning, errorRaw: err }, latency, ttft);
    throw err;
  }

  /** Kit-`kind` → der Fehler, den die Aufrufer schon kennen: `ChatHttpError` (Status + Rohbody, die
   *  Anzeige übersetzt sie in `chat_error.ts`), `AbortError`, `ChatTimeoutError`, sonst der
   *  übersetzte Netzfehlertext. `detail` (Servermeldung) bleibt im Body bzw. im Lab-Log. */
  private failure(res: Extract<LlmResult, { ok: false }>): Error {
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
        // Die Fristen sind statisch (Kit-Konstanten); keine Einstellung nennt eine andere Zahl.
        return new ChatTimeoutError(
          (res.timing.firstChunkAt === undefined ? JIT_FIRST_CHUNK_TIMEOUT_MS : DEFAULT_IDLE_TIMEOUT_MS) / 1000);
      case "no-endpoint":
        return new Error(t("error.noEndpoint"));
      default:
        return new Error(t("sse.networkError"));
    }
  }

  /** Meldet einen Aufruf ans LLM Lab, falls es installiert ist. Fire-and-forget:
   *  `log()` ist synchron und darf nie werfen — ein `try` steht trotzdem hier, weil ein
   *  fremdes Plugin nicht unser Vertrauen verdient, nur weil es unsere Signatur erfuellt.
   *
   *  Das Lab bekommt den GESENDETEN Text (Platzhalter statt Geheimnis), nicht die Originale: die
   *  Verbindung schwärzt vor dem Senden umkehrbar und gibt uns die Originale zurück, ein Log mit
   *  diesen Originalen schriebe die Geheimnisse an einen Ort, den der Server nie sah. Nachrichten,
   *  Antwort, Denkspur und Prompt-Anteil laufen durch EINE Sitzung, damit derselbe Wert überall
   *  denselben Platzhalter trägt. */
  private reportToLab(
    opts: { model?: string; trace?: ChatTrace } | undefined,
    messages: ChatMessage[],
    res: LlmResult,
    result: { content: string; reasoning?: string; finishReason?: string; errorRaw?: unknown },
    latencyMs: number,
    ttftMs?: number,
  ): void {
    if (!opts?.trace) return;
    try {
      const { errorRaw, ...rest } = result;
      const tail = [
        { role: "assistant", content: rest.content },
        { role: "assistant", content: rest.reasoning ?? "" },
        { role: "system", content: opts.trace.promptTemplate ?? "" },
      ];
      const sent = redactMessages([...messages, ...tail]).messages;
      const n = messages.length;
      const text = (i: number, orig: string): string => { const c = sent[i]?.content; return typeof c === "string" ? c : orig; };
      const apiKey = res.source.config?.apiKey;
      const promptTemplate = opts.trace.promptTemplate ? text(n + 2, opts.trace.promptTemplate) : "";
      const ret: unknown = readLabApi(opts.trace.app)?.log({
        plugin: "vault-retrieval",
        feature: opts.trace.feature,
        model: res.source.sentModel || res.source.model,
        endpointUrl: res.source.config?.url ?? "",
        messages: sent.slice(0, n) as ChatMessage[],
        latencyMs,
        ...(ttftMs !== undefined ? { ttftMs } : {}),
        ...(apiKey ? { secrets: [apiKey] } : {}),
        ...(opts.trace.contextPaths?.length ? { contextPaths: opts.trace.contextPaths } : {}),
        ...(promptTemplate ? { promptTemplate } : {}),
        ...(opts.trace.turnId ? { turnId: opts.trace.turnId } : {}),
        content: text(n, rest.content),
        ...(rest.reasoning ? { reasoning: text(n + 1, rest.reasoning) } : {}),
        ...(rest.finishReason !== undefined ? { finishReason: rest.finishReason } : {}),
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
