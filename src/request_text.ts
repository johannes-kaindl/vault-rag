// uebernommen aus lingotuner/src/core/request-text.ts, 2026-09-30
import { t } from "./vendor/kit/i18n";
import type { Deviation, DeviationKind } from "./vendor/kit/sampling-profiles";

/** Textbausteine fuer Abweichungen (Spec § 5.3): eine Zuordnung, von der Session-Notice UND
 *  dem Abschnitt „Anfrage" (Statuszeile) genutzt — nie zweimal formuliert. */
const KEY: Record<DeviationKind, string> = {
  "thinking-despite-off": "request.dev.thinkingDespiteOff",
  "empty-by-budget": "request.dev.emptyByBudget",
  "family-mismatch": "request.dev.familyMismatch",
  "family-detected": "request.dev.familyDetected",
  "rejected": "request.dev.rejected",
};

export function deviationDetail(kind: DeviationKind, detail?: string): string {
  return detail !== undefined ? t(KEY[kind], detail) : t(KEY[kind]);
}

/** Notice-Text: nur fuer Abweichungen mit `affectsResult` aufgerufen (Vertrag von
 *  `createRequestSession`), deshalb ohne den (dort ungenutzten) `thinking-despite-off`-Fall. */
export function deviationNotice(d: Deviation): string {
  return `${deviationDetail(d.kind, d.detail)} ${t("request.dev.seeSettings")}`;
}

/** Text zu einer ID aus einer Kit-Tabelle (Modus, Feld, Stufe, Quelle). Der Schluessel wird
 *  erst hier gebaut, nicht als Template-Literal im `t()`-Aufruf — der Schluessel-Waechter
 *  (`tests/i18n/keys.test.ts`) kann Interpolation nicht aufloesen (Gotcha in AGENTS.md).
 *  Preis: die Vollstaendigkeit bewacht stattdessen `tests/request_text.test.ts` gegen die
 *  Kit-Tabellen. */
export type RequestTextGroup = "request.level" | "request.mode" | "request.field" | "request.familySource" | "request.backendSource";
export function requestText(group: RequestTextGroup, id: string): string {
  const key = `${group}.${id}`;
  return t(key);
}
