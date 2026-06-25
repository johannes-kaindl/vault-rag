import { parseFrontmatter } from "./frontmatter";
import type { FmValue } from "./frontmatter";

export interface TemplateSection { heading: string; level: number; placeholder: string; guidance: string }
export interface TemplateSpec { type: string; keys: string[]; fmDefaults: Record<string, FmValue>; fmGuidance?: Record<string, string>; sections: TemplateSection[]; raw: string }

// Lokal — chunker.ts exportiert seine FRONTMATTER_RE nicht.
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/** Entfernt %% ... %%-Annotationen (auch mehrzeilig). Zeilen, die danach nur noch
 *  Whitespace enthalten, werden zur Leerzeile kollabiert (kein leerer Zeilenmüll). */
export function stripAnnotations(text: string): string {
  const stripped = text.replace(/%%[\s\S]*?%%/g, "");
  return stripped.replace(/^[^\S\n]+$/gm, "");
}

/** Sammelt den Inhalt aller %% … %%-Annotationen (Marker entfernt), zu einem Hinweis verbunden.
 *  Unbalancierte/halboffene %% werden ignoriert (kein Match). */
export function extractAnnotations(text: string): string {
  const out: string[] = [];
  const re = /%%([\s\S]*?)%%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim();
    if (inner) out.push(inner);
  }
  return out.join(" ");
}

/** type: aus dem Frontmatter-Block. null wenn kein Frontmatter oder kein type-Key. */
export function extractType(noteText: string): string | null {
  const fm = FRONTMATTER_RE.exec(noteText);
  if (!fm) return null;
  const m = /^type:\s*(.+)$/m.exec(fm[1]);
  if (!m) return null;
  const raw = m[1].trim();
  return raw.replace(/^["'](.*)["']$/, "$1").trim() || null;
}

/** Template-Datei → Schema: Frontmatter-Keys + geordnete Body-Überschriften (mit Platzhaltertext). */
export function parseTemplate(text: string): TemplateSpec {
  const parsed = parseFrontmatter(text);
  const keys = parsed.order;
  const fmDefaults = parsed.data;
  const fmGuidance = parsed.comments ?? {};
  const body = parsed.body;
  const lines = body.split("\n");
  const sections: TemplateSection[] = [];
  let cur: { heading: string; level: number; buf: string[] } | null = null;
  const flush = (): void => {
    if (cur) {
      const buf = cur.buf.join("\n");
      sections.push({
        heading: cur.heading,
        level: cur.level,
        placeholder: stripAnnotations(buf).trim(),
        guidance: extractAnnotations(buf),
      });
    }
  };
  for (const line of lines) {
    const hm = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (hm) {
      flush();
      cur = { heading: hm[2], level: hm[1].length, buf: [] };
    } else if (cur) {
      cur.buf.push(line);
    }
  }
  flush();
  return { type: extractType(text) ?? "", keys, fmDefaults, fmGuidance, sections, raw: text };
}

/** Emoji + Whitespace raus, lowercase — für robusten Typ/Template-Vergleich. */
function normalizeType(s: string): string {
  return s
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** Eine Folder Note: eine Notiz, deren Dateiname (ohne .md) dem Namen ihres unmittelbaren
 *  Elternordners entspricht (z.B. `Projekt/Projekt.md`). Top-Level-Dateien sind keine. */
export function isFolderNote(path: string): boolean {
  const parts = path.split("/");
  if (parts.length < 2) return false; // keine Elternordner-Ebene
  const base = parts[parts.length - 1].replace(/\.md$/i, "");
  const parent = parts[parts.length - 2];
  return base.toLowerCase() === parent.toLowerCase(); // case-insensitiv wie Obsidian (macOS/Windows)
}

/** Alle Markdown-Pfade unter `dir` (inkl. Unterordnern), sibling-sicher. Folder Notes
 *  (Name === Elternordner) werden ausgeschlossen — sie sind keine Vorlagen. Leeres dir → []. */
export function templateFilesUnder(mdPaths: string[], dir: string): string[] {
  const d = dir.trim();
  if (d === "") return [];
  const prefix = d.endsWith("/") ? d : d + "/";
  return mdPaths.filter(p => p.startsWith(prefix) && !isFolderNote(p));
}

/** Findet das Template, dessen Basename (ohne Verzeichnis/.md) zum Typ passt — emoji/case-normalisiert. */
export function resolveTemplateForType(type: string, templates: string[]): string | null {
  const want = normalizeType(type);
  if (!want) return null;
  for (const path of templates) {
    const base = path.replace(/^.*\//, "").replace(/\.md$/i, "");
    if (normalizeType(base) === want) return path;
  }
  return null;
}

export type SuggestionSource = "frontmatter" | "rag" | "none";
export interface TypeSuggestion {
  type: string | null; templatePath: string | null;
  source: SuggestionSource; confidence: "no" | "likely" | "confirmed";
}
export interface DetectDeps {
  read: (p: string) => Promise<string>;
  listTemplates: () => Promise<string[]>;
  embed: (text: string) => Promise<Float32Array>;
  search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
  typeOf: (p: string) => Promise<string | null>;
}

const NONE: TypeSuggestion = { type: null, templatePath: null, source: "none", confidence: "no" };
const RAG_K = 8;
const RAG_MIN_SIM = 0.2;

/** Typ-Erkennung als Fallback-Kette (KEIN LLM): Frontmatter-type → RAG-Vote → none. */
export async function detectType(notePath: string, deps: DetectDeps): Promise<TypeSuggestion> {
  const text = await deps.read(notePath);
  const templates = await deps.listTemplates();

  // (a) Gültiges Frontmatter-type + passendes Template → bestätigt.
  const fmType = extractType(text);
  if (fmType) {
    const tpl = resolveTemplateForType(fmType, templates);
    if (tpl) return { type: fmType, templatePath: tpl, source: "frontmatter", confidence: "confirmed" };
  }

  // (b) Aktiven Body LIVE einbetten + search(vec) → gewichteter Vote über top-k Hit-Typen.
  const body = text.replace(FRONTMATTER_RE, "");
  try {
    const vec = await deps.embed(body);
    const hits = deps.search(vec, { k: RAG_K, minSim: RAG_MIN_SIM, exclude: ["Templates/"] });
    const votes = new Map<string, number>();
    for (const h of hits) {
      let t: string | null;
      try { t = await deps.typeOf(h.path); } catch { continue; }
      if (!t) continue;
      votes.set(t, (votes.get(t) ?? 0) + h.score);
    }
    let bestType: string | null = null;
    let bestScore = -Infinity;
    for (const [t, score] of votes) {
      if (score > bestScore) { bestScore = score; bestType = t; }
    }
    if (bestType) {
      const tpl = resolveTemplateForType(bestType, templates);
      return { type: bestType, templatePath: tpl, source: "rag", confidence: "likely" };
    }
  } catch {
    // Embedder/Index offline → sauber auf none degradieren.
  }

  // (c) Nichts gefunden.
  return NONE;
}
