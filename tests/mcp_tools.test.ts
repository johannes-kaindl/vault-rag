// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { McpTools, type ToolIo, resolveNotePath } from "../src/mcp/tools";
import { loadConfig } from "../src/mcp/config";
import type { McpConfig } from "../src/mcp/config";

/** Mini-Vault mit Index (dim 4): Vektoren pro Pfad, int8-quantisiert wie das Plugin. */
async function makeVaultWithIndex(vecs: Record<string, number[]>): Promise<string> {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-tools-"));
  const dir = path.join(vault, "_vaultrag");
  await fs.mkdir(dir, { recursive: true });
  await writeIndex(dir, vecs);
  return vault;
}

async function writeIndex(dir: string, vecs: Record<string, number[]>): Promise<void> {
  const paths = Object.keys(vecs);
  const dim = vecs[paths[0]].length;
  const i8 = new Int8Array(paths.length * dim);
  paths.forEach((p, r) => vecs[p].forEach((v, c) => { i8[r * dim + c] = Math.round(v * 127); }));
  await fs.writeFile(path.join(dir, "notes.i8"), Buffer.from(i8.buffer));
  await fs.writeFile(path.join(dir, "paths.json"), JSON.stringify(paths));
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({
    schema_version: 1, embedding_model: "test", index_dim: dim, scale: 127,
    count: paths.length, granularity: "note", quant: "int8",
  }));
}

const NO_NET: ToolIo = {
  probe: async () => { throw new Error("kein Netz im Test"); },
  embedQuery: async () => { throw new Error("kein Netz im Test"); },
};

async function makeTools(vault: string, io: ToolIo = NO_NET): Promise<{ tools: McpTools; cfg: McpConfig }> {
  const cfg = await loadConfig(vault, {});
  return { tools: new McpTools(cfg, io), cfg };
}

describe("McpTools.related", () => {
  it("liefert Nachbarn sortiert, ohne die Notiz selbst, Scores gerundet", async () => {
    const vault = await makeVaultWithIndex({
      "a.md": [1, 0, 0, 0], "fast-a.md": [0.9, 0.1, 0, 0], "quer.md": [0, 0, 1, 0],
    });
    const { tools } = await makeTools(vault);
    const r = await tools.related({ path: "a.md", min_similarity: 0.5 });
    expect(r.hits.map(h => h.path)).toEqual(["fast-a.md"]);
    expect(r.hits[0].score).toBeCloseTo(Math.round(r.hits[0].score * 1000) / 1000, 10);
  });
  it("unbekannter Pfad → Klartext-Fehler", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const { tools } = await makeTools(vault);
    await expect(tools.related({ path: "gibts-nicht.md" })).rejects.toThrow(/nicht im Index/);
  });
  it("fehlender Index → Klartext-Fehler mit Aufbau-Hinweis", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-leer-"));
    const { tools } = await makeTools(vault);
    await expect(tools.related({ path: "a.md" })).rejects.toThrow(/Index im Plugin/);
  });
  it("lädt den Index bei manifest-mtime-Änderung neu", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0], "b.md": [1, 0, 0, 0] });
    const { tools } = await makeTools(vault);
    expect((await tools.related({ path: "a.md" })).hits.map(h => h.path)).toEqual(["b.md"]);
    await new Promise(r => setTimeout(r, 10)); // mtime-Auflösung
    await writeIndex(path.join(vault, "_vaultrag"), { "a.md": [1, 0, 0, 0], "neu.md": [1, 0, 0, 0] });
    expect((await tools.related({ path: "a.md" })).hits.map(h => h.path)).toEqual(["neu.md"]);
  });
});

describe("resolveNotePath (Guard)", () => {
  const root = "/vault";
  it("akzeptiert vault-relative .md-Pfade", () => {
    expect(resolveNotePath(root, "sub/notiz.md", [])).toBe(path.join(root, "sub/notiz.md"));
  });
  it("weist absolute Pfade ab", () => {
    expect(() => resolveNotePath(root, "/etc/passwd.md", [])).toThrow(/vault-relativ/i);
  });
  it("weist ..-Traversal ab (auch versteckt)", () => {
    expect(() => resolveNotePath(root, "../geheim.md", [])).toThrow(/verlässt/);
    expect(() => resolveNotePath(root, "sub/../../geheim.md", [])).toThrow(/verlässt/);
  });
  it("weist Nicht-Markdown ab", () => {
    expect(() => resolveNotePath(root, "bild.png", [])).toThrow(/\.md/);
  });
  it("weist exclude-Präfixe ab", () => {
    expect(() => resolveNotePath(root, "Templates/t.md", ["Templates/"])).toThrow(/Ausschluss/);
  });
  it("weist exclude-Präfixe auch bei abweichender Groß-/Kleinschreibung ab", () => {
    expect(() => resolveNotePath(root, "templates/t.md", ["Templates/"])).toThrow(/Ausschluss/);
  });
});

describe("McpTools.readNote", () => {
  it("liest den Volltext einer Notiz", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    await fs.writeFile(path.join(vault, "a.md"), "# Inhalt");
    const { tools } = await makeTools(vault);
    expect(await tools.readNote({ path: "a.md" })).toEqual({ path: "a.md", content: "# Inhalt" });
  });
  it("fehlende Datei → Klartext-Fehler", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const { tools } = await makeTools(vault);
    await expect(tools.readNote({ path: "fehlt.md" })).rejects.toThrow(/nicht gefunden/);
  });
  it("folgt Symlinks nicht aus dem Vault heraus", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const outside = path.join(vault, "..", `vaultrag-outside-${path.basename(vault)}.md`);
    await fs.writeFile(outside, "GEHEIM");
    await fs.symlink(outside, path.join(vault, "leak.md"));
    const { tools } = await makeTools(vault);
    await expect(tools.readNote({ path: "leak.md" })).rejects.toThrow(/verlässt den Vault/);
    await fs.rm(outside, { force: true });
  });
});
