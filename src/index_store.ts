// Pure-core (obsidian-frei): Lade-/Migrations-Wahrheit für den Container-Index.
// Container-first; Legacy-Tripel (Prä-0.18) wird byte-level in den Container repackt
// (kein Umweg über Float — keine Re-Quantisierung) und erst nach parseIndex-Beweis
// geschrieben. Spec: docs/superpowers/specs/2026-07-29-sync-race-container-index-design.md

import { VaultAdapter, VaultIndex, IndexManifest, IndexLoader, parseIndex } from "./index";
import { CONTAINER_FILE, encodeContainer, decodeContainer } from "./index_container";

export type StoreLoadResult =
  | { state: "loaded"; index: VaultIndex; source: "container" | "legacy-migrated" }
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
  if (await existsConservative(adapter, containerPath)) {
    let index: VaultIndex;
    try {
      const { manifest, paths, matrix } = decodeContainer(await adapter.readBinary(containerPath));
      index = parseIndex(manifest, paths, matrix);
    } catch (e) {
      // Diagnose nicht verschlucken: ContainerError.reason (crc/magic/truncated/header/schema)
      // samt CRC-Werten ist die Forensik-Basis für Vorfall-Rekonstruktionen.
      console.warn("vault-rag: loadIndexStore: Container unlesbar", e);
      return { state: "corrupt" };
    }
    await cleanupLegacyTriple(adapter, dir);
    return { state: "loaded", index, source: "container" };
  }
  if (!(await existsConservative(adapter, `${dir}/manifest.json`))) return { state: "no-index" };
  // Legacy-Tripel: erst beweisen (parseIndex), dann byte-level repacken.
  let manifest: IndexManifest; let paths: string[]; let matrix: ArrayBuffer; let index: VaultIndex;
  try {
    manifest = JSON.parse(await adapter.read(`${dir}/manifest.json`)) as IndexManifest;
    paths = JSON.parse(await adapter.read(`${dir}/paths.json`)) as string[];
    matrix = await adapter.readBinary(`${dir}/notes.i8`);
    index = parseIndex(manifest, paths, matrix);
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
export async function verifyBackupCandidate(adapter: VaultAdapter, backupDir: string): Promise<VaultIndex | null> {
  try {
    if (await adapter.exists(`${backupDir}/${CONTAINER_FILE}`)) {
      const { manifest, paths, matrix } = decodeContainer(await adapter.readBinary(`${backupDir}/${CONTAINER_FILE}`));
      return parseIndex(manifest, paths, matrix);
    }
  } catch { /* Container unbrauchbar → Legacy versuchen */ }
  try {
    return await new IndexLoader(adapter, backupDir).load();
  } catch {
    return null;
  }
}
