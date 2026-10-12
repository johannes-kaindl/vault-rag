// vendored from code-kit@0.23.0, src/ts/pure/index-store.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/index_store.ts (nur der Container-Pfad von loadIndexStore), 2026-10-11 (Änderungen: IndexStorage statt VaultAdapter, kein Legacy-Tripel; Warnung in der Konsole ohne den Namen des ersten Nutzers)
/** Loads the container file of a note index and says what it found: `loaded`, `no-index` (no file) or `corrupt` (a file
 *  that does not decode and prove itself). It never writes and never deletes: what to do about `corrupt` is the
 *  caller's decision (heal from a backup, rebuild — and above all do NOT overwrite a good index with an empty one, which
 *  is what {@link ../index-guard} exists for).
 *
 *  Origin: vault-rag `loadIndexStore`. The part for the pre-0.18 file triple (`notes.i8` + `paths.json` + `manifest.json`)
 *  and the cleaning up of it stay in vault-rag as a thin wrapper around this function: they exist for indexes that
 *  nobody else has. */

import { decodeContainer, CONTAINER_FILE, type FileStamp } from "./index-container";
import { parseIndex, type IndexStorage, type VectorIndex } from "./vector-index";

export type StoreLoadResult =
  | { state: "loaded"; index: VectorIndex; source: "container"; stamps?: FileStamp[] }
  | { state: "no-index" }
  | { state: "corrupt" };

/** `exists()` conservatively: if it throws, the file counts as "might be there" (otherwise an `exists` error would end
 *  as no-index → a fresh indexer → risk of clobbering a good index). */
async function existsConservative(storage: IndexStorage, p: string): Promise<boolean> {
  try { return await storage.exists(p); } catch { return true; }
}

export async function loadContainerIndex(storage: IndexStorage, dir: string): Promise<StoreLoadResult> {
  const containerPath = `${dir}/${CONTAINER_FILE}`;
  if (!(await existsConservative(storage, containerPath))) return { state: "no-index" };
  try {
    const decoded = await storage.readBinary(containerPath).then(decodeContainer);
    const { manifest, paths, matrix } = decoded;
    // `undefined` for old files (before the stamp field) — the guard cannot check then, and that is no error: the
    // index is unchecked, not suspect.
    const index = parseIndex(manifest, paths, matrix);
    return { state: "loaded", index, source: "container", ...(decoded.stamps ? { stamps: decoded.stamps } : {}) };
  } catch (e) {
    // Do not swallow the diagnosis: ContainerError.reason (crc/magic/truncated/header/schema) with the CRC values is
    // the forensic basis for reconstructing an incident.
    console.warn("index-store: Container unlesbar", e);
    return { state: "corrupt" };
  }
}
