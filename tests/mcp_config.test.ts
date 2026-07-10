import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, DATA_JSON_REL } from "../src/mcp/config";
import { DEFAULT_SETTINGS } from "../src/settings_core";

async function makeVault(dataJson?: unknown): Promise<string> {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-cfg-"));
  if (dataJson !== undefined) {
    const p = path.join(vault, DATA_JSON_REL);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(dataJson));
  }
  return vault;
}

describe("loadConfig", () => {
  it("fehlende data.json → Defaults", async () => {
    const cfg = await loadConfig(await makeVault(), {});
    expect(cfg.settings.indexDir).toBe(DEFAULT_SETTINGS.indexDir);
    expect(cfg.settings.embeddingEndpoints).toEqual(DEFAULT_SETTINGS.embeddingEndpoints);
    expect(cfg.settings.embeddingEndpoints).not.toBe(DEFAULT_SETTINGS.embeddingEndpoints); // keine geteilte Referenz
  });
  it("liest gespeicherte Settings und merged über Defaults", async () => {
    const cfg = await loadConfig(await makeVault({ indexDir: "_anders", k: 7 }), {});
    expect(cfg.settings.indexDir).toBe("_anders");
    expect(cfg.settings.k).toBe(7);
    expect(cfg.settings.minSim).toBe(DEFAULT_SETTINGS.minSim);
  });
  it("migriert alte Einzel-Endpoint-Settings zur Liste", async () => {
    const cfg = await loadConfig(await makeVault({ embeddingEndpoint: "http://alt:1111" }), {});
    expect(cfg.settings.embeddingEndpoints).toEqual(["http://alt:1111"]);
  });
  it("leere Endpoint-Liste fällt auf Default zurück", async () => {
    const cfg = await loadConfig(await makeVault({ embeddingEndpoints: [] }), {});
    expect(cfg.settings.embeddingEndpoints).toEqual(DEFAULT_SETTINGS.embeddingEndpoints);
  });
  it("Env-Overrides gewinnen", async () => {
    const cfg = await loadConfig(await makeVault({ embeddingEndpoints: ["http://a:1"], embeddingModel: "m1", indexDir: "_x" }), {
      VAULT_RAG_EMBEDDING_ENDPOINT: "http://env:9",
      VAULT_RAG_EMBEDDING_MODEL: "env-model",
      VAULT_RAG_INDEX_DIR: "_env",
    });
    expect(cfg.settings.embeddingEndpoints).toEqual(["http://env:9"]);
    expect(cfg.settings.embeddingModel).toBe("env-model");
    expect(cfg.settings.indexDir).toBe("_env");
  });
  it("korrupte data.json → Defaults statt Crash", async () => {
    const vault = await makeVault();
    const p = path.join(vault, DATA_JSON_REL);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, "{kaputt");
    const cfg = await loadConfig(vault, {});
    expect(cfg.settings.indexDir).toBe(DEFAULT_SETTINGS.indexDir);
  });
});
