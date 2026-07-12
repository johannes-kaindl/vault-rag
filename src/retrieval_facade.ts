import { VaultIndex } from "./index";
import { Retriever, Hit, RetrieveOpts } from "./retriever";
import { toIndexVector } from "./embed_vector";

/** Live-Anschlüsse, die die Fassade konsumiert — vom Plugin (main.ts) injiziert.
 *  Zustandslos: getIndex()/embed etc. liefern immer das aktuelle Live-Objekt. */
export interface RetrievalDeps {
  getIndex(): VaultIndex | null;
  /** ready-check inkl. Re-Resolve-Retry (der EINE Endpoint-Resolver-Pfad). */
  embedderReady(): Promise<boolean>;
  /** roher Batch-Embed (EmbeddingClient.embed); die Fassade ruft embed([text]). */
  embed(texts: string[]): Promise<Float32Array[]>;
  settings(): { k: number; minSim: number; exclude: string[] };
  /** Volltext einer vault-relativen Notiz (main.ts übergibt sie symlink-guarded). */
  readVault(rel: string): Promise<string>;
}

/** Per-Call überschreibbar; exclude bleibt IMMER aus settings(). */
export interface RetrieveOverrides { k: number; minSim: number }

export type EmbedResult = { kind: "vec"; vec: Float32Array } | { kind: "no-index" } | { kind: "offline" };
export type SearchResult = { kind: "hits"; hits: Hit[] } | { kind: "no-index" } | { kind: "offline" };
export type VecSearchResult = { kind: "hits"; hits: Hit[] } | { kind: "no-index" };
export type RelatedResult = { kind: "hits"; hits: Hit[] } | { kind: "no-index" } | { kind: "not-indexed"; path: string };

export class RetrievalFacade {
  constructor(private deps: RetrievalDeps) {}

  /** Query-Text → Vektor im Index-Raum. Erwartbare Zustände als Werte, nie throw. */
  async embedQuery(text: string): Promise<EmbedResult> {
    const index = this.deps.getIndex();
    if (!index) return { kind: "no-index" };
    return this.embedWith(index, text);
  }

  /** Reine Cosinus-Suche mit fertigem Query-Vektor (kein embed, kein ready-check). */
  searchVector(vec: Float32Array, opts?: Partial<RetrieveOverrides>): VecSearchResult {
    const index = this.deps.getIndex();
    if (!index) return { kind: "no-index" };
    return { kind: "hits", hits: new Retriever(index).search(vec, this.resolveOpts(opts)) };
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

  private async embedWith(index: VaultIndex, text: string): Promise<{ kind: "vec"; vec: Float32Array } | { kind: "offline" }> {
    if (!(await this.deps.embedderReady())) return { kind: "offline" };
    try {
      const vecs = await this.deps.embed([text]);
      if (vecs.length === 0) return { kind: "offline" };
      return { kind: "vec", vec: toIndexVector(vecs, index.dim) };
    } catch {
      return { kind: "offline" };
    }
  }

  private resolveOpts(opts?: Partial<RetrieveOverrides>): RetrieveOpts {
    const s = this.deps.settings();
    return { k: opts?.k ?? s.k, minSim: opts?.minSim ?? s.minSim, exclude: s.exclude };
  }
}
