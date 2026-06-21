import { normalizeEndpoint } from "./endpoint";
import { Capabilities, fetchCapabilities } from "./capabilities";

export class EmbeddingClient {
  private endpoint: string;
  constructor(endpoint: string, private model: string) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${this.endpoint}/v1/models`);
      return r.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const r = await fetch(`${this.endpoint}/v1/models`);
      if (!r.ok) return [];
      const j = await r.json() as { data?: { id?: string }[] };
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
      const r = await fetch(`${this.endpoint}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: batch }),
      });
      if (!r.ok) throw new Error(`Embedding HTTP ${r.status}`);
      const data: unknown = await r.json();
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
