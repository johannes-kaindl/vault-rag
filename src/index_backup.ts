// Pure-core (obsidian-frei): Namens-/Rotations-/Sortier-Logik für geräte-lokale Index-Backups.
// Die eigentliche Datei-I/O passiert in der Obsidian-Schicht (main.ts) via migrateIndex.

import { selectGfsRetention, stampedName, timeFromStampedName, type GfsCalendar } from "./vendor/kit/rotation";

export const BACKUP_SUBDIR = "index-backups";

/** Dateisystem-sicherer Verzeichnisname aus dem `built_at` des Containers: UTC-Stempel mit
 *  Millisekunden, `:` und `.` → `-`. Ein Stempel ohne Millisekunden (ältere Container) wird
 *  normalisiert, weil die Rotation ihn sonst nicht lesen und das Backup nie löschen würde. */
export function backupDirName(builtAt: string): string {
  const time = Date.parse(builtAt);
  return Number.isNaN(time) ? builtAt.replace(/[:.]/g, "-") : stampedName(time);
}

/**
 * Gibt die zu löschenden Backup-Verzeichnisnamen zurück (Großvater-Vater-Sohn, Kit `rotation`,
 * Standard-Policy: heute 6 · 7 Tage · 4 Wochen · 6 Monate, höchstens 23). Gehalten wird je Fenster der
 * ÄLTESTE Stand; der Name trägt aber `built_at` des Containers und nicht die Sicherungszeit, deshalb
 * schützen `keepNewest` und `protect` das jüngste und das gerade angelegte Backup. Ein Name ohne
 * lesbaren Stempel geht nicht in die Aufbewahrung und wird nie gelöscht. `calendar` ist für Tests;
 * ohne Angabe gilt der Kalender der Rechner-Zeitzone (ein Backup „von gestern“ ist eines, das der
 * Nutzer gestern gesehen hat).
 */
export function selectBackupsToDelete(
  existing: readonly string[],
  now: number,
  opts: { protect?: readonly string[]; calendar?: GfsCalendar } = {},
): string[] {
  const entries: { name: string; time: number }[] = [];
  for (const name of existing) {
    const time = timeFromStampedName(name);
    if (time !== null) entries.push({ name, time });
  }
  return selectGfsRetention(entries, now, {
    keepNewest: true,
    ...(opts.protect ? { protect: opts.protect } : {}),
    ...(opts.calendar ? { calendar: opts.calendar } : {}),
  }).drop;
}

export interface BackupEntry { name: string; count: number }

/** Neueste zuerst — für die Restore-Auswahl. */
export function sortBackupsNewestFirst(entries: BackupEntry[]): BackupEntry[] {
  return [...entries].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}
