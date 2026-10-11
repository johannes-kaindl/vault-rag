// vendored from code-kit@0.22.0, src/ts/pure/retrieval-facade.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/retrieval_facade.ts (ohne resolveNotePath, readNote und RetrievalDeps.readVault), 2026-10-11 (Änderungen: VectorIndex/Retriever/toIndexVector aus den Kit-Modulen; Verhalten unverändert)
/** The search side in one place: query text → vector in the index space → cosine over the loaded index, `related` for a
 *  note that is in the index, and the expected states as VALUES (`no-index`, `offline`, `not-indexed`), never a throw.
 *
 *  Everything it needs from outside is in {@link RetrievalDeps}: the CURRENT index (a getter, because the index is
 *  replaced while the program runs), whether an embedder is ready, the embed function, the search settings. How the
 *  query vector comes about is the caller's: Obsidian's `requestUrl`, a Node `fetch` with a deadline (the hook's 10 s)
 *  — whatever `embed` does, a failure or a timeout there is `offline` here.
 *
 *  Origin: vault-rag. Left there: `resolveNotePath` and `readNote` (the path guard and the vault read of the MCP channel;
 *  vault-rag extends this class by them). */

import { toIndexVector } from "./embed-vector";
import { Retriever, type Hit, type RetrieveOpts, type VectorIndex } from "./vector-index";

/** Live connections the facade consumes — injected by the host. Stateless: `getIndex()`/`embed` etc. always return the
 *  current live object. */
export interface RetrievalDeps {
  getIndex(): VectorIndex | null;
  /** Ready check including the re-resolve retry (the ONE endpoint resolver path). */
  embedderReady(): Promise<boolean>;
  /** Raw batch embed; the facade calls embed([text]). */
  embed(texts: string[]): Promise<Float32Array[]>;
  settings(): { k: number; minSim: number; exclude: string[] };
}

/** Overridable per call; exclude always stays from settings(). */
export interface RetrieveOverrides { k: number; minSim: number }

export type EmbedResult = { kind: "vec"; vec: Float32Array } | { kind: "no-index" } | { kind: "offline" };
export type SearchResult = { kind: "hits"; hits: Hit[] } | { kind: "no-index" } | { kind: "offline" };
export type VecSearchResult = { kind: "hits"; hits: Hit[] } | { kind: "no-index" };
export type RelatedResult = { kind: "hits"; hits: Hit[] } | { kind: "no-index" } | { kind: "not-indexed"; path: string };

export class RetrievalFacade {
  constructor(protected readonly deps: RetrievalDeps) {}

  /** Query-Text → Vektor im Index-Raum. Erwartbare Zustände als Werte, nie throw. */
  async embedQuery(text: string): Promise<EmbedResult> {
    const index = this.deps.getIndex();
    if (!index) return { kind: "no-index" };
    return this.embedWith(index, text);
  }

  /** Reine Cosinus-Suche mit fertigem Query-Vektor (kein embed, kein ready-check).
   *  Interner Low-Level-Pfad (Chat + SmartApply-Detect) — opts.exclude überschreibt settings().exclude,
   *  falls angegeben (im Gegensatz zu search()/related(), die exclude strikt aus settings() ziehen). */
  searchVector(vec: Float32Array, opts?: Partial<RetrieveOpts>): VecSearchResult {
    const index = this.deps.getIndex();
    if (!index) return { kind: "no-index" };
    return { kind: "hits", hits: new Retriever(index).search(vec, this.resolveOpts(opts, true)) };
  }

  /** Query-Text → embed → Cosinus. */
  async search(query: string, opts?: Partial<RetrieveOverrides>): Promise<SearchResult> {
    const index = this.deps.getIndex();          // Snapshot vor dem await (kein Reload-Race)
    if (!index) return { kind: "no-index" };
    const e = await this.embedWith(index, query);
    if (e.kind !== "vec") return e;              // offline
    return { kind: "hits", hits: new Retriever(index).search(e.vec, this.resolveOpts(opts)) };
  }

  /** Verwandte Notizen zu einem Pfad (offline, direkt aus dem Index). */
  related(path: string, opts?: Partial<RetrieveOverrides>): RelatedResult {
    const index = this.deps.getIndex();
    if (!index) return { kind: "no-index" };
    if (index.rowFor(path) < 0) return { kind: "not-indexed", path };
    return { kind: "hits", hits: new Retriever(index).related(path, this.resolveOpts(opts)) };
  }

  private async embedWith(index: VectorIndex, text: string): Promise<{ kind: "vec"; vec: Float32Array } | { kind: "offline" }> {
    try {
      if (!(await this.deps.embedderReady())) return { kind: "offline" };
      const vecs = await this.deps.embed([text]);
      if (vecs.length === 0) return { kind: "offline" };
      return { kind: "vec", vec: toIndexVector(vecs, index.dim) };
    } catch {
      return { kind: "offline" };
    }
  }

  /** allowExclude: nur searchVector darf opts.exclude durchreichen (internes Nutzungsmuster).
   *  search()/related() rufen ohne allowExclude → exclude kommt immer aus settings(). */
  private resolveOpts(opts?: Partial<RetrieveOpts>, allowExclude = false): RetrieveOpts {
    const s = this.deps.settings();
    return {
      k: opts?.k ?? s.k,
      minSim: opts?.minSim ?? s.minSim,
      exclude: allowExclude && opts?.exclude ? opts.exclude : s.exclude,
    };
  }
}
