import {
  RetrievalFacade as KitRetrievalFacade, type RetrievalDeps as KitRetrievalDeps,
} from "./vendor/kit/retrieval-facade";

export type {
  RetrieveOverrides, EmbedResult, SearchResult, VecSearchResult, RelatedResult,
} from "./vendor/kit/retrieval-facade";

/** Die Anschlüsse des Kit-Kerns plus der Vault-Lesezugriff des MCP-Kanals. */
export interface RetrievalDeps extends KitRetrievalDeps {
  /** Volltext einer vault-relativen Notiz (main.ts übergibt sie symlink-guarded). */
  readVault(rel: string): Promise<string>;
}

export type ReadResult = { kind: "ok"; text: string } | { kind: "not-found"; path: string } | { kind: "invalid"; path: string; reason: string };

/** Path-Guard für readNote: vault-relativ, kein Traversal, nur .md, exclude-Präfix (case-insensitiv).
 *  Gibt den normalisierten vault-relativen Pfad zurück. Reine String-Logik (kein node:path).
 *
 *  Die Meldungen sind bewusst ENGLISCH und laufen NICHT durch `t()`: `readNote` hat genau einen
 *  Konsumenten — `mcp/tools.ts`, den Loopback-JSON-RPC-Kanal. Das liest ein Agent, kein Mensch in
 *  einer lokalisierten Oberfläche. Die Plugin-API (`plugin_api.ts`) trägt bewusst kein readNote. */
export function resolveNotePath(rel: string, exclude: string[]): string {
  if (rel.startsWith("/")) throw new Error(`Only vault-relative paths are allowed: "${rel}"`);
  const parts = rel.split(/[\\/]/).filter(s => s !== "" && s !== ".");
  if (parts.some(s => s === "..")) throw new Error(`Path escapes the vault: "${rel}"`);
  const norm = parts.join("/");
  if (!norm.toLowerCase().endsWith(".md")) throw new Error(`Only Markdown notes (.md) can be read: "${rel}"`);
  const normLower = norm.toLowerCase();
  const hit = exclude.find(e => e && normLower.startsWith(e.toLowerCase()));
  if (hit) throw new Error(`Path is under excluded prefix "${hit}": "${rel}"`);
  return norm;
}

/** Der Such-Kern (embedQuery, search, searchVector, related) liegt in code-kit; hier bleibt, was nur vault-rag hat:
 *  `readNote` mit dem Path-Guard für den MCP-Kanal. */
export class RetrievalFacade extends KitRetrievalFacade {
  constructor(protected override readonly deps: RetrievalDeps) { super(deps); }

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
}
