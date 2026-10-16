import { describe, it, expect } from "vitest";
import "../src/i18n/strings";
import { harness, recordingTransport } from "./helpers/llm";
import type { BackendId, FamilyId } from "../src/vendor/kit/sampling-profiles";

// Goldene Requests (Rezept 8): die Parameter, die das Plugin je Aufrufstelle tatsaechlich
// sendet — gemessen am BODY, der in den Transport geht, durch die echte Chat-Verbindung des Plugins
// (`chatConnectionOptions`, Kit `createLlmConnection`). Seit Welle 15 entscheidet das Kit allein ueber
// die Werte; der Wrapper-Test davor pruefte Funktionen, die es nicht mehr gibt, dieser prueft das, was
// auf die Leitung geht. Die Tabelle steht ausgeschrieben, nicht als Snapshot: jede Zeile ist eine
// Zusage, die man lesen kann. Die Werte wurden beim Anlegen gegen `sampling-profiles.ts` (MODES,
// FAMILIES, BACKENDS) gelesen, nicht aus einer Notiz uebernommen:
//   · Temperatur je Modus: grounded 0.4 · structured 0.1 · transform 0.2
//   · LM Studio ignoriert presence_penalty (nicht gesendet), Open WebUI nimmt top_k/min_p/
//     presence_penalty an, ein unbekanntes Backend bekommt nur die Standardfelder
//   · gpt-oss kann das Denken nicht abschalten: reasoning_effort ist minimal, nie none (7b10d84)
//   · unbekannte Familie auf unbekanntem Backend: nur die Temperatur
// Aendert ein Kit-Update einen Wert, faellt genau diese Tabelle auf und zeigt, was sich fuer
// die drei Aufrufstellen aendert. Budget je Aufrufstelle wie im Plugin: Chat keins, Smart
// Apply (Einstellung `smartApplyMaxTokens`) und Umformatieren (`REFORMAT_MAX_TOKENS`) 4096.
type Site = "chat" | "smartApply" | "reformat";
type Row = [Site, FamilyId | null, BackendId, Record<string, number | string>];

const MODE = { chat: "grounded", smartApply: "structured", reformat: "transform" } as const;
/** Ein Modellname, aus dem das Kit die Familie rät (Namensrater); `null` = keine bekannte Familie. */
const MODEL_OF: Record<string, string> = { "qwen3.8": "qwen3.8-test", "qwen3.6": "qwen3.6-test", gemma4: "gemma4-test", "gpt-oss": "gpt-oss-test", null: "irgendein-modell" };
/** Alles, was nicht Sampling ist, steht ebenfalls im Body. */
const NOT_SAMPLING = new Set(["model", "messages", "stream", "stream_options"]);

/** Sendet EINEN Aufruf der Aufrufstelle und liefert die Sampling-Felder des Bodys. */
async function sentParams(
  site: Site, family: FamilyId | null, backend: BackendId, edit?: (h: ReturnType<typeof harness>) => void,
): Promise<Record<string, unknown>> {
  const { transport, calls } = recordingTransport();
  const h = harness({
    transport, backend: backend === "unknown" ? null : backend,
    endpoints: [{ url: "http://localhost:1234", model: MODEL_OF[String(family)]! }],
  });
  edit?.(h);
  await h.client.stream([{ role: "user", content: "hi" }], () => {}, () => {}, undefined, { mode: MODE[site] });
  return Object.fromEntries(Object.entries(calls[0]!.body).filter(([k]) => !NOT_SAMPLING.has(k)));
}

const EXPECTED: Row[] = [
  ["chat", "qwen3.8", "lmstudio", {"temperature":0.4,"top_p":0.8,"top_k":20,"min_p":0,"reasoning_effort":"none"}],
  ["chat", "qwen3.8", "openwebui", {"temperature":0.4,"top_p":0.8,"top_k":20,"min_p":0,"presence_penalty":1.5,"reasoning_effort":"none"}],
  ["chat", "qwen3.8", "unknown", {"temperature":0.4,"top_p":0.8,"reasoning_effort":"none"}],
  ["chat", "qwen3.6", "lmstudio", {"temperature":0.4,"top_p":0.95,"top_k":20,"reasoning_effort":"none"}],
  ["chat", "qwen3.6", "openwebui", {"temperature":0.4,"top_p":0.95,"top_k":20,"reasoning_effort":"none"}],
  ["chat", "qwen3.6", "unknown", {"temperature":0.4,"top_p":0.95,"reasoning_effort":"none"}],
  ["chat", "gemma4", "lmstudio", {"temperature":0.4,"top_p":0.95,"top_k":64,"reasoning_effort":"low"}],
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
  ["smartApply", "gemma4", "lmstudio", {"temperature":0.1,"top_p":0.95,"top_k":64,"reasoning_effort":"low","max_tokens":4096}],
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
  ["reformat", "gemma4", "lmstudio", {"temperature":0.2,"top_p":0.95,"top_k":64,"reasoning_effort":"low","max_tokens":4096}],
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
  it.each(EXPECTED)("%s · %s · %s", async (site, family, backend, expected) => {
    expect(await sentParams(site, family, backend)).toEqual(expected);
  });
});

describe("Stufenwahl und Überschreibungen ändern die gesendeten Felder", () => {
  it("qwen3.6 auf LM Studio: Denken an (medium) hebt die Temperatur auf den Boden und schaltet die Stufe um", async () => {
    expect(await sentParams("chat", "qwen3.6", "lmstudio", (h) => { h.settings.request.thinking.grounded = "medium"; }))
      .toEqual({"temperature":0.6,"top_p":0.95,"top_k":20,"reasoning_effort":"medium"});
  });
  it("eine Überschreibung für Modus × Familie gewinnt, eine für eine andere Familie nicht", async () => {
    const p = await sentParams("chat", "qwen3.6", "lmstudio", (h) => {
      h.settings.request.overrides.grounded = { "qwen3.6": { temperature: 0.9 }, gemma4: { temperature: 0.1 } };
    });
    expect(p.temperature).toBe(0.9);
  });
  it("eine Überschreibung unter `unknown` greift nur, wenn die Familie unbekannt ist", async () => {
    const edit = (h: ReturnType<typeof harness>): void => { h.settings.request.overrides.grounded = { unknown: { temperature: 1.3 } }; };
    expect((await sentParams("chat", null, "lmstudio", edit)).temperature).toBe(1.3);
    expect((await sentParams("chat", "qwen3.6", "lmstudio", edit)).temperature).toBe(0.4);
  });
  it("das Plugin-Budget von Smart Apply ist eine Einstellung, nicht der Chat: sie wirkt nur im Modus structured", async () => {
    const edit = (h: ReturnType<typeof harness>): void => { h.settings.smartApplyMaxTokens = 8192; };
    expect((await sentParams("smartApply", "qwen3.6", "lmstudio", edit)).max_tokens).toBeGreaterThanOrEqual(8192);
    expect("max_tokens" in await sentParams("chat", "qwen3.6", "lmstudio", edit)).toBe(false);
  });
});
