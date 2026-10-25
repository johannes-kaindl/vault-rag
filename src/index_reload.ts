/**
 * Entscheidet, ob `maybeReload` den Index von der Platte neu lädt (obsidian-frei, in Node getestet).
 *
 * Warum es das gibt (Welle 27, V2): `maybeReload` lädt neu, sobald `index.bin` eine andere mtime trägt als die zuletzt
 * gesehene. Das Plugin schreibt die Datei aber selbst — jeder `persist` (Live-Update, Drain, Heilung, Voll-Reindex) und
 * die Zwischenstände von `LiveIndexer.reindexAll` (`persistCheckpoint`, alle 250 Notizen) ändern die mtime. Ohne
 * Nachziehen hielt der Wächter jedes eigene Schreiben nach höchstens 30 s für eine fremde Änderung und rief `loadIndex`
 * auf, samt den Meldungen über veraltete und unbrauchbare Zeilen und dem Fenster „Index vervollständigen“.
 *
 * Zwei Regeln: (1) Ein eigener Lauf zieht die mtime nach, wenn er fertig ist (`adoptOwnWrite`). (2) Solange ein eigener
 * Lauf schreiben kann (`busy`), lädt der Wächter nicht neu. Grenze: eine fremde Änderung, die genau in das Fenster eines
 * eigenen Laufs fällt, bleibt unbemerkt, bis die Datei das nächste Mal anders aussieht (ein Sync-Eingang während des
 * Laufs überschreibt der Lauf ohnehin mit seinem Stand).
 */
export interface ReloadWatchDeps {
  /** mtime der Container-Datei auf der Platte; `null`, wenn es sie nicht gibt. */
  mtime(): Promise<number | null>;
  /** `true`, solange ein eigener Lauf (Live-Update, Drain, Heilung, Voll-Reindex) `index.bin` schreiben kann. */
  busy(): boolean;
}

export class IndexReloadWatch {
  private seen = 0;

  constructor(private readonly deps: ReloadWatchDeps) {}

  /** Die zuletzt gesehene mtime (Rückfall für den Zeitstempel eines Snapshots). */
  get lastSeen(): number { return this.seen; }

  /** Merkt den Stand, den ein Ladevorgang gesehen hat. */
  note(mtime: number): void { this.seen = mtime; }

  /** Zieht die mtime der Platte als „gesehen“ nach — nach einem eigenen Schreiben oder dem Ende eines eigenen Laufs. */
  async adoptOwnWrite(): Promise<void> {
    const m = await this.deps.mtime();
    if (m !== null) this.seen = m;
  }

  /** `true`, wenn jemand anderes die Datei geändert hat und neu geladen werden soll; merkt den Stand dann als gesehen. */
  async foreignChange(): Promise<boolean> {
    if (this.deps.busy()) return false;
    const m = await this.deps.mtime();
    if (m === null || m === this.seen) return false;
    this.seen = m;
    return true;
  }
}
