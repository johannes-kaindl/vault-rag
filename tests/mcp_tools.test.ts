// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { McpTools, type ToolIo } from "../src/mcp/tools";
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
