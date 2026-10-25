/**
 * Die Stempel-Lücke des geladenen Index (obsidian-frei, in Node getestet): wie viele Zeilen den Stempel `[0, 0]` tragen und was die
 * Index-Zustand-Zeile in den Einstellungen dazu sagt.
 *
 * Warum (Welle 27, V4; Entscheidung Johannes 2026-10-24): `findStaleVectorPaths` überspringt Zeilen mit dem Stempel `[0, 0]` („nicht
 * geprüft ist nicht verdächtig“), also bemerkt der Wächter Änderungen außerhalb von Obsidian an diesen Notizen nie. Die Lücke wird hier
 * sichtbar gemacht, am Stempel selbst wird nichts gebaut und nichts nachgestempelt (ein Voll-Reindex bleibt Johannes' Entscheidung).
 *
 * Was „ohne Stempel“ heißt, entscheidet allein das Kit (`countUnstampedRows`, code-kit 0.37.0); hier steht nur, WELCHE Pfade es sind, damit die
 * Zahl nach einer Live-Änderung nicht alt bleibt: das Plugin schreibt Stempel über Live-Update und Drain, lädt aber (seit dem Reload-Wächter
 * von V2) nach eigenen Schreibvorgängen nicht mehr neu. Der Zähler sitzt nicht am `LiveIndexer` (`noteStamps` wird dort ohnehin gepflegt): ein
 * Zugriff dort wäre eine Kit-Änderung (Kit-Task an den Master); das `Set` hier ist der Preis dafür.
 */
import { countUnstampedRows } from "./vendor/kit/index-guard";

/** Was die Zeile zur Lücke sagt. */
export type StampGapView =
  | { kind: "none" }
  | { kind: "some"; unstamped: number; total: number }
  | { kind: "no-stamps" };

export interface StampGapInput {
  /** Der Container trägt kein Stempel-Feld (Altbestand, vor dem Wächter gebaut). */
  missing: boolean;
  /** Zeilen mit dem Stempel `[0, 0]`. */
  unstamped: number;
  /** Zeilen im Index. */
  total: number;
}

/** Wahl zwischen „keine Zahl“, „N von M“ und dem ehrlichen Satz für einen Container ohne Stempel. */
export function describeStampGap(i: StampGapInput): StampGapView {
  if (i.missing) return i.total > 0 ? { kind: "no-stamps" } : { kind: "none" };
  if (i.unstamped <= 0) return { kind: "none" };
  return { kind: "some", unstamped: i.unstamped, total: i.total };
}

type RowStamp = readonly [number, number];

export class StampGap {
  private open = new Set<string>();
  private missing = false;

  /** Beim Laden des Containers: die Pfade, deren Zeile `[0, 0]` trägt (nach der Definition des Kits), und ob das Stempel-Feld fehlt. */
  load(paths: readonly string[], stamps: readonly RowStamp[] | undefined): void {
    this.missing = stamps === undefined;
    this.open = new Set();
    if (!stamps) return;
    paths.forEach((p, i) => { const s = stamps[i]; if (s && countUnstampedRows([s]) === 1) this.open.add(p); });
  }

  /** Der Pfad hat über Live-Update, Drain oder Heilung einen echten Stempel bekommen (oder ist aus dem Index gegangen). */
  stamped(path: string): void { this.open.delete(path); }

  /** Ein Umbenennen trägt die Lücke auf den neuen Namen. */
  moved(oldPath: string, newPath: string): void {
    if (this.open.delete(oldPath)) this.open.add(newPath);
  }

  /** Nach einem Voll-Reindex trägt jede Zeile einen Stempel, auch in einem Altbestand ohne Stempel-Feld. */
  settle(): void { this.open = new Set(); this.missing = false; }

  view(total: number): StampGapView {
    return describeStampGap({ missing: this.missing, unstamped: this.open.size, total });
  }
}
