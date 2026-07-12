import { Hit } from "../retriever";
import { RetrievalFacade } from "../retrieval_facade";

export interface HitList { hits: { path: string; score: number }[] }

/** Transport-freie Tool-Handler des MCP-Servers — register_tools.ts ist die SDK-Schale.
 *  Dünner Adapter über die geteilte RetrievalFacade: Result-Unions → JSON bzw. throw. */
export class McpTools {
  constructor(private facade: RetrievalFacade) {}

  private static toHitList(hits: Hit[]): HitList {
    return { hits: hits.map(h => ({ path: h.path, score: Math.round(h.score * 1000) / 1000 })) };
  }

  async search(a: { query: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const r = await this.facade.search(a.query, { k: a.k, minSim: a.min_similarity });
    if (r.kind === "no-index") throw new Error("Kein Index geladen — im Plugin (neu) indizieren oder aus Backup wiederherstellen.");
    if (r.kind === "offline") throw new Error("Embedding-Endpoint nicht erreichbar.");
    return McpTools.toHitList(r.hits);
  }

  async related(a: { path: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const r = this.facade.related(a.path, { k: a.k, minSim: a.min_similarity });
    if (r.kind === "no-index") throw new Error("Kein Index geladen — im Plugin (neu) indizieren oder aus Backup wiederherstellen.");
    if (r.kind === "not-indexed") throw new Error(`Notiz nicht im Index: "${a.path}" — nicht indexiert (exclude-Regel?) oder noch nicht embedded.`);
    return McpTools.toHitList(r.hits);
  }

  async readNote(a: { path: string }): Promise<{ path: string; content: string }> {
    const r = await this.facade.readNote(a.path);
    if (r.kind === "invalid") throw new Error(r.reason);
    if (r.kind === "not-found") throw new Error(`Notiz nicht gefunden: "${a.path}"`);
    return { path: a.path, content: r.text };
  }
}
