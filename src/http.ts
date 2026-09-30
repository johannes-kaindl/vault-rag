import { requestUrl } from "obsidian";
import { classifyEndpointStatus, EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
import { withTimeout } from "./vendor/kit/timeout";
import { authHeaders } from "./endpoint_config";
import { probeBaseUrl, probeEndpoint as probeBackend, type CapabilityFetch } from "./vendor/kit/capabilities";
import type { BackendId } from "./vendor/kit/sampling-profiles";

/** Einziger Netz-Helfer über Obsidians `requestUrl` (CORS-frei, mobil-tauglich) — kapselt den
 *  obsidian-Import, damit die Client-Module obsidian-frei + in Node testbar bleiben.
 *  Streaming-Requests (SSE) gehen bewusst weiter über `fetch` (requestUrl kann nicht streamen). */
export interface HttpResponse { status: number; json: unknown }

export async function httpJson(param: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResponse> {
  const r = await requestUrl({ ...param, throw: false });
  let json: unknown = undefined;
  try { json = r.json; } catch { /* nicht-JSON-Body — json bleibt undefined */ }
  return { status: r.status, json };
}

/** Erreichbarkeits-Probe eines Endpunkts (GET <baseUrl>/v1/models) mit Klartext-Diagnose.
 *  baseUrl ist bereits normalisiert. Timeout via `withTimeout` aus dem Kit, weil requestUrl
 *  weder ein timeout-Feld noch Abort kennt — gewinnt der Timer, läuft der echte Request
 *  im Hintergrund folgenlos weiter (reine Lese-Probe). `window` ist der Timer-Port; die
 *  Bindung daran gehört in diese obsidian-nahe Schicht, nicht ins pure Kit-Modul. */
export async function probeEndpoint(baseUrl: string, apiKey?: string, timeoutMs = 5000): Promise<EndpointStatus> {
  const url = `${baseUrl}/v1/models`;
  const headers = authHeaders(apiKey);
  try {
    const raced = await withTimeout(
      requestUrl({ url, headers, throw: false }).then(r => {
        let body: unknown = undefined;
        try { body = r.json; } catch { /* nicht-JSON → body bleibt undefined */ }
        return { status: r.status, body } as const;
      }),
      timeoutMs,
      window,
    );
    if (raced.timedOut) return classifyEndpointStatus({ kind: "timeout" });
    return classifyEndpointStatus({ kind: "response", status: raced.value.status, body: raced.value.body });
  } catch (e) {
    const message = String((e as { message?: string })?.message ?? e);
    return classifyEndpointStatus({ kind: "error", message });
  }
}

// uebernommen aus lingotuner/src/obsidian/http.ts, 2026-09-30 (`cachedProbe`, Adapter und Cache);
// neu hier nur die Frist: eine Probe darf das Verdrahten des Chat-Endpunkts nie blockieren.
const fetchJsonAdapter: CapabilityFetch = async (req) => {
  const res = await requestUrl({ url: req.url, method: req.method ?? "GET", headers: req.headers, body: req.body, throw: false });
  if (res.status < 200 || res.status >= 300) return null;
  try { return { json: JSON.parse(res.text) as unknown }; } catch { return null; }
};

const BACKEND_CACHE_MS = 30_000;
const BACKEND_PROBE_TIMEOUT_MS = 6_000;
let backendCache: { url: string; backend: BackendId; at: number } | null = null;

/** Welches Backend hinter einer URL steckt — 30 s je URL zwischengespeichert (dieselbe Regel wie
 *  der Modelllisten-Cache), bei Aenderung der URL verworfen. `null`, wenn die Probe nichts
 *  Brauchbares liefert oder laenger als die Frist braucht: dann bleibt das Backend `unknown`,
 *  und das Kit sendet nur die Standardfelder. */
export async function cachedProbe(url: string, model: string): Promise<BackendId | null> {
  if (!/^https?:/i.test(url)) return null;
  const now = Date.now();
  if (backendCache && backendCache.url === url && now - backendCache.at < BACKEND_CACHE_MS) return backendCache.backend;
  try {
    const raced = await withTimeout(probeBackend(fetchJsonAdapter, probeBaseUrl(url), model), BACKEND_PROBE_TIMEOUT_MS, window);
    if (raced.timedOut) return null;
    backendCache = { url, backend: raced.value.backend, at: now };
    return raced.value.backend;
  } catch { return null; }
}
