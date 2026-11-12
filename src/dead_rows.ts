/**
 * Tote Zeilen im Index: Zeilen, deren Notiz nicht mehr im Vault liegt (verschoben, umbenannt oder gelöscht, während kein Ereignis ankam: Obsidian war zu, der Embedder
 * nicht erreichbar, ein Programm hat die Datei außerhalb von Obsidian bewegt). Gemessen 2026-11-12 im Pallas-Index (Kopie): 3.113 von 14.990 Zeilen (20,8 %).
 *
 * Der Index-Ordner ist gesynct, die Notizen sind es auch, aber nicht im selben Takt: kommt `index.bin` von einem anderen Gerät vor den Notizen, fehlt dort für Stunden die Datei zu einer
 * LEBENDEN Zeile. Eine Zeile gilt deshalb erst als tot, wenn ihre Datei auf DIESEM Gerät bei zwei Beobachtungen im Abstand von mindestens `graceMs` gefehlt hat, durchgehend (kommt
 * die Datei dazwischen zurück, beginnt die Frist von vorn). Die Beobachtungen liegen im Speicher des Geräts (nicht gesynct), nicht im Index.
 */

/** Frist, die eine Datei durchgehend fehlen muss, bevor ihre Zeile entfernt wird: ein Tag deckt einen Sync-Rückstand über Nacht. */
export const DEAD_ROW_GRACE_MS = 24 * 60 * 60 * 1000;

/** Was der Speicher des Geräts können muss (`window.localStorage` passt). */
export interface DeadRowStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DeadRowObservation {
  /** Zeilen, deren Datei seit mindestens der Frist durchgehend fehlt: sie dürfen entfernt werden. */
  due: string[];
  /** Zeilen ohne Datei, deren Frist noch läuft. */
  waiting: number;
}

export class DeadRowGrace {
  constructor(
    private readonly storage: DeadRowStorage,
    private readonly key: string,
    private readonly graceMs: number = DEAD_ROW_GRACE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Eine Beobachtung: `missing` sind die Zeilen, deren Datei jetzt fehlt. Wer fehlt, behält seinen ersten Zeitpunkt; wer wieder da ist, fällt aus der Merkliste. */
  observe(missing: readonly string[]): DeadRowObservation {
    const before = this.load();
    const t = this.now();
    const after: Record<string, number> = {};
    const due: string[] = [];
    for (const p of missing) {
      const first = before[p] ?? t;
      after[p] = first;
      if (t - first >= this.graceMs) due.push(p);
    }
    this.save(after);
    return { due, waiting: missing.length - due.length };
  }

  /** Die entfernten Zeilen aus der Merkliste nehmen (sonst stünden sie bei einer Rückkehr der Datei mit altem Zeitpunkt da). */
  forget(paths: readonly string[]): void {
    const before = this.load();
    for (const p of paths) delete before[p];
    this.save(before);
  }

  private load(): Record<string, number> {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      const out: Record<string, number> = {};
      for (const [p, v] of Object.entries(parsed)) if (typeof v === "number" && Number.isFinite(v)) out[p] = v;
      return out;
    } catch { return {}; }
  }

  private save(map: Record<string, number>): void {
    try { this.storage.setItem(this.key, JSON.stringify(map)); }
    catch (e) { console.warn("vault-rag: Merkliste der toten Zeilen nicht gespeichert", e); }
  }
}
