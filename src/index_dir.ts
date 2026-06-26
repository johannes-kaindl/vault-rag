/** Trimmt und entfernt Trailing-Slashes — kanonische Form für Vergleiche und data-path. */
export function normalizeIndexDir(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** Pfade mit `.`-Präfix werden von Obsidian Sync ignoriert (außer `.obsidian`). */
export function isDotPath(raw: string): boolean {
  return normalizeIndexDir(raw).startsWith(".");
}

/**
 * CSS, das den Index-Ordner aus dem Datei-Explorer ausblendet.
 * `data-path` ist internes Obsidian-Markup (kein API) — bricht es, taucht der Ordner nur
 * kosmetisch wieder auf (kein Datenverlust). Ohne `:has()` (Mobile), `display:none`
 * (Explorer-Virtualisierung), Attributwert via JSON.stringify escaped.
 */
export function buildHideCss(indexDir: string, hide: boolean): string {
  const p = normalizeIndexDir(indexDir);
  if (!hide || p === "") return "";
  const sel = `.nav-folder-title[data-path=${JSON.stringify(p)}]`;
  return `${sel},\n${sel} + .nav-folder-children { display: none; }`;
}
