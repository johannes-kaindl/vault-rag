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
export type ReadResult = { kind: "ok"; text: string } | { kind: "not-found"; path: string } | { kind: "invalid"; path: string; reason: string };

/** Path-Guard für readNote: vault-relativ, kein Traversal, nur .md, exclude-Präfix (case-insensitiv).
 *  Gibt den normalisierten vault-relativen Pfad zurück. Reine String-Logik (kein node:path). */
export function resolveNotePath(rel: string, exclude: string[]): string {
  if (rel.startsWith("/")) throw new Error(`Nur vault-relative Pfade erlaubt: "${rel}"`);
  const parts = rel.split(/[\\/]/).filter(s => s !== "" && s !== ".");
  if (parts.some(s => s === "..")) throw new Error(`Pfad verlässt den Vault: "${rel}"`);
  const norm = parts.join("/");
  if (!norm.toLowerCase().endsWith(".md")) throw new Error(`Nur Markdown-Notizen (.md) lesbar: "${rel}"`);
  const normLower = norm.toLowerCase();
  const hit = exclude.find(e => e && normLower.startsWith(e.toLowerCase()));
  if (hit) throw new Error(`Pfad liegt unter Ausschluss-Präfix "${hit}": "${rel}"`);
  return norm;
}

export class RetrievalFacade {
  constructor(private deps: RetrievalDeps) {}

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

  /** Volltext einer Notiz mit Path-Guard. Ungültige Pfade → invalid (Grund erhalten). */
  async readNote(relPath: string): Promise<ReadResult> {
    let rel: string;
    try {
      rel = resolveNotePath(relPath, this.deps.settings().exclude);
    } catch (e) {
      return { kind: "invalid", path: relPath, reason: (e as Error).message };
    }
    try {
      return { kind: "ok", text: await this.deps.readVault(rel) };
    } catch {
      return { kind: "not-found", path: relPath };
    }
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
