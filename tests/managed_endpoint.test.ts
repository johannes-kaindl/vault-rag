import { describe, it, expect } from "vitest";
import { resolveManagedChat, resolveManagedEmbedding } from "../src/managed_endpoint";
import type { LlmEndpointManagerApi, ResolvedEndpoint, ApiError } from "../src/vendor/kit/endpoint-source";

function fakeManager(over: { resolve?: ResolvedEndpoint | ApiError; materialize?: ResolvedEndpoint | ApiError } = {}): LlmEndpointManagerApi {
  const ep: ResolvedEndpoint = { id: "e1", label: "E1", config: { url: "http://m:1", apiKey: "geheim" }, defaultModel: "qwen3-embedding:8b" };
  return {
    version: 1,
    list: () => [], get: () => null,
    resolve: async () => over.resolve ?? ep,
    materialize: async () => over.materialize ?? ep,
    models: async () => [], importEndpoints: async () => ({ added: [], merged: [], skipped: [] }),
    on: () => () => {},
  };
}
const up = async () => true;
const down = async () => false;

describe("resolveManagedChat", () => {
  it("nimmt Endpunkt und Standardmodell vom Manager, Schluessel bleibt an der Zeile", async () => {
    const r = await resolveManagedChat(fakeManager(), {}, up);
    expect(r.config).toEqual({ url: "http://m:1", apiKey: "geheim", model: "qwen3-embedding:8b" });
    expect(r.active).toBe(true);
  });
  it("die Nutzerwahl (choice.model) schlaegt das Standardmodell", async () => {
    const r = await resolveManagedChat(fakeManager(), { model: "mein-modell" }, up);
    expect(r.config?.model).toBe("mein-modell");
  });
  it("config.model des Managers (== defaultModel) ueberschreibt die Nutzerwahl NICHT — lingotuner-Fund C1", async () => {
    const ep: ResolvedEndpoint = { id: "e1", label: "E1", config: { url: "http://m:1", model: "default-modell" }, defaultModel: "default-modell" };
    const r = await resolveManagedChat(fakeManager({ resolve: ep }), { model: "meine-wahl" }, up);
    expect(r.config?.model).toBe("meine-wahl");
  });
  it("kein Endpunkt beim Manager: config null, kein Rueckfall auf eine lokale Liste", async () => {
    const r = await resolveManagedChat(fakeManager({ resolve: { error: "no-endpoint" } }), {}, up);
    expect(r).toEqual({ config: null, reason: "no-endpoint", active: false });
  });
  it("nicht erreichbar: Endpunkt bleibt verdrahtet, ist aber nicht aktiv markiert", async () => {
    const r = await resolveManagedChat(fakeManager(), {}, down);
    expect(r.config?.url).toBe("http://m:1");
    expect(r.active).toBe(false);
  });
  it("ein werfender Ping macht den Endpunkt inaktiv statt den Resolver zu kippen", async () => {
    const r = await resolveManagedChat(fakeManager(), {}, async () => { throw new Error("x"); });
    expect(r.active).toBe(false);
  });
});

describe("resolveManagedEmbedding", () => {
  it("Modell passt zum Index und Endpunkt antwortet: aktiv", async () => {
    const r = await resolveManagedEmbedding(fakeManager(), {}, "qwen3-embedding:8b", up);
    expect(r).toMatchObject({ active: true, mismatch: false, noModel: false });
  });
  it("fremdes Modell: nicht aktiv, Mismatch gemeldet, Endpunkt bleibt fuer die Suche verdrahtet", async () => {
    const r = await resolveManagedEmbedding(fakeManager(), {}, "anderes-modell", up);
    expect(r).toMatchObject({ active: false, mismatch: true });
    expect(r.config?.url).toBe("http://m:1");
  });
  it("der Mismatch-Fall pingt gar nicht erst (Rand aus der Task: kein Endpunkt passt zum Index)", async () => {
    let pings = 0;
    await resolveManagedEmbedding(fakeManager(), {}, "anderes-modell", async () => { pings++; return true; });
    expect(pings).toBe(0);
  });
  it("Manager ohne Modellnamen: noModel, nie aktiv — leer darf den Modell-Guard nicht ausschalten", async () => {
    const ep: ResolvedEndpoint = { id: "e1", label: "E1", config: { url: "http://m:1" } };
    const r = await resolveManagedEmbedding(fakeManager({ resolve: ep }), {}, undefined, up);
    expect(r).toMatchObject({ active: false, noModel: true });
  });
  it("kein Index geladen: jedes Modell passt (wie bei der lokalen Liste)", async () => {
    const r = await resolveManagedEmbedding(fakeManager(), {}, undefined, up);
    expect(r.active).toBe(true);
  });
  it("gewaehlter Endpunkt (choice.endpointId) laeuft ueber materialize, verwaiste Wahl faellt auf resolve zurueck", async () => {
    const r = await resolveManagedEmbedding(fakeManager({ materialize: { error: "not-found" } }), { endpointId: "weg" }, "qwen3-embedding:8b", up);
    expect(r.config?.url).toBe("http://m:1");
    expect(r.reason).toBe("not-found");
  });
  it("Alias: gesendet und gegen den Index geprueft wird die aufgeloeste Schreibweise", async () => {
    const ep: ResolvedEndpoint = {
      id: "e1", label: "E1", config: { url: "http://m:1" }, defaultModel: "verdi-embed",
      models: [{ id: "verdi-embed", aliasOf: "qwen3-embedding:8b" }],
    };
    const r = await resolveManagedEmbedding(fakeManager({ resolve: ep }), {}, "qwen3-embedding:8b", up);
    expect(r.config?.model).toBe("qwen3-embedding:8b");
    expect(r.active).toBe(true);
  });
});
