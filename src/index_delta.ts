import { chunkMarkdown } from "./chunker";

/** Formatiert den Index-Füllstand als "embedded / total Notizen" (de-DE), mit
 *  Vollständigkeits-Hinweis wenn nichts fehlt und optionalem Hinweis auf ignorierte
 *  leere Notizen. Pure — keine Obsidian-Abhängigkeit, daher direkt testbar ohne main.ts
 *  (das "obsidian" importiert). */
export function indexDeltaReadout(embedded: number, total: number, emptyCount = 0): string {
  const fmt = (n: number): string => n.toLocaleString("de-DE");
  const complete = embedded >= total ? " (vollständig)" : "";
  const empty = emptyCount > 0 ? ` · ${fmt(emptyCount)} leere Notizen ignoriert` : "";
  return `${fmt(embedded)} / ${fmt(total)} Notizen${complete}${empty}`;
}

/** Rechnet das Anzeige-Delta unter Ausschluss nicht-indexierbarer (chunk-loser) Notizen:
 *  leere Notizen zählen weder als fehlend noch ins Soll — sie KÖNNEN nie im Index landen
 *  (embedNote → null). Nur die Schnittmenge missing∩empty zählt; ein leerer Pfad, der
 *  (noch) im Index steht, bleibt im Soll. */
export function computeIndexDelta(
  vaultTotal: number,
  missing: string[],
  emptyPaths: ReadonlySet<string>,
): { embedded: number; total: number; emptyCount: number } {
  const emptyCount = missing.filter(p => emptyPaths.has(p)).length;
  const total = vaultTotal - emptyCount;
  const embedded = total - (missing.length - emptyCount);
  return { embedded, total, emptyCount };
}

/** Klassifiziert Pfade als chunk-los (leer / nur Frontmatter → kein embeddbarer Inhalt).
 *  Unlesbare Dateien gelten NICHT als leer — sie bleiben ehrlich im Fehl-Delta. */
export async function classifyChunkless(
  paths: string[],
  read: (p: string) => Promise<string>,
): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    try {
      if (chunkMarkdown(await read(p)).length === 0) out.push(p);
    } catch { /* unlesbar ≠ leer */ }
  }
  return out;
}

/** Ehrliche Heal-Abschluss-Meldung: weist leere und fehlgeschlagene Notizen getrennt aus,
 *  statt sie stumm in „0 ergänzt" zu verstecken. */
export function healResultMessage(added: number, skippedEmpty: number, failed: number): string {
  const fmt = (n: number): string => n.toLocaleString("de-DE");
  if (added === 0 && failed === 0 && skippedEmpty > 0) {
    return `Index vollständig — ${fmt(skippedEmpty)} leere Notizen übersprungen (kein Inhalt).`;
  }
  let msg = `Index vervollständigt: ${fmt(added)} ${added === 1 ? "Notiz" : "Notizen"} ergänzt`;
  if (skippedEmpty > 0) msg += ` · ${fmt(skippedEmpty)} leere übersprungen`;
  if (failed > 0) msg += ` · ${fmt(failed)} fehlgeschlagen`;
  return msg + ".";
}
