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
 * Auto-Heal-Persist-Regel (Spec §Heal-Kaskade, Schutzregel b): Der aus einem Backup geheilte
 * Index darf nur persistieren (und sich per Sync verteilen), wenn der Heal-Lauf restlos
 * durchlief. Bricht der Endpoint mitten im Heal weg (failed > 0), bleibt der Gefahrenzustand
 * bestehen, statt einen halb geheilten Index zu verteilen.
 */
export function canPersistHealedIndex(failedCount: number): boolean {
  return failedCount === 0;
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

/**
 * Darf ein Embedding-Endpunkt-Kandidat den geladenen Index bedienen?
 * Ein Modellwechsel wechselt den **Vektorraum**: neue Vektoren wären zu den bestehenden
 * inkommensurabel, ohne dass irgendein Guard anschlüge — der Count bleibt gleich
 * (`assertSafeToPersist` greift nicht), die Dimension wird auf 256 gepaddet/geschnitten,
 * CRC32 und Byte-Guard sehen einen strukturell perfekten Container. Nur ein voller Reindex
 * heilt das, und schon die reine Suche degradiert. Darum entscheidet das nicht der Zufall
 * eines Failovers, sondern diese Regel.
 *
 * `indexModel` leer/undefined (kein Index geladen, Erstinstallation, Alt-Index ohne Feld)
 * → true: es gibt nichts zu vergiften, und ein frisch installiertes Plugin muss embedden dürfen.
 * Sonst exakte Gleichheit nach `trim()` — Modellnamen sind case-sensitiv.
 */
export function embeddingModelMatchesIndex(candidateModel: string, indexModel: string | undefined): boolean {
  const want = indexModel?.trim();
  if (!want) return true;
  return candidateModel.trim() === want;
}

/**
 * Muss der Index in den Schreibschutz, weil **kein einziger** konfigurierter Endpunkt sein
 * Embedding-Modell bedienen kann? Dann gibt es keinen gefahrlosen Live-Pfad mehr: der
 * terminale Rückfall würde sonst einen fremden Vektorraum adoptieren, `assertSafeToPersist`
 * ließe ihn durch (Count ±1) und der nächste Persist schriebe `manifest.embedding_model` auf
 * den fremden Namen um — danach hielte der Modell-Guard einen gemischten Index für homogen.
 * Lesende Suche bleibt unberührt; nur Live-Persists blocken (`PersistBlockedError("not-ready")`).
 *
 * Kein Index-Modell → nie Schreibschutz (es gibt nichts zu schützen).
 */
export function indexNeedsWriteProtection(candidateModels: string[], indexModel: string | undefined): boolean {
  if (!indexModel?.trim()) return false;
  return !candidateModels.some(m => embeddingModelMatchesIndex(m, indexModel));
}

export class PersistBlockedError extends Error {
  constructor(readonly kind: "not-ready" | "shrink" | "unreadable", message: string) {
    super(message);
    this.name = "PersistBlockedError";
  }
}
