// Pure-core (obsidian-frei): Namens-/Rotations-/Sortier-Logik für geräte-lokale Index-Backups.
// Die eigentliche Datei-I/O passiert in der Obsidian-Schicht (main.ts) via migrateIndex.

export const BACKUP_SUBDIR = "index-backups";

/** Dateisystem-sicherer Verzeichnisname aus einem ISO-Zeitstempel (`:` und `.` → `-`). */
export function backupDirName(builtAt: string): string {
  return builtAt.replace(/[:.]/g, "-");
}

/**
 * Gibt die zu löschenden Backup-Verzeichnisnamen zurück, sodass die `keep` neuesten bleiben.
 * Namen sind ISO-basiert → lexikografische Sortierung == chronologisch.
 */
export function selectBackupsToDelete(existing: string[], keep: number): string[] {
  if (existing.length <= keep) return [];
  const sorted = [...existing].sort(); // aufsteigend: ältestes zuerst
  return sorted.slice(0, existing.length - keep);
}

export interface BackupEntry { name: string; count: number }

/** Neueste zuerst — für die Restore-Auswahl. */
export function sortBackupsNewestFirst(entries: BackupEntry[]): BackupEntry[] {
  return [...entries].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}
