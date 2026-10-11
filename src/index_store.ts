// Pure-core (obsidian-frei): Lade-/Migrations-Wahrheit für den Container-Index.
// Container-first; Legacy-Tripel (Prä-0.18) wird byte-level in den Container repackt
// (kein Umweg über Float — keine Re-Quantisierung) und erst nach parseIndex-Beweis
// geschrieben. Spec: Vault-Cockpit `_SDD/2026-07-29-sync-race-container-index-design.md`

import type { VaultAdapter } from "./index";
import { parseIndex, type VectorIndex, type IndexManifest } from "./vendor/kit/vector-index";
import { CONTAINER_FILE, encodeContainer, decodeContainer, type FileStamp } from "./vendor/kit/index-container";
import { loadContainerIndex } from "./vendor/kit/index-store";

export type StoreLoadResult =
  | { state: "loaded"; index: VectorIndex; source: "container" | "legacy-migrated"; stamps?: FileStamp[] }
  | { state: "no-index" }
  | { state: "corrupt" };

const LEGACY_FILES = ["notes.i8", "paths.json", "manifest.json"];

/** exists() konservativ: wirft es, gilt „könnte da sein" (sonst würde ein exists-Fehler
 *  fälschlich als no-index → markFresh → Clobber-Risiko enden; vgl. loadIndex-Kommentar). */
async function existsConservative(adapter: VaultAdapter, p: string): Promise<boolean> {
  try { return await adapter.exists(p); } catch { return true; }
}

export async function loadIndexStore(adapter: VaultAdapter, dir: string): Promise<StoreLoadResult> {
  const containerPath = `${dir}/${CONTAINER_FILE}`;
  const loaded = await loadContainerIndex(adapter, dir);
  if (loaded.state === "loaded") {
    await cleanupLegacyTriple(adapter, dir);
    return loaded;
  }
  if (loaded.state === "corrupt") return loaded;
  // no-index: ein Prä-0.18-Tripel? (Der Kit-Kern kennt es nicht — es existiert nur bei Indizes, die sonst niemand hat.)
  if (!(await existsConservative(adapter, `${dir}/manifest.json`))) return { state: "no-index" };
  // Legacy-Tripel: erst beweisen (parseIndex), dann byte-level repacken.
  let manifest: IndexManifest; let paths: string[]; let matrix: ArrayBuffer; let index: VectorIndex;
  try {
    ({ manifest, paths, matrix, index } = await readLegacyTriple(adapter, dir));
  } catch (e) {
    // s. o.: Read-/JSON-/Schema-Fehler des Tripels bleibt sichtbar, sonst ist `corrupt` blind.
    console.warn("vault-rag: loadIndexStore: Legacy-Tripel unlesbar", e);
    return { state: "corrupt" };
  }
  try {
    await adapter.writeBinary(containerPath, encodeContainer(manifest, paths, new Uint8Array(matrix)));
    await cleanupLegacyTriple(adapter, dir);
  } catch (e) {
    // Migration fehlgeschlagen → Load gilt trotzdem; nächster Load wiederholt die Migration.
    console.warn("vault-rag: loadIndexStore: Container-Migration fehlgeschlagen — nächster Load wiederholt", e);
  }
  return { state: "loaded", index, source: "legacy-migrated" };
}

/** Liest das Prä-0.18-Tripel (`manifest.json`, `paths.json`, `notes.i8`) und beweist es mit `parseIndex`. */
async function readLegacyTriple(adapter: VaultAdapter, dir: string):
  Promise<{ manifest: IndexManifest; paths: string[]; matrix: ArrayBuffer; index: VectorIndex }> {
  const manifest = JSON.parse(await adapter.read(`${dir}/manifest.json`)) as IndexManifest;
  const paths = JSON.parse(await adapter.read(`${dir}/paths.json`)) as string[];
  const matrix = await adapter.readBinary(`${dir}/notes.i8`);
  return { manifest, paths, matrix, index: parseIndex(manifest, paths, matrix) };
}

/** Räumt ein (ggf. von einem Alt-Geräte-Plugin nachgeschriebenes) Legacy-Tripel still weg. */
async function cleanupLegacyTriple(adapter: VaultAdapter, dir: string): Promise<void> {
  for (const f of LEGACY_FILES) {
    try {
      if (await adapter.exists(`${dir}/${f}`)) await adapter.remove(`${dir}/${f}`);
    } catch { /* best-effort — nächster Load räumt nach */ }
  }
}

/** Beweist ein Backup (Container ODER Prä-0.18-Tripel) via Decode + parseIndex.
 *  null = nicht beweisbar (korrupt/unvollständig) — nie werfen, Kaskade probiert das nächste. */
export async function verifyBackupCandidate(adapter: VaultAdapter, backupDir: string): Promise<VectorIndex | null> {
  try {
    if (await adapter.exists(`${backupDir}/${CONTAINER_FILE}`)) {
      const { manifest, paths, matrix } = decodeContainer(await adapter.readBinary(`${backupDir}/${CONTAINER_FILE}`));
      return parseIndex(manifest, paths, matrix);
    }
  } catch { /* Container unbrauchbar → Legacy versuchen */ }
  try {
    return (await readLegacyTriple(adapter, backupDir)).index;
  } catch {
    return null;
  }
}
