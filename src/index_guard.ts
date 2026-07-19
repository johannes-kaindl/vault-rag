// Pure-core (obsidian-frei): datenverlust-kritische Entscheidungen an einer Stelle,
// isoliert testbar. Siehe docs/superpowers/specs/2026-07-10-index-robustheit-design.md.

export type LoadState = "no-index" | "loaded-ok" | "load-failed-index-present";

/**
 * Klassifiziert das Ergebnis eines Index-Ladeversuchs.
 * - Kein Manifest auf Platte → frische Installation; ein leerer Indexer darf aufbauen.
 * - Manifest da + Parse-Fehler → GEFAHRENZUSTAND: ein guter Index liegt beschädigt vor und
 *   darf NICHT überschrieben werden.
 */
export function classifyLoadResult(manifestExists: boolean, parseThrew: boolean): LoadState {
  if (!manifestExists) return "no-index";
  return parseThrew ? "load-failed-index-present" : "loaded-ok";
}

export type PersistReason = "live" | "reindex" | "heal";

export interface PersistDecision {
  allowed: boolean;
  kind?: "shrink";
  message?: string;
}

/**
 * Entscheidet, ob ein persist den Index gefahrlos ersetzen darf.
 * `reindex`/`heal` sind explizit vom Nutzer ausgelöst → immer erlaubt (dürfen legitim schrumpfen).
 * `live` (jede Notiz-Änderung) ändert den Count invariant um höchstens ±1 → ein Sturz um mehr als 1
 * ist Datenverlust (leerer/verwirrter Indexer plättet den guten Bestand) und wird verweigert.
 */
export function assertSafeToPersist(diskCount: number, nextCount: number, reason: PersistReason): PersistDecision {
  if (reason !== "live") return { allowed: true };
  if (nextCount >= diskCount - 1) return { allowed: true };
  return {
    allowed: false,
    kind: "shrink",
    message: `Persist verweigert: Index würde von ${diskCount} auf ${nextCount} Notizen fallen (Live-Änderung ändert nur ±1) — vermutlich beschädigter/leerer Index.`,
  };
}

/**
 * True, wenn ein von Platte nachgeladener Index drastisch kleiner ist als der aktuelle
 * In-Memory-Bestand (cross-device-Clobber-Verdacht). Moderat kleinere Fremd-Indizes gelten
 * als legitim und werden übernommen.
 */
export function isSuspiciousShrink(currentCount: number, incomingCount: number, ratio = 0.5): boolean {
  if (currentCount <= 0) return false;
  return incomingCount < currentCount * ratio;
}

/**
 * Mengendifferenz Vault↔Index. `missing` = im Vault, aber nicht im Index (Self-Heal-Kandidaten);
 * `stale` = im Index, aber nicht mehr im Vault (informativ; Live-Delete räumt sie normal ab).
 */
export function diffIndexVsVault(indexPaths: string[], vaultPaths: string[]): { missing: string[]; stale: string[] } {
  const inIndex = new Set(indexPaths);
  const inVault = new Set(vaultPaths);
  return {
    missing: vaultPaths.filter(p => !inIndex.has(p)),
    stale: indexPaths.filter(p => !inVault.has(p)),
  };
}

export class PersistBlockedError extends Error {
  constructor(readonly kind: "not-ready" | "shrink" | "unreadable", message: string) {
    super(message);
    this.name = "PersistBlockedError";
  }
}
