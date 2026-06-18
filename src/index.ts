export interface IndexManifest {
  schema_version: number;
  embedding_model: string;
  index_dim: number;
  scale: number;
  count: number;
  granularity: string;
  quant: string;
}

export interface VaultAdapter {
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export class VaultIndex {
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

export function parseIndex(manifest: IndexManifest, paths: string[], matrix: ArrayBuffer): VaultIndex {
  if (manifest.count !== paths.length) {
    throw new Error(`vault-rag index korrupt: manifest.count ${manifest.count} != paths ${paths.length}`);
  }
  const dim = manifest.index_dim, scale = manifest.scale, n = paths.length;
  const i8 = new Int8Array(matrix);
  const f = new Float32Array(n * dim);
  for (let r = 0; r < n; r++) {
    let norm = 0;
    for (let c = 0; c < dim; c++) { const v = i8[r * dim + c] / scale; f[r * dim + c] = v; norm += v * v; }
    norm = Math.sqrt(norm) || 1;                       // Renormalisieren (Quant-Drift)
    for (let c = 0; c < dim; c++) f[r * dim + c] /= norm;
  }
  return new VaultIndex(manifest, paths, f);
}

export class IndexLoader {
  constructor(private adapter: VaultAdapter, private dir: string) {}
  async load(): Promise<VaultIndex> {
    const manifest = JSON.parse(await this.adapter.read(`${this.dir}/manifest.json`)) as IndexManifest;
    const paths = JSON.parse(await this.adapter.read(`${this.dir}/paths.json`)) as string[];
    const matrix = await this.adapter.readBinary(`${this.dir}/notes.i8`);
    return parseIndex(manifest, paths, matrix);
  }
}
