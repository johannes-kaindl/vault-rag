// vendored from code-kit@0.38.0, src/ts/pure/index-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/index_guard.ts, 2026-10-11 (Änderungen: `noUncheckedIndexedAccess`-clean; neu `assertDimSafeToPersist` und die Art "dim-mismatch"; sonst Code und Meldungen unverändert)
// Pure core: decisions where data can be lost, in one place and testable in isolation. Origin: vault-rag (spec 2026-07-10, index robustness).
// The message texts are German and stay as they were: the consumer's tests and its users' notices carry them.

export type LoadState = "no-index" | "loaded-ok" | "load-failed-index-present";

/**
 * Stempel-Wert fuer „fuer diese Zeile war kein Stempel zu ermitteln".
 *
 * Warum es ihn gibt: `stampsFor` verwarf bei einer einzigen Luecke die Stempel des GANZEN
 * Laufs (Alles-oder-nichts, weil das Format ein Array parallel zu `paths` ist). Gemessen am
 * 2026-09-05: im Staging-Vault (18 Notizen, 30 s) entstanden Stempel, im Arbeitsvault (7.002
 * Notizen, 10 h) keine — dort genuegte eine Notiz, die zwischen Lesen und Stempeln aus dem
 * Vault verschwand, und `stampOf` lieferte `undefined`. Der Waechter war damit in genau den
 * Vaults blind, fuer die er gebaut wurde.
 *
 * `[0, 0]` kann keine echte Notiz sein: mtime 0 waere 1970, und eine 0 Byte grosse Notiz hat
 * keine Chunks und steht deshalb nie im Index. Der Wert bleibt unter derselben
 * `schema_version` gueltig (`stempelGueltig` akzeptiert ihn), bricht das Format also nicht —
 * eine aeltere Plugin-Version liest den Container weiter und meldet fuer diese Zeile
 * hoechstens einmal zu viel „veraltet", was folgenlos neu einbettet.
 */
export const UNBEKANNTER_STEMPEL: readonly [number, number] = [0, 0];

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
  kind?: "shrink" | "model-mismatch" | "dim-mismatch" | "unreadable";
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

/**
 * Darf mit dieser Dimension auf den Index geschrieben werden, der **auf Platte** liegt? Dieselbe Klasse wie der
 * Modell-Guard, und neu, seit die Dimension ein Parameter ist (vorher war sie die Konstante 256): ein Indexer, der
 * mit 256 Spalten arbeitet, würde einen Index mit 1024 Spalten beim Schreiben still auf 256 abschneiden — oder einen
 * mit 256 auf 1024 mit Nullen auffüllen —, und CRC32, Byte-Guard und Count sähen einen strukturell perfekten
 * Container. Ein Dimensionswechsel erfordert wie ein Modellwechsel einen vollständigen Neuaufbau.
 *
 * - `reindex` → immer erlaubt (Voll-Ersatz).
 * - `live` und `heal` → bei Unterschied blocken.
 * - Disk-Dimension fehlend, 0 oder keine Zahl (frischer Index, Container ohne das Feld) → erlauben.
 */
export function assertDimSafeToPersist(
  diskDim: number | undefined,
  indexerDim: number,
  reason: PersistReason,
): PersistDecision {
  if (reason === "reindex") return { allowed: true };
  if (typeof diskDim !== "number" || !Number.isFinite(diskDim) || diskDim <= 0) return { allowed: true };
  if (diskDim === indexerDim) return { allowed: true };
  return {
    allowed: false,
    kind: "dim-mismatch",
    message: `Persist verweigert: Der Index auf Platte hat ${diskDim} Dimensionen, dieser Indexer arbeitet mit ${indexerDim} — `
      + `ein Schreiben würde die Vektoren abschneiden oder mit Nullen auffüllen. Eine andere Dimension erfordert einen vollständigen Neuaufbau des Index.`,
  };
}

export class PersistBlockedError extends Error {
  constructor(readonly kind: "not-ready" | "shrink" | "unreadable" | "model-mismatch" | "dim-mismatch", message: string) {
    super(message);
    this.name = "PersistBlockedError";
  }
}

/** Was die Auto-Heal-Kaskade mit den vorhandenen Mitteln tun kann. */
export type AutoHealPlan =
  | { kind: "restore-and-reindex" }
  | { kind: "restore-only" }
  | { kind: "wait-for-sync" }
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
 * erst unter 50 %, ein Rückfall um 200 Notizen liefe also still durch. Deshalb `wait-for-sync`:
 * dort wird gar nicht geheilt, Schreibschutz und Notice bleiben, die Heilung kommt vom Desktop —
 * genau die Arbeitsteilung, die `attemptAutoHeal` immer beschrieben hat.
 *
 * **Warum nicht wenigstens in den Speicher übernehmen?** Genau das stand hier am 2026-08-18 für
 * ein paar Stunden und ist wieder rausgeflogen. Der Zweig hätte eine Zusage gegeben („die Platte
 * bleibt unberührt"), die im Code nirgends durchgesetzt war: der Indexer blieb nach `init(base)`
 * mit den Backup-Vektoren scharf, ein späterer Live-Persist hing allein an einem Nebeneffekt
 * (`readDiskState() === null`) — der zudem schwächer prüft als der Ladepfad —, und ein
 * `markUnready()` hätte `resolveAndReconnectEmbedder` beim nächsten Endpunktwechsel wieder
 * aufgehoben. Sitzungs-Retrieval auf dem Telefon ist Komfort; ihn gegen eine nur zufällig
 * haltende Nicht-Schreib-Zusage einzutauschen, ist an diesem Pfad kein guter Handel. Wenn, dann
 * mit einem echten geräteweiten Schreib-Lock — eigener Slice.
 */
export function planAutoHeal(
  input: { hasBackup: boolean; embedderReady: boolean; canCompleteIndex: boolean },
): AutoHealPlan {
  if (!input.hasBackup) return { kind: "no-backup" };
  if (input.embedderReady) return { kind: "restore-and-reindex" };
  return input.canCompleteIndex ? { kind: "restore-only" } : { kind: "wait-for-sync" };
}

/** A restored backup younger than this may be written back without a reached endpoint: seven days. */
export const HEAL_BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Why the healing writes or keeps the write protection. The caller words the notice from `because`; the texts are not here. */
export type HealWriteVerdict =
  | { write: true; because: "reindex-follows" | "backup-fresh" | "endpoint-reached-this-session" }
  | { write: false; because: "no-backup" | "wait-for-sync" | "backup-too-old" | "unknown-plan" };

/**
 * May the healing write the restored index into the SYNCED index folder? (Decision Johannes 2026-10-15; owner
 * task: vault-rag, "Wann darf die Heilung in den gesyncten Index-Ordner schreiben".)
 *
 * `planAutoHeal` says how far the cascade gets; this says whether its restore may reach the disk. They differ only
 * for `restore-only`: a backup restored while the endpoint does not answer. There the gap to the vault is closed
 * later by live operation — if the endpoint ever comes back. If it does not (a URL typed wrong, the pending queue
 * never empties), the old stand sits in a folder that sync carries to every other device, and `isSuspiciousShrink`
 * accepts a drop above 50 %. So `restore-only` writes only if
 *
 * - the backup is younger than {@link HEAL_BACKUP_MAX_AGE_MS} (the loss is bounded by the age), **or**
 * - the endpoint was reached in this session (the gap will close).
 *
 * Otherwise the write protection stays and the caller shows a notice. Per plan:
 *
 * - `restore-and-reindex` → writes (`reindex-follows`): the endpoint answers now and the reindex fills the gap. A
 *   reindex that fails half way is {@link canPersistHealedIndex}'s to refuse — the caller applies both.
 * - `wait-for-sync` → never writes, however fresh the backup or reached the endpoint: the mobile rule stays.
 * - `no-backup` → nothing to write.
 *
 * `backupAgeMs` unknown (anything but a finite number: `undefined`, `null`, `NaN`, `Infinity`) or **negative** counts as not fresh: a missing time is no proof of freshness, and
 * a time in the future is no proof either. Clock skew between devices is the caller's to clamp before it gets here.
 * Fresh is checked before "endpoint reached", so `because` names the weaker, backup-bound reason when both hold.
 */
export function decideHealWrite(
  input: { plan: AutoHealPlan["kind"]; backupAgeMs: number | undefined; endpointReachedThisSession: boolean },
): HealWriteVerdict {
  switch (input.plan) {
    case "no-backup": return { write: false, because: "no-backup" };
    case "wait-for-sync": return { write: false, because: "wait-for-sync" };
    case "restore-and-reindex": return { write: true, because: "reindex-follows" };
    case "restore-only": {
      const age = input.backupAgeMs;
      if (typeof age === "number" && age >= 0 && age < HEAL_BACKUP_MAX_AGE_MS) return { write: true, because: "backup-fresh" };
      if (input.endpointReachedThisSession) return { write: true, because: "endpoint-reached-this-session" };
      return { write: false, because: "backup-too-old" };
    }
    // A plan this copy does not know (a newer caller): the write protection stays.
    default: return { write: false, because: "unknown-plan" };
  }
}

/** Age of a backup in ms from its modification time and the clock. `undefined` when either is missing or not finite;
 *  a time in the future gives a negative age on purpose ({@link decideHealWrite} refuses it). */
export function backupAgeMs(backupMtimeMs: number | undefined, nowMs: number): number | undefined {
  if (backupMtimeMs === undefined || !Number.isFinite(backupMtimeMs) || !Number.isFinite(nowMs)) return undefined;
  return nowMs - backupMtimeMs;
}

/**
 * Findet Zeilen, deren Vektor ausschliesslich aus Nullen besteht — strukturell tote Eintraege.
 *
 * Warum das ein eigener Befund ist: eine solche Notiz IST im Index (ihr Pfad steht in `paths`,
 * `count` zaehlt sie mit, CRC32 und Byte-Guard sehen einen perfekten Container), aber ihr
 * Vektor kann zu keiner Anfrage passen — Cosinus gegen einen Nullvektor ist immer 0. Sie ist
 * damit unauffindbar, ohne irgendwo als fehlend aufzutauchen: `diffIndexVsVault` zaehlt sie
 * als vorhanden, `computeIndexDelta` meldet „vollstaendig". Genau diese Luecke macht den
 * Befund unsichtbar, deshalb wird er hier eigens erhoben.
 *
 * Gemessen am 2026-08-30 im Arbeits-Vault: 4 solche Zeilen, darunter drei Notizen, die zuvor
 * als „findet sich ueber den eigenen Text nicht" gemeldet worden waren.
 *
 * Abgrenzung: leere Notizen (nur Frontmatter) sind hiervon NICHT betroffen — sie kommen
 * gar nicht erst in den Index (`embedNote` liefert null bei 0 Chunks).
 */
export function findDeadVectorPaths(paths: string[], vectors: Float32Array, dim: number): string[] {
  const dead: string[] = [];
  for (let r = 0; r < paths.length; r++) {
    let alive = false;
    for (let c = 0; c < dim; c++) {
      if (vectors[r * dim + c] !== 0) { alive = true; break; }
    }
    if (!alive) dead.push(paths[r] ?? "");
  }
  return dead;
}

/**
 * Pfade, deren Vektor AELTER ist als die Notiz, zu der er gehoert — der Waechter gegen den
 * einzigen Index-Schaden, den bisher kein Wächter sehen konnte.
 *
 * Warum es ihn braucht: `diffIndexVsVault` ist rein mengenbasiert (Pfad da oder nicht),
 * `findDeadVectorPaths` sieht nur Nullvektoren, CRC32 deckt Header und Nutzlast **gemeinsam**
 * ab und beglaubigt einen Fehlstand mit. Ein plausibler, aber veralteter Vektor bei vorhandenem
 * Pfad passiert deshalb jede Pruefung: `computeIndexDelta` meldet „vollstaendig",
 * `status()` meldet `indexed: true`, und die Suche wird still schlechter.
 *
 * Kriterium ist `[mtime, size]` aus `TFile.stat` — beides haelt Obsidian im Speicher, der
 * Waechter kostet beim Laden also nichts. Die Asymmetrie der Fehler traegt die Wahl: ein
 * FEHLALARM fuehrt nur zu unnoetigem Neu-Embedden und macht den Index nie falsch; der
 * gefaehrliche Gegenfehler setzte voraus, dass ein Schreibvorgang weder mtime noch Groesse
 * veraendert.
 *
 * @param paths      Pfade des Containers, in Zeilenreihenfolge
 * @param stamps     Stempel je Zeile — `undefined` bei Altbestand: dann wird NICHTS gemeldet
 *                   (ein vor dieser Version gebauter Index ist nicht verdaechtig, nur ungeprueft)
 * @param aktuell    heutiger Stand je Pfad; ein fehlender Eintrag ist eine geloeschte Notiz und
 *                   gehoert `diffIndexVsVault`, nicht hier — sonst meldeten zwei Waechter denselben Fund
 */
export function findStaleVectorPaths(
  paths: string[],
  stamps: readonly (readonly [number, number])[] | undefined,
  aktuell: ReadonlyMap<string, readonly [number, number]>,
): string[] {
  if (!stamps || stamps.length !== paths.length) return [];
  const stale: string[] = [];
  for (let r = 0; r < paths.length; r++) {
    const path = paths[r] ?? "";
    const jetzt = aktuell.get(path);
    const stamp = stamps[r];
    if (!jetzt || !stamp) continue;
    const [mtime, size] = stamp;
    // Ungeprueft ist nicht verdaechtig — dieselbe Regel wie fuer einen ganzen Index ohne
    // Stempel, nur zeilenweise. Ohne sie meldete jede Platzhalter-Zeile dauerhaft „veraltet".
    if (mtime === UNBEKANNTER_STEMPEL[0] && size === UNBEKANNTER_STEMPEL[1]) continue;
    if (jetzt[0] !== mtime || jetzt[1] !== size) stale.push(path);
  }
  return stale;
}

/**
 * How many rows carry no usable stamp: the rows whose stamp is {@link UNBEKANNTER_STEMPEL}, `[0, 0]`.
 *
 * The counterpart of {@link findStaleVectorPaths}: that guard skips exactly these rows ("not checked is not suspicious"), so a
 * stale vector under such a row passes unseen. Which rows are those, and how many: this answers the second. Only `[0, 0]`
 * counts, both numbers zero — `[0, 1]` and `[1, 0]` are stamps of a real note, however odd. A row the index holds without a
 * stamp is not a defect, it is a gap in the guard's view; showing the number keeps the gap from being silent (decision Johannes
 * 2026-10-24, question of ragkoda-w27 for vault-rag's index state line).
 *
 * @param stamps  stamp per row; `undefined` for an index built before the guard existed. Then the result is `0`: the whole index
 *                is unchecked, which is a different statement from "some rows are", and the caller tells them apart by
 *                `stamps === undefined`. A hole or a row that is not a pair is not counted either.
 */
export function countUnstampedRows(stamps: readonly (readonly [number, number])[] | undefined): number {
  if (!stamps) return 0;
  let n = 0;
  for (const stamp of stamps) {
    if (stamp && stamp[0] === UNBEKANNTER_STEMPEL[0] && stamp[1] === UNBEKANNTER_STEMPEL[1]) n++;
  }
  return n;
}
