// vendored from code-kit@0.37.2, src/ts/pure/index-container.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/index_container.ts, 2026-10-11 (Änderungen: crc32 aus eigenem Modul, `noUncheckedIndexedAccess`-clean; Format und Fehlermeldungen unverändert; seit 0.30.0 ist ein Header, der kein JSON-Objekt ist, `header` statt TypeError)
/** Codec for the container file of a note index (`<dir>/index.bin`). One file instead of three, so that a file sync
 *  cannot mix generations (vault-rag spec 2026-07-29).
 *
 *  Layout: "VRIX" · u32 headerLen LE · header JSON (manifest + paths [+ stamps]) · int8 matrix · u32 CRC32 LE.
 *
 *  **The format is frozen, the names are not to be tidied:** the magic "VRIX", the file name `index.bin` and
 *  `schema_version` 2 are what every index already on disk carries, on several devices, and `decodeContainer` accepts
 *  exactly one version. The header's key ORDER is part of it too (`encodeContainer(decodeContainer(x))` gives the
 *  same bytes back; a test holds that against a real index). Origin: vault-rag (`index_container.ts`). */

import { crc32 } from "./crc32";
import type { IndexManifest } from "./vector-index";

export const CONTAINER_FILE = "index.bin";
export const CONTAINER_SCHEMA_VERSION = 2;

const MAGIC = new Uint8Array([0x56, 0x52, 0x49, 0x58]); // "VRIX"

export class ContainerError extends Error {
  constructor(readonly reason: "truncated" | "magic" | "crc" | "header" | "schema", message: string) {
    super(message);
    this.name = "ContainerError";
  }
}

/**
 * File stamp of an index row: `[mtime, size]` of the note at the time it was embedded.
 *
 * What for: a stale vector at an existing path is otherwise visible to NOTHING — CRC32 covers header and payload
 * together and vouches for a wrong state as well, `diffIndexVsVault` only compares sets, `findDeadVectorPaths` only
 * sees zero vectors. Both values come from the host's file stat for free, so the guard costs nothing at load time
 * (measured 2026-09-04: a content hash would have read 44 MB, ~768 ms raw).
 */
export type FileStamp = [mtime: number, size: number];

/** A stamp array is only good if it matches `paths` row for row. Otherwise it assigns wrongly — the same class as the
 *  index damage of 2026-08-30, where a vector matrix belonged to an older path list. Better NO guard than a wrong one. */
function stempelGueltig(stamps: unknown, pathCount: number): stamps is FileStamp[] {
  return Array.isArray(stamps)
    && stamps.length === pathCount
    && stamps.every(e => Array.isArray(e) && e.length === 2
      && typeof e[0] === "number" && Number.isFinite(e[0])
      && typeof e[1] === "number" && Number.isFinite(e[1]));
}

export function encodeContainer(
  manifest: IndexManifest,
  paths: string[],
  matrix: Uint8Array,
  stamps?: FileStamp[],
): ArrayBuffer {
  // `stamps` is an OPTIONAL field under the same `schema_version` — deliberately not a break to 3:
  // `decodeContainer` checks the version for exact equality, so raising it would make every older plugin version
  // reject the (synced!) container as a danger state.
  // Without stamps the field is LEFT OUT, not written empty: otherwise two containers with the same content would
  // no longer be byte-identical.
  const header = stamps && stamps.length === paths.length
    ? { ...manifest, schema_version: CONTAINER_SCHEMA_VERSION, paths, stamps }
    : { ...manifest, schema_version: CONTAINER_SCHEMA_VERSION, paths };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const total = 8 + headerBytes.length + matrix.length + 4;
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  out.set(matrix, 8 + headerBytes.length);
  const crc = crc32(out.subarray(0, total - 4));
  new DataView(out.buffer).setUint32(total - 4, crc, true);
  return out.buffer;
}

export function decodeContainer(buf: ArrayBuffer): {
  manifest: IndexManifest & Record<string, unknown>;
  paths: string[];
  matrix: ArrayBuffer;
  /** `undefined` for old files OR for unusable stamps — the caller then does not check. */
  stamps?: FileStamp[];
} {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 12) throw new ContainerError("truncated", `Container zu kurz (${bytes.length} Bytes)`);
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) throw new ContainerError("magic", "Container-Magic 'VRIX' fehlt");
  }
  const headerLen = new DataView(buf).getUint32(4, true);
  if (8 + headerLen + 4 > bytes.length) {
    throw new ContainerError("truncated", `Header (${headerLen} B) passt nicht in Datei (${bytes.length} B)`);
  }
  const storedCrc = new DataView(buf).getUint32(bytes.length - 4, true);
  const actualCrc = crc32(bytes.subarray(0, bytes.length - 4));
  if (storedCrc !== actualCrc) {
    throw new ContainerError("crc", `CRC-Mismatch (gespeichert ${storedCrc}, berechnet ${actualCrc}) — halb geschriebene/gesyncte Datei`);
  }
  let header: (IndexManifest & Record<string, unknown> & { paths?: unknown; stamps?: unknown });
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as typeof header;
  } catch {
    throw new ContainerError("header", "Container-Header ist kein gültiges JSON");
  }
  if (typeof header !== "object" || header === null || Array.isArray(header)) {
    throw new ContainerError("header", "Container-Header ist kein Objekt");
  }
  if (header.schema_version !== CONTAINER_SCHEMA_VERSION) {
    throw new ContainerError("schema", `Unbekannte Container-Schema-Version ${String(header.schema_version)}`);
  }
  const { paths, stamps, ...manifest } = header;
  if (!Array.isArray(paths) || paths.some(p => typeof p !== "string")) {
    throw new ContainerError("header", "Container-Header ohne gültiges paths-Array");
  }
  return {
    manifest,
    paths: paths as string[],
    matrix: buf.slice(8 + headerLen, bytes.length - 4),
    // Unusable stamps are NOT a container error: the index itself is fine, only the guard cannot work. A `throw` here
    // would turn a missing extra check into a danger state — exactly the overreaction that made the index unusable.
    ...(stempelGueltig(stamps, paths.length) ? { stamps } : {}),
  };
}
