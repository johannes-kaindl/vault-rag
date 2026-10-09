// uebernommen aus lingotuner/src/core/request-text.ts, 2026-09-30 (nur `requestText`; die Abweichungs-Texte liefert seit der Verbindung das Kit)
import { t } from "./vendor/kit/i18n";

/** Text zu einer ID aus einer Kit-Tabelle (Modus, Feld, Stufe, Quelle). Der Schluessel wird
 *  erst hier gebaut, nicht als Template-Literal im `t()`-Aufruf — der Schluessel-Waechter
 *  (`tests/i18n/keys.test.ts`) kann Interpolation nicht aufloesen (Gotcha in AGENTS.md).
 *  Preis: die Vollstaendigkeit bewacht stattdessen `tests/request_text.test.ts` gegen die
 *  Kit-Tabellen. */
export type RequestTextGroup = "request.level";
export function requestText(group: RequestTextGroup, id: string): string {
  const key = `${group}.${id}`;
  return t(key);
}
