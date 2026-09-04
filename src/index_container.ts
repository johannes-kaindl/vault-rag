// Pure-core (obsidian-frei): Codec für das Container-Index-Format `_vaultrag/index.bin`.
// Ein File statt drei → Obsidian Sync kann keine Generationen mehr mischen (Spec 2026-07-29).
// Layout: "VRIX" · u32 headerLen LE · Header-JSON (Manifest + paths [+ stamps]) · Int8-Matrix · u32 CRC32 LE.

import { IndexManifest } from "./index";

export const CONTAINER_FILE = "index.bin";
export const CONTAINER_SCHEMA_VERSION = 2;

const MAGIC = new Uint8Array([0x56, 0x52, 0x49, 0x58]); // "VRIX"

export class ContainerError extends Error {
  constructor(readonly reason: "truncated" | "magic" | "crc" | "header" | "schema", message: string) {
    super(message);
    this.name = "ContainerError";
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32/ISO-HDLC (wie zlib), unsigned. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Datei-Stempel einer Index-Zeile: `[mtime, size]` der Notiz zum Zeitpunkt des Embeddens.
 *
 * Wozu: ein veralteter Vektor bei vorhandenem Pfad ist sonst durch NICHTS erkennbar — CRC32
 * deckt Header und Nutzlast gemeinsam ab und beglaubigt einen Fehlstand mit, `diffIndexVsVault`
 * ist rein mengenbasiert, `findDeadVectorPaths` sieht nur Nullvektoren. Beide Werte liefert
 * Obsidian in `TFile.stat` aus dem Speicher, also kostet der Waechter beim Laden nichts
 * (gemessen 2026-09-04: ein Inhalts-Hash haette stattdessen 44 MB gelesen, ~768 ms roh).
 */
export type FileStamp = [mtime: number, size: number];

/** Ein Stempel-Array taugt nur, wenn es Zeile fuer Zeile zu `paths` passt. Sonst ordnet es
 *  falsch zu — dieselbe Klasse wie der Index-Altschaden vom 2026-08-30, bei dem eine
 *  Vektormatrix zu einer aelteren Pfadliste gehoerte. Lieber KEIN Waechter als ein falscher. */
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
  // `stamps` ist ein OPTIONALES Feld unter derselben `schema_version` — bewusst kein Bruch auf 3:
  // `decodeContainer` prueft die Version auf exakte Gleichheit, eine Erhoehung liesse also jede
  // aeltere Plugin-Version den (gesyncten!) Container als Gefahrenzustand ablehnen.
  // Ohne Stempel wird das Feld WEGGELASSEN, nicht leer geschrieben: sonst waeren zwei
  // inhaltsgleiche Container nicht mehr byte-identisch.
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
  /** `undefined` bei Altbestand ODER bei unbrauchbaren Stempeln — der Aufrufer prueft dann nicht. */
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
    // Unbrauchbare Stempel sind KEIN Container-Fehler: der Index selbst ist in Ordnung, nur der
    // Waechter kann nicht arbeiten. Ein `throw` hier machte aus einer fehlenden Zusatzpruefung
    // einen Gefahrenzustand — genau die Ueberreaktion, die den Index unbenutzbar machte.
    ...(stempelGueltig(stamps, paths.length) ? { stamps } : {}),
  };
}
