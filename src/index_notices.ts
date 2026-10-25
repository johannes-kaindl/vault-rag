/**
 * Die Meldungen nach dem Laden des Index (obsidian-frei, in Node getestet): wann das Fenster „Index vervollständigen“
 * erscheint, und wann ein immer wiederkehrender Pfad nur noch einmal als Befund steht. Den Schnitt der Pfadliste (`MAX_PATHS_IN_NOTICE`) macht
 * das Kit (`summarizeList`, code-kit 0.37.2); der Text „a.md, b.md (+3)“ entsteht in `main.ts` (`announceFindings`).
 *
 * Warum (Welle 27, V2): das Fenster prüfte weder einen laufenden Lauf noch die Pause noch die Warteschlange, und die
 * Meldungen nannten nur eine Zahl. Wer „5 Notizen haben sich geändert“ liest, weiß nicht, welche — und wer dieselbe
 * Meldung bei jedem Reload wieder liest, hört auf, sie zu lesen.
 */

/** Wie viele Pfade eine Meldung höchstens nennt (das `max` für `summarizeList`). */
export const MAX_PATHS_IN_NOTICE = 5;

export interface CompletionOfferInput {
  /** Embeddierbare Notizen, die im Index fehlen (ohne chunk-lose). */
  missing: readonly string[];
  /** Notizen im Vault insgesamt. */
  total: number;
  /** Ein eigener Lauf schreibt gerade (`embeddingProgress.isEmbedding`). */
  running: boolean;
  /** Die Einbettung ist pausiert. */
  paused: boolean;
  /** Steht der Pfad schon in der Warteschlange? */
  queued(path: string): boolean;
  /** Das Fenster kam in dieser Sitzung schon. */
  offered: boolean;
}

/**
 * Soll das Fenster „Index vervollständigen“ erscheinen? Nur bei einer substanziellen Lücke (über 20 Notizen und über
 * 5 Prozent), die nicht schon von selbst geschlossen wird: kein Lauf, keine Pause, nicht in der Warteschlange und
 * höchstens einmal je Sitzung.
 */
export function shouldOfferCompletion(i: CompletionOfferInput): boolean {
  if (i.offered || i.running || i.paused) return false;
  const open = i.missing.filter((p) => !i.queued(p)).length;
  return open > 20 && open > i.total * 0.05;
}

export interface RecurringResult {
  /** Pfade, die wie bisher gemeldet werden. */
  report: string[];
  /** Pfade, die zum dritten Mal in Folge auftauchen: einmal als „immer dieselbe Notiz“, danach still. */
  recurring: string[];
}

/** Zählt je Pfad, in wie vielen Reloads in Folge er gemeldet wurde (Speicher der Sitzung, kein Setting). */
export class RecurringFindings {
  private static readonly LIMIT = 3;
  private counts = new Map<string, number>();

  observe(paths: readonly string[]): RecurringResult {
    const now = new Set(paths);
    for (const p of [...this.counts.keys()]) if (!now.has(p)) this.counts.delete(p);   // war in Ordnung: zählt von vorn
    const report: string[] = [];
    const recurring: string[] = [];
    for (const p of now) {
      const n = (this.counts.get(p) ?? 0) + 1;
      this.counts.set(p, n);
      if (n < RecurringFindings.LIMIT) report.push(p);
      else if (n === RecurringFindings.LIMIT) recurring.push(p);
    }
    return { report, recurring };
  }
}
