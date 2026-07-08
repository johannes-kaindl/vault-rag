import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { Capabilities, fetchCapabilities } from "./capabilities";
import { httpJson, probeEndpoint } from "./http";
import { EndpointStatus } from "./vendor/kit/endpoint_diagnostics";

export class EmbeddingClient {
  private endpoint: string;
  constructor(endpoint: string, private model: string) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  /** Erreichbarkeit + Klartext-Diagnose des Endpunkts. */
  async probe(): Promise<EndpointStatus> {
    return probeEndpoint(this.endpoint);
  }

  /** Boolean-Kurzform für Aufrufer (Resolver), die nur Erreichbarkeit brauchen.
   *  Verschärft: 200 allein genügt nicht — probe() verlangt die /v1/models-Form (siehe probeEndpoint). */
  async ping(): Promise<boolean> {
    return (await this.probe()).reachable;
  }

  async listModels(): Promise<string[]> {
    try {
      const { status, json } = await httpJson({ url: `${this.endpoint}/v1/models` });
      if (status !== 200) return [];
      const j = json as { data?: { id?: string }[] };
      return (j.data ?? []).map(m => m.id).filter((x): x is string => typeof x === "string").sort();
    } catch { return []; }
  }

  /** Best-effort native Capability-Metadaten (Ollama /api/show, LM Studio /api/v1|v0).
   *  null wenn nichts Verwertbares verfügbar. this.endpoint ist bereits die Basis-URL. */
  async fetchCapabilities(model: string): Promise<Capabilities | null> {
    return fetchCapabilities(this.endpoint, model);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32);
      const { status, json } = await httpJson({
        url: `${this.endpoint}/v1/embeddings`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: batch }),
      });
      if (status < 200 || status >= 300) throw new Error(`Embedding HTTP ${status}`);
      const data: unknown = json;
      if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>).data)) {
        throw new Error("Embedding: ungültiges Response-Schema (data fehlt)");
      }
      for (const item of (data as { data: { embedding: number[] }[] }).data) {
        results.push(new Float32Array(item.embedding));
      }
    }
    return results;
  }
}
