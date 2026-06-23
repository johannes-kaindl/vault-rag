export interface TemplateSection { heading: string; level: number; placeholder: string }
export interface TemplateSpec { type: string; keys: string[]; sections: TemplateSection[]; raw: string }

// Lokal — chunker.ts exportiert seine FRONTMATTER_RE nicht.
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/** Entfernt %% ... %%-Annotationen (auch mehrzeilig). Zeilen, die danach nur noch
 *  Whitespace enthalten, werden zur Leerzeile kollabiert (kein leerer Zeilenmüll). */
export function stripAnnotations(text: string): string {
  const stripped = text.replace(/%%[\s\S]*?%%/g, "");
  return stripped.replace(/^[^\S\n]+$/gm, "");
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
  const fm = FRONTMATTER_RE.exec(text);
  const keys: string[] = [];
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const km = /^([A-Za-z0-9_-]+):/.exec(line);
      if (km) keys.push(km[1]);
    }
  }
  const body = fm ? text.slice(fm[0].length) : text;
  const lines = body.split("\n");
  const sections: TemplateSection[] = [];
  let cur: { heading: string; level: number; buf: string[] } | null = null;
  const flush = (): void => {
    if (cur) sections.push({ heading: cur.heading, level: cur.level, placeholder: cur.buf.join("\n").trim() });
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
  return { type: extractType(text) ?? "", keys, sections, raw: text };
}

/** Emoji + Whitespace raus, lowercase — für robusten Typ/Template-Vergleich. */
function normalizeType(s: string): string {
  return s
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, "")
    .toLowerCase();
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
