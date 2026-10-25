import { describe, it, expect, vi } from "vitest";
import { ReformatPanel, type ReformatPanelDeps } from "../src/reformat_panel";
import { makeFakeEl } from "./__mocks__/obsidian";
import "../src/i18n/strings"; // i18n-Texte registrieren

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}
const first = (el: any, cls: string): any => all(el, cls)[0];
async function flush(n = 20): Promise<void> { for (let i = 0; i < n; i++) await Promise.resolve(); }

/** Die Verbindung der Modellzeile: dieselbe wie im Chat (`llm: this.llm`), hier ein Fake mit zwei Modellen. */
function mkLlm() {
  return {
    models: vi.fn(async () => ({ models: ["fast-model", "smart-model"], reachable: true })),
    source: () => ({ defaultModel: "fast-model" }),
    modelInUse: () => "fast-model",
    setModel: vi.fn(async () => {}),
  };
}
function mkThinking() {
  const state = { level: "low" };
  return {
    family: () => null,
    current: () => state.level,
    onLevel: () => "low",
    setLevel: vi.fn(async (l: string) => { state.level = l; }),
    levelPicker: () => false,
    strings: {
      button: (level: string) => (level === "off" ? "Thinking off" : `Thinking: ${level}`),
      level: (l: string) => l,
      pickerLabel: "Thinking level",
    },
  };
}
function mkPanel(over: Partial<ReformatPanelDeps> = {}) {
  const llm = mkLlm();
  const deps: ReformatPanelDeps = {
    getReadiness: () => ({ kind: "no-editor" }),
    run: vi.fn(),
    transforms: () => [],
    app: { plugins: { plugins: {} } } as never,
    llm: llm as never,
    thinking: mkThinking() as never,
    ...over,
  };
  const container = makeFakeEl();
  const panel = new ReformatPanel(deps);
  panel.mount(container);
  return { panel, container, llm, deps };
}

describe("ReformatPanel — Modellzeile (Welle 27, V5)", () => {
  it("trägt die Modellzeile des Kits mit dem Namen „Reformat (chat model)“ und der Denk-Steuerung darin", () => {
    const { container } = mkPanel();
    const bar = first(container, "okit-model-bar");
    expect(bar).toBeTruthy();
    expect(first(bar, "okit-model-bar-label").textContent).toBe("Reformat (chat model)");
    expect(all(bar, "okit-thinking-control").length).toBe(1);
    expect(all(container, "okit-model-bar").length).toBe(1);
  });

  it("das Dropdown füllt sich aus llm.models(), ein Wechsel ruft setModel der geteilten Verbindung", async () => {
    const { container, llm } = mkPanel();
    await flush();
    const sel = first(container, "okit-model-bar-select");
    expect(sel.children.map((o: any) => o.textContent)).toEqual(["Automatic (fast-model)", "fast-model", "smart-model"]);
    sel.value = "smart-model";
    (sel._listeners?.change ?? []).forEach((cb: any) => cb());
    await flush();
    expect(llm.setModel).toHaveBeenCalledWith("smart-model");
  });

  it("jedes mount() baut genau EINE Zeile und meldet die alte ab (rebuild nach geänderten Funktionen)", () => {
    const { panel, container } = mkPanel();
    const before = first(container, "okit-model-bar");
    panel.rebuild();
    expect(all(container, "okit-model-bar").length).toBe(1);
    expect(first(container, "okit-model-bar")).not.toBe(before);
  });

  it("refreshModelBar zeichnet die Zeile neu, `models` lädt die Liste neu; onShow gleicht ab; destroy meldet die Zeile ab", async () => {
    const { panel, container, llm } = mkPanel();
    await flush();
    const n = llm.models.mock.calls.length;
    panel.refreshModelBar({ models: true });
    await flush();
    expect(llm.models.mock.calls.length).toBeGreaterThan(n);
    panel.onShow();
    expect(all(container, "okit-model-bar").length).toBe(1);
    panel.destroy();
    expect(all(container, "okit-model-bar").length).toBe(0);
  });

  it("die Zeile ist nie gesperrt: die Vorschau ist ein Modal, das Panel ist währenddessen ohnehin nicht bedienbar", async () => {
    const { container } = mkPanel();
    await flush();
    expect(first(container, "okit-model-bar-select").disabled ?? false).toBe(false);
  });
});
