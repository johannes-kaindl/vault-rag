/** Formatiert den Index-Füllstand als "embedded / total Notizen" (de-DE), mit
 *  Vollständigkeits-Hinweis wenn nichts fehlt. Pure — keine Obsidian-Abhängigkeit,
 *  daher direkt testbar ohne main.ts (das "obsidian" importiert). */
export function indexDeltaReadout(embedded: number, total: number): string {
  const fmt = (n: number): string => n.toLocaleString("de-DE");
  const complete = embedded >= total ? " (vollständig)" : "";
  return `${fmt(embedded)} / ${fmt(total)} Notizen${complete}`;
}
