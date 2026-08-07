import { chunkMarkdown } from "./chunker";
import { t } from "./vendor/kit/i18n";

/** Formatiert den Index-Füllstand als "embedded / total notes" (i18n via t(),
 *  Zahlformat über die Runtime-Default-Locale), mit Vollständigkeits-Hinweis wenn
 *  nichts fehlt und optionalem Hinweis auf ignorierte leere Notizen. Pure — keine
 *  Obsidian-Abhängigkeit, daher direkt testbar ohne main.ts (das "obsidian" importiert). */
export function indexDeltaReadout(embedded: number, total: number, emptyCount = 0): string {
  const fmt = (n: number): string => n.toLocaleString();
  const complete = embedded >= total ? t("indexDelta.complete") : "";
  const empty = emptyCount > 0 ? t("indexDelta.emptyIgnored", fmt(emptyCount)) : "";
  return `${t("indexDelta.readout", fmt(embedded), fmt(total))}${complete}${empty}`;
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

/** Teilt die missing-Pfade in Heal-Arbeit und bereits als leer bekannte Pfade: leere werden
 *  nicht erneut embeddet (embedNote → null wäre garantiert) und verfälschen so weder den
 *  Fortschritts-Zähler noch die Abschluss-Meldung. Frisch klassifiziert wird bei jedem
 *  loadIndex; neue Leere unter den embeddable fängt healMissing selbst (skippedEmpty). */
export function splitHealTargets(
  missing: string[],
  emptyPaths: ReadonlySet<string>,
): { embeddable: string[]; knownEmpty: string[] } {
  return {
    embeddable: missing.filter(p => !emptyPaths.has(p)),
    knownEmpty: missing.filter(p => emptyPaths.has(p)),
  };
}

/** Ehrliche Heal-Abschluss-Meldung: weist leere und fehlgeschlagene Notizen getrennt aus,
 *  statt sie stumm in „0 ergänzt" zu verstecken. */
export function healResultMessage(added: number, skippedEmpty: number, failed: number): string {
  const fmt = (n: number): string => n.toLocaleString();
  if (added === 0 && failed === 0 && skippedEmpty > 0) {
    return t("indexDelta.completeEmptySkipped", fmt(skippedEmpty));
  }
  let msg = added === 1
    ? t("indexDelta.completed.singular", fmt(added))
    : t("indexDelta.completed.plural", fmt(added));
  if (skippedEmpty > 0) msg += t("indexDelta.skippedEmptySuffix", fmt(skippedEmpty));
  if (failed > 0) msg += t("indexDelta.failedSuffix", fmt(failed));
  return msg + ".";
}
