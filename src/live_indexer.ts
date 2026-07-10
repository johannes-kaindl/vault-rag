import { VaultAdapter, VaultIndex, IndexManifest } from "./index";
import { EmbeddingClient } from "./embedder";
import { chunkMarkdown } from "./chunker";
import { toIndexVector } from "./embed_vector";
import { assertSafeToPersist, PersistReason, PersistBlockedError } from "./index_guard";

const INDEX_DIM = 256;
const INT8_SCALE = 127;

export class LiveIndexer {
  private noteVectors = new Map<string, Float32Array>();
  private loadedManifest: IndexManifest | null = null;
  private ready = false;
  private diskCount = 0;

  constructor(
    private adapter: VaultAdapter,
    private indexDir: string,
    private embedder: EmbeddingClient,
    private embeddingModel: string,
  ) {}

  init(index: VaultIndex): void {
    this.loadedManifest = index.manifest;
    this.noteVectors.clear();
    for (const path of index.paths) {
      const v = index.vectorFor(path);
      if (v) this.noteVectors.set(path, v.slice());
    }
    this.ready = true;
    this.diskCount = index.count;
  }

  private async embedNote(content: string): Promise<Float32Array | null> {
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) return null;
    const vecs = await this.embedder.embed(chunks.map(c => c.text));
    return toIndexVector(vecs, INDEX_DIM);
  }

  async update(path: string, content: string): Promise<void> {
    const v = await this.embedNote(content);
    if (v) this.noteVectors.set(path, v); else this.noteVectors.delete(path);
  }

  remove(path: string): void { this.noteVectors.delete(path); }

  rename(oldPath: string, newPath: string): void {
    const v = this.noteVectors.get(oldPath);
    if (v) { this.noteVectors.set(newPath, v); this.noteVectors.delete(oldPath); }
  }

  get noteCount(): number { return this.noteVectors.size; }

  isReady(): boolean { return this.ready; }

  /** No-Index-Pfad: kein Index auf Platte → leerer Indexer darf gefahrlos aufbauen. */
  markFresh(): void { this.ready = true; this.diskCount = 0; }

  async reindexAll(
    paths: string[],
    read: (p: string) => Promise<string>,
    onProgress?: (done: number, indexed: number, total: number) => void,
  ): Promise<void> {
    const fresh = new Map<string, Float32Array>();
    let indexed = 0;
    for (let i = 0; i < paths.length; i++) {
      try {
        const v = await this.embedNote(await read(paths[i]));
        if (v) { fresh.set(paths[i], v); indexed++; }
      } catch { /* unlesbar/Embed-Fehler überspringen */ }
      onProgress?.(i + 1, indexed, paths.length);
    }
    this.noteVectors = fresh;
    this.ready = true;
  }

  /**
   * Additiver Delta-Reindex: embeddet nur die fehlenden Pfade und fügt sie zur bestehenden
   * Vektor-Map hinzu (KEIN Reset). Dient als „Index vervollständigen" und als Resume für
   * abgebrochene Voll-Reindexe. Gibt die Zahl neu indizierter Notizen zurück.
   */
  async healMissing(
    missing: string[],
    read: (p: string) => Promise<string>,
    onProgress?: (done: number, indexed: number, total: number) => void,
  ): Promise<number> {
    let indexed = 0;
    for (let i = 0; i < missing.length; i++) {
      try {
        const v = await this.embedNote(await read(missing[i]));
        if (v) { this.noteVectors.set(missing[i], v); indexed++; }
      } catch { /* unlesbar/Embed-Fehler überspringen */ }
      onProgress?.(i + 1, indexed, missing.length);
    }
    this.ready = true;
    return indexed;
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

  async persist(reason: PersistReason = "live"): Promise<void> {
    const nextCount = this.noteVectors.size;
    if (!this.ready && reason === "live") {
      throw new PersistBlockedError("not-ready", "Persist verweigert: Index ist nicht initialisiert (Load-Fehler) — der gute Index auf Platte bleibt erhalten.");
    }
    const decision = assertSafeToPersist(this.diskCount, nextCount, reason);
    if (!decision.allowed) {
      throw new PersistBlockedError(decision.kind ?? "shrink", decision.message ?? "Persist verweigert.");
    }
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
      vault: (this.loadedManifest as { vault?: string } | null)?.vault ?? "10_Pallas",
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
    this.ready = true;
    this.diskCount = nextCount;
  }
}
