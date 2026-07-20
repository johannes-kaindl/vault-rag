/** Ab wann der Kaltstart-Hinweis eingeblendet wird. Vorher wuerde er eine schnelle
 *  Antwort unnoetig mit einer Sorge belasten, die es gar nicht gibt. */
export const COLD_START_HINT_AFTER_MS = 5000;

const COLD_START_HINT = "Beim ersten Aufruf muss das Modell ggf. erst geladen werden.";

/**
 * Wartetext fuer die Vorschau, solange noch kein Token eingetroffen ist.
 *
 * Bewusst ohne Diagnose: der OpenAI-kompatible Endpunkt sagt uns nicht, ob das Modell
 * gerade geladen wird oder nur nachdenkt — wir sehen ausschliesslich "noch keine Bytes".
 * Ein "Modell wird geladen" waere geraten und bei einem laengst geladenen, nur langsamen
 * Modell schlicht falsch. Angezeigt wird daher nur, DASS gewartet wird und WIE LANGE
 * schon; die mitlaufende Sekundenzahl ist das eigentliche Signal, dass die Oberflaeche
 * lebt und kein Haenger vorliegt.
 */
export function waitingMessage(elapsedMs: number): string {
  const secs = Math.max(0, Math.floor(elapsedMs / 1000));
  const head = `Warte auf Antwort … ${secs} s`;
  return elapsedMs >= COLD_START_HINT_AFTER_MS ? `${head}\n${COLD_START_HINT}` : head;
}
