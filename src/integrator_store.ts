// Inbox des Integrators: Vorschlaege je Notiz + Ablehnungs-Gedaechtnis. Reines Zustandsobjekt,
// obsidian-frei; Datei-I/O in main.ts (Plugin-Ordner, geraete-lokal — Spec E5).

export interface LinkCandidate { path: string; score: number }
export interface LinkProposal {
  notePath: string;
  /** djb2 des Notiztexts zur Berechnungszeit — Stale-Guard beim Annehmen. */
  noteHash: number;
  createdAt: number;
  links: LinkCandidate[];
  stale: boolean;
}
export interface IntegratorState {
  version: 1;
  proposals: Record<string, LinkProposal>;
  rejected: Record<string, string[]>;
}
export const INTEGRATOR_FILE = "integrator.json";

export class IntegratorStore {
  private state: IntegratorState;

  constructor(state?: IntegratorState) {
    this.state = state ?? { version: 1, proposals: {}, rejected: {} };
  }

  static parse(json: string): IntegratorState {
    const raw = JSON.parse(json) as Partial<IntegratorState>;
    if (raw.version !== 1) throw new Error(`integrator.json: unbekannte version ${String(raw.version)}`);
    return { version: 1, proposals: raw.proposals ?? {}, rejected: raw.rejected ?? {} };
  }

  upsert(p: LinkProposal): void {
    if (p.links.length === 0) { delete this.state.proposals[p.notePath]; return; }
    this.state.proposals[p.notePath] = { ...p, links: p.links.map(l => ({ ...l })) };
  }
  get(path: string): LinkProposal | undefined { return this.state.proposals[path]; }
  list(): LinkProposal[] { return Object.values(this.state.proposals).sort((a, b) => b.createdAt - a.createdAt); }
  count(): number { return Object.keys(this.state.proposals).length; }

  resolve(path: string, target: string, outcome: "accepted" | "rejected"): void {
    const p = this.state.proposals[path];
    if (p) {
      p.links = p.links.filter(l => l.path !== target);
      if (p.links.length === 0) delete this.state.proposals[path];
    }
    if (outcome === "rejected") {
      const set = new Set(this.state.rejected[path] ?? []);
      set.add(target);
      this.state.rejected[path] = [...set];
    }
  }
  rejectedFor(path: string): Set<string> { return new Set(this.state.rejected[path] ?? []); }
  markStale(path: string): void { const p = this.state.proposals[path]; if (p) p.stale = true; }
  updateHash(path: string, hash: number): void {
    const p = this.state.proposals[path];
    if (p) { p.noteHash = hash; p.stale = false; }
  }
  remove(path: string): void { delete this.state.proposals[path]; delete this.state.rejected[path]; }
  rename(oldPath: string, newPath: string): void {
    const p = this.state.proposals[oldPath];
    if (p) { delete this.state.proposals[oldPath]; this.state.proposals[newPath] = { ...p, notePath: newPath }; }
    const r = this.state.rejected[oldPath];
    if (r) { delete this.state.rejected[oldPath]; this.state.rejected[newPath] = r; }
  }
  serialize(): string { return JSON.stringify(this.state); }
}
