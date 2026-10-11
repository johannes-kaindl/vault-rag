// vendored from code-kit@0.22.1, src/ts/pure/vector-index.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/index.ts (ohne IndexLoader, VaultIndex → VectorIndex, VaultAdapter → IndexStorage) und vault-rag/src/retriever.ts, 2026-10-11 (Änderungen: `noUncheckedIndexedAccess`-clean; Fehlermeldungen ohne den Präfix "vault-rag")
/** The loaded form of a note index: a manifest, one path per row and a matrix of unit vectors, plus the cosine search
 *  over it. Where the bytes come from is {@link IndexStorage}'s concern (a Node file system, Obsidian's vault
 *  adapter); how they are laid out in a file is `index-container`'s.
 *
 *  Origin: vault-rag (`index.ts`, `retriever.ts`). Renamed `VaultIndex` → `VectorIndex` and `VaultAdapter` →
 *  `IndexStorage`: the second consumer (Oneiron) indexes lessons, not a vault. The error messages began with
 *  "vault-rag index korrupt"; they say "Index korrupt" now (a consumer's name in a library message misleads the other
 *  consumer; no test of vault-rag pinned the prefix). */

export interface IndexManifest {
  schema_version: number;
  embedding_model: string;
  index_dim: number;
  scale: number;
  count: number;
  granularity: string;
  quant: string;
}

/** What the index code needs from a place that stores files. A superset (vault-rag's `VaultAdapter` has `read` and
 *  `write` for text as well) satisfies it structurally.
 *
 *  **Contract for `writeBinary`: atomic.** A reader sees either the old content or the new one, never a mix, and a
 *  crash in the middle leaves the old file. The index code relies on that and does no temp-file dance of its own
 *  (it could not: this layer has no rename, and a `.tmp` file next to a synced index is a second thing for the sync
 *  to carry around). Obsidian's `adapter.writeBinary` queues writes and is accepted; a Node adapter writes a temp
 *  file in the same directory and renames it. `exists` should not throw for a missing file; if it does the loader
 *  treats the file as "might be there". */
export interface IndexStorage {
  exists(path: string): Promise<boolean>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export class VectorIndex {
  private rowMap = new Map<string, number>();
  constructor(readonly manifest: IndexManifest, readonly paths: string[], readonly vectors: Float32Array) {
    paths.forEach((p, i) => this.rowMap.set(p, i));
  }
  get count() { return this.paths.length; }
  get dim() { return this.manifest.index_dim; }
  rowFor(path: string): number { return this.rowMap.get(path) ?? -1; }
  vectorFor(path: string): Float32Array | null {
    const r = this.rowFor(path);
    if (r < 0) return null;
    return this.vectors.subarray(r * this.dim, (r + 1) * this.dim);
  }
}

/** Dequantises the int8 matrix (`manifest.scale`), renormalises every row (quantisation drift) and checks that the
 *  sizes fit: a matrix of the wrong length is an error, not a vector of NaN. */
export function parseIndex(manifest: IndexManifest, paths: string[], matrix: ArrayBuffer): VectorIndex {
  if (manifest.count !== paths.length) {
    throw new Error(`Index korrupt: manifest.count ${manifest.count} != paths ${paths.length}`);
  }
  const dim = manifest.index_dim, scale = manifest.scale, n = paths.length;
  const expectedBytes = n * dim;
  if (matrix.byteLength !== expectedBytes) {
    throw new Error(`Index korrupt: notes.i8 byteLength ${matrix.byteLength} != erwartet ${expectedBytes} (count ${n} × dim ${dim})`);
  }
  const i8 = new Int8Array(matrix);
  const f = new Float32Array(n * dim);
  for (let r = 0; r < n; r++) {
    let norm = 0;
    for (let c = 0; c < dim; c++) { const v = (i8[r * dim + c] ?? 0) / scale; f[r * dim + c] = v; norm += v * v; }
    norm = Math.sqrt(norm) || 1;                       // renormalise (quantisation drift)
    for (let c = 0; c < dim; c++) f[r * dim + c] = (f[r * dim + c] ?? 0) / norm;
  }
  return new VectorIndex(manifest, paths, f);
}

// ---- search -----------------------------------------------------------------------------

export interface Hit { path: string; score: number; }
export interface RetrieveOpts {
  k: number;
  minSim: number;
  /** Path PREFIXES (`startsWith`). Give folders with a slash: "Templates/", "Archive/".
   *  A bare stem such as "b" would also hit "books/…". */
  exclude: string[];
}

export class Retriever {
  constructor(private index: VectorIndex) {}

  related(activePath: string, opts: RetrieveOpts): Hit[] {
    const q = this.index.vectorFor(activePath);
    if (!q) return [];
    return this.rank(q, opts, activePath);
  }

  search(queryVec: Float32Array, opts: RetrieveOpts): Hit[] {
    return this.rank(queryVec, opts);
  }

  private rank(q: Float32Array, opts: RetrieveOpts, skipPath?: string): Hit[] {
    const dim = this.index.dim, vecs = this.index.vectors, paths = this.index.paths;
    // A query vector shorter than the index has no cosine with it. The loop below used to get there by
    // accident (an undefined factor makes the dot product NaN, and `NaN >= minSim` is false for every row).
    if (q.length < dim) return [];
    const hits: Hit[] = [];
    for (let r = 0; r < paths.length; r++) {
      const p = paths[r] ?? "";
      if (p === skipPath || opts.exclude.some(e => p.startsWith(e))) continue;
      let dot = 0;
      for (let c = 0; c < dim; c++) dot += (q[c] ?? 0) * (vecs[r * dim + c] ?? 0);   // cosine (normalised)
      if (dot >= opts.minSim) hits.push({ path: p, score: dot });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.k);
  }
}
