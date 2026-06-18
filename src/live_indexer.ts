import { VaultAdapter, VaultIndex, IndexManifest } from "./index";
import { EmbeddingClient } from "./embedder";
import { chunkMarkdown } from "./chunker";

const INDEX_DIM = 256;
const INT8_SCALE = 127;

export class LiveIndexer {
  private noteVectors = new Map<string, Float32Array>();
  private loadedManifest: IndexManifest | null = null;

  constructor(
    private adapter: VaultAdapter,
    private indexDir: string,
    private embedder: EmbeddingClient,
    private embeddingModel: string,
  ) {}

  init(index: VaultIndex): void {
    this.loadedManifest = index.manifest;
    for (const path of index.paths) {
      const v = index.vectorFor(path);
      if (v) this.noteVectors.set(path, v.slice());
    }
  }

  async update(path: string, content: string): Promise<void> {
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) { this.noteVectors.delete(path); return; }

    const vecs = await this.embedder.embed(chunks.map(c => c.text));
    const dim = Math.min(INDEX_DIM, vecs[0].length);
    const mean = new Float32Array(dim);
    for (const v of vecs) {
      for (let i = 0; i < dim; i++) mean[i] += v[i] / vecs.length;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += mean[i] * mean[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) mean[i] /= norm;

    this.noteVectors.set(path, mean);
  }

  remove(path: string): void { this.noteVectors.delete(path); }

  rename(oldPath: string, newPath: string): void {
    const v = this.noteVectors.get(oldPath);
    if (v) { this.noteVectors.set(newPath, v); this.noteVectors.delete(oldPath); }
  }

  buildIndex(): VaultIndex {
    const paths = [...this.noteVectors.keys()].sort();
    const n = paths.length;
    const f = new Float32Array(n * INDEX_DIM);
    for (let r = 0; r < n; r++) {
      const v = this.noteVectors.get(paths[r])!;
      for (let c = 0; c < INDEX_DIM; c++) f[r * INDEX_DIM + c] = v[c] ?? 0;
    }
    const manifest: IndexManifest = {
      schema_version: 1,
      embedding_model: this.embeddingModel,
      index_dim: INDEX_DIM,
      scale: INT8_SCALE,
      count: n,
      granularity: "note",
      quant: "int8",
    };
    return new VaultIndex(manifest, paths, f);
  }

  async persist(): Promise<void> {
    const paths = [...this.noteVectors.keys()].sort();
    const n = paths.length;
    const i8 = new Int8Array(n * INDEX_DIM);
    for (let r = 0; r < n; r++) {
      const v = this.noteVectors.get(paths[r])!;
      for (let c = 0; c < INDEX_DIM; c++) {
        i8[r * INDEX_DIM + c] = Math.max(-INT8_SCALE, Math.min(INT8_SCALE, Math.round((v[c] ?? 0) * INT8_SCALE)));
      }
    }
    await this.adapter.mkdir(this.indexDir);
    // Write-Order: binary → paths → manifest (manifest letztes = reload-Trigger)
    await this.adapter.writeBinary(`${this.indexDir}/notes.i8`, i8.buffer);
    await this.adapter.write(`${this.indexDir}/paths.json`, JSON.stringify(paths));
    const manifest = {
      schema_version: 1,
      vault: (this.loadedManifest as any)?.vault ?? "10_Pallas",
      embedding_model: this.embeddingModel,
      source_dim: INDEX_DIM,
      index_dim: INDEX_DIM,
      granularity: "note",
      aggregation: "mean",
      quant: "int8",
      scale: INT8_SCALE,
      count: n,
      shards: ["notes.i8"],
      source_commit: "",
      built_at: new Date().toISOString(),
    };
    await this.adapter.write(`${this.indexDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  }
}
