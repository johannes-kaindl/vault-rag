import {
  RetrievalFacade as KitRetrievalFacade, type RetrievalDeps as KitRetrievalDeps,
  type EmbedResult, type SearchResult, type VecSearchResult, type RelatedResult, type RetrieveOverrides,
} from "./vendor/kit/retrieval-facade";
import type { RetrieveOpts } from "./vendor/kit/vector-index";
import { normalizeRelPath } from "./vendor/kit/rel-path";
import { chunkMarkdown } from "./vendor/kit/chunker";

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

/** Warum eine vorhandene Notiz nicht im Index steht: ohne Text (nur Frontmatter oder leer, bleibt dauerhaft draußen, bis jemand Inhalt schreibt) oder mit Text
 *  (der Indexer zieht nach). `unknown`: die Datei ist nicht zu lesen oder der Pfad nicht zulässig — dann bleibt es bei der allgemeinen Antwort. */
export type NotIndexedCause = "frontmatter-only" | "pending" | "unknown";

export type ReadResult = { kind: "ok"; text: string } | { kind: "not-found"; path: string } | { kind: "invalid"; path: string; reason: string };

/** Path-Guard für readNote: vault-relativ, kein Traversal, nur .md, exclude-Präfix (case-insensitiv).
 *  Gibt den normalisierten vault-relativen Pfad zurück. Die Segmentregeln kommen aus code-kit `rel-path` (`normalizeRelPath`,
 *  Ergebnis mit `problem`, kein Wurf); hier wird `problem` in die Meldung übersetzt. Reine String-Logik (kein node:path).
 *
 *  Die Meldungen sind bewusst ENGLISCH und laufen NICHT durch `t()`: `readNote` hat genau einen
 *  Konsumenten — `mcp/tools.ts`, den Loopback-JSON-RPC-Kanal. Das liest ein Agent, kein Mensch in
 *  einer lokalisierten Oberfläche. Die Plugin-API (`plugin_api.ts`) trägt bewusst kein readNote. */
export function resolveNotePath(rel: string, exclude: string[]): string {
  const r = normalizeRelPath(rel);
  if (!r.ok) {
    if (r.problem === "absolute") throw new Error(`Only vault-relative paths are allowed: "${rel}"`);
    if (r.problem === "traversal") throw new Error(`Path escapes the vault: "${rel}"`);
    if (r.problem === "nul") throw new Error(`Path contains a NUL byte: "${rel}"`);
    throw new Error(`Only Markdown notes (.md) can be read: "${rel}"`);
  }
  const norm = r.path;
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
  /** Verwandte Notizen zu einem Pfad. Der Pfad ist ein EXAKTER Schlüssel im Index (kein Dateizugriff): `..`, absolute Pfade, NUL und
   *  Backslash treffen keinen Eintrag und enden als `not-indexed`. Ein Pfad unter `exclude` ebenso, auch wenn ein alter Index ihn noch trägt
   *  (wie `readNote`; die Antwort ist dieselbe wie für einen unbekannten Pfad, sie verrät nicht, ob er im Index steht). */
  related(path: string, opts?: Partial<RetrieveOverrides>): RelatedResult {
    const lower = path.toLowerCase();
    if (this.deps.settings().exclude.some(e => e && lower.startsWith(e.toLowerCase()))) return { kind: "not-indexed", path };
    return this.core.related(path, opts);
  }

  /** Warum `related` für `relPath` mit `not-indexed` antwortet. Nur für den Werkzeugweg (`related_notes`), nie für die öffentliche API: das Lesen der Datei
   *  steht hinter dem Path-Guard (`resolveNotePath`: Traversal, absolute Pfade, NUL, Nicht-Markdown und `exclude` enden als `unknown`, ohne einen Dateizugriff),
   *  und die Antwort für einen Pfad, den es nicht gibt, ist dieselbe wie für einen unzulässigen. Chunks zählt derselbe Chunker, der beim Einbetten entscheidet. */
  async notIndexedCause(relPath: string): Promise<NotIndexedCause> {
    // Zusätzlich zum Path-Guard: Backslash und Steuerzeichen (Windows-Laufwerkspfad, Backspace in einem Dateinamen) lesen wir nie. `resolveNotePath` normalisiert den Backslash zum Schrägstrich und lässt Steuerzeichen durch (sie
    // enden bei `readNote` als „nicht gefunden“); hier wäre ein Treffer eine Aussage über die Datei, und `related` hat sie nie gelesen.
    if ([...relPath].some((ch) => ch === "\\" || ch.charCodeAt(0) < 0x20)) return "unknown";
    let rel: string;
    try { rel = resolveNotePath(relPath, this.deps.settings().exclude); } catch { return "unknown"; }
    let text: string;
    try { text = await this.deps.readVault(rel); } catch { return "unknown"; }
    return chunkMarkdown(text).length === 0 ? "frontmatter-only" : "pending";
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
}
