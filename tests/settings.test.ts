import { describe, it, expect, vi } from "vitest";
import { DEFAULT_SETTINGS, VaultRagSettings, migrateEndpointList, applyEndpointEdit, applyDestructive, VaultRagSettingTab } from "../src/settings";
import { makeFakeEl } from "./__mocks__/obsidian";

describe("settings", () => {
  it("hat sinnvolle Defaults", () => {
    expect(DEFAULT_SETTINGS.k).toBe(20);
    expect(DEFAULT_SETTINGS.minSim).toBeCloseTo(0.3);
    expect(DEFAULT_SETTINGS.indexDir).toBe("_vaultrag");
    expect(DEFAULT_SETTINGS.exclude).toContain("Templates/");
  });

  it("hat embeddingEndpoints-Default (Liste)", () => {
    expect(DEFAULT_SETTINGS.embeddingEndpoints).toEqual(["http://localhost:11434"]);
  });

  it("hat embeddingModel-Default", () => {
    expect(DEFAULT_SETTINGS.embeddingModel).toBe("qwen3-embedding:8b");
  });

  it("showStatusBar-Default ist false", () => {
    expect(DEFAULT_SETTINGS.showStatusBar).toBe(false);
  });

  it("debounceMs-Default ist 3000", () => {
    expect(DEFAULT_SETTINGS.debounceMs).toBe(3000);
  });

  it("hat Chat-Defaults", () => {
    expect(DEFAULT_SETTINGS.chatEndpoints).toEqual(["http://localhost:1234"]);
    expect(DEFAULT_SETTINGS.chatModel).toBe("qwen3");
    expect(DEFAULT_SETTINGS.chatK).toBe(5);
    expect(DEFAULT_SETTINGS.contextCharBudget).toBe(12000);
  });

  it("hat Chat-Modell-UX-Defaults", () => {
    expect(DEFAULT_SETTINGS.chatTemperature).toBe(0.7);
    expect(DEFAULT_SETTINGS.chatInputPosition).toBe("bottom");
    expect(DEFAULT_SETTINGS.chatSystemPrompt).toContain("gegroundet");
  });

  it("hat UX-Politur-Defaults", () => {
    expect(DEFAULT_SETTINGS.suppressThinking).toBe(false);
    expect(DEFAULT_SETTINGS.enterSends).toBe(true);
  });

  it("hat Smart-Apply-Defaults", () => {
    expect(DEFAULT_SETTINGS.smartApplyEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.templateDir).toBe("Templates/");
    expect(DEFAULT_SETTINGS.smartApplyTemperature).toBe(0);
  });

  it("Default-Merge ergänzt fehlende Smart-Apply-Felder aus altem data.json (Backward-Compat)", () => {
    // altes data.json — vor Smart Apply geschrieben, kennt die drei Felder nicht
    const loaded: Partial<VaultRagSettings> = {
      k: 30,
      chatModel: "mein-altes-modell",
      exclude: ["Archive/"],
    };
    const merged = Object.assign({}, DEFAULT_SETTINGS, loaded);
    // bestehende Werte aus data.json gewinnen
    expect(merged.k).toBe(30);
    expect(merged.chatModel).toBe("mein-altes-modell");
    expect(merged.exclude).toEqual(["Archive/"]);
    // die drei neuen Felder fehlen im alten data.json → fallen auf die Defaults zurück
    expect(merged.smartApplyEnabled).toBe(false);
    expect(merged.templateDir).toBe("Templates/");
    expect(merged.smartApplyTemperature).toBe(0);
  });

  it("hat Smart-Apply-Dashboard-Defaults", () => {
    expect(DEFAULT_SETTINGS.smartApplyModel).toBe("");
    expect(DEFAULT_SETTINGS.smartApplySuppressThinking).toBe(false);
    expect(DEFAULT_SETTINGS.smartApplyMaxTokens).toBe(4096);
  });

  it("Default-Merge ergänzt fehlende Dashboard-Felder (Backward-Compat)", () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, { smartApplyEnabled: true } as Partial<VaultRagSettings>);
    expect(merged.smartApplyModel).toBe("");
    expect(merged.smartApplySuppressThinking).toBe(false);
    expect(merged.smartApplyMaxTokens).toBe(4096);
  });

  it("hideIndexFolder-Default ist true", () => {
    expect(DEFAULT_SETTINGS.hideIndexFolder).toBe(true);
  });

  it("Default-Merge ergänzt fehlendes hideIndexFolder aus altem data.json (Backward-Compat)", () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, { k: 30 } as Partial<VaultRagSettings>);
    expect(merged.hideIndexFolder).toBe(true);
  });
});

describe("migrateEndpointList", () => {
  it("migriert ein altes Einzel-Setting auf eine 1-Element-Liste", () => {
    expect(migrateEndpointList("http://x", undefined)).toEqual(["http://x"]);
  });

  it("trimmt den migrierten Einzel-Endpunkt", () => {
    expect(migrateEndpointList("  http://x  ", undefined)).toEqual(["http://x"]);
  });

  it("lässt eine vorhandene Liste unverändert (gewinnt über das Einzelfeld)", () => {
    expect(migrateEndpointList("http://alt", ["http://a", "http://b"])).toEqual(["http://a", "http://b"]);
  });

  it("filtert leere Einträge aus einer vorhandenen Liste", () => {
    expect(migrateEndpointList(undefined, ["http://a", "", "  "])).toEqual(["http://a"]);
  });

  it("gibt [] bei fehlenden/leeren Eingaben zurück (Aufrufer fällt auf Default)", () => {
    expect(migrateEndpointList(undefined, undefined)).toEqual([]);
    expect(migrateEndpointList("   ", [])).toEqual([]);
  });
});

describe("applyEndpointEdit", () => {
  it("hängt einen nicht-leeren Adder-Wert an", () => {
    expect(applyEndpointEdit(["http://a"], 1, "http://b", true)).toEqual(["http://a", "http://b"]);
  });

  it("ignoriert einen leeren Adder-Wert", () => {
    expect(applyEndpointEdit(["http://a"], 1, "   ", true)).toEqual(["http://a"]);
  });

  it("setzt einen vorhandenen Index auf einen neuen Wert (Edit)", () => {
    expect(applyEndpointEdit(["http://a", "http://b"], 0, "http://c", false)).toEqual(["http://c", "http://b"]);
  });

  it("entfernt den Eintrag, wenn ein Nicht-Adder-Feld geleert wird", () => {
    expect(applyEndpointEdit(["http://a", "http://b"], 0, "", false)).toEqual(["http://b"]);
  });

  it("trimmt und filtert leere Einträge im Ergebnis", () => {
    expect(applyEndpointEdit(["  http://a  ", "http://b"], 1, "  http://c  ", false)).toEqual(["http://a", "http://c"]);
  });
});

describe("applyDestructive", () => {
  it("nutzt setDestructive, wenn vorhanden (1.13+)", () => {
    let called = false;
    const b = { setDestructive() { called = true; return this; }, buttonEl: { addClass() { throw new Error("nicht erwartet"); } } };
    applyDestructive(b as any);
    expect(called).toBe(true);
  });
  it("fällt auf mod-warning-Klasse zurück, wenn setDestructive fehlt (1.12.7)", () => {
    const classes: string[] = [];
    const b = { buttonEl: { addClass(c: string) { classes.push(c); } } };  // kein setDestructive
    applyDestructive(b as any);
    expect(classes).toContain("mod-warning");
  });
});

describe("DEFAULT_SETTINGS Endpunkte", () => {
  it("Chat-Default ist LM Studio :1234", () => {
    expect(DEFAULT_SETTINGS.chatEndpoints).toEqual(["http://localhost:1234"]);
  });
  it("Embedding-Default bleibt Ollama :11434", () => {
    expect(DEFAULT_SETTINGS.embeddingEndpoints).toEqual(["http://localhost:11434"]);
  });
});

const DECLARATIVE_KEYS = [
  "k","minSim","exclude","debounceMs","showStatusBar","hideIndexFolder",
  "chatK","chatTemperature","chatSystemPrompt","chatInputPosition","suppressThinking","enterSends",
  "smartApplyEnabled","templateDir","smartApplyTemperature","smartApplySuppressThinking",
  "smartApplyMaxTokens","smartApplyDefaultMode",
] as const;

function makeFakeHost() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    refreshSmartApplyRanking: vi.fn(),
    setStatusBarVisible: vi.fn(),
    refreshIndexFolderHiding: vi.fn(),
    // Endpoint-/Modell-/MCP-Methoden für render-Hatches (in Struktur-Tests nicht aufgerufen):
    resolveAndReconnectEmbedder: vi.fn().mockResolvedValue(undefined),
    resolveAndReconnectChat: vi.fn().mockResolvedValue(undefined),
    // Von renderImperative (display-Fallback) synchron aufgerufene render-Hatch-Methoden —
    // ungemockt würden sie beim Walk sofort werfen (undefined ist keine Funktion).
    embedderReady: vi.fn().mockResolvedValue(true),
    indexDelta: vi.fn().mockReturnValue({ embedded: 0, total: 0, healthy: true, emptyCount: 0 }),
    indexHealthReadout: vi.fn().mockReturnValue(""),
    mcpServerRunning: vi.fn().mockReturnValue(false),
    mcpServerAddress: vi.fn().mockReturnValue(null),
    mcpStartError: vi.fn().mockReturnValue(null),
  } as any;
}

function makeTab(host = makeFakeHost()) {
  return { tab: new VaultRagSettingTab({} as any, host), host };
}

describe("getControlValue/setControlValue", () => {
  it("round-trippt jeden deklarativen Key ohne Store-Drift", async () => {
    const { tab, host } = makeTab();
    for (const key of DECLARATIVE_KEYS) {
      const before = structuredClone(host.settings[key]);
      await tab.setControlValue(key, tab.getControlValue(key));
      expect(host.settings[key]).toEqual(before);
    }
  });

  it("exclude: string ↔ string[] Coercion", async () => {
    const { tab, host } = makeTab();
    expect(tab.getControlValue("exclude")).toBe("Templates/, Archive/");
    await tab.setControlValue("exclude", "A/, B/");
    expect(host.settings.exclude).toEqual(["A/", "B/"]);
  });

  it("templateDir: Trailing-Slash-Normalisierung + Ranking-Refresh", async () => {
    const { tab, host } = makeTab();
    await tab.setControlValue("templateDir", "Vorlagen");
    expect(host.settings.templateDir).toBe("Vorlagen/");
    expect(host.refreshSmartApplyRanking).toHaveBeenCalled();
  });

  it("Seiteneffekte: k→refresh, showStatusBar→setStatusBarVisible, hideIndexFolder→refreshIndexFolderHiding", async () => {
    const { tab, host } = makeTab();
    await tab.setControlValue("k", 30);
    expect(host.refresh).toHaveBeenCalled();
    await tab.setControlValue("showStatusBar", true);
    expect(host.setStatusBarVisible).toHaveBeenCalledWith(true);
    await tab.setControlValue("hideIndexFolder", false);
    expect(host.refreshIndexFolderHiding).toHaveBeenCalled();
  });
});

describe("getSettingDefinitions – Struktur", () => {
  function groups(tab: VaultRagSettingTab) {
    const defs = tab.getSettingDefinitions() as any[];
    return defs.filter(d => d.type === "group");
  }
  function controlKeys(tab: VaultRagSettingTab): string[] {
    return groups(tab).flatMap(g => (g.items ?? []))
      .filter((i: any) => i.control).map((i: any) => i.control.key);
  }

  it("liefert nur Groups auf oberster Ebene", () => {
    const { tab } = makeTab();
    const defs = tab.getSettingDefinitions() as any[];
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) expect(d.type).toBe("group");
  });

  it("jeder Control-Key existiert in DEFAULT_SETTINGS und round-trippt", async () => {
    const { tab, host } = makeTab();
    for (const key of controlKeys(tab)) {
      expect(key in host.settings).toBe(true);
      const before = structuredClone(host.settings[key]);
      await tab.setControlValue(key, tab.getControlValue(key));
      expect(host.settings[key]).toEqual(before);
    }
  });

  it("Suche-Gruppe hat k, minSim, exclude", () => {
    const { tab } = makeTab();
    const search = groups(tab).find(g => g.heading === "Suche");
    expect(search).toBeTruthy();
    const keys = (search!.items as any[]).filter(i => i.control).map(i => i.control.key);
    expect(keys).toEqual(["k", "minSim", "exclude"]);
  });

  it("Live-Embedding-Gruppe: Debounce/Statusleiste deklarativ, 3 render-Hatches", () => {
    const { tab } = makeTab();
    const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Live-Embedding");
    expect(g).toBeTruthy();
    const items = g.items as any[];
    const controlKeys = items.filter(i => i.control).map(i => i.control.key);
    expect(controlKeys).toEqual(["debounceMs", "showStatusBar"]);
    expect(items.filter(i => typeof i.render === "function").length).toBe(3); // Endpunkte, Modell, Status
  });

  it("Index-Gruppe: Index-Ordner render-Hatch + hideIndexFolder toggle", () => {
    const { tab } = makeTab();
    const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Index");
    expect(g).toBeTruthy();
    const items = g.items as any[];
    expect(items.filter(i => typeof i.render === "function").length).toBe(1);
    expect(items.filter(i => i.control).map(i => i.control.key)).toEqual(["hideIndexFolder"]);
  });

  it("Index-Robustheit-Gruppe: 1 render-Hatch (Zustand) + 2 action-Zeilen", () => {
    const { tab } = makeTab();
    const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Index-Robustheit");
    expect(g).toBeTruthy();
    const items = g.items as any[];
    expect(items.filter(i => typeof i.render === "function").length).toBe(1);
    expect(items.filter(i => typeof i.action === "function").length).toBe(2);
  });

  it("MCP-Gruppe: genau ein render-Hatch", () => {
    const { tab } = makeTab();
    const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "MCP-Server");
    expect(g).toBeTruthy();
    const items = g.items as any[];
    expect(items.length).toBe(1);
    expect(typeof items[0].render).toBe("function");
  });

  it("Chat-Gruppe: deklarative Keys + render-Hatches + Testen-Action", () => {
    const { tab } = makeTab();
    const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Chat");
    expect(g).toBeTruthy();
    const items = g.items as any[];
    const keys = items.filter(i => i.control).map(i => i.control.key);
    expect(keys).toEqual(["chatK", "chatTemperature", "chatSystemPrompt", "chatInputPosition", "suppressThinking", "enterSends"]);
    // Endpunkte, Modell, Modelldetails, Fähigkeiten, Budget = 5 render-Hatches
    expect(items.filter(i => typeof i.render === "function").length).toBe(5);
    // „Testen" als eigene Action-Zeile
    expect(items.filter(i => typeof i.action === "function").length).toBe(1);
  });

  it("Smart-Apply-Gruppe: deklarative Keys inkl. folder + 1 render-Hatch + empty-Hinweis", () => {
    const { tab } = makeTab();
    const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Smart Apply");
    expect(g).toBeTruthy();
    const items = g.items as any[];
    const keys = items.filter(i => i.control).map(i => i.control.key);
    expect(keys).toEqual([
      "smartApplyEnabled", "templateDir", "smartApplyTemperature",
      "smartApplySuppressThinking", "smartApplyMaxTokens", "smartApplyDefaultMode",
    ]);
    expect(items.find(i => i.control?.key === "templateDir").control.type).toBe("folder");
    expect(items.filter(i => typeof i.render === "function").length).toBe(1); // Modell
    expect(items.filter(i => !i.control && !i.render && !i.action).length).toBe(1); // Verbindungs-Hinweis (empty)
  });
});

describe("resolvedOnOpen – Re-Resolve beim Tab-Öffnen", () => {
  it("getSettingDefinitions() feuert resolveAndReconnectChat genau einmal pro Öffnen, erneut nach hide()", () => {
    const { tab, host } = makeTab();
    tab.getSettingDefinitions();
    tab.getSettingDefinitions();
    expect(host.resolveAndReconnectChat).toHaveBeenCalledTimes(1);
    tab.hide();
    tab.getSettingDefinitions();
    expect(host.resolveAndReconnectChat).toHaveBeenCalledTimes(2);
  });
});

describe("renderImperative (display-Fallback für <1.13)", () => {
  it("rendert alle 7 Gruppen ohne Crash", () => {
    const { tab } = makeTab();
    tab.containerEl = makeFakeEl() as any;   // falls nicht schon gesetzt
    expect(() => tab.display()).not.toThrow();
    tab.hide();   // räumt den 2s-Poll aus renderEmbeddingStatus ab (sonst Timer-Leak über das Test-Teardown)
  });
  it("display() liest aus getSettingDefinitions (kein separater Baum)", () => {
    const { tab } = makeTab();
    const spy = vi.spyOn(tab, "getSettingDefinitions");
    tab.display();
    expect(spy).toHaveBeenCalled();
    tab.hide();   // räumt den 2s-Poll aus renderEmbeddingStatus ab (sonst Timer-Leak über das Test-Teardown)
  });
});
