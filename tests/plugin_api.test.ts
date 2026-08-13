import { describe, it, expect } from "vitest";
import { createVaultRetrievalApi, VAULT_RETRIEVAL_API_VERSION } from "../src/plugin_api";
import { RetrievalFacade } from "../src/retrieval_facade";
import { parseIndex, VaultIndex } from "../src/index";

function idx(): VaultIndex {
  const m = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 3, granularity: "note", quant: "int8" };
  const bytes = new Int8Array([127, 0, 117, 50, 0, 127]);
  return parseIndex(m, ["a.md", "b.md", "c.md"], bytes.buffer);
}

/** Baut die API über eine Facade mit Test-Anschlüssen. `over` überschreibt einzelne Deps. */
function api(over: Record<string, unknown> = {}) {
  const deps = {
    getIndex: () => idx(),
    embedderReady: async () => true,
    embed: async () => [new Float32Array([1, 0])],
    settings: () => ({ k: 5, minSim: 0, exclude: ["Templates/"] }),
    readVault: async (r: string) => `INHALT ${r}`,
    ...over,
  } as ConstructorParameters<typeof RetrievalFacade>[0];
  return createVaultRetrievalApi(new RetrievalFacade(deps), deps.getIndex);
}

describe("Plugin-API — Vertrag", () => {
  it("nennt ihre Version als Feld", () => {
    expect(api().apiVersion).toBe(VAULT_RETRIEVAL_API_VERSION);
  });

  it("status() ist synchron, netzfrei und meldet den Index-Bestand", () => {
    expect(api().status()).toEqual({ apiVersion: VAULT_RETRIEVAL_API_VERSION, indexed: true, noteCount: 3 });
  });

  it("status() meldet ohne Index indexed=false statt zu werfen", () => {
    expect(api({ getIndex: () => null }).status()).toEqual({
      apiVersion: VAULT_RETRIEVAL_API_VERSION, indexed: false, noteCount: 0,
    });
  });

  it("status() ruft den Embedder nicht an (kein Netz beim Bereitschafts-Check)", () => {
    let pinged = false;
    api({ embedderReady: async () => { pinged = true; return true; } }).status();
    expect(pinged).toBe(false);
  });
});

describe("Plugin-API — search", () => {
  it("liefert Treffer als ok-Ergebnis", async () => {
    const r = await api().search("x");
    expect(r.ok && r.hits.map(h => h.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("gibt den Score ROH zurück \u2014 anders als der MCP-Adapter, der auf 3 Stellen rundet", async () => {
    const r = await api().search("x");
    const b = r.ok ? r.hits.find(h => h.path === "b.md") : undefined;
    expect(b?.score).toBeCloseTo(0.9195510149, 9);   // nicht 0.92
  });

  it("meldet fehlenden Index als Wert, nicht als Ausnahme", async () => {
    await expect(api({ getIndex: () => null }).search("x")).resolves.toEqual({ ok: false, reason: "no-index" });
  });

  it("meldet einen nicht erreichbaren Endpunkt als offline", async () => {
    await expect(api({ embedderReady: async () => false }).search("x")).resolves.toEqual({ ok: false, reason: "offline" });
  });

  it("reicht k an den Retriever durch", async () => {
    const r = await api({ settings: () => ({ k: 5, minSim: 0, exclude: [] }) }).search("x", { k: 1 });
    expect(r.ok && r.hits.length).toBe(1);
  });

  it("lässt die Ausschluss-Liste des Nutzers nicht überschreiben", async () => {
    const r = await api({ settings: () => ({ k: 5, minSim: 0, exclude: ["a"] }) })
      .search("x", { exclude: [] } as { k?: number; minSim?: number });
    expect(r.ok && r.hits.some(h => h.path === "a.md")).toBe(false);
  });
});

describe("Plugin-API — related", () => {
  it("liefert verwandte Notizen", async () => {
    const r = await api().related("a.md");
    expect(r.ok && r.hits.map(h => h.path)).toEqual(["b.md", "c.md"]);
  });

  it("meldet eine unbekannte Notiz als not-indexed samt Pfad", async () => {
    await expect(api().related("missing.md")).resolves.toEqual({ ok: false, reason: "not-indexed", path: "missing.md" });
  });

  it("meldet fehlenden Index als Wert", async () => {
    await expect(api({ getIndex: () => null }).related("a.md")).resolves.toEqual({ ok: false, reason: "no-index" });
  });

  it("ist nach außen asynchron (Vertrag hält eine spätere Umstellung offen)", () => {
    expect(api().related("a.md")).toBeInstanceOf(Promise);
  });

  it("erreicht den Endpunkt nie — verwandte Notizen kommen offline aus dem Index", async () => {
    const r = await api({ embedderReady: async () => false }).related("a.md");
    expect(r.ok).toBe(true);
  });
});

describe("Plugin-API — Fremdkonsumenten-Tauglichkeit", () => {
  it("gibt ausschließlich JSON-taugliche Werte zurück (keine Klassen, keine TypedArrays)", async () => {
    for (const r of [await api().search("x"), await api().related("a.md"), api().status()]) {
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    }
  });

  it("trägt in keinem Fehlerfall übersetzten Text — nur maschinenlesbare Codes", async () => {
    const fails = [
      await api({ getIndex: () => null }).search("x"),
      await api({ embedderReady: async () => false }).search("x"),
      await api().related("missing.md"),
    ];
    for (const f of fails) {
      expect(f.ok).toBe(false);
      expect(Object.keys(f).every(k => ["ok", "reason", "path"].includes(k))).toBe(true);
    }
  });
});
