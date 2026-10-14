/** Zähler je Aufrufer für Embedding-Anfragen (Task „Woher kommen 10–18 Embedding-Anfragen pro Minute“, Welle 22).
 *  Reine Instrumentierung: sie zählt Texte je Etikett mit Zeitstempel und rechnet daraus Summen und Rate im Fenster.
 *  Obsidian-frei. Gemessen wird später am echten Modell (Modell-Runde); hier steht nur das Werkzeug. */
export interface EmbedCount { label: string; requests: number; texts: number; perMinute: number }

export class EmbedCounter {
  private readonly events = new Map<string, { at: number; texts: number }[]>();
  private readonly now: () => number;
  /** Ältere Ereignisse werden verworfen, damit der Zähler im Dauerbetrieb nicht wächst. */
  private readonly keepMs: number;

  constructor(now: () => number = () => Date.now(), keepMs = 3_600_000) { this.now = now; this.keepMs = keepMs; }

  /** Eine Anfrage mit `texts` Texten für `label`. */
  count(label: string, texts: number): void {
    const t = this.now();
    const list = this.events.get(label) ?? [];
    list.push({ at: t, texts });
    while (list.length > 0 && t - list[0].at > this.keepMs) list.shift();
    this.events.set(label, list);
  }

  /** Summen je Etikett im Fenster (Default: die letzte Stunde), größte Rate zuerst. `perMinute` zählt Anfragen. */
  snapshot(windowMs = 3_600_000): EmbedCount[] {
    const t = this.now();
    const out: EmbedCount[] = [];
    for (const [label, list] of this.events) {
      const inWindow = list.filter(e => t - e.at <= windowMs);
      if (inWindow.length === 0) continue;
      out.push({
        label,
        requests: inWindow.length,
        texts: inWindow.reduce((s, e) => s + e.texts, 0),
        perMinute: Math.round((inWindow.length / (windowMs / 60_000)) * 100) / 100,
      });
    }
    return out.sort((a, b) => b.requests - a.requests);
  }
}
