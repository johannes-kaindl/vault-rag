import { describe, it, expect } from "vitest";
import { buildChatParams, buildSmartApplyParams, buildReformatParams } from "../src/request_profile";
import { DEFAULT_REQUEST_SETTINGS, type BackendId, type FamilyId } from "../src/vendor/kit/sampling-profiles";

// Goldene Requests (Rezept 8): die Parameter, die das Plugin je Aufrufstelle tatsaechlich
// sendet — gebaut ueber die Wrapper des PLUGINS, nicht ueber `resolveRequestParams`. Die
// Tabelle steht ausgeschrieben, nicht als Snapshot: jede Zeile ist eine Zusage, die man lesen
// kann. Die Werte wurden beim Anlegen gegen `sampling-profiles.ts` (MODES, FAMILIES, BACKENDS)
// gelesen, nicht aus einer Notiz uebernommen:
//   · Temperatur je Modus: grounded 0.4 · structured 0.1 · transform 0.2
//   · LM Studio ignoriert presence_penalty (nicht gesendet), Open WebUI nimmt top_k/min_p/
//     presence_penalty an, ein unbekanntes Backend bekommt nur die Standardfelder
//   · gpt-oss kann das Denken nicht abschalten: reasoning_effort ist minimal, nie none (7b10d84)
//   · unbekannte Familie auf unbekanntem Backend: nur die Temperatur
// Aendert ein Kit-Update einen Wert, faellt genau diese Tabelle auf und zeigt, was sich fuer
// die drei Aufrufstellen aendert. Budget je Aufrufstelle wie im Plugin: Chat keins, Smart
// Apply und Umformatieren 4096.
type Site = "chat" | "smartApply" | "reformat";
type Row = [Site, FamilyId | null, BackendId, Record<string, number | string>];

const BUILD = {
  chat: { build: buildChatParams, budget: undefined },
  smartApply: { build: buildSmartApplyParams, budget: 4096 },
  reformat: { build: buildReformatParams, budget: 4096 },
} as const;

const EXPECTED: Row[] = [
  ["chat", "qwen3.8", "lmstudio", {"temperature":0.4,"top_p":0.8,"top_k":20,"min_p":0,"reasoning_effort":"none"}],
  ["chat", "qwen3.8", "openwebui", {"temperature":0.4,"top_p":0.8,"top_k":20,"min_p":0,"presence_penalty":1.5,"reasoning_effort":"none"}],
  ["chat", "qwen3.8", "unknown", {"temperature":0.4,"top_p":0.8,"reasoning_effort":"none"}],
  ["chat", "qwen3.6", "lmstudio", {"temperature":0.4,"top_p":0.95,"top_k":20,"reasoning_effort":"none"}],
  ["chat", "qwen3.6", "openwebui", {"temperature":0.4,"top_p":0.95,"top_k":20,"reasoning_effort":"none"}],
  ["chat", "qwen3.6", "unknown", {"temperature":0.4,"top_p":0.95,"reasoning_effort":"none"}],
  ["chat", "gemma4", "lmstudio", {"temperature":0.4,"top_p":0.95,"top_k":64,"reasoning_effort":"none"}],
  ["chat", "gemma4", "openwebui", {"temperature":0.4,"top_p":0.95,"top_k":64,"reasoning_effort":"none"}],
  ["chat", "gemma4", "unknown", {"temperature":0.4,"top_p":0.95,"reasoning_effort":"none"}],
  ["chat", "gpt-oss", "lmstudio", {"temperature":0.4,"top_p":1,"reasoning_effort":"minimal"}],
  ["chat", "gpt-oss", "openwebui", {"temperature":0.4,"top_p":1,"reasoning_effort":"minimal"}],
  ["chat", "gpt-oss", "unknown", {"temperature":0.4,"top_p":1,"reasoning_effort":"minimal"}],
  ["chat", null, "lmstudio", {"temperature":0.4,"reasoning_effort":"none"}],
  ["chat", null, "openwebui", {"temperature":0.4,"reasoning_effort":"none"}],
  ["chat", null, "unknown", {"temperature":0.4}],
  ["smartApply", "qwen3.8", "lmstudio", {"temperature":0.1,"top_p":0.8,"top_k":20,"min_p":0,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", "qwen3.8", "openwebui", {"temperature":0.1,"top_p":0.8,"top_k":20,"min_p":0,"presence_penalty":1.5,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", "qwen3.8", "unknown", {"temperature":0.1,"top_p":0.8,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", "qwen3.6", "lmstudio", {"temperature":0.1,"top_p":0.95,"top_k":20,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", "qwen3.6", "openwebui", {"temperature":0.1,"top_p":0.95,"top_k":20,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", "qwen3.6", "unknown", {"temperature":0.1,"top_p":0.95,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", "gemma4", "lmstudio", {"temperature":0.1,"top_p":0.95,"top_k":64,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", "gemma4", "openwebui", {"temperature":0.1,"top_p":0.95,"top_k":64,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", "gemma4", "unknown", {"temperature":0.1,"top_p":0.95,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", "gpt-oss", "lmstudio", {"temperature":0.1,"top_p":1,"reasoning_effort":"minimal","max_tokens":4096}],
  ["smartApply", "gpt-oss", "openwebui", {"temperature":0.1,"top_p":1,"reasoning_effort":"minimal","max_tokens":4096}],
  ["smartApply", "gpt-oss", "unknown", {"temperature":0.1,"top_p":1,"reasoning_effort":"minimal","max_tokens":4096}],
  ["smartApply", null, "lmstudio", {"temperature":0.1,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", null, "openwebui", {"temperature":0.1,"reasoning_effort":"none","max_tokens":4096}],
  ["smartApply", null, "unknown", {"temperature":0.1,"max_tokens":4096}],
  ["reformat", "qwen3.8", "lmstudio", {"temperature":0.2,"top_p":0.8,"top_k":20,"min_p":0,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", "qwen3.8", "openwebui", {"temperature":0.2,"top_p":0.8,"top_k":20,"min_p":0,"presence_penalty":1.5,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", "qwen3.8", "unknown", {"temperature":0.2,"top_p":0.8,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", "qwen3.6", "lmstudio", {"temperature":0.2,"top_p":0.95,"top_k":20,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", "qwen3.6", "openwebui", {"temperature":0.2,"top_p":0.95,"top_k":20,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", "qwen3.6", "unknown", {"temperature":0.2,"top_p":0.95,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", "gemma4", "lmstudio", {"temperature":0.2,"top_p":0.95,"top_k":64,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", "gemma4", "openwebui", {"temperature":0.2,"top_p":0.95,"top_k":64,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", "gemma4", "unknown", {"temperature":0.2,"top_p":0.95,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", "gpt-oss", "lmstudio", {"temperature":0.2,"top_p":1,"reasoning_effort":"minimal","max_tokens":4096}],
  ["reformat", "gpt-oss", "openwebui", {"temperature":0.2,"top_p":1,"reasoning_effort":"minimal","max_tokens":4096}],
  ["reformat", "gpt-oss", "unknown", {"temperature":0.2,"top_p":1,"reasoning_effort":"minimal","max_tokens":4096}],
  ["reformat", null, "lmstudio", {"temperature":0.2,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", null, "openwebui", {"temperature":0.2,"reasoning_effort":"none","max_tokens":4096}],
  ["reformat", null, "unknown", {"temperature":0.2,"max_tokens":4096}],
];

describe("goldene Requests je Aufrufstelle × Familie × Backend", () => {
  it("die Tabelle deckt 3 Aufrufstellen × 5 Familien × 3 Backends ab", () => {
    expect(EXPECTED).toHaveLength(45);
    expect(new Set(EXPECTED.map(([s, f, b]) => `${s}|${f}|${b}`)).size).toBe(45);
  });
  it.each(EXPECTED)("%s · %s · %s", (site, family, backend, expected) => {
    const { build, budget } = BUILD[site];
    const { params } = build({ family, backend }, structuredClone(DEFAULT_REQUEST_SETTINGS), budget);
    expect(params).toEqual(expected);
  });
});

describe("Stufenwahl ändert die gesendeten Felder", () => {
  it("qwen3.6 auf LM Studio: Denken an (medium) hebt die Temperatur auf den Boden und schaltet die Stufe um", () => {
    const s = structuredClone(DEFAULT_REQUEST_SETTINGS);
    s.thinking.grounded = "medium";
    expect(buildChatParams({ family: "qwen3.6", backend: "lmstudio" }, s).params)
      .toEqual({"temperature":0.6,"top_p":0.95,"top_k":20,"reasoning_effort":"medium"});
  });
});
