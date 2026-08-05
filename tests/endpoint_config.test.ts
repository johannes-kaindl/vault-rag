import { describe, it, expect } from "vitest";
import { authHeaders, effectiveModel, chatRequestModel, migrateEndpointList, applyEndpointEdit, carriesApiKey, moveEndpointToFront, endpointRole, describeEndpointRole, type EndpointConfig } from "../src/endpoint_config";

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

describe("chatRequestModel", () => {
  const local: EndpointConfig = { url: "http://localhost:1234" };
  const hosted: EndpointConfig = { url: "https://openrouter.ai/api", apiKey: "sk-x", model: "anthropic/claude" };

  it("ohne Override und ohne feature-eigenes Modell gilt das globale", () => {
    expect(chatRequestModel(local, "", "qwen3")).toBe("qwen3");
    expect(chatRequestModel(local, undefined, "qwen3")).toBe("qwen3");
    expect(chatRequestModel(local, "   ", "qwen3")).toBe("qwen3");
  });

  it("ohne Override gewinnt das feature-eigene Modell (Smart Apply)", () => {
    expect(chatRequestModel(local, " qwen3-coder ", "qwen3")).toBe("qwen3-coder");
  });

  it("das Zeilen-Override des aktiven Endpunkts schlägt beides", () => {
    // Sonst ginge „qwen3-coder" an einen Anbieter, der diesen Namen nicht kennt → HTTP 400.
    expect(chatRequestModel(hosted, "qwen3-coder", "qwen3")).toBe("anthropic/claude");
    expect(chatRequestModel(hosted, "", "qwen3")).toBe("anthropic/claude");
  });

  it("ein leeres Override zählt nicht als Override", () => {
    expect(chatRequestModel({ url: "u", model: "  " }, "qwen3-coder", "qwen3")).toBe("qwen3-coder");
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

describe("moveEndpointToFront", () => {
  const list = (): EndpointConfig[] => [
    { url: "http://a" },
    { url: "http://b", apiKey: "k" },
    { url: "http://c", model: "m" },
  ];

  it("holt den Eintrag an die Spitze und erhält die Reihenfolge der übrigen", () => {
    expect(moveEndpointToFront(list(), 2).map(e => e.url)).toEqual(["http://c", "http://a", "http://b"]);
  });

  it("nimmt die Felder des Eintrags vollständig mit", () => {
    expect(moveEndpointToFront(list(), 1)[0]).toEqual({ url: "http://b", apiKey: "k" });
  });

  it("Index 0 lässt die Liste unverändert", () => {
    expect(moveEndpointToFront(list(), 0)).toEqual(list());
  });

  it("Index außerhalb lässt die Liste unverändert", () => {
    expect(moveEndpointToFront(list(), 9)).toEqual(list());
    expect(moveEndpointToFront(list(), -1)).toEqual(list());
  });

  it("mutiert die Eingangsliste nicht", () => {
    const original = list();
    moveEndpointToFront(original, 2);
    expect(original.map(e => e.url)).toEqual(["http://a", "http://b", "http://c"]);
  });
});

describe("endpointRole", () => {
  const base = { isActive: false, reachable: true, modelFits: true, position: 2 };

  it("aktiv schlägt alles andere", () => {
    expect(endpointRole({ ...base, isActive: true })).toEqual({ kind: "active" });
  });

  it("nicht erreichbar vor Modell-Mismatch — der offensichtlichere Grund gewinnt", () => {
    expect(endpointRole({ ...base, reachable: false, modelFits: false })).toEqual({ kind: "unreachable" });
  });

  it("erreichbar, aber falsches Modell → übersprungen", () => {
    expect(endpointRole({ ...base, modelFits: false })).toEqual({ kind: "skipped-model" });
  });

  it("erreichbar und passend, aber nicht aktiv → wartet auf seinem Platz", () => {
    expect(endpointRole({ ...base, position: 3 })).toEqual({ kind: "standby", position: 3 });
  });
});

describe("describeEndpointRole", () => {
  it("benennt den aktiven Endpunkt", () => {
    expect(describeEndpointRole({ kind: "active" })).toBe("aktiv");
  });

  it("nennt bei standby die Position — sonst bliebe offen, warum er nicht dran ist", () => {
    expect(describeEndpointRole({ kind: "standby", position: 3 })).toBe("erreichbar, aber Platz 3");
  });

  it("benennt Nichterreichbarkeit", () => {
    expect(describeEndpointRole({ kind: "unreachable" })).toBe("nicht erreichbar");
  });

  it("erklärt den Modell-Guard, statt ihn nur zu behaupten", () => {
    expect(describeEndpointRole({ kind: "skipped-model" }))
      .toBe("übersprungen — Modell passt nicht zum Index");
  });
});
