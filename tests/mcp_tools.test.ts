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

describe("McpTools.search", () => {
  const okStatus = { reachable: true, kind: "ok", klartext: "Verbunden" } as const;
  const downStatus = { reachable: false, kind: "refused", klartext: "Verbindung abgelehnt — Server läuft nicht oder Port falsch." } as const;

  it("bettet die Query ein und rankt gegen den Index", async () => {
    const vault = await makeVaultWithIndex({ "treffer.md": [1, 0, 0, 0], "daneben.md": [0, 1, 0, 0] });
    const io: ToolIo = {
      probe: async () => okStatus,
      embedQuery: async () => new Float32Array([1, 0, 0, 0]),
    };
    const { tools } = await makeTools(vault, io);
    const r = await tools.search({ query: "egal", min_similarity: 0.5 });
    expect(r.hits.map(h => h.path)).toEqual(["treffer.md"]);
  });
  it("nimmt den ersten erreichbaren Endpoint (Fallback-Liste) und cached ihn", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const cfg = await loadConfig(vault, {});
    cfg.settings.embeddingEndpoints = ["http://tot:1", "http://lebt:2/v1"];
    const probed: string[] = [];
    const usedEndpoints: string[] = [];
    const tools = new McpTools(cfg, {
      probe: async ep => { probed.push(ep); return ep.includes("lebt") ? okStatus : downStatus; },
      embedQuery: async ep => { usedEndpoints.push(ep); return new Float32Array([1, 0, 0, 0]); },
    });
    await tools.search({ query: "q" });
    await tools.search({ query: "q2" });
    expect(usedEndpoints).toEqual(["http://lebt:2", "http://lebt:2"]); // normalisiert (/v1 gestrippt) + gecacht
    expect(probed.filter(p => p.includes("lebt")).length).toBe(1);      // zweiter Call ohne Re-Probe
  });
  it("kein Endpoint erreichbar → Fehler listet Klartext-Diagnosen", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const { tools } = await makeTools(vault, {
      probe: async () => downStatus,
      embedQuery: async () => { throw new Error("unerreichbar"); },
    });
    await expect(tools.search({ query: "q" })).rejects.toThrow(/Verbindung abgelehnt/);
  });
  it("Totalausfall probt jeden Endpoint nur einmal (kein Doppel-Scan)", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    const cfg = await loadConfig(vault, {});
    cfg.settings.embeddingEndpoints = ["http://tot1:1", "http://tot2:2"];
    let probes = 0;
    const tools = new McpTools(cfg, {
      probe: async () => { probes++; return downStatus; },
      embedQuery: async () => { throw new Error("nie erreicht"); },
    });
    await expect(tools.search({ query: "q" })).rejects.toThrow(/Kein Embedding-Endpunkt/);
    expect(probes).toBe(2);
  });
  it("Embed-Fehler → genau ein Re-Resolve + Retry", async () => {
    const vault = await makeVaultWithIndex({ "a.md": [1, 0, 0, 0] });
    let embedCalls = 0;
    const { tools } = await makeTools(vault, {
      probe: async () => okStatus,
      embedQuery: async () => {
        embedCalls++;
        if (embedCalls === 1) throw new Error("Verbindung riss");
        return new Float32Array([1, 0, 0, 0]);
      },
    });
    const r = await tools.search({ query: "q" });
    expect(embedCalls).toBe(2);
    expect(r.hits.length).toBeGreaterThan(0);
  });
});
