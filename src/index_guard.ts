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
  kind?: "shrink" | "model-mismatch" | "unreadable";
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
 * Darf mit dem aktuellen Embedding-Modell auf den Index geschrieben werden, der **auf Platte**
 * liegt? Der Guard hängt bewusst an der Schreiboperation und liest seine Wahrheit aus dem
 * Container, nicht aus einem Flag oder einem In-Memory-Manifest (dieselbe Lehre wie beim
 * 0.18.0-Sync-Race: ein Guard, der vor der Operation in einem Zustand lebt, ist nicht dicht).
 *
 * - `reindex` → immer erlaubt: Voll-Ersatz, danach beschreibt das Manifest ehrlich alle Vektoren.
 * - `live` und `heal` → bei Modell-Unterschied blocken. Heal gehört ausdrücklich dazu: additives
 *   Einmischen fremder Vektoren in einen bestehenden Index ist genau der Schaden.
 * - Disk-Modell leer/fehlend (Alt-Index ohne Feld, frischer Index) → erlauben, nicht blockieren.
 */
export function assertModelSafeToPersist(
  diskModel: string | undefined,
  embedderModel: string,
  reason: PersistReason,
): PersistDecision {
  if (reason === "reindex") return { allowed: true };
  const disk = diskModel?.trim();
  if (!disk) return { allowed: true };
  if (embeddingModelMatchesIndex(embedderModel, disk)) return { allowed: true };
  return {
    allowed: false,
    kind: "model-mismatch",
    message: `Persist verweigert: Der Index auf Platte wurde mit „${disk}" gebaut, dieser Endpunkt `
      + `embeddet mit „${embedderModel}" — verschiedene Vektorräume. Ein Wechsel des `
      + `Embedding-Modells erfordert einen vollständigen Neuaufbau des Index.`,
  };
}

export class PersistBlockedError extends Error {
  constructor(readonly kind: "not-ready" | "shrink" | "unreadable" | "model-mismatch", message: string) {
    super(message);
    this.name = "PersistBlockedError";
  }
}

/** Was die Auto-Heal-Kaskade mit den vorhandenen Mitteln tun kann. */
export type AutoHealPlan =
  | { kind: "restore-and-reindex" }
  | { kind: "restore-only" }
  | { kind: "restore-in-memory" }
  | { kind: "no-backup" };

/**
 * Entscheidet, wie weit die Kaskade kommt — die Reihenfolge IST die Regel.
 *
 * Ein Backup zu übernehmen braucht **kein Netz**; nur der Delta-Reindex der seither
 * hinzugekommenen Notizen braucht einen erreichbaren Embedding-Endpunkt. Bis 0.23.0 hingen
 * beide an einer einzigen `embedderReady()`-Prüfung, die VOR der Backup-Suche lief: wer
 * offline war (oder einen toten Endpunkt konfiguriert hatte), blieb dauerhaft auf einem
 * defekten Container sitzen, obwohl die CRC-bewiesene Rettung lokal danebenlag. Genau so
 * beobachtet am 2026-08-14.
 *
 * `restore-only` ist deshalb kein Notbehelf, sondern das richtige Ergebnis: ein Index von
 * gestern schlägt „kein Index" in jeder Hinsicht, und der defekte Container hat keinerlei
 * Wert, den man schützen müsste.
 *
 * **`canCompleteIndex` trennt zwei Bedeutungen, die vorher beide in `embedderReady` steckten**
 * — und nur eine davon durfte fallen. „Der Endpunkt antwortet gerade nicht" ist auf dem
 * Desktop vorübergehend: dort ist Übernehmen samt Schreiben richtig, die Lücke schließt der
 * Live-Betrieb, sobald Ollama wieder da ist. „Dieses Gerät hat strukturell keinen Endpunkt"
 * (iPhone) ist dagegen dauerhaft — und dort ist das Schreiben schädlich, weil der Index-Ordner
 * GESYNCT ist: ein älterer Stand ginge an alle Geräte zurück, und `isSuspiciousShrink` greift
 * erst unter 50 %, ein Rückfall um 200 Notizen liefe also still durch. Deshalb `restore-in-memory`:
 * die Sitzung bekommt sofort wieder Retrieval, die Platte bleibt unberührt, und die Heilung
 * kommt per Sync vom Desktop — genau die Arbeitsteilung, die `attemptAutoHeal` immer
 * beschrieben hat.
 */
export function planAutoHeal(
  input: { hasBackup: boolean; embedderReady: boolean; canCompleteIndex: boolean },
): AutoHealPlan {
  if (!input.hasBackup) return { kind: "no-backup" };
  if (input.embedderReady) return { kind: "restore-and-reindex" };
  return input.canCompleteIndex ? { kind: "restore-only" } : { kind: "restore-in-memory" };
}
