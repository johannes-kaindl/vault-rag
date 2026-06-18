export class EmbeddingClient {
  constructor(private endpoint: string, private model: string) {}

  async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${this.endpoint}/v1/models`);
      return r.ok;
    } catch {
      return false;
    }
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
      const data = await r.json() as { data: { embedding: number[] }[] };
      for (const item of data.data) results.push(new Float32Array(item.embedding));
    }
    return results;
  }
}
