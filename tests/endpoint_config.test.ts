import { describe, it, expect } from "vitest";
import { authHeaders, effectiveModel, migrateEndpointList, applyEndpointEdit, carriesApiKey, type EndpointConfig } from "../src/endpoint_config";

describe("authHeaders", () => {
  it("ohne Schlüssel → keine Header", () => {
    expect(authHeaders(undefined)).toEqual({});
    expect(authHeaders("")).toEqual({});
    expect(authHeaders("   ")).toEqual({});
  });

  it("mit Schlüssel → Bearer, getrimmt", () => {
    expect(authHeaders("  sk-abc  ")).toEqual({ Authorization: "Bearer sk-abc" });
  });
});

describe("effectiveModel", () => {
  it("ohne Override gilt das globale Modell", () => {
    expect(effectiveModel({ url: "u" }, "qwen3")).toBe("qwen3");
    expect(effectiveModel({ url: "u", model: "  " }, "qwen3")).toBe("qwen3");
  });

  it("Override gewinnt und wird getrimmt", () => {
    expect(effectiveModel({ url: "u", model: " gpt-4o " }, "qwen3")).toBe("gpt-4o");
  });
});

describe("carriesApiKey", () => {
  it("ohne Schlüssel → false", () => {
    expect(carriesApiKey({ url: "u" })).toBe(false);
    expect(carriesApiKey({ url: "u", apiKey: "" })).toBe(false);
    expect(carriesApiKey({ url: "u", apiKey: "   " })).toBe(false);
  });

  it("mit (auch nur whitespace-umrandetem) Schlüssel → true", () => {
    expect(carriesApiKey({ url: "u", apiKey: "sk-abc" })).toBe(true);
    expect(carriesApiKey({ url: "u", apiKey: "  sk-abc  " })).toBe(true);
  });
});

describe("migrateEndpointList", () => {
  it("Prä-0.19-Strings werden zu Configs", () => {
    expect(migrateEndpointList(undefined, ["http://a:1234", "http://b:1234"]))
      .toEqual([{ url: "http://a:1234" }, { url: "http://b:1234" }]);
  });

  it("bestehende Configs bleiben unverändert", () => {
    const cfg: EndpointConfig[] = [{ url: "https://x/api", apiKey: "sk-1", model: "m" }];
    expect(migrateEndpointList(undefined, cfg)).toEqual(cfg);
  });

  it("Mischliste aus String und Config", () => {
    expect(migrateEndpointList(undefined, ["http://a:1234", { url: "https://x/api", apiKey: "k" }]))
      .toEqual([{ url: "http://a:1234" }, { url: "https://x/api", apiKey: "k" }]);
  });

  it("Alt-Einzelfeld wird übernommen, wenn keine Liste da ist", () => {
    expect(migrateEndpointList("http://alt:1234", undefined)).toEqual([{ url: "http://alt:1234" }]);
  });

  it("leere und whitespace-Einträge fliegen raus", () => {
    expect(migrateEndpointList(undefined, ["", "  ", { url: "  " }, "http://a:1234"]))
      .toEqual([{ url: "http://a:1234" }]);
  });
});

describe("applyEndpointEdit", () => {
  const eps: EndpointConfig[] = [{ url: "http://a:1234" }, { url: "http://b:1234", apiKey: "k" }];

  it("URL an Index setzen", () => {
    expect(applyEndpointEdit(eps, 0, "url", " http://c:1234 ", false)[0]).toEqual({ url: "http://c:1234" });
  });

  it("Schlüssel setzen lässt die URL unberührt", () => {
    expect(applyEndpointEdit(eps, 0, "apiKey", "sk-neu", false)[0]).toEqual({ url: "http://a:1234", apiKey: "sk-neu" });
  });

  it("Schlüssel leeren entfernt das Feld, behält den Eintrag", () => {
    const out = applyEndpointEdit(eps, 1, "apiKey", "", false);
    expect(out[1]).toEqual({ url: "http://b:1234" });
    expect(out).toHaveLength(2);
  });

  it("leere URL entfernt den ganzen Eintrag", () => {
    expect(applyEndpointEdit(eps, 0, "url", "", false)).toEqual([{ url: "http://b:1234", apiKey: "k" }]);
  });

  it("Adder hängt nur bei nicht-leerer URL an", () => {
    expect(applyEndpointEdit(eps, 2, "url", "http://c:1234", true)).toHaveLength(3);
    expect(applyEndpointEdit(eps, 2, "url", "  ", true)).toHaveLength(2);
  });
});
