import { parseFrontmatter } from "./frontmatter";
import { extractType, resolveTemplateForType } from "./template_matcher";

export interface TemplateRank {
  templatePath: string;
  type: string;
  /** Rohe Cosinus-Ähnlichkeit 0..1 (0 = nicht eingebettet / Embedder offline). */
  score: number;
  source: "confirmed" | "match" | "fallback";
}

export interface RankDeps {
  read: (path: string) => Promise<string>;
  stat: (path: string) => Promise<{ mtime: number }>;
  listTemplates: () => Promise<string[]>;
  /** text → unit-norm reduzierter Vektor (im Wiring: toIndexVector(embedder.embed([t]), index.dim)). */
  embed: (text: string) => Promise<Float32Array>;
}

/** Skalarprodukt zweier unit-norm Vektoren = Cosinus. Defensiv gegen Längen-Mismatch/Leere. */
function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function basename(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.md$/i, "");
}

/** Rankt Vorlagen nach direkter Cosinus-Ähnlichkeit der aktiven Notiz zum Vorlagen-Text.
 *  Frontmatter-`type` pinnt die passende Vorlage als "confirmed" nach oben.
 *  Embedder offline → kein Throw: alphabetischer Fallback (score 0). Cache per mtime. */
export class TemplateRanker {
  private cache = new Map<string, { mtime: number; vec: Float32Array }>();
  constructor(private deps: RankDeps) {}

  async rank(notePath: string): Promise<TemplateRank[]> {
    const templates = await this.deps.listTemplates();
    const noteText = await this.deps.read(notePath);
    const fmType = extractType(noteText);
    const pinnedPath = fmType ? resolveTemplateForType(fmType, templates) : null;

    let queryVec: Float32Array | null = null;
    try {
      const vec = await this.deps.embed(parseFrontmatter(noteText).body);
      queryVec = vec.length > 0 ? vec : null;
    } catch {
      queryVec = null; // Embedder/Index offline → sauber degradieren.
    }

    const ranks: TemplateRank[] = [];
    for (const path of templates) {
      const type = basename(path);
      const confirmed = path === pinnedPath;
      if (queryVec === null) {
        ranks.push({ templatePath: path, type, score: 0, source: confirmed ? "confirmed" : "fallback" });
        continue;
      }
      let score = 0;
      try {
        score = dot(queryVec, await this.templateVec(path));
      } catch {
        score = 0; // einzelne Vorlage nicht einbettbar → score 0, bleibt gelistet.
      }
      ranks.push({ templatePath: path, type, score, source: confirmed ? "confirmed" : "match" });
    }

    ranks.sort((a, b) => {
      const ca = a.source === "confirmed" ? 1 : 0;
      const cb = b.source === "confirmed" ? 1 : 0;
      if (ca !== cb) return cb - ca;
      if (b.score !== a.score) return b.score - a.score;
      return a.templatePath < b.templatePath ? -1 : a.templatePath > b.templatePath ? 1 : 0;
    });
    return ranks;
  }

  private async templateVec(path: string): Promise<Float32Array> {
    const { mtime } = await this.deps.stat(path);
    const cached = this.cache.get(path);
    if (cached && cached.mtime === mtime) return cached.vec;
    const vec = await this.deps.embed(await this.deps.read(path)); // ganze Vorlage inkl. %%-Anleitung
    this.cache.set(path, { mtime, vec });
    return vec;
  }
}
