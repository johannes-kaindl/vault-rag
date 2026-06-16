import { VaultIndex } from "./index";

export interface Hit { path: string; score: number; }
export interface RetrieveOpts { k: number; minSim: number; exclude: string[]; }

export class Retriever {
  constructor(private index: VaultIndex) {}

  related(activePath: string, opts: RetrieveOpts): Hit[] {
    const q = this.index.vectorFor(activePath);
    if (!q) return [];
    const dim = this.index.dim, vecs = this.index.vectors, paths = this.index.paths;
    const excl = new Set(opts.exclude);
    const hits: Hit[] = [];
    for (let r = 0; r < paths.length; r++) {
      const p = paths[r];
      if (p === activePath || excl.has(p) || opts.exclude.some(e => p.startsWith(e))) continue;
      let dot = 0;
      for (let c = 0; c < dim; c++) dot += q[c] * vecs[r * dim + c];   // Cosinus (normalisiert)
      if (dot >= opts.minSim) hits.push({ path: p, score: dot });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.k);
  }
}
