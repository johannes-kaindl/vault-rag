import { VaultAdapter } from "./index";
import { normalizeIndexDir } from "./index_dir";

const INDEX_BINARY_FILES = ["notes.i8"];
// manifest.json bewusst zuletzt (Reload-Trigger-Konvention, vgl. live_indexer.persist)
const INDEX_TEXT_FILES = ["paths.json", "pending.json", "manifest.json"];

/** Alle Index-Dateien als Basenames — für Migration und Cleanup-Sicherheitscheck. */
export const INDEX_ALL_FILES: string[] = [...INDEX_BINARY_FILES, ...INDEX_TEXT_FILES];

/** Zum LADEN nötige Index-Dateien (pending.json ist optional). */
export const INDEX_REQUIRED_FILES = ["notes.i8", "paths.json", "manifest.json"];

/**
 * Kopiert die Index-Dateien von `from` nach `to` (Copy, kein Move) — kein Reindex,
 * kein In-Memory-Risiko. Fehlende Dateien werden still übersprungen.
 */
export async function migrateIndex(adapter: VaultAdapter, from: string, to: string): Promise<void> {
  const src = normalizeIndexDir(from);
  const dst = normalizeIndexDir(to);
  if (dst === "" || src === dst) return;
  await adapter.mkdir(dst);
  for (const f of INDEX_BINARY_FILES) {
    try { await adapter.writeBinary(`${dst}/${f}`, await adapter.readBinary(`${src}/${f}`)); }
    catch { /* fehlende Datei überspringen */ }
  }
  for (const f of INDEX_TEXT_FILES) {
    try { await adapter.write(`${dst}/${f}`, await adapter.read(`${src}/${f}`)); }
    catch { /* fehlende Datei überspringen */ }
  }
}

/**
 * True, wenn ein Verzeichnis-Listing ausschließlich bekannte Index-Dateien (Basenames)
 * und keine Unterordner enthält → sicher zu löschen. `files`/`folders` sind volle Pfade
 * (Obsidian `DataAdapter.list`-Format).
 */
export function onlyContainsIndexFiles(files: string[], folders: string[]): boolean {
  if (folders.length > 0) return false;
  const known = new Set(INDEX_ALL_FILES);
  return files.every(p => known.has(p.split("/").pop() ?? p));
}

/**
 * True, wenn `files` (volle Pfade, Obsidian `DataAdapter.list`-Format) alle Pflichtdateien
 * (`INDEX_REQUIRED_FILES`) als Basename enthält — Backup-/Kopiervorgang gilt nur dann als
 * vollständig. Verhindert, dass eine durch eine Race abgebrochene `migrateIndex`-Kopie (z. B.
 * Quelldatei wird währenddessen von Sync überschrieben) als gültiges Backup gezählt wird.
 */
export function hasAllRequiredFiles(files: string[]): boolean {
  const present = new Set(files.map(p => p.split("/").pop() ?? p));
  return INDEX_REQUIRED_FILES.every(f => present.has(f));
}
