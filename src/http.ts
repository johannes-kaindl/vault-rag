import { requestUrl } from "obsidian";
import { classifyEndpointStatus, EndpointStatus } from "./vendor/kit/endpoint_diagnostics";

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
 *  baseUrl ist bereits normalisiert. Eigener Timeout via Promise.race, weil requestUrl
 *  weder ein timeout-Feld noch Abort kennt — gewinnt der Timer, läuft der echte Request
 *  im Hintergrund folgenlos weiter (reine Lese-Probe). */
export async function probeEndpoint(baseUrl: string, timeoutMs = 5000): Promise<EndpointStatus> {
  const url = `${baseUrl}/v1/models`;
  let timer: number | undefined;
  const timeout = new Promise<"__timeout__">(resolve => {
    timer = window.setTimeout(() => resolve("__timeout__"), timeoutMs);
  });
  try {
    const raced = await Promise.race([
      requestUrl({ url, throw: false }).then(r => {
        let body: unknown = undefined;
        try { body = r.json; } catch { /* nicht-JSON → body bleibt undefined */ }
        return { status: r.status, body } as const;
      }),
      timeout,
    ]);
    if (raced === "__timeout__") return classifyEndpointStatus({ kind: "timeout" });
    return classifyEndpointStatus({ kind: "response", status: raced.status, body: raced.body });
  } catch (e) {
    const message = String((e as { message?: string })?.message ?? e);
    return classifyEndpointStatus({ kind: "error", message });
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}
