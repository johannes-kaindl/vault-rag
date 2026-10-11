import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { Capabilities, fetchCapabilities } from "./capabilities";
import { httpJson, probeEndpoint } from "./http";
import { createEmbeddingClient, type Embedder } from "./vendor/kit/embeddings-client";
import { authHeaders } from "./endpoint_config";
import { EndpointStatus, extractModelIds } from "./vendor/kit/endpoint_diagnostics";

export class EmbeddingClient {
  private endpoint: string;
  private client: Embedder;
  constructor(endpoint: string, private model: string, private apiKey?: string) {
    this.endpoint = normalizeEndpoint(endpoint);
    this.client = createEmbeddingClient({
      endpoint: this.endpoint, model, ...(apiKey ? { apiKey } : {}),
      transport: ({ url, method, headers, body }) => httpJson({ url, method, headers, body }),
    });
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

  async listModels(): Promise<string[]> {
    try {
      const { status, json } = await httpJson({ url: `${this.endpoint}/v1/models`, headers: authHeaders(this.apiKey) });
      if (status !== 200) return [];
      return extractModelIds(json).sort();
    } catch { return []; }
  }

  /** Best-effort native Capability-Metadaten (Ollama /api/show, LM Studio /api/v1|v0).
   *  null wenn nichts Verwertbares verfügbar. this.endpoint ist bereits die Basis-URL. */
  async fetchCapabilities(model: string): Promise<Capabilities | null> {
    return fetchCapabilities(this.endpoint, model, this.apiKey);
  }

  /** Batch-Embed über den Kit-Client (Batches zu 32, nacheinander). Transport ist `httpJson` (Obsidians `requestUrl`). */
  async embed(texts: string[], opts?: { signal?: AbortSignal }): Promise<Float32Array[]> {
    return this.client.embed(texts, opts);
  }
}
