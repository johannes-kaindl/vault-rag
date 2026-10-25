// Anzeige-Texte des Index-Füllstands und des Heal-Ergebnisses (mit t()). Die Rechnung dahinter (computeIndexDelta,
// classifyChunkless, splitHealTargets) liegt seit Welle 17 in code-kit (`./vendor/kit/index-delta`).
import { t } from "./vendor/kit/i18n";
import type { StampGapView } from "./stamp_gap";

/** Formatiert den Index-Füllstand als "embedded / total notes" (i18n via t(),
 *  Zahlformat über die Runtime-Default-Locale), mit Vollständigkeits-Hinweis wenn
 *  nichts fehlt und optionalem Hinweis auf ignorierte leere Notizen. Pure — keine
 *  Obsidian-Abhängigkeit, daher direkt testbar ohne main.ts (das "obsidian" importiert). */
export function indexDeltaReadout(embedded: number, total: number, emptyCount = 0, stampGap: StampGapView = { kind: "none" }): string {
  const fmt = (n: number): string => n.toLocaleString();
  const complete = embedded >= total ? t("indexDelta.complete") : "";
  const empty = emptyCount > 0 ? t("indexDelta.emptyIgnored", fmt(emptyCount)) : "";
  // Die Lücke im Stempel-Wächter (Zeilen mit `[0, 0]`): Änderungen außerhalb von Obsidian werden dort nicht erkannt.
  const gap = stampGap.kind === "some" ? t("indexDelta.stampGap", fmt(stampGap.unstamped), fmt(stampGap.total))
    : stampGap.kind === "no-stamps" ? t("indexDelta.noStamps") : "";
  return `${t("indexDelta.readout", fmt(embedded), fmt(total))}${complete}${empty}${gap}`;
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
