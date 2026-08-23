import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authHeaders, effectiveModel, chatRequestModel, migrateEndpointList, applyEndpointEdit, carriesApiKey, moveEndpointToFront, endpointRole, describeEndpointRole, endpointStatusText, endpointWarningText, endpointInputWarnings, type EndpointConfig } from "../src/endpoint_config";
import "../src/i18n/strings"; // Register i18n strings

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
    expect(describeEndpointRole({ kind: "active" })).toBe("active");
  });

  it("nennt bei standby die Position — sonst bliebe offen, warum er nicht dran ist", () => {
    expect(describeEndpointRole({ kind: "standby", position: 3 })).toBe("reachable, but position 3");
  });

  it("benennt Nichterreichbarkeit", () => {
    expect(describeEndpointRole({ kind: "unreachable" })).toBe("unreachable");
  });

  it("erklärt den Modell-Guard, statt ihn nur zu behaupten", () => {
    expect(describeEndpointRole({ kind: "skipped-model" }))
      .toBe("skipped — model does not match the index");
  });
});

describe("describeEndpointRole i18n", () => {
  it("liefert die Rollentexte auf Englisch", () => {
    expect(describeEndpointRole({ kind: "active" })).toBe("active");
    expect(describeEndpointRole({ kind: "standby", position: 2 })).toBe("reachable, but position 2");
    expect(describeEndpointRole({ kind: "unreachable" })).toBe("unreachable");
    expect(describeEndpointRole({ kind: "skipped-model" }))
      .toBe("skipped — model does not match the index");
  });
});

// ── i18n Teil 3: Diagnose-Codes statt Kit-Prosa ──────────────────────────────
// Das Kit liefert zu jedem Befund BEIDES — einen Code (`kind`/`rule`) und deutschen
// Klartext (`klartext`/`message`). Nur der Code ist sprachneutral; die beiden Funktionen
// hier sind die einzige Stelle, an der aus ihm Anzeigetext wird.

describe("endpointStatusText", () => {
  it("übersetzt jeden Erreichbarkeits-Code, statt den Kit-Klartext durchzureichen", () => {
    expect(endpointStatusText({ reachable: true, kind: "ok", klartext: "Verbunden" }))
      .toBe("Connected");
    expect(endpointStatusText({ reachable: false, kind: "refused", klartext: "…" }))
      .toBe("Connection refused — server not running or wrong port.");
    expect(endpointStatusText({ reachable: false, kind: "unknown-host", klartext: "…" }))
      .toBe("Unknown hostname — typo in the address?");
    expect(endpointStatusText({ reachable: false, kind: "timeout", klartext: "…" }))
      .toBe("Timeout — network unreachable (wrong network / VPN off?).");
    expect(endpointStatusText({ reachable: false, kind: "not-an-llm-api", klartext: "…" }))
      .toBe("Responds, but is not an OpenAI-compatible endpoint — wrong path/service?");
    expect(endpointStatusText({ reachable: false, kind: "unauthorized", klartext: "…" }))
      .toBe("Access denied — key missing or invalid.");
  });

  it("hängt bei `unknown` die rohe Fehlermeldung an — sie ist die einzige Spur, die es gibt", () => {
    expect(endpointStatusText({ reachable: false, kind: "unknown", klartext: "…", raw: "ECONNRESET" }))
      .toBe("Not reachable — ECONNRESET");
  });

  it("bleibt bei `unknown` ohne `raw` eine vollständige Aussage", () => {
    expect(endpointStatusText({ reachable: false, kind: "unknown", klartext: "…" }))
      .toBe("Not reachable");
  });
});

describe("endpointWarningText", () => {
  it("übersetzt die bekannten Eingabe-Regeln", () => {
    expect(endpointWarningText({ rule: "scheme", message: "…" }))
      .toBe("Address needs http:// or https://");
    expect(endpointWarningText({ rule: "malformed", message: "…" }))
      .toBe("Address is not a valid URL");
    expect(endpointWarningText({ rule: "port", message: "…" }))
      .toBe("Local LLM servers almost always need a port (e.g. :1234)");
    expect(endpointWarningText({ rule: "placeholder-ip", message: "…" }))
      .toBe("Looks like an example/placeholder address");
  });

  it("reicht eine unbekannte Regel als Kit-Text durch, statt den Befund zu verschlucken", () => {
    // `rule` ist im Kit `string`, keine Union — ein Kit-Update kann jederzeit eine neue
    // Regel mitbringen. Dann ist deutscher Text das kleinere Übel gegenüber Schweigen.
    expect(endpointWarningText({ rule: "kit-neu-2027", message: "Neuer Kit-Befund" }))
      .toBe("Neuer Kit-Befund");
  });
});

describe("endpointInputWarnings", () => {
  it("liefert fertige Anzeigetexte — der Aufrufer sieht das Kit-Rohobjekt nie", () => {
    expect(endpointInputWarnings("localhost:1234"))
      .toEqual(["Address needs http:// or https://"]);
    expect(endpointInputWarnings("http://localhost"))
      .toEqual(["Local LLM servers almost always need a port (e.g. :1234)"]);
    expect(endpointInputWarnings("http://0.0.0.0:1234"))
      .toEqual(["Looks like an example/placeholder address"]);
  });

  it("schweigt bei einer unauffälligen Adresse", () => {
    expect(endpointInputWarnings("http://localhost:1234")).toEqual([]);
    expect(endpointInputWarnings("")).toEqual([]);
  });
});

// Aus der TaskNote "Modell-Override ging einmal verloren — nicht reproduzierbar": der Verlust
// war nie reproduzierbar, die einzelnen Operationen sind je fuer sich geprueft. Was fehlte, war
// die Aussage UEBER ALLE: eine Operation, die einen Eintrag nicht bewusst entfernt oder gerade
// dieses Feld bearbeitet, muss `apiKey` und `model` erhalten. Genau so ein Verlust erklaert sich
// hinterher nicht mehr — er faellt erst auf, wenn ein Endpunkt stillschweigend das falsche
// Modell benutzt.
describe("Listenoperationen — Invariante: kein stiller Feldverlust", () => {
  const full = (): EndpointConfig[] => ([
    { url: "http://a", apiKey: "ka", model: "ma" },
    { url: "http://b", apiKey: "kb", model: "mb" },
    { url: "http://c" },                                  // bewusst ohne Zusatzfelder
  ]);

  /** Jeder Eintrag, der die Operation ueberlebt, traegt seine Felder unveraendert —
   *  ausser er war das Ziel einer Bearbeitung GENAU dieses Feldes. */
  function assertFieldsKept(before: EndpointConfig[], after: EndpointConfig[], exempt?: { url: string; field: "apiKey" | "model" }): void {
    for (const b of before) {
      const a = after.find(x => x.url === b.url);
      if (!a) continue;                                    // bewusst entfernt — nicht Gegenstand
      for (const field of ["apiKey", "model"] as const) {
        if (exempt && exempt.url === b.url && exempt.field === field) continue;
        expect(a[field], `${b.url}.${field} ging verloren`).toBe(b[field]);
      }
    }
  }

  it("moveEndpointToFront erhaelt alle Felder, aus jeder Position", () => {
    for (let i = -1; i <= 3; i++) assertFieldsKept(full(), moveEndpointToFront(full(), i));
  });

  it("migrateEndpointList erhaelt alle Felder", () => {
    assertFieldsKept(full(), migrateEndpointList(undefined, full()));
  });

  it("applyEndpointEdit erhaelt die jeweils NICHT bearbeiteten Felder", () => {
    for (let i = 0; i < 3; i++) {
      assertFieldsKept(full(), applyEndpointEdit(full(), i, "url", "http://neu", false));
      const urls = full()[i]!.url;
      assertFieldsKept(full(), applyEndpointEdit(full(), i, "apiKey", "neu", false), { url: urls, field: "apiKey" });
      assertFieldsKept(full(), applyEndpointEdit(full(), i, "model", "neu", false), { url: urls, field: "model" });
      // Feld leeren entfernt NUR dieses Feld — das andere muss stehen bleiben.
      assertFieldsKept(full(), applyEndpointEdit(full(), i, "apiKey", "", false), { url: urls, field: "apiKey" });
      assertFieldsKept(full(), applyEndpointEdit(full(), i, "model", "", false), { url: urls, field: "model" });
    }
  });

  it("applyEndpointEdit im Adder-Modus laesst die bestehende Liste unberuehrt", () => {
    assertFieldsKept(full(), applyEndpointEdit(full(), 3, "url", "http://d", true));
  });

  // Vollstaendigkeits-Guard: die Invariante ist nur so viel wert wie die Liste der geprueften
  // Operationen. Eine neu hinzugefuegte Listenoperation soll diesen Test rot faerben, statt
  // ungeprueft danebenzustehen (CORE-TEST-04).
  it("kennt jede Operation, die eine Endpunkt-Liste zurueckgibt", () => {
    const src = readFileSync(join(__dirname, "..", "src", "endpoint_config.ts"), "utf8");
    // Am RUECKGABETYP erkannt, nicht am Parameter: eine Listenoperation ist definiert durch das,
    // was sie liefert. `[^{]*?` haelt den Treffer in der Signatur, damit nicht zwei Funktionen
    // ueber ihre Rumpfgrenze hinweg zu einem Match verschmelzen.
    const listOps = [...src.matchAll(/export function (\w+)\([^{]*?\): EndpointConfig\[\]/g)].map(m => m[1]);
    expect(listOps.sort()).toEqual(["applyEndpointEdit", "migrateEndpointList", "moveEndpointToFront"]);
  });
});
