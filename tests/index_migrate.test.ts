import { describe, it, expect } from "vitest";
import { VaultAdapter } from "../src/index";
import { migrateIndex, onlyContainsIndexFiles, INDEX_ALL_FILES } from "../src/index_migrate";

function makeMemAdapter(seed: Record<string, string | ArrayBuffer> = {}): VaultAdapter & { store: Map<string, string | ArrayBuffer>; mkdirs: string[] } {
  const store = new Map<string, string | ArrayBuffer>(Object.entries(seed));
  const mkdirs: string[] = [];
  return {
    read: async (p: string) => { if (!store.has(p)) throw new Error("not found: " + p); return store.get(p) as string; },
    readBinary: async (p: string) => { if (!store.has(p)) throw new Error("not found: " + p); return store.get(p) as ArrayBuffer; },
    write: async (p: string, d: string) => { store.set(p, d); },
    writeBinary: async (p: string, d: ArrayBuffer) => { store.set(p, d); },
    mkdir: async (p: string) => { mkdirs.push(p); },
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
});
