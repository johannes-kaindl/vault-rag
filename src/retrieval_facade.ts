import {
  RetrievalFacade as KitRetrievalFacade, type RetrievalDeps as KitRetrievalDeps,
  type EmbedResult, type SearchResult, type VecSearchResult, type RelatedResult, type RetrieveOverrides,
} from "./vendor/kit/retrieval-facade";
import type { RetrieveOpts } from "./vendor/kit/vector-index";

export type {
  RetrieveOverrides, EmbedResult, SearchResult, VecSearchResult, RelatedResult,
} from "./vendor/kit/retrieval-facade";

/** Die Anschlüsse des Kit-Kerns plus der Vault-Lesezugriff des MCP-Kanals. */
export interface RetrievalDeps extends KitRetrievalDeps {
  /** Volltext einer vault-relativen Notiz (main.ts übergibt sie symlink-guarded). */
  readVault(rel: string): Promise<string>;
  /** Embedding pausiert (Spec 2026-09-17, E3)? Dann antworten `embedQuery` und `search` mit `paused`, BEVOR der Ready-Check
   *  oder ein Embedding-Aufruf läuft. Fehlt der Anschluss: nie pausiert. */
  isPaused?: () => boolean;
}

/** Pause ist eine Entscheidung des Nutzers, kein Ausfall: ein eigener Zustand neben `offline`, nie dahinein gefaltet. */
export type PausedResult = { kind: "paused" };

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

/** Der Such-Kern (embedQuery, search, searchVector, related) liegt in code-kit; hier steht eine dünne Hülle darum, die
 *  zwei Dinge hat, die nur vault-rag braucht: den Pause-Zustand (`paused` VOR jedem Embedding-Aufruf; als Hülle statt Unterklasse,
 *  weil ein zusätzlicher Ergebnis-Zustand den Rückgabetyp der Basis erweitern würde) und `readNote` mit dem Path-Guard für den
 *  MCP-Kanal. */
export class RetrievalFacade {
  private readonly core: KitRetrievalFacade;
  constructor(protected readonly deps: RetrievalDeps) { this.core = new KitRetrievalFacade(deps); }

  embedQuery(text: string): Promise<EmbedResult | PausedResult> {
    if (this.deps.isPaused?.()) return Promise.resolve({ kind: "paused" });
    return this.core.embedQuery(text);
  }
  search(query: string, opts?: Partial<RetrieveOverrides>): Promise<SearchResult | PausedResult> {
    if (this.deps.isPaused?.()) return Promise.resolve({ kind: "paused" });
    return this.core.search(query, opts);
  }
  searchVector(vec: Float32Array, opts?: Partial<RetrieveOpts>): VecSearchResult { return this.core.searchVector(vec, opts); }
  related(path: string, opts?: Partial<RetrieveOverrides>): RelatedResult { return this.core.related(path, opts); }

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
