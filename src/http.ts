import { requestUrl } from "obsidian";

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
