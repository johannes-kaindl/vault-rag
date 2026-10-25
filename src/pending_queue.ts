import { VaultAdapter } from "./index";

export class PendingQueue {
  private pending = new Set<string>();

  constructor(private adapter: VaultAdapter, private dir: string) {}

  async load(): Promise<void> {
    try {
      const raw = await this.adapter.read(`${this.dir}/pending.json`);
      const arr = JSON.parse(raw) as string[];
      this.pending = new Set(arr);
    } catch { this.pending = new Set(); }
  }

  async add(path: string): Promise<void> {
    this.pending.add(path);
    await this.save();
  }

  /** Mehrere Pfade in EINEM Write. `pending.json` liegt im gesyncten Index-Ordner —
   *  ein `add()` je Pfad wäre dort ein Sync-Ereignis je Pfad. */
  async addMany(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    for (const p of paths) this.pending.add(p);
    await this.save();
  }

  has(path: string): boolean { return this.pending.has(path); }

  /** Schreibt den AKTUELLEN Stand nach `pending.json` — anders als `clear()` bleiben Pfade, die seit `drain()` neu hineinkamen.
   *  `drain()` leert nur den Speicher; wer einen Drain erfolgreich beendet hat, ruft das einmal auf (die Datei liegt im
   *  gesyncten Index-Ordner: kein Schreiben je Pfad). */
  async flush(): Promise<void> { await this.save(); }

  drain(): string[] {
    const paths = [...this.pending];
    this.pending.clear();
    return paths;
  }

  async clear(): Promise<void> {
    this.pending.clear();
    await this.adapter.write(`${this.dir}/pending.json`, "[]");
  }

  get size(): number { return this.pending.size; }

  private async save(): Promise<void> {
    await this.adapter.write(`${this.dir}/pending.json`, JSON.stringify([...this.pending]));
  }
}
