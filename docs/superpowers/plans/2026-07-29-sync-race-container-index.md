# Container-Index (Sync-Race-Wurzelfix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Vektor-Index wird von drei einzeln gesyncten Dateien (`notes.i8`/`paths.json`/`manifest.json`) auf **eine** Container-Datei `_vaultrag/index.bin` umgestellt, damit Obsidian Sync keine Generationen mehr mischen kann; dazu einmalige Migration, CRC-Verifikation und eine Backup-Heal-Kaskade.

**Architecture:** Neues pures Codec-Modul `index_container.ts` (Magic + Header-JSON inkl. `paths` + Int8-Matrix + CRC32), neues Lade-/Migrations-Modul `index_store.ts` (Container-first, Legacy-Tripel byte-level repacken, Aufräumen), `LiveIndexer.persist` schreibt eine Datei, `main.ts` bekommt eine Auto-Heal-Kaskade aus CRC-beweisbaren Backups. Spec: `docs/superpowers/specs/2026-07-29-sync-race-container-index-design.md`.

**Tech Stack:** TypeScript strict · vitest (happy-dom bzw. node fs für Integration) · Obsidian Plugin API nur an der Kante (`main.ts`).

## Global Constraints

- TS strict + `noImplicitAny` — keine `any`-Casts für neue Typen.
- Neue Module `index_container.ts` / `index_store.ts` sind **obsidian-frei** (nur `VaultAdapter`).
- Nach JEDER Task: `npm test` (712+ Tests), `npm run typecheck`, `npm run lint` (läuft mit `--max-warnings 0`) grün.
- Commits: Conventional Commits, deutsche Beschreibung erlaubt; **nur berührte Dateien stagen — nie `git add -A`**. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Nutzer-sichtbare Strings (Notices) deutsch, konsistent zur bestehenden UI.
- `pending.json` bleibt eine eigene Datei außerhalb des Containers.
- Der Backup-Leichen-Bug (`adapter.rmdir` wirkungslos) ist eine EIGENE TaskNote — hier nicht anfassen.
- Tests prüfen **Effekte** auf dem (Fake-)Dateisystem (existiert `index.bin`? Tripel weg?), nicht nur Rückgabewerte.

---

### Task 1: Container-Codec `index_container.ts`

**Files:**
- Create: `src/index_container.ts`
- Test: `tests/index_container.test.ts`

**Interfaces:**
- Consumes: `IndexManifest` aus `src/index.ts` (nur als Typ).
- Produces (spätere Tasks verlassen sich exakt hierauf):
  - `CONTAINER_FILE = "index.bin"` (const string)
  - `CONTAINER_SCHEMA_VERSION = 2` (const number)
  - `class ContainerError extends Error { readonly reason: "truncated" | "magic" | "crc" | "header" | "schema" }`
  - `crc32(bytes: Uint8Array): number` (Standard-CRC-32/ISO-HDLC, unsigned)
  - `encodeContainer(manifest: IndexManifest, paths: string[], matrix: Uint8Array): ArrayBuffer` — akzeptiert strukturell auch breitere Objekte (Zusatzfelder wie `built_at` wandern mit in den Header)
  - `decodeContainer(buf: ArrayBuffer): { manifest: IndexManifest & Record<string, unknown>; paths: string[]; matrix: ArrayBuffer }`

Binärlayout (Spec §Format): `"VRIX"(4B) · u32 headerLen LE · Header-JSON UTF-8 · Int8-Matrix · u32 CRC32 LE über alle Bytes davor`. Header-JSON = `{ ...manifest, schema_version: 2, paths }`; `decodeContainer` zieht `paths` heraus und gibt den Rest als `manifest` zurück.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// tests/index_container.test.ts
import { describe, it, expect } from "vitest";
import {
  CONTAINER_FILE, CONTAINER_SCHEMA_VERSION, ContainerError,
  crc32, encodeContainer, decodeContainer,
} from "../src/index_container";
import { IndexManifest } from "../src/index";

const DIM = 4;
function makeManifest(count: number): IndexManifest & Record<string, unknown> {
  return {
    schema_version: CONTAINER_SCHEMA_VERSION, embedding_model: "fake-model",
    index_dim: DIM, scale: 127, count, granularity: "note", quant: "int8",
    built_at: "2026-07-29T08:00:00.000Z",
  };
}
function makeMatrix(count: number): Uint8Array {
  const m = new Uint8Array(count * DIM);
  for (let i = 0; i < m.length; i++) m[i] = (i * 37 + 3) % 251 - 125;
  return m;
}

describe("index_container", () => {
  it("Konstanten sind gepinnt", () => {
    expect(CONTAINER_FILE).toBe("index.bin");
    expect(CONTAINER_SCHEMA_VERSION).toBe(2);
  });

  it("crc32 liefert den bekannten Referenzwert", () => {
    // CRC-32/ISO-HDLC von "123456789" ist 0xCBF43926 (Standard-Prüfvektor).
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("Round-Trip: encode → decode ist byte-genau", () => {
    const paths = ["a.md", "b.md", "c/ä ö.md"];
    const matrix = makeMatrix(3);
    const buf = encodeContainer(makeManifest(3), paths, matrix);
    const out = decodeContainer(buf);
    expect(out.paths).toEqual(paths);
    expect(out.manifest.count).toBe(3);
    expect(out.manifest.embedding_model).toBe("fake-model");
    expect((out.manifest as { built_at?: string }).built_at).toBe("2026-07-29T08:00:00.000Z");
    expect(new Uint8Array(out.matrix)).toEqual(matrix);
  });

  it("0-Notizen-Index round-trippt", () => {
    const out = decodeContainer(encodeContainer(makeManifest(0), [], new Uint8Array(0)));
    expect(out.paths).toEqual([]);
    expect(out.matrix.byteLength).toBe(0);
  });

  it("Truncation an jeder Grenze wirft ContainerError", () => {
    const full = new Uint8Array(encodeContainer(makeManifest(3), ["a.md", "b.md", "c.md"], makeMatrix(3)));
    // Schnitte: im Magic, direkt nach headerLen, mitten im Header, mitten in der Matrix, im CRC.
    const headerLen = new DataView(full.buffer).getUint32(4, true);
    const cuts = [2, 8, 8 + Math.floor(headerLen / 2), 8 + headerLen + 3, full.length - 2];
    for (const cut of cuts) {
      const cutBuf = full.slice(0, cut).buffer;
      expect(() => decodeContainer(cutBuf), `Schnitt bei ${cut}`).toThrow(ContainerError);
    }
  });

  it("Bit-Flip an beliebiger Position wirft (CRC)", () => {
    const full = new Uint8Array(encodeContainer(makeManifest(3), ["a.md", "b.md", "c.md"], makeMatrix(3)));
    for (const pos of [0, 5, 10, 8 + 4, full.length - 6, full.length - 1]) {
      const bad = full.slice();
      bad[pos] = bad[pos] ^ 0xff;
      expect(() => decodeContainer(bad.buffer), `Flip bei ${pos}`).toThrow(ContainerError);
    }
  });

  it("falsches Magic wirft mit reason 'magic'", () => {
    const full = new Uint8Array(encodeContainer(makeManifest(1), ["a.md"], makeMatrix(1)));
    full[0] = 0x58; // "X..."
    try { decodeContainer(full.buffer); expect.unreachable(); }
    catch (e) { expect((e as ContainerError).reason).toBe("magic"); }
  });

  it("falsche schema_version wirft mit reason 'schema'", () => {
    const manifest = makeManifest(1);
    (manifest as { schema_version: number }).schema_version = 1;
    const buf = encodeContainer(manifest, ["a.md"], makeMatrix(1));
    // encodeContainer erzwingt schema_version 2 im Header — der Test prüft also,
    // dass ein von Hand gebauter v1-Header abgelehnt wird:
    const full = new Uint8Array(buf);
    const headerLen = new DataView(full.buffer).getUint32(4, true);
    const headerTxt = new TextDecoder().decode(full.subarray(8, 8 + headerLen));
    const v1 = headerTxt.replace('"schema_version":2', '"schema_version":1');
    expect(v1).not.toBe(headerTxt); // Ersetzung hat gegriffen
    const v1Bytes = new TextEncoder().encode(v1);
    const body = new Uint8Array(8 + v1Bytes.length + (full.length - 8 - headerLen));
    body.set(full.subarray(0, 8)); body.set(v1Bytes, 8);
    body.set(full.subarray(8 + headerLen, full.length - 4), 8 + v1Bytes.length);
    new DataView(body.buffer).setUint32(4, v1Bytes.length, true);
    const crc = crc32(body.subarray(0, body.length - 4));
    new DataView(body.buffer).setUint32(body.length - 4, crc, true);
    try { decodeContainer(body.buffer); expect.unreachable(); }
    catch (e) { expect((e as ContainerError).reason).toBe("schema"); }
  });

  it("kaputtes Header-JSON wirft mit reason 'header'", () => {
    // Gültige Hülle, aber Header ist kein JSON: von Hand bauen, CRC korrekt setzen.
    const headerBytes = new TextEncoder().encode("{nicht json");
    const body = new Uint8Array(8 + headerBytes.length + 4);
    body.set([0x56, 0x52, 0x49, 0x58]); // "VRIX"
    new DataView(body.buffer).setUint32(4, headerBytes.length, true);
    body.set(headerBytes, 8);
    const crc = crc32(body.subarray(0, body.length - 4));
    new DataView(body.buffer).setUint32(body.length - 4, crc, true);
    try { decodeContainer(body.buffer); expect.unreachable(); }
    catch (e) { expect((e as ContainerError).reason).toBe("header"); }
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run tests/index_container.test.ts`
Expected: FAIL — Modul `../src/index_container` existiert nicht.

- [ ] **Step 3: Implementierung schreiben**

```ts
// src/index_container.ts
// Pure-core (obsidian-frei): Codec für das Container-Index-Format `_vaultrag/index.bin`.
// Ein File statt drei → Obsidian Sync kann keine Generationen mehr mischen (Spec 2026-07-29).
// Layout: "VRIX" · u32 headerLen LE · Header-JSON (Manifest + paths) · Int8-Matrix · u32 CRC32 LE.

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

export function encodeContainer(
  manifest: IndexManifest,
  paths: string[],
  matrix: Uint8Array,
): ArrayBuffer {
  const header = { ...manifest, schema_version: CONTAINER_SCHEMA_VERSION, paths };
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
  let header: (IndexManifest & Record<string, unknown> & { paths?: unknown });
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as typeof header;
  } catch {
    throw new ContainerError("header", "Container-Header ist kein gültiges JSON");
  }
  if (header.schema_version !== CONTAINER_SCHEMA_VERSION) {
    throw new ContainerError("schema", `Unbekannte Container-Schema-Version ${String(header.schema_version)}`);
  }
  const { paths, ...manifest } = header;
  if (!Array.isArray(paths) || paths.some(p => typeof p !== "string")) {
    throw new ContainerError("header", "Container-Header ohne gültiges paths-Array");
  }
  return {
    manifest: manifest as IndexManifest & Record<string, unknown>,
    paths: paths as string[],
    matrix: buf.slice(8 + headerLen, bytes.length - 4),
  };
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/index_container.test.ts`
Expected: PASS (alle).

- [ ] **Step 5: Gates + Commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: alles grün (712 + 8 neue Tests).

```bash
git add src/index_container.ts tests/index_container.test.ts
git commit -m "feat(index): Container-Codec index.bin (VRIX-Magic, Header-JSON inkl. paths, CRC32)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `VaultAdapter.remove` + Lade-/Migrations-Modul `index_store.ts`

**Files:**
- Modify: `src/index.ts` (nur: `remove` im `VaultAdapter`-Interface ergänzen)
- Create: `src/index_store.ts`
- Test: `tests/index_store.test.ts`
- Modify: alle Test-Fakes, die `VaultAdapter` strukturell implementieren (Suche: `grep -rn "VaultAdapter" tests/` — mindestens `tests/index_robustness.integration.test.ts` (`fsAdapter`), ggf. In-Memory-Adapter in `tests/live_indexer.test.ts`, `tests/index_migrate.test.ts`, `tests/index.test.ts`): Methode `remove` ergänzen.

**Interfaces:**
- Consumes: `CONTAINER_FILE`, `encodeContainer`, `decodeContainer`, `ContainerError` (Task 1); `IndexLoader`, `parseIndex`, `VaultIndex`, `VaultAdapter` (bestehend).
- Produces:
  - `VaultAdapter` hat neu `remove(path: string): Promise<void>` (Obsidians `DataAdapter` erfüllt das strukturell bereits — `main.ts` nutzt `adapter.remove` heute schon direkt).
  - `type StoreLoadResult = { state: "loaded"; index: VaultIndex; source: "container" | "legacy-migrated" } | { state: "no-index" } | { state: "corrupt" }`
  - `loadIndexStore(adapter: VaultAdapter, dir: string): Promise<StoreLoadResult>`
  - `verifyBackupCandidate(adapter: VaultAdapter, backupDir: string): Promise<VaultIndex | null>`

Semantik (Spec §Load-Pfad): Container-first; Legacy-Tripel wird **byte-level** repackt (Original-`notes.i8` unverändert in den Container — KEINE Re-Quantisierung) und erst nach `parseIndex`-Beweis geschrieben; Tripel danach gelöscht. Schlägt Schreiben/Aufräumen fehl, gilt der Load trotzdem als erfolgreich (nächster Load wiederholt). `exists`-Fehler gelten konservativ als „könnte da sein" (wie heute in `loadIndex`).

- [ ] **Step 1: `remove` ins Interface (kein Test nötig — Typ-Änderung)**

```ts
// src/index.ts — im VaultAdapter-Interface ergänzen:
export interface VaultAdapter {
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}
```

Dann `npm run typecheck` — jeder Fehler zeigt einen Test-Fake, dem `remove` fehlt. In `fsAdapter` (Integrationstest): `remove: async (p) => { await fs.rm(p, { force: true }); },` — In-Memory-Fakes analog (`delete store[p]`).

- [ ] **Step 2: Failing Tests für `index_store` schreiben**

Muster: echtes Dateisystem wie `tests/index_robustness.integration.test.ts` (Temp-Dir, `fsAdapter` — dorthin schauen und `fsAdapter`/Temp-Setup ÜBERNEHMEN, inkl. neuem `remove`).

```ts
// tests/index_store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VaultAdapter, IndexManifest } from "../src/index";
import { CONTAINER_FILE, encodeContainer, decodeContainer } from "../src/index_container";
import { loadIndexStore, verifyBackupCandidate } from "../src/index_store";

const DIM = 4;

function fsAdapter(): VaultAdapter {
  return {
    read: (p) => fs.readFile(p, "utf8"),
    readBinary: async (p) => { const b = await fs.readFile(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
    write: async (p, d) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, d); },
    writeBinary: async (p, d) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, Buffer.from(d)); },
    mkdir: async (p) => { await fs.mkdir(p, { recursive: true }); },
    exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
    remove: async (p) => { await fs.rm(p, { force: true }); },
  };
}

function makeManifest(count: number): IndexManifest {
  return { schema_version: 1, embedding_model: "fake", index_dim: DIM, scale: 127, count, granularity: "note", quant: "int8" };
}
function makeMatrix(count: number): Uint8Array {
  const m = new Uint8Array(count * DIM);
  for (let i = 0; i < m.length; i++) m[i] = (i % 200) - 100;
  return m;
}
const PATHS3 = ["a.md", "b.md", "c.md"];

describe("index_store", () => {
  let root: string; let dir: string; let a: VaultAdapter;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-store-"));
    dir = path.join(root, "_vaultrag");
    a = fsAdapter();
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  async function writeLegacyTriple(count = 3, paths = PATHS3): Promise<void> {
    await a.mkdir(dir);
    await a.writeBinary(`${dir}/notes.i8`, makeMatrix(count).buffer);
    await a.write(`${dir}/paths.json`, JSON.stringify(paths));
    await a.write(`${dir}/manifest.json`, JSON.stringify(makeManifest(count)));
  }
  async function writeContainer(count = 3, paths = PATHS3): Promise<void> {
    await a.mkdir(dir);
    await a.writeBinary(`${dir}/${CONTAINER_FILE}`, encodeContainer(makeManifest(count), paths, makeMatrix(count)));
  }

  it("Container vorhanden → loaded (source container)", async () => {
    await writeContainer();
    const r = await loadIndexStore(a, dir);
    expect(r.state).toBe("loaded");
    if (r.state === "loaded") { expect(r.source).toBe("container"); expect(r.index.count).toBe(3); }
  });

  it("nur Legacy-Tripel → Migration: loaded, Container existiert, Tripel weg, pending.json überlebt", async () => {
    await writeLegacyTriple();
    await a.write(`${dir}/pending.json`, JSON.stringify(["x.md"]));
    const r = await loadIndexStore(a, dir);
    expect(r.state).toBe("loaded");
    if (r.state === "loaded") { expect(r.source).toBe("legacy-migrated"); expect(r.index.count).toBe(3); }
    // EFFEKT auf dem Dateisystem:
    expect(await a.exists(`${dir}/${CONTAINER_FILE}`)).toBe(true);
    expect(await a.exists(`${dir}/notes.i8`)).toBe(false);
    expect(await a.exists(`${dir}/paths.json`)).toBe(false);
    expect(await a.exists(`${dir}/manifest.json`)).toBe(false);
    expect(await a.exists(`${dir}/pending.json`)).toBe(true);
  });

  it("Migration ist BYTE-LEVEL: Matrix im Container ist identisch zum alten notes.i8", async () => {
    await writeLegacyTriple();
    await loadIndexStore(a, dir);
    const { matrix } = decodeContainer(await a.readBinary(`${dir}/${CONTAINER_FILE}`));
    expect(new Uint8Array(matrix)).toEqual(makeMatrix(3));
  });

  it("Container UND Tripel vorhanden → Container gewinnt, Tripel wird still aufgeräumt", async () => {
    await writeContainer(3);
    await writeLegacyTriple(1, ["alt.md"]); // z. B. von einem Alt-Geräte-Plugin nachgeschrieben
    const r = await loadIndexStore(a, dir);
    expect(r.state).toBe("loaded");
    if (r.state === "loaded") { expect(r.source).toBe("container"); expect(r.index.count).toBe(3); }
    expect(await a.exists(`${dir}/notes.i8`)).toBe(false);
    expect(await a.exists(`${dir}/manifest.json`)).toBe(false);
  });

  it("nichts vorhanden → no-index", async () => {
    expect((await loadIndexStore(a, dir)).state).toBe("no-index");
  });

  it("korrupter Container (Bit-Flip) → corrupt; Datei bleibt unangetastet", async () => {
    await writeContainer();
    const p = `${dir}/${CONTAINER_FILE}`;
    const bytes = new Uint8Array(await a.readBinary(p));
    bytes[10] = bytes[10] ^ 0xff;
    await a.writeBinary(p, bytes.buffer);
    expect((await loadIndexStore(a, dir)).state).toBe("corrupt");
    expect(await a.exists(p)).toBe(true);
  });

  it("korruptes Legacy-Tripel (count-Mismatch) → corrupt; KEINE Migration, Tripel bleibt", async () => {
    await writeLegacyTriple(3);
    await a.write(`${dir}/paths.json`, JSON.stringify(["nur-einer.md"])); // count 3 ≠ 1 Pfad
    expect((await loadIndexStore(a, dir)).state).toBe("corrupt");
    expect(await a.exists(`${dir}/${CONTAINER_FILE}`)).toBe(false);
    expect(await a.exists(`${dir}/notes.i8`)).toBe(true);
  });

  it("verifyBackupCandidate: Container-Backup wird bewiesen geladen", async () => {
    const bdir = path.join(root, "backup-1");
    await a.mkdir(bdir);
    await a.writeBinary(`${bdir}/${CONTAINER_FILE}`, encodeContainer(makeManifest(3), PATHS3, makeMatrix(3)));
    const idx = await verifyBackupCandidate(a, bdir);
    expect(idx?.count).toBe(3);
  });

  it("verifyBackupCandidate: Legacy-Tripel-Backup (Prä-0.18-Bestand) wird geladen", async () => {
    const bdir = path.join(root, "backup-legacy");
    await a.mkdir(bdir);
    await a.writeBinary(`${bdir}/notes.i8`, makeMatrix(2).buffer);
    await a.write(`${bdir}/paths.json`, JSON.stringify(["a.md", "b.md"]));
    await a.write(`${bdir}/manifest.json`, JSON.stringify(makeManifest(2)));
    const idx = await verifyBackupCandidate(a, bdir);
    expect(idx?.count).toBe(2);
  });

  it("verifyBackupCandidate: korruptes Backup → null (kein Throw)", async () => {
    const bdir = path.join(root, "backup-bad");
    await a.mkdir(bdir);
    await a.writeBinary(`${bdir}/${CONTAINER_FILE}`, new Uint8Array([1, 2, 3]).buffer);
    expect(await verifyBackupCandidate(a, bdir)).toBeNull();
  });

  it("verifyBackupCandidate: leerer Ordner → null", async () => {
    const bdir = path.join(root, "backup-leer");
    await a.mkdir(bdir);
    expect(await verifyBackupCandidate(a, bdir)).toBeNull();
  });
});
```

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run tests/index_store.test.ts`
Expected: FAIL — `../src/index_store` existiert nicht.

- [ ] **Step 4: Implementierung schreiben**

```ts
// src/index_store.ts
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
    } catch {
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
  } catch {
    return { state: "corrupt" };
  }
  try {
    await adapter.writeBinary(containerPath, encodeContainer(manifest, paths, new Uint8Array(matrix)));
    await cleanupLegacyTriple(adapter, dir);
  } catch {
    // Migration fehlgeschlagen → Load gilt trotzdem; nächster Load wiederholt die Migration.
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
```

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/index_store.test.ts`
Expected: PASS.

- [ ] **Step 6: Gates + Commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: grün (inkl. der in Step 1 um `remove` ergänzten Fakes).

```bash
git add src/index.ts src/index_store.ts tests/index_store.test.ts tests/index_robustness.integration.test.ts
# + jede weitere Testdatei, deren Fake-Adapter remove bekam (git status prüfen, gezielt adden)
git commit -m "feat(index): index_store — Container-first-Load, byte-level Legacy-Migration, Backup-Beweis

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `index_migrate.ts` — Dateilisten & Vollständigkeits-Semantik

**Files:**
- Modify: `src/index_migrate.ts`
- Test: `tests/index_migrate.test.ts`

**Interfaces:**
- Consumes: `CONTAINER_FILE` (Task 1).
- Produces (Tasks 4–5 verlassen sich darauf):
  - `INDEX_REQUIRED_FILES = ["index.bin"]`
  - `INDEX_ALL_FILES` enthält `index.bin` **und** die Legacy-Namen (`notes.i8`, `paths.json`, `pending.json`, `manifest.json`) — `onlyContainsIndexFiles` muss alte Ordner weiter als sicher-löschbar erkennen.
  - `migrateIndex(adapter, from, to)` kopiert alle vorhandenen bekannten Dateien (Container **und** ggf. Legacy — für Prä-0.18-Backups), Signatur unverändert.
  - `hasAllRequiredFiles(files: string[]): boolean` — NEU: true, wenn `index.bin` da ist **oder** das Legacy-Tripel (`notes.i8` + `paths.json` + `manifest.json`) komplett ist.

**Warum vor dem persist-Umbau:** Sobald `persist` (Task 4) den Container schreibt, müssen `migrateIndex`/`hasAllRequiredFiles` `index.bin` bereits kennen — sonst laufen die Backup-Round-Trip-Integrationstests am Ende von Task 4 rot.

- [ ] **Step 1: Failing Tests schreiben** (in `tests/index_migrate.test.ts` ergänzen/ändern; bestehendes Adapter-Muster des Files nutzen)

```ts
it("migrateIndex kopiert den Container (und lässt fehlende Legacy-Dateien stumm aus)", async () => {
  // from enthält nur index.bin + pending.json → beide landen in to, sonst nichts.
});

it("migrateIndex kopiert ein Legacy-Tripel (Prä-0.18-Backup) weiterhin vollständig", async () => {
  // from enthält notes.i8/paths.json/manifest.json → alle drei landen in to.
});

it("hasAllRequiredFiles: Container allein genügt", () => {
  expect(hasAllRequiredFiles(["x/index.bin"])).toBe(true);
});

it("hasAllRequiredFiles: Legacy-Tripel komplett genügt", () => {
  expect(hasAllRequiredFiles(["x/notes.i8", "x/paths.json", "x/manifest.json"])).toBe(true);
});

it("hasAllRequiredFiles: unvollständiges Tripel ohne Container → false", () => {
  expect(hasAllRequiredFiles(["x/notes.i8", "x/manifest.json"])).toBe(false);
});

it("onlyContainsIndexFiles kennt index.bin UND die Legacy-Namen", () => {
  expect(onlyContainsIndexFiles(["d/index.bin", "d/pending.json"], [])).toBe(true);
  expect(onlyContainsIndexFiles(["d/notes.i8", "d/paths.json", "d/manifest.json"], [])).toBe(true);
  expect(onlyContainsIndexFiles(["d/index.bin", "d/fremd.md"], [])).toBe(false);
});
```

Die zwei Kommentar-Tests mit dem konkreten Adapter-Muster des Files ausformulieren (Effekt-Assertions: welche Dateien existieren in `to`).

- [ ] **Step 2: Laufen lassen — müssen fehlschlagen**

Run: `npx vitest run tests/index_migrate.test.ts`
Expected: FAIL (`index.bin` unbekannt; `hasAllRequiredFiles` verlangt noch das Tripel).

- [ ] **Step 3: Implementierung**

```ts
// src/index_migrate.ts — Kopf ersetzen:
import { CONTAINER_FILE } from "./index_container";

const INDEX_BINARY_FILES = [CONTAINER_FILE, "notes.i8"];
// Legacy-Namen bleiben gelistet: Prä-0.18-Backups kopier-/restorebar, alte Ordner cleanup-sicher.
const INDEX_TEXT_FILES = ["paths.json", "pending.json", "manifest.json"];

export const INDEX_ALL_FILES: string[] = [...INDEX_BINARY_FILES, ...INDEX_TEXT_FILES];

/** Zum LADEN nötig: der Container. (Legacy-Vollständigkeit prüft hasAllRequiredFiles.) */
export const INDEX_REQUIRED_FILES = [CONTAINER_FILE];

const LEGACY_REQUIRED_FILES = ["notes.i8", "paths.json", "manifest.json"];

// hasAllRequiredFiles ersetzen:
/** True, wenn das Listing einen ladbaren Index-Bestand beschreibt: Container vorhanden
 *  ODER Legacy-Tripel (Prä-0.18-Backup) komplett. */
export function hasAllRequiredFiles(files: string[]): boolean {
  const present = new Set(files.map(p => p.split("/").pop() ?? p));
  if (present.has(CONTAINER_FILE)) return true;
  return LEGACY_REQUIRED_FILES.every(f => present.has(f));
}
```

`migrateIndex` und `onlyContainsIndexFiles` bleiben unverändert — sie arbeiten über die Listen.

- [ ] **Step 4: Laufen lassen — bestehen; Gates**

Run: `npx vitest run tests/index_migrate.test.ts && npm test && npm run typecheck && npm run lint`
Expected: PASS. Achtung: `main.ts` nutzt `INDEX_REQUIRED_FILES` in `indexComplete`/`restoreBackup` — kompiliert weiter (nur Werteänderung), Verhalten wird in Task 5 verdrahtet.

- [ ] **Step 5: Commit**

```bash
git add src/index_migrate.ts tests/index_migrate.test.ts
git commit -m "feat(index): Migrations-/Backup-Dateilisten auf Container + Legacy-Kompatibilität

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `LiveIndexer.persist` schreibt den Container; `readDiskCount` liest ihn

**Files:**
- Modify: `src/live_indexer.ts` (`persist` ~Z.139–187, `readDiskCount` ~Z.193–203)
- Test: `tests/live_indexer.test.ts` (bestehende persist-Assertions umstellen)
- Modify: `tests/index_robustness.integration.test.ts` (liest Platte-Zustand künftig via Container)

**Interfaces:**
- Consumes: `CONTAINER_FILE`, `encodeContainer`, `decodeContainer` (Task 1).
- Produces: `persist(reason)` schreibt **genau eine Datei** `${indexDir}/index.bin` (kein `notes.i8`/`paths.json`/`manifest.json` mehr); Signaturen von `persist`/`readDiskCount` unverändert. Guards (`assertSafeToPersist`, `PersistBlockedError`-Kinds `not-ready`/`shrink`/`unreadable`) unverändert.

- [ ] **Step 1: Failing Tests schreiben/umstellen**

In `tests/live_indexer.test.ts` (bestehenden In-Memory-Adapter des Files nutzen; er hat seit Task 2 `remove`). Neue/geänderte Tests:

```ts
// Ergänzen in tests/live_indexer.test.ts (Importe: CONTAINER_FILE, decodeContainer aus ../src/index_container):

it("persist schreibt GENAU EINE Datei: index.bin — kein Tripel mehr", async () => {
  // Setup wie in den bestehenden persist-Tests des Files (Indexer mit 2 Notizen, markFresh, update…).
  await indexer.persist("reindex");
  expect(files.has(`${DIR}/${CONTAINER_FILE}`)).toBe(true);       // files = Map des In-Memory-Adapters
  expect(files.has(`${DIR}/notes.i8`)).toBe(false);
  expect(files.has(`${DIR}/paths.json`)).toBe(false);
  expect(files.has(`${DIR}/manifest.json`)).toBe(false);
});

it("persist-Container round-trippt: decode liefert Count, Pfade sortiert, Matrix-Größe", async () => {
  await indexer.persist("reindex");
  const { manifest, paths, matrix } = decodeContainer(files.get(`${DIR}/${CONTAINER_FILE}`)!);
  expect(manifest.count).toBe(2);
  expect(paths).toEqual([...paths].sort());
  expect(matrix.byteLength).toBe(2 * 256);
});

it("readDiskCount (via persist-live-Guard): Container-Count zählt — Shrink von 100 auf 1 blockt", async () => {
  // Analog zum bestehenden Shrink-Test, nur dass die Platte jetzt einen Container mit count 100 hält:
  // Container mit count 100 in den Adapter legen (encodeContainer), Indexer mit 1 Notiz ready machen,
  // persist("live") → erwartet PersistBlockedError kind "shrink".
});

it("readDiskCount: korrupter Container → PersistBlockedError kind 'unreadable'", async () => {
  // Container-Bytes flippen, Indexer ready mit n Notizen, persist("live") → "unreadable".
});

it("readDiskCount: kein Container → 0 → frischer Aufbau erlaubt", async () => {
  // Leerer Adapter, markFresh, 1 Notiz, persist("live") → kein Throw, index.bin existiert danach.
});
```

Die drei Kommentar-Tests mit dem konkreten Setup-Muster des Files ausformulieren (bestehende Shrink-/unreadable-Tests im File zeigen das Muster exakt — sie stellen heute `manifest.json` in den Adapter; NUR die Platte-Vorbereitung auf `encodeContainer` umstellen, Assertions bleiben).

- [ ] **Step 2: Tests laufen lassen — neue müssen fehlschlagen**

Run: `npx vitest run tests/live_indexer.test.ts`
Expected: FAIL (persist schreibt noch das Tripel; alte Tripel-Assertions schlagen ebenfalls fehl → sie in diesem Schritt auf Container umgestellt haben).

- [ ] **Step 3: Implementierung**

In `src/live_indexer.ts`:

```ts
// Import ergänzen:
import { CONTAINER_FILE, encodeContainer, decodeContainer } from "./index_container";

// persist(): den Block ab `await this.adapter.mkdir(this.indexDir);` (nach dem i8-Aufbau) ersetzen durch:
    await this.adapter.mkdir(this.indexDir);
    const manifest = {
      schema_version: 1, // wird von encodeContainer auf CONTAINER_SCHEMA_VERSION gesetzt
      vault: (this.loadedManifest as { vault?: string } | null)?.vault ?? "10_Pallas",
      embedding_model: this.embeddingModel,
      source_dim: INDEX_DIM,
      index_dim: INDEX_DIM,
      granularity: "note",
      aggregation: "mean",
      quant: "int8",
      scale: INT8_SCALE,
      count: n,
      source_commit: "",
      built_at: new Date().toISOString(),
    };
    // EIN Container statt drei Dateien — Sync kann keine Generationen mehr mischen (Spec 2026-07-29).
    await this.adapter.writeBinary(`${this.indexDir}/${CONTAINER_FILE}`, encodeContainer(manifest, paths, new Uint8Array(i8.buffer)));
    this.ready = true;
// (das Feld `shards` entfällt — es beschrieb die Tripel-Aufteilung)

// readDiskCount(): Rumpf ersetzen:
  private async readDiskCount(): Promise<number | null> {
    const containerPath = `${this.indexDir}/${CONTAINER_FILE}`;
    let exists: boolean;
    try { exists = await this.adapter.exists(containerPath); } catch { return null; }
    if (!exists) return 0;
    try {
      const { manifest } = decodeContainer(await this.adapter.readBinary(containerPath));
      return typeof manifest.count === "number" ? manifest.count : null;
    } catch { return null; }
  }
```

Hinweis für den Docstring von `readDiskCount`: Semantik unverändert (kein Container = legitim frisch `0`; unlesbar/korrupt = `null` = blocken). Kein Legacy-Fallback nötig — `loadIndexStore` migriert, bevor im Plugin-Lebenszyklus der erste Live-Persist laufen kann (Spec §live_indexer).

- [ ] **Step 4: Integrationstest nachziehen**

`tests/index_robustness.integration.test.ts` läuft nach Step 3 rot, weil `IndexLoader.load()` (Tripel) nichts mehr findet und `countOnDisk` `manifest.json` liest. Umstellen:

```ts
// Importe ergänzen: CONTAINER_FILE, decodeContainer aus ../src/index_container,
//                   loadIndexStore aus ../src/index_store
// countOnDisk ersetzen:
async function countOnDisk(dir: string): Promise<number> {
  const b = await fs.readFile(path.join(dir, CONTAINER_FILE));
  const { manifest } = decodeContainer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return manifest.count;
}
// Jede Stelle `new IndexLoader(fsAdapter(), indexDir).load()` → 
//   const r = await loadIndexStore(fsAdapter(), indexDir);
//   (r.state === "loaded" prüfen, Index aus r.index nehmen)
// Der Byte-Guard-Test „abgeschnittener notes.i8" wird zum Container-Test:
//   index.bin real abschneiden → loadIndexStore → state "corrupt".
// Der Sync-Race-Test (markFresh + später erscheinender großer Index) bleibt inhaltlich
// identisch — der „auf Platte erscheinende" Index wird als Container geschrieben
// (encodeContainer) statt als Tripel.
```

- [ ] **Step 5: Alle Tests laufen lassen**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS komplett.

- [ ] **Step 6: Commit**

```bash
git add src/live_indexer.ts tests/live_indexer.test.ts tests/index_robustness.integration.test.ts
git commit -m "feat(index): persist schreibt den Container (eine Datei) — Sync-Race strukturell unmöglich

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `main.ts` — Store-Load, Auto-Heal-Kaskade, Backups, Reload-Trigger

**Files:**
- Modify: `src/index_guard.ts` (eine neue pure Funktion)
- Modify: `src/main.ts` (`loadIndex` ~Z.718–777, `maybeReload` ~Z.779–804, `snapshotIndex` ~Z.571–597, `listBackups` ~Z.619–628, `restoreBackup` ~Z.630–639)
- Test: `tests/index_guard.test.ts`

**Interfaces:**
- Consumes: `loadIndexStore`, `verifyBackupCandidate`, `StoreLoadResult` (Task 2); `CONTAINER_FILE`, `decodeContainer` (Task 1); `hasAllRequiredFiles` (Task 3); bestehend: `diffIndexVsVault`, `LiveIndexer.healMissing`, `embedderReady`, `runIndexOp`, `listBackups`, `backupsRoot`.
- Produces: `canPersistHealedIndex(failedCount: number): boolean` in `index_guard.ts`; neue private Methode `attemptAutoHeal()` in `main.ts`.

**Wichtig:** `main.ts` ist obsidian-verdrahtet und headless nicht lauffähig (Repo-Konvention: dünne Kante, Test-Gewicht im puren Kern). Die testbaren Entscheidungen stecken in Tasks 1–4 + `canPersistHealedIndex`; dieser Task wird über `typecheck`/`lint`/Gesamt-Testlauf/Build + den manuellen Smoke (Handoff) abgesichert.

- [ ] **Step 1: Failing Test für `canPersistHealedIndex`**

```ts
// tests/index_guard.test.ts ergänzen:
import { canPersistHealedIndex } from "../src/index_guard";

describe("canPersistHealedIndex", () => {
  it("nur ein restlos sauberer Heal-Lauf darf persistieren (failed === 0)", () => {
    expect(canPersistHealedIndex(0)).toBe(true);
    expect(canPersistHealedIndex(1)).toBe(false);
    expect(canPersistHealedIndex(50)).toBe(false);
  });
});
```

Run: `npx vitest run tests/index_guard.test.ts` → FAIL (Funktion fehlt).

- [ ] **Step 2: `canPersistHealedIndex` implementieren**

```ts
// src/index_guard.ts ergänzen:
/**
 * Auto-Heal-Persist-Regel (Spec §Heal-Kaskade, Schutzregel b): Der aus einem Backup geheilte
 * Index darf nur persistieren (und sich per Sync verteilen), wenn der Heal-Lauf restlos
 * durchlief. Bricht der Endpoint mitten im Heal weg (failed > 0), bleibt der Gefahrenzustand
 * bestehen, statt einen halb geheilten Index zu verteilen.
 */
export function canPersistHealedIndex(failedCount: number): boolean {
  return failedCount === 0;
}
```

Run: `npx vitest run tests/index_guard.test.ts` → PASS.

- [ ] **Step 3: `loadIndex` auf `loadIndexStore` umstellen**

```ts
// src/main.ts — Importe ergänzen/ändern:
import { loadIndexStore, verifyBackupCandidate } from "./index_store";
import { CONTAINER_FILE, decodeContainer } from "./index_container";
import { /* bestehende + */ canPersistHealedIndex } from "./index_guard";
// (Import von IndexLoader und classifyLoadResult aus main.ts entfernen, falls nirgends mehr genutzt —
//  classifyLoadResult bleibt in index_guard.ts exportiert, die Semantik lebt jetzt in loadIndexStore.)

// Neues Feld in der Plugin-Klasse:
  /** Auto-Heal höchstens einmal je Gefahrenzustand-Episode (Reset bei gesundem Load). */
  private autoHealAttempted = false;

// loadIndex() — Rumpf ersetzen:
  async loadIndex() {
    const result = await loadIndexStore(this.app.vault.adapter, this.settings.indexDir);
    if (result.state === "loaded") {
      this.autoHealAttempted = false;
      this.index = result.index;
      this.liveIndexer.init(this.index);
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/${CONTAINER_FILE}`);
      if (st) this.lastMtime = st.mtime;
      this.indexHealthy = true;
      this.refresh();
      this.syncProgress();
      const vaultPaths = this.vaultMarkdownPaths();
      const { missing } = diffIndexVsVault([...this.index.paths], vaultPaths);
      this.emptyNotePaths = new Set(await classifyChunkless(missing, (p) => this.app.vault.adapter.read(p)));
      const embeddable = missing.filter(p => !this.emptyNotePaths.has(p));
      if (embeddable.length > 20 && embeddable.length > vaultPaths.length * 0.05 && await this.embedderReady()) {
        // (Auto-Heal-Prompt: Block UNVERÄNDERT aus dem bisherigen loaded-ok-Zweig übernehmen —
        //  Notice + confirmAction fire-and-forget, vgl. bee6a2a-Gotcha.)
      }
    } else if (result.state === "no-index") {
      this.index = null;
      this.liveIndexer.markFresh();
      this.indexHealthy = true;
      this.syncProgress();
    } else {
      // GEFAHRENZUSTAND (wie bisher): Schreibschutz sofort, dann Heal-Kaskade fire-and-forget
      // (kein await — onload darf nicht auf Netz/Backups blocken, vgl. bee6a2a-Gotcha).
      this.index = null;
      this.liveIndexer.markUnready();
      this.indexHealthy = false;
      this.syncProgress();
      new Notice("⚠ Vault Retrieval: Der Embedding-Index für die Ähnlichkeitssuche ist beschädigt — deine Notizen sind unberührt, nur der Suchindex. Schreibschutz aktiv; automatische Wiederherstellung wird versucht.", 10000);
      void this.attemptAutoHeal();
    }
  }
```

Die Kommentare `(… UNVERÄNDERT übernehmen)` heißen: den existierenden Codeblock aus dem alten Rumpf wörtlich weiterverwenden — nicht neu erfinden.

- [ ] **Step 4: `attemptAutoHeal` implementieren**

```ts
// src/main.ts — neue Methode (Spec §Heal-Kaskade):
  /** Backup-Kaskade: neuestes CRC-beweisbares Backup übernehmen, Lücke per Delta-Heal schließen,
   *  nur restlos sauberen Heal persistieren. Ohne Endpoint/Backup bleibt der Gefahrenzustand
   *  (iPhone wartet auf die Desktop-Heilung via Sync). */
  private async attemptAutoHeal(): Promise<void> {
    if (this.autoHealAttempted) return;
    this.autoHealAttempted = true;
    if (!(await this.embedderReady())) return;
    let candidate: VaultIndex | null = null;
    for (const b of await this.listBackups()) { // sortBackupsNewestFirst-Reihenfolge
      candidate = await verifyBackupCandidate(this.app.vault.adapter, `${this.backupsRoot()}/${b.name}`);
      if (candidate) break;
    }
    if (!candidate) return; // keine beweisbare Basis → Status quo (Notice kam bereits)
    let healed = false;
    let added = 0;
    await this.runIndexOp(async () => {
      this.liveIndexer.init(candidate!);
      const { missing } = diffIndexVsVault([...candidate!.paths], this.vaultMarkdownPaths());
      const report = await this.liveIndexer.healMissing(missing, (p) => this.app.vault.adapter.read(p));
      if (!canPersistHealedIndex(report.failed.length)) {
        this.liveIndexer.markUnready(); // halb geheilten Index NICHT verteilen
        return;
      }
      await this.liveIndexer.persist("heal");
      healed = true;
      added = report.added;
    });
    if (healed) {
      new Notice(`vault-rag: Index automatisch aus Backup wiederhergestellt — ${added} Notizen ergänzt.`, 8000);
      await this.loadIndex(); // lädt den frisch persistierten Container → gesunder Zustand
    } else {
      new Notice("vault-rag: Automatische Wiederherstellung unvollständig — Schreibschutz bleibt aktiv. Über Einstellungen › Index-Robustheit wiederherstellen oder neu indizieren.", 10000);
    }
  }
```

Rekursions-Schutz: `autoHealAttempted` wird erst bei einem **gesunden** Load zurückgesetzt (Step 3) — die Kaskade läuft höchstens einmal pro Gefahrenzustand-Episode; das `loadIndex()` am Erfolgsende trifft den `loaded`-Zweig und resettet.

- [ ] **Step 5: Reload-Trigger + Backups umstellen**

```ts
// maybeReload(): stat auf den Container:
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/${CONTAINER_FILE}`);
// (Rest des Rumpfs unverändert — Suspicious-Shrink-Logik bleibt.)

// snapshotIndex(): built_at aus dem Container-Header statt manifest.json:
        let builtAt = "";
        try {
          const buf = await this.app.vault.adapter.readBinary(`${this.settings.indexDir}/${CONTAINER_FILE}`);
          builtAt = ((decodeContainer(buf).manifest as { built_at?: string }).built_at) ?? "";
        } catch { /* ignore */ }
// „schon gesichert"-Check: statt `${dest}/manifest.json` → `${dest}/${CONTAINER_FILE}`.

// listBackups(): Count je Backup — Container-first, Legacy-Fallback (Prä-0.18-Backups):
      let count = 0;
      try {
        const buf = await this.app.vault.adapter.readBinary(`${this.backupsRoot()}/${name}/${CONTAINER_FILE}`);
        count = decodeContainer(buf).manifest.count;
      } catch {
        try { const m = JSON.parse(await this.app.vault.adapter.read(`${this.backupsRoot()}/${name}/manifest.json`)) as { count?: number }; count = m.count ?? 0; } catch { /* ignore */ }
      }

// restoreBackup(): Vollständigkeit via hasAllRequiredFiles statt Datei-Schleife
// (akzeptiert Container-Backups UND Prä-0.18-Tripel-Backups; loadIndex migriert Letztere):
  async restoreBackup(name: string): Promise<void> {
    const src = `${this.backupsRoot()}/${name}`;
    const listing = await this.app.vault.adapter.list(src);
    if (!hasAllRequiredFiles(listing.files ?? [])) {
      new Notice(`Backup „${name}" unvollständig — Wiederherstellung abgebrochen.`);
      return;
    }
    await migrateIndex(this.app.vault.adapter, src, this.settings.indexDir);
    await this.loadIndex();
    new Notice(this.indexHealthy ? "Index aus Backup wiederhergestellt." : "Wiederhergestellter Index ließ sich nicht laden.");
  }
```

`indexComplete` bleibt unverändert (nutzt `INDEX_REQUIRED_FILES`, das seit Task 3 `["index.bin"]` ist — genau richtig für den indexDir-Wechsel nach der Migration).

- [ ] **Step 6: Gates + Build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: alles grün. (Kein neuer `node:`-Import, kein neuer obsidian-Import außerhalb der Kante.)

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/index_guard.ts tests/index_guard.test.ts
git commit -m "feat(index): main auf Container-Store — Auto-Heal-Kaskade aus beweisbaren Backups, Reload/Backups/Restore umgestellt

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Integrations-Szenarien (echtes Dateisystem)

**Files:**
- Modify: `tests/index_robustness.integration.test.ts` (neue Szenarien ergänzen; Grundumstellung kam in Task 4)

**Interfaces:**
- Consumes: alles aus Tasks 1–4 (`loadIndexStore`, `verifyBackupCandidate`, `encodeContainer`, `decodeContainer`, `CONTAINER_FILE`, `hasAllRequiredFiles`).
- Produces: Regressions-Netz für genau die Fehlerklasse des Vorfalls vom 22.07.

- [ ] **Step 1: Szenarien-Tests schreiben** (ins bestehende describe; `buildGoodIndex`/`fsAdapter`-Helfer wiederverwenden)

```ts
it("VORFALL 22.07. NACHGESTELLT: gemischte Generationen sind strukturell unmöglich — es gibt nur noch ganze Container-Generationen", async () => {
  await buildGoodIndex(); // schreibt Container Gen A (100 Notizen)
  const genA = await fs.readFile(path.join(indexDir, CONTAINER_FILE));
  // Gen B: kleiner Index (6 Notizen) — wie der iPhone-Winz-Stand vom 22.07.
  const li = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
  li.markFresh();
  await li.healMissing(paths.slice(0, 6), read);
  await li.persist("heal"); // Container Gen B ersetzt Gen A ALS GANZES
  // Sync kann nur „Datei A" oder „Datei B" wählen — beide laden konsistent:
  for (const gen of [genA, await fs.readFile(path.join(indexDir, CONTAINER_FILE))]) {
    await fs.writeFile(path.join(indexDir, CONTAINER_FILE), gen);
    const r = await loadIndexStore(fsAdapter(), indexDir);
    expect(r.state).toBe("loaded"); // nie ein Zustand, den kein Gerät geschrieben hat
  }
});

it("halber Sync-Download (abgeschnittener Container) → corrupt, kein stiller Fehlladen", async () => {
  await buildGoodIndex();
  const p = path.join(indexDir, CONTAINER_FILE);
  const full = await fs.readFile(p);
  await fs.writeFile(p, full.subarray(0, Math.floor(full.length / 2)));
  expect((await loadIndexStore(fsAdapter(), indexDir)).state).toBe("corrupt");
});

it("SILENT-MIX-LÜCKE GESCHLOSSEN: gleicher Count, getauschte Bytes → CRC schlägt an", async () => {
  await buildGoodIndex();
  const p = path.join(indexDir, CONTAINER_FILE);
  const bytes = await fs.readFile(p);
  bytes[bytes.length - 100] = bytes[bytes.length - 100] ^ 0xff; // Matrix-Byte einer „fremden Generation"
  await fs.writeFile(p, bytes);
  expect((await loadIndexStore(fsAdapter(), indexDir)).state).toBe("corrupt");
});

it("End-to-End-Migration: echter Alt-Tripel-Bestand → ein Load → Container da, Tripel weg, Index identisch nutzbar", async () => {
  // Alt-Tripel wie ein Prä-0.18-Plugin schreiben (manifest/paths/notes.i8 von Hand, wie
  // writeLegacyTriple in tests/index_store.test.ts, nur mit den 100 Test-Notizen).
  // Dann: loadIndexStore → loaded/legacy-migrated, count 100; notes.i8/paths.json/manifest.json
  // existieren nicht mehr; zweiter Load → loaded/container (idempotent).
});

it("Backup-Kaskade-Basis: von zwei Backups ist das neuere korrupt → verifyBackupCandidate beweist das ältere", async () => {
  await buildGoodIndex();
  const b1 = path.join(root, "backups", "2026-07-28T10-00-00-000Z");
  const b2 = path.join(root, "backups", "2026-07-29T10-00-00-000Z");
  await migrateIndex(fsAdapter(), indexDir, b1);
  await migrateIndex(fsAdapter(), indexDir, b2);
  const p2 = path.join(b2, CONTAINER_FILE);
  const bytes = await fs.readFile(p2);
  bytes[20] = bytes[20] ^ 0xff;
  await fs.writeFile(p2, bytes);
  expect(await verifyBackupCandidate(fsAdapter(), b2)).toBeNull();
  expect((await verifyBackupCandidate(fsAdapter(), b1))?.count).toBe(100);
});
```

Den Kommentar-Test (End-to-End-Migration) vollständig ausformulieren.

- [ ] **Step 2: Laufen lassen — neue Szenarien müssen bestehen** (Implementierung existiert seit Task 5)

Run: `npx vitest run tests/index_robustness.integration.test.ts`
Expected: PASS. Falls ein Szenario fehlschlägt: STOPP — das ist ein echter Befund in Tasks 1–5, nicht der Test.

- [ ] **Step 3: Gates + Commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add tests/index_robustness.integration.test.ts
git commit -m "test(index): Integrations-Szenarien — Vorfall 22.07. nachgestellt, Migration end-to-end, Backup-Beweis

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Doku — AGENTS.md, explanation, README (beide!), CHANGELOG

**Files:**
- Modify: `AGENTS.md`, `docs/explanation/index.md`, `README.md`, `README.de.md`, `CHANGELOG.md`

**Interfaces:** — (reine Doku; Inhalte unten sind verbindlich)

- [ ] **Step 1: AGENTS.md aktualisieren**

1. Modul-Layout-Block: `index_container.ts` (Container-Codec: VRIX-Magic, Header-JSON inkl. paths, CRC32) und `index_store.ts` (Container-first-Load, byte-level Legacy-Migration, verifyBackupCandidate) ergänzen; Beschreibung von `index.ts` (IndexLoader = Legacy-Leser, von index_store genutzt) und `live_indexer.ts` (persist schreibt EINE Datei `index.bin`) anpassen.
2. Den Absatz „**Index-Format (Slice A, unveränderlich):** …" ersetzen durch:
   > **Index-Format (seit 0.18.0):** EINE Container-Datei `_vaultrag/index.bin` — `"VRIX"` · u32 headerLen LE · Header-JSON (Manifest inkl. `paths`, `schema_version: 2`) · Int8-Matrix · CRC32. Ein File statt drei, damit Obsidian Sync keine Generationen mischen kann (Spec `docs/superpowers/specs/2026-07-29-sync-race-container-index-design.md`). Embedding-Dimension **256**, `INT8_SCALE = 127`, **mean**-Aggregation. `pending.json` bleibt eigenständig (Dirty-List, unkritisch). Das Prä-0.18-Tripel (`notes.i8`/`paths.json`/`manifest.json`) wird beim ersten Load byte-level migriert. **HyperForge-Export ist stillgelegt** — bei Reaktivierung muss er das Container-Format erzeugen.
3. Gotchas: den `parseIndex`-Gotcha um CRC/Container ergänzen; den `persist`-Gotcha-Punkt („Write-Order: notes.i8 → paths.json → manifest.json") auf die Container-Wahrheit umschreiben; Auto-Heal-Kaskade als neuen Gotcha-Punkt (höchstens einmal je Episode, persist nur bei `failed === 0`).

- [ ] **Step 2: `docs/explanation/index.md` — offenes Problem als gelöst umschreiben**

Abschnitt „The limit of this approach" (ab ~Z.65) ersetzen: Das per-Datei-Konfliktproblem existierte, weil der Index drei Dateien war; seit 0.18.0 ist er **ein** Container mit CRC — a sync service can only ever deliver a whole generation. Detection bleibt (CRC beim Load), Recovery ist die Backup-Heal-Kaskade. Der Text bleibt englisch, Ton des Dokuments beibehalten.

- [ ] **Step 3: README.md + README.de.md**

`grep -n "notes.i8\|paths.json\|manifest.json\|_vaultrag" README.md README.de.md` — jede Fundstelle prüfen: Beschreibung des Sync-Artefakts auf `index.bin` umstellen. **Beide Fassungen synchron ändern** (AGENTS.md-Regel: eine veraltete Übersetzung ist schlechter als keine). Alle Links absolut lassen.

- [ ] **Step 4: CHANGELOG.md `[Unreleased]`**

```markdown
### Changed
- **Index-Format:** Der Sync-Index ist jetzt EINE Container-Datei `_vaultrag/index.bin`
  (vorher drei: `notes.i8`/`paths.json`/`manifest.json`). Obsidian Sync kann damit keine
  inkonsistenten Mischzustände aus zwei Generationen mehr erzeugen — die Wurzel der
  wiederkehrenden Index-Beschädigung (Vorfälle 19.07./22.07.) ist beseitigt, nicht nur erkannt.
  Bestehende Indizes werden beim ersten Start automatisch und verlustfrei migriert.
  **Mixed-Version-Hinweis:** Ein Gerät, das noch eine ältere Plugin-Version läuft, zeigt bis
  zu seinem Update „kein Index" an (kein Datenverlust — Notizen sind unberührt).

### Added
- **Automatische Wiederherstellung:** Ist der Index beim Laden beschädigt (z. B. halber
  Sync-Download), stellt das Plugin ihn selbstständig aus dem neuesten per Prüfsumme
  verifizierten geräte-lokalen Backup wieder her und ergänzt fehlende Notizen per
  Delta-Reindex — sofern der Embedding-Endpoint erreichbar ist. Sonst wie bisher:
  Schreibschutz + Meldung.
```

- [ ] **Step 5: Lint + Commit**

Run: `npm run lint && npm test` (Doku bricht nichts — Kontrolle).

```bash
git add AGENTS.md docs/explanation/index.md README.md README.de.md CHANGELOG.md
git commit -m "docs: Container-Index dokumentiert — AGENTS, explanation, READMEs (beide), CHANGELOG

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Nach dem Plan (nicht Teil der Tasks)

- **Whole-Branch-Review** (superpowers:requesting-code-review) — Plan-Fehler fängt nur die übergreifende Stufe (Lehre 0.16.0).
- **Manueller Smoke (Jay, Checkliste ins Handoff):**
  1. Desktop: Update laden → Migration läuft (Console: kein Fehler; `_vaultrag/` enthält nur noch `index.bin` + `pending.json`), Related-Panel liefert Treffer.
  2. `index.bin` absichtlich mit einem Hex-Editor/`dd` beschädigen → Reload → Auto-Heal-Notice („aus Backup wiederhergestellt").
  3. iPhone: nach Sync — Related-Panel funktioniert mit dem Container; Obsidian 1.12.4-Zweig unauffällig.
  4. MCP-Server-Start + eine `search`-Anfrage (Loader-Pfad).
- **Release 0.18.0** über den üblichen Flow (`finishing-a-development-branch` → lokal `--no-ff` → `npm run release`); vor jedem Push `git rev-parse --short main origin/main github/main`.
