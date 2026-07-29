import { describe, it, expect } from "vitest";
import { VaultAdapter } from "../src/index";
import { migrateIndex, onlyContainsIndexFiles, INDEX_ALL_FILES, hasAllRequiredFiles } from "../src/index_migrate";

function makeMemAdapter(seed: Record<string, string | ArrayBuffer> = {}): VaultAdapter & { store: Map<string, string | ArrayBuffer>; mkdirs: string[] } {
  const store = new Map<string, string | ArrayBuffer>(Object.entries(seed));
  const mkdirs: string[] = [];
  return {
    read: async (p: string) => { if (!store.has(p)) throw new Error("not found: " + p); return store.get(p) as string; },
    readBinary: async (p: string) => { if (!store.has(p)) throw new Error("not found: " + p); return store.get(p) as ArrayBuffer; },
    write: async (p: string, d: string) => { store.set(p, d); },
    writeBinary: async (p: string, d: ArrayBuffer) => { store.set(p, d); },
    mkdir: async (p: string) => { mkdirs.push(p); },
    exists: async (p: string) => store.has(p),
    remove: async (p: string) => { store.delete(p); },
    store,
    mkdirs,
  };
}

describe("migrateIndex", () => {
  it("kopiert binär + text von alt nach neu und legt das Zielverzeichnis an", async () => {
    const bin = new Int8Array([1, 2, 3]).buffer;
    const a = makeMemAdapter({
      "_vaultrag/notes.i8": bin,
      "_vaultrag/paths.json": '["a.md"]',
      "_vaultrag/manifest.json": '{"count":1}',
      "_vaultrag/pending.json": "[]",
    });
    await migrateIndex(a, "_vaultrag", "99_System/idx");
    expect(a.mkdirs).toContain("99_System/idx");
    expect(a.store.get("99_System/idx/notes.i8")).toBe(bin);
    expect(a.store.get("99_System/idx/paths.json")).toBe('["a.md"]');
    expect(a.store.get("99_System/idx/manifest.json")).toBe('{"count":1}');
    expect(a.store.get("99_System/idx/pending.json")).toBe("[]");
  });

  it("überspringt fehlende Dateien ohne Fehler", async () => {
    const a = makeMemAdapter({ "_vaultrag/notes.i8": new ArrayBuffer(0) });
    await expect(migrateIndex(a, "_vaultrag", "x")).resolves.toBeUndefined();
    expect(a.store.get("x/notes.i8")).toBeInstanceOf(ArrayBuffer);
    expect(a.store.has("x/paths.json")).toBe(false);
  });

  it("from === to (normalisiert) ist no-op", async () => {
    const a = makeMemAdapter({ "_vaultrag/notes.i8": new ArrayBuffer(0) });
    const before = a.store.size;
    await migrateIndex(a, "_vaultrag", "_vaultrag/");
    expect(a.store.size).toBe(before);
    expect(a.mkdirs).toHaveLength(0);
  });

  it("migrateIndex kopiert den Container (und lässt fehlende Legacy-Dateien stumm aus)", async () => {
    const containerBuf = new Int8Array([1, 2, 3]).buffer;
    const pendingJson = "[]";
    const a = makeMemAdapter({
      "_vaultrag/index.bin": containerBuf,
      "_vaultrag/pending.json": pendingJson,
    });
    await migrateIndex(a, "_vaultrag", "99_System/idx");
    expect(a.mkdirs).toContain("99_System/idx");
    expect(a.store.get("99_System/idx/index.bin")).toBe(containerBuf);
    expect(a.store.get("99_System/idx/pending.json")).toBe(pendingJson);
    // Legacy-Dateien existieren nicht → nicht in to
    expect(a.store.has("99_System/idx/notes.i8")).toBe(false);
    expect(a.store.has("99_System/idx/paths.json")).toBe(false);
    expect(a.store.has("99_System/idx/manifest.json")).toBe(false);
  });

  it("migrateIndex kopiert ein Legacy-Tripel (Prä-0.18-Backup) weiterhin vollständig", async () => {
    const binBuf = new Int8Array([4, 5, 6]).buffer;
    const pathsJson = '["x.md"]';
    const manifestJson = '{"count":2}';
    const a = makeMemAdapter({
      "_vaultrag/notes.i8": binBuf,
      "_vaultrag/paths.json": pathsJson,
      "_vaultrag/manifest.json": manifestJson,
    });
    await migrateIndex(a, "_vaultrag", "backup/old");
    expect(a.mkdirs).toContain("backup/old");
    expect(a.store.get("backup/old/notes.i8")).toBe(binBuf);
    expect(a.store.get("backup/old/paths.json")).toBe(pathsJson);
    expect(a.store.get("backup/old/manifest.json")).toBe(manifestJson);
    // Container existiert nicht in source → nicht in to
    expect(a.store.has("backup/old/index.bin")).toBe(false);
  });
});

describe("onlyContainsIndexFiles", () => {
  it("nur Index-Dateien, keine Unterordner → true", () => {
    const files = INDEX_ALL_FILES.map(f => `_vaultrag/${f}`);
    expect(onlyContainsIndexFiles(files, [])).toBe(true);
  });

  it("fremde Datei → false", () => {
    expect(onlyContainsIndexFiles(["_vaultrag/notes.i8", "_vaultrag/meine-notiz.md"], [])).toBe(false);
  });

  it("Unterordner vorhanden → false", () => {
    expect(onlyContainsIndexFiles(["_vaultrag/notes.i8"], ["_vaultrag/sub"])).toBe(false);
  });

  it("leeres Listing → true (Ordner darf gelöscht werden)", () => {
    expect(onlyContainsIndexFiles([], [])).toBe(true);
  });

  it("onlyContainsIndexFiles kennt index.bin UND die Legacy-Namen", () => {
    expect(onlyContainsIndexFiles(["d/index.bin", "d/pending.json"], [])).toBe(true);
    expect(onlyContainsIndexFiles(["d/notes.i8", "d/paths.json", "d/manifest.json"], [])).toBe(true);
    expect(onlyContainsIndexFiles(["d/index.bin", "d/fremd.md"], [])).toBe(false);
  });
});

describe("hasAllRequiredFiles", () => {
  it("alle drei Pflichtdateien vorhanden → true", () => {
    expect(hasAllRequiredFiles(["dest/notes.i8", "dest/paths.json", "dest/manifest.json"])).toBe(true);
  });

  it("manifest.json fehlt → false", () => {
    expect(hasAllRequiredFiles(["dest/notes.i8", "dest/paths.json"])).toBe(false);
  });

  it("leere Liste (fehlgeschlagene Kopie) → false", () => {
    expect(hasAllRequiredFiles([])).toBe(false);
  });

  it("zusätzliche optionale Datei (pending.json) ändert nichts an true", () => {
    expect(hasAllRequiredFiles(["dest/notes.i8", "dest/paths.json", "dest/manifest.json", "dest/pending.json"])).toBe(true);
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
});
