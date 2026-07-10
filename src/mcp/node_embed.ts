import { classifyEndpointStatus, type EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { toIndexVector } from "../embed_vector";

/** Erreichbarkeits-Probe via Node-fetch (GET /v1/models) mit Klartext-Diagnose —
 *  Node-Pendant zu http.ts probeEndpoint (das obsidian.requestUrl nutzt).
 *  Node-Gotcha: der Fehlercode steckt in error.cause.code, nicht in der Message. */
export async function nodeProbe(baseUrl: string, timeoutMs = 5000): Promise<EndpointStatus> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) });
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    return classifyEndpointStatus({ kind: "response", status: res.status, body });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") return classifyEndpointStatus({ kind: "timeout" });
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const message = `${String((e as Error).message ?? e)} ${cause?.code ?? cause?.message ?? ""}`;
    return classifyEndpointStatus({ kind: "error", message });
  }
}

/** Query-Text → Vektor im Index-Raum: POST /v1/embeddings, dann toIndexVector
 *  (truncate auf Index-dim + L2-Norm) — exakt die Transformation der Notiz-Vektoren. */
export async function embedQueryVector(endpoint: string, model: string, text: string, dim: number): Promise<Float32Array> {
  const res = await fetch(`${endpoint}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: [text] }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Embedding fehlgeschlagen: HTTP ${res.status}`);
  const data = await res.json() as { data?: { embedding?: number[] }[] };
  const emb = data?.data?.[0]?.embedding;
  if (!Array.isArray(emb)) throw new Error("Embedding: ungültiges Response-Schema (data fehlt)");
  return toIndexVector([new Float32Array(emb)], dim);
}
