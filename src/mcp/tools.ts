import { VaultIndex } from "../index";
import { Retriever, Hit } from "../retriever";
import type { McpDeps } from "./mcp_deps";

export interface HitList { hits: { path: string; score: number }[] }

/** Path-Guard für read_note: vault-relativ, kein Traversal, nur .md, exclude-Präfix (case-insensitiv).
 *  Gibt den normalisierten vault-relativen Pfad zurück (der VaultAdapter liest vault-relativ) —
 *  kein node:path nötig, reine String-Logik. Was vom Index ausgeschlossen ist, gibt der Server
 *  auch nicht als Volltext heraus. */
export function resolveNotePath(rel: string, exclude: string[]): string {
  if (rel.startsWith("/")) throw new Error(`Nur vault-relative Pfade erlaubt: "${rel}"`);
  // Segmente normalisieren, "."/leere entfernen, ".." verbieten.
  const parts = rel.split(/[\\/]/).filter(s => s !== "" && s !== ".");
  if (parts.some(s => s === "..")) throw new Error(`Pfad verlässt den Vault: "${rel}"`);
  const norm = parts.join("/");
  if (!norm.toLowerCase().endsWith(".md")) throw new Error(`Nur Markdown-Notizen (.md) lesbar: "${rel}"`);
  const normLower = norm.toLowerCase();
  const hit = exclude.find(e => e && normLower.startsWith(e.toLowerCase()));
  if (hit) throw new Error(`Pfad liegt unter Ausschluss-Präfix "${hit}": "${rel}"`);
  return norm;
}

/** Transport-freie Tool-Handler des MCP-Servers — register_tools.ts ist die SDK-Schale. */
export class McpTools {
  constructor(private deps: McpDeps) {}

  private requireIndex(): VaultIndex {
    const index = this.deps.getIndex();
    if (!index) throw new Error("Kein Index geladen — im Plugin (neu) indizieren oder aus Backup wiederherstellen.");
    return index;
  }

  private opts(k: number | undefined, minSim: number | undefined) {
    const s = this.deps.settings();
    return { k: k ?? s.k, minSim: minSim ?? s.minSim, exclude: s.exclude };
  }

  private static toHitList(hits: Hit[]): HitList {
    return { hits: hits.map(h => ({ path: h.path, score: Math.round(h.score * 1000) / 1000 })) };
  }

  async search(a: { query: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const index = this.requireIndex();
    const vec = await this.deps.embedQuery(a.query, index.dim);
    return McpTools.toHitList(new Retriever(index).search(vec, this.opts(a.k, a.min_similarity)));
  }

  async related(a: { path: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const index = this.requireIndex();
    if (index.rowFor(a.path) < 0) {
      throw new Error(`Notiz nicht im Index: "${a.path}" — nicht indexiert (exclude-Regel?) oder noch nicht embedded.`);
    }
    return McpTools.toHitList(new Retriever(index).related(a.path, this.opts(a.k, a.min_similarity)));
  }

  async readNote(a: { path: string }): Promise<{ path: string; content: string }> {
    const rel = resolveNotePath(a.path, this.deps.settings().exclude);
    try {
      return { path: a.path, content: await this.deps.readNote(rel) };
    } catch {
      throw new Error(`Notiz nicht gefunden: "${a.path}"`);
    }
  }
}
