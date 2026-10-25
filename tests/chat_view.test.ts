import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { ChatPanel } from "../src/chat_view";
import { ChatHttpError, ChatNetworkError, ChatNoEndpointError, ChatTimeoutError } from "../src/chat_error";
import { makeFakeEl } from "./__mocks__/obsidian";
import { setLang } from "../src/vendor/kit/i18n";
import "../src/i18n/strings"; // Register i18n strings

// Jede gebaute Modellzeile wird mitgezählt (Pass-through): der Test zur Abmelde-Rückgabe liest, wie oft `destroy` an welcher Zeile ankam.
const bars = vi.hoisted(() => ({ made: [] as { destroy: { mock: { calls: unknown[] } } }[] }));
vi.mock("../src/vendor/kit-obsidian/model-bar", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/vendor/kit-obsidian/model-bar")>();
  return { ...real, buildModelBar: (o: Parameters<typeof real.buildModelBar>[0]) => { const b = real.buildModelBar(o); bars.made.push({ destroy: vi.spyOn(b, "destroy") }); return b; } };
});

// Das Kit-Fenster nimmt seine Uhr aus `window` (Renderer); die Testumgebung ist Node.
beforeAll(() => { vi.stubGlobal("window", globalThis); });
afterEach(() => { vi.useRealTimers(); setLang("en"); });

/** Denk-Steuerung-Mock (Kit `thinking-control`). */
type Level = "off" | "low" | "medium" | "high";
function mkThinking() {
  const state: { level: Level } = { level: "low" };
  return {
    state,
    deps: {
      family: () => null,
      current: () => state.level,
      onLevel: (): Level => "low",
      setLevel: vi.fn(async (l: Level) => { state.level = l; }),
      levelPicker: () => false,
      strings: {
        button: (level: Level) => (level === "off" ? "Thinking off" : `Thinking: ${level}`),
        level: (l: Level) => l,
        pickerLabel: "Thinking level",
      },
    },
  };
}

type Stream = (msgs: any[], onC: (t: string) => void, onR: (t: string) => void, signal: AbortSignal, opts: any) => Promise<any>;

function mkPanel(opts: { stream?: Stream; assemble?: any; inputPosition?: () => "top" | "bottom"; enterSends?: () => boolean; embed?: any; search?: any } = {}) {
  const stream = vi.fn<Parameters<Stream>, ReturnType<Stream>>(opts.stream ?? (async (_m, onC) => { onC("Ant"); onC("wort"); return { content: "Antwort", reasoning: "" }; }));
  const opened: string[] = [];
  const thinking = mkThinking();
  const llm = {
    models: vi.fn(async () => ({ models: ["m1", "m2"], reachable: true })),
    setModel: vi.fn(async (_m: string) => {}),
    modelInUse: () => "m1",
    source: () => ({ family: null, model: "m1", sentModel: "m1", kind: "local" }),
  };
  const assemble = opts.assemble ?? vi.fn(async (paths: string[]) => ({ text: paths.map((p) => `## ${p}\nINHALT`).join("\n\n"), sources: paths }));
  const embed = opts.embed ?? vi.fn(async () => new Float32Array([1, 0]));
  const search = opts.search ?? vi.fn(() => ["auto.md"]);
  const panel = new ChatPanel({
    app: { plugins: { plugins: {} } } as never,
    llm: llm as never,
    client: () => ({ stream }) as never,
    assemble,
    systemPreamble: (hasContext: boolean) => (hasContext ? "MIT-KONTEXT" : "OHNE-KONTEXT"),
    model: () => "mx",
    openPath: (p: string) => opened.push(p),
    inputPosition: opts.inputPosition ?? (() => "bottom"),
    thinking: thinking.deps,
    enterSends: opts.enterSends ?? (() => true),
    renderMarkdown: vi.fn(async (el: any, md: string) => { el.setText(md); }),
    getActivePath: () => "aktiv.md",
    embed, search,
    pickNote: async () => null,
    autoK: 3,
    domGuard: false,
  });
  const container = makeFakeEl() as any;
  panel.mount(container);
  return { panel, container, stream, llm, assemble, embed, search, opened, thinking };
}
type Ctx = ReturnType<typeof mkPanel>;

const all = (c: any, sel: string): any[] => c.querySelectorAll(sel);
const text = (c: any): string => c.textContent as string;
const input = (c: any): any => all(c, ".okit-chat-input")[0];
/** Sendet eine Frage über den Knopf und wartet, bis die Runde fertig ist (eine weitere Antwort steht da, der Knopf heißt wieder „Send“). */
const ask = async (x: Ctx, q = "Frage?"): Promise<void> => {
  const before = all(x.container, ".is-assistant").length;
  input(x.container).value = q;
  all(x.container, ".okit-chat-send")[0].click();
  await vi.waitFor(() => { expect(all(x.container, ".is-assistant").length).toBe(before + 1); });
  await vi.waitFor(() => { expect(all(x.container, ".okit-chat-send")[0].textContent).toBe("Send"); });
};
const key = (el: any, k: string, mods: Record<string, boolean> = {}) => {
  const ev = { type: "keydown", key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...mods };
  el.dispatchEvent(ev);
  return ev;
};
/** Das Fake-DOM lässt Ereignisse nicht bubbeln; im Renderer erreicht `input` die Wurzel von selbst. */
const typeInto = (x: Ctx, value: string): void => {
  const el = input(x.container);
  el.value = value;
  const root = all(x.container, ".okit-chat")[0];
  root.dispatchEvent({ type: "input", target: el });
};

describe("ChatPanel", () => {
  it("id und Beschriftung", () => {
    const { panel } = mkPanel();
    expect(panel.id).toBe("chat");
    expect(panel.label).toBe("Chat");
  });

  it("der Wirt trägt die Klasse, die dem Fenster eine begrenzte Höhe gibt", () => {
    const { container } = mkPanel();
    expect(container.hasClass("vault-rag-chat-host")).toBe(true);
    expect(all(container, ".okit-chat").length).toBe(1);
  });

  describe("send", () => {
    it("die Anfrage trägt Prompt und Kontext im System, die Frage zuletzt; Modell, Modus und Tracing kommen mit", async () => {
      const x = mkPanel();
      await ask(x, "Wie geht das?");
      const [msgs, , , signal, opts] = x.stream.mock.calls[0]!;
      expect(msgs.map((m: any) => m.role)).toEqual(["system", "user"]);
      expect(msgs[1]).toEqual({ role: "user", content: "Wie geht das?" });
      expect(msgs[0].content.startsWith("OHNE-KONTEXT")).toBe(true);   // keine Notiz gewählt, kein Kontext
      expect(signal.aborted).toBe(false);
      expect(opts.model).toBe("mx");
      expect(opts.mode).toBe("grounded");
      expect(typeof opts.onContentReset).toBe("function");
    });

    it("das llm-lab-Tracing kommt an: feature chat, die Quellen als contextPaths, nur der Preamble als promptTemplate, eine turnId je Frage", async () => {
      const x = mkPanel();
      x.panel.onShow();
      // gepinnte Notiz über den Kontext-Panel-Weg: die Quelle geht als contextPaths mit
      const pinned = (x.panel as any).panel as { pin(p: string): void };
      pinned.pin("a.md");
      await ask(x, "eins");
      await ask(x, "zwei");
      const traces = x.stream.mock.calls.map((c) => c[4].trace);
      expect(traces[0]).toMatchObject({ feature: "chat", contextPaths: ["a.md"], promptTemplate: "MIT-KONTEXT", turnId: expect.any(String) });
      expect(traces[0].app).toBeDefined();
      expect(traces[0].promptTemplate).not.toContain("INHALT");
      expect(traces[1].turnId).not.toBe(traces[0].turnId);
      expect(x.stream.mock.calls[0]![0][0].content).toContain("## a.md\nINHALT");
    });

    it("frühere Runden gehen mit Frage und Antwort mit, nie erneut mit Kontext", async () => {
      const x = mkPanel();
      await ask(x, "eins");
      await ask(x, "zwei");
      const second = x.stream.mock.calls[1]![0].map((m: any) => `${m.role}:${m.content}`);
      expect(second.slice(1)).toEqual(["user:eins", "assistant:Antwort", "user:zwei"]);
    });

    it("eine abgebrochene oder gescheiterte Antwort geht nicht als Verlauf ans Modell", async () => {
      let n = 0;
      const x = mkPanel({ stream: async () => { if (++n === 1) throw new ChatNetworkError(); return { content: "ok", reasoning: "" }; } });
      await ask(x, "Qf");
      await ask(x, "Qn");
      expect(x.stream.mock.calls[1]![0].filter((m: any) => m.role === "user").map((m: any) => m.content)).toEqual(["Qn"]);
    });

    it("Reasoning und Content-Reset des Clients erreichen das Fenster", async () => {
      const x = mkPanel({
        stream: async (_m, onC, onR, _s, o) => {
          onC("Thinking Process: …");
          o.onContentReset();
          onR("denke");
          onC("Antwort");
          return { content: "Antwort", reasoning: "denke" };
        },
      });
      await ask(x);
      expect(text(x.container)).toContain("Antwort");
      expect(text(x.container)).not.toContain("Thinking Process");
      expect(text(x.container)).toContain("denke");
    });

    it("ein Abschneiden am Token-Limit sagt das Fenster (finishReason length)", async () => {
      const x = mkPanel({ stream: async (_m, onC) => { onC("halb"); return { content: "halb", reasoning: "", finishReason: "length" }; } });
      await ask(x);
      expect(text(x.container)).toContain("cut off");
    });

    it("eine leere Antwort ist eine Fehlerzeile, kein stiller Erfolg", async () => {
      const x = mkPanel({ stream: async () => ({ content: "", reasoning: "" }) });
      await ask(x);
      expect(all(x.container, ".okit-chat-error")[0].textContent).toContain("Empty response");
    });
  });

  describe("Fehlerabbildung (der Client wirft, das Fenster erwartet ein Ergebnis)", () => {
    it("HTTP: die Begründung des Servers bleibt in der Fehlerzeile, mit dem Status", async () => {
      const x = mkPanel({ stream: async () => { throw new ChatHttpError(401, '{"detail":"Not authenticated"}'); } });
      await ask(x);
      const line = all(x.container, ".okit-chat-error")[0].textContent as string;
      expect(line).toContain("401");
      expect(line).toContain("Not authenticated");
    });

    it("HTTP 400: der Grund (fehlender Modellname) steht da", async () => {
      const x = mkPanel({ stream: async () => { throw new ChatHttpError(400, '{"error":{"message":"model not found"}}'); } });
      await ask(x);
      expect(all(x.container, ".okit-chat-error")[0].textContent).toContain("model not found");
    });

    it("Timeout nennt die Frist in Sekunden", async () => {
      const x = mkPanel({ stream: async () => { throw new ChatTimeoutError(120); } });
      await ask(x);
      expect(all(x.container, ".okit-chat-error")[0].textContent).toContain("120");
    });

    it("kein Endpunkt und Netzfehler haben je ihre eigene Zeile", async () => {
      const a = mkPanel({ stream: async () => { throw new ChatNoEndpointError(); } });
      await ask(a);
      const noEp = all(a.container, ".okit-chat-error")[0].textContent as string;
      const b = mkPanel({ stream: async () => { throw new ChatNetworkError(); } });
      await ask(b);
      const net = all(b.container, ".okit-chat-error")[0].textContent as string;
      // Mit Detail steht eine Zeile des Transports dahinter (Kit 0.70.0, geschwärzt und gekürzt vom Kit).
      const d = mkPanel({ stream: async () => { throw new ChatNetworkError("fetch failed: connect ECONNREFUSED 127.0.0.1:1234"); } });
      await ask(d);
      expect(all(d.container, ".okit-chat-error")[0].textContent as string).toContain("ECONNREFUSED 127.0.0.1:1234");
      expect(net).not.toContain("ECONNREFUSED");
      expect(noEp).not.toBe(net);
      expect(net).toContain("Could not reach the endpoint");
    });

    it("ein Abbruch ist keine Fehlerzeile, sondern „Stopped.“ (Escape bricht ab)", async () => {
      const x = mkPanel({
        stream: (_m, _c, _r, signal) => new Promise((_res, rej) => { signal.addEventListener("abort", () => { const e = new Error("Aborted"); e.name = "AbortError"; rej(e); }); }),
      });
      input(x.container).value = "Frage?";
      const pending = x.container.querySelectorAll(".okit-chat-send")[0].click();
      await vi.waitFor(() => { expect(x.stream).toHaveBeenCalled(); });
      key(input(x.container), "Escape");
      await pending;
      await vi.waitFor(() => { expect(text(x.container)).toContain("Stopped."); });
      expect(x.stream.mock.calls[0]![3].aborted).toBe(true);
      expect(all(x.container, ".okit-chat-error").length).toBe(0);
    });

    it("ein Unbekanntes wird nicht erfunden: das Fenster zeigt die Nachricht", async () => {
      const x = mkPanel({ stream: async () => { throw new Error("boom"); } });
      await ask(x);
      expect(all(x.container, ".okit-chat-error")[0].textContent).toContain("boom");
    });

    it("ein Kontext, der nicht zu laden ist, wird eine Fehlerzeile der Runde; die Frage geht nicht ans Modell", async () => {
      const x = mkPanel({ assemble: vi.fn(async () => { throw new Error("ctx weg"); }) });
      await ask(x);
      expect(x.stream).not.toHaveBeenCalled();
      expect(all(x.container, ".okit-chat-error")[0].textContent).toContain("Could not load context.");
    });
  });

  describe("Quellen unter der Antwort", () => {
    it("stehen als Chips unter einer fertigen Antwort, ein Klick öffnet die Notiz", async () => {
      const x = mkPanel();
      (x.panel as any).panel.pin("ordner/Notiz eins.md");
      await ask(x);
      const chips = all(x.container, ".vault-rag-chat-source");
      expect(chips.length).toBe(1);
      expect(chips[0].textContent).toContain("Notiz eins");
      chips[0].click();
      expect(x.opened).toEqual(["ordner/Notiz eins.md"]);
    });

    it("an einer gescheiterten Runde stehen keine", async () => {
      const x = mkPanel({ stream: async () => { throw new ChatNetworkError(); } });
      (x.panel as any).panel.pin("a.md");
      await ask(x);
      expect(all(x.container, ".vault-rag-chat-source").length).toBe(0);
    });

    it("ohne Kontext keine Zeile", async () => {
      const x = mkPanel();
      await ask(x);
      expect(all(x.container, ".vault-rag-chat-sources").length).toBe(0);
    });
  });

  describe("Auto-Kontext beim Tippen", () => {
    it("das input-Ereignis des Textfelds startet nach 400 ms die Suche, jedes weitere setzt die Frist zurück", async () => {
      vi.useFakeTimers();
      const x = mkPanel();
      typeInto(x, "retrieval");
      await vi.advanceTimersByTimeAsync(399);
      expect(x.embed).not.toHaveBeenCalled();
      typeInto(x, "retrieval augmented");
      await vi.advanceTimersByTimeAsync(399);
      expect(x.embed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(x.embed).toHaveBeenCalledTimes(1);
      expect(x.embed).toHaveBeenCalledWith("retrieval augmented");
      expect(text(x.container)).toContain("auto");   // der Treffer steht als Chip da
    });

    it("andere input-Ziele im Wurzelknoten (der Auto-Kontext liegt im selben Knoten) lösen keine Suche aus", async () => {
      vi.useFakeTimers();
      const x = mkPanel();
      const root = all(x.container, ".okit-chat")[0];
      root.dispatchEvent({ type: "input", target: makeFakeEl() });
      await vi.advanceTimersByTimeAsync(1000);
      expect(x.embed).not.toHaveBeenCalled();
    });

    it("Senden nimmt die Chips mit, setzt sie zurück und löscht die Entprellung: nach dem Senden feuert nichts mit dem alten Text nach", async () => {
      vi.useFakeTimers();
      const x = mkPanel();
      typeInto(x, "retrieval");
      await vi.advanceTimersByTimeAsync(401);
      expect(x.embed).toHaveBeenCalledTimes(1);
      typeInto(x, "retrieval mehr");   // Entprellung läuft
      const send = all(x.container, ".okit-chat-send")[0].click();
      await vi.advanceTimersByTimeAsync(1);
      await send;
      await vi.advanceTimersByTimeAsync(1000);
      expect(x.assemble).toHaveBeenCalledWith(["auto.md"]);   // die Chips gingen mit
      expect(x.embed).toHaveBeenCalledTimes(1);               // die Entprellung feuerte nicht nach
    });

    it("nach dem Senden kommen die weggeklickten Auto-Treffer wieder in Frage (der Kontext-Panel wird zurückgesetzt)", async () => {
      const x = mkPanel();
      const p = (x.panel as any).panel;
      p.excludeAuto("auto.md");
      expect(p.excluded.has("auto.md")).toBe(true);
      await ask(x);
      expect(p.excluded.size).toBe(0);
    });

    it("Pause und Fortsetzen erreichen den Kontext-Panel", () => {
      const x = mkPanel();
      const p = (x.panel as any).panel;
      const pause = vi.spyOn(p, "onPause");
      const resume = vi.spyOn(p, "onResume");
      x.panel.onEmbeddingPause(true);
      x.panel.onEmbeddingPause(false);
      expect(pause).toHaveBeenCalledTimes(1);
      expect(resume).toHaveBeenCalledTimes(1);
    });
  });

  describe("Eingabe", () => {
    it("Enter sendet, Umschalt+Enter nicht (enterSends = true)", async () => {
      const x = mkPanel();
      input(x.container).value = "Frage?";
      expect(key(input(x.container), "Enter", { shiftKey: true }).defaultPrevented).toBe(false);
      expect(x.stream).not.toHaveBeenCalled();
      expect(key(input(x.container), "Enter").defaultPrevented).toBe(true);
      await vi.waitFor(() => { expect(x.stream).toHaveBeenCalledTimes(1); });
    });

    it("enterSends = false kehrt um: Enter macht eine Zeile, Umschalt+Enter sendet", async () => {
      const x = mkPanel({ enterSends: () => false });
      input(x.container).value = "Frage?";
      expect(key(input(x.container), "Enter").defaultPrevented).toBe(false);
      expect(x.stream).not.toHaveBeenCalled();
      expect(key(input(x.container), "Enter", { shiftKey: true }).defaultPrevented).toBe(true);
      await vi.waitFor(() => { expect(x.stream).toHaveBeenCalledTimes(1); });
    });

    it("inputPosition „top“ setzt die Eingabe vor den Verlauf", () => {
      const x = mkPanel({ inputPosition: () => "top" });
      const root = all(x.container, ".okit-chat")[0];
      const order = root.children.map((c: any) => String(c.className ?? ""));
      const iComposer = order.findIndex((c: string) => c.includes("okit-chat-composer"));
      const iLog = order.findIndex((c: string) => c.includes("okit-chat-log"));
      expect(iComposer).toBeGreaterThanOrEqual(0);
      expect(iComposer).toBeLessThan(iLog);
    });

    it("das Textfeld trägt den Platzhalter des Plugins", () => {
      const { container } = mkPanel();
      expect(input(container).placeholder ?? input(container).getAttribute("placeholder")).toBe("Ask your vault…");
    });
  });

  describe("Modellzeile", () => {
    it("steht im Kopf des Fensters mit dem Namen „Chat“, die Denk-Steuerung ist in ihr, es gibt keinen zweiten Knopf", () => {
      const { container } = mkPanel();
      const header = all(container, ".okit-chat-header")[0];
      expect(header.querySelectorAll(".okit-model-bar").length).toBe(1);
      expect(header.querySelector(".okit-model-bar-label").textContent).toBe("Chat");
      expect(all(container, ".okit-thinking-control").length).toBe(1);
      expect(all(container, ".okit-model-bar")[0].querySelectorAll(".okit-thinking-control").length).toBe(1);
      expect(all(container, ".vault-rag-chat-model").length).toBe(0);
    });

    it("ein Wechsel im Dropdown ruft setModel der Chat-Verbindung", async () => {
      const x = mkPanel();
      const select = all(x.container, ".okit-model-bar-select")[0];
      await vi.waitFor(() => { expect(select.querySelectorAll("option").length).toBeGreaterThan(2); });
      select.value = "m2";
      select.dispatchEvent({ type: "change" });
      await vi.waitFor(() => { expect(x.llm.setModel).toHaveBeenCalledWith("m2"); });
    });

    it("ein Neuzeichnen des Kopfs meldet die alte Zeile genau einmal ab (Abmelde-Rückgabe des Kits), `destroy` die letzte", () => {
      bars.made.length = 0;
      const x = mkPanel();
      expect(bars.made.length).toBe(1);
      (x.panel as any).win.refresh();
      expect(bars.made.length).toBe(2);
      expect(bars.made[0]!.destroy.mock.calls.length).toBe(1);
      expect(bars.made[1]!.destroy.mock.calls.length).toBe(0);
      x.panel.destroy();
      expect(bars.made[1]!.destroy.mock.calls.length).toBe(1);
      expect(bars.made[0]!.destroy.mock.calls.length).toBe(1);
    });

    it("sperrt sich während eines Laufs und gibt sich danach frei", async () => {
      let release: (r: any) => void = () => {};
      const x = mkPanel({ stream: () => new Promise((resolve) => { release = resolve; }) });
      const select = (): any => all(x.container, ".okit-model-bar-select")[0];
      expect(select().disabled ?? false).toBe(false);
      input(x.container).value = "Frage?";
      const pending = all(x.container, ".okit-chat-send")[0].click();
      await vi.waitFor(() => { expect(x.stream).toHaveBeenCalled(); });
      expect(select().disabled).toBe(true);
      release({ content: "fertig", reasoning: "" });
      await pending;
      await vi.waitFor(() => { expect(select().disabled ?? false).toBe(false); });
    });

    it("onShow und refreshModelBar zeichnen die Zeile neu (Stufe und Modell können sich in den Einstellungen geändert haben); `models` lädt die Liste neu", async () => {
      const x = mkPanel();
      expect(text(x.container)).toContain("Thinking: low");
      x.thinking.state.level = "high";
      x.panel.onShow();
      expect(text(x.container)).toContain("Thinking: high");
      x.thinking.state.level = "off";
      x.panel.refreshModelBar();
      expect(text(x.container)).toContain("Thinking off");
      await new Promise((r) => setTimeout(r, 0));
      const before = x.llm.models.mock.calls.length;
      x.panel.refreshModelBar({ models: true });
      await new Promise((r) => setTimeout(r, 0));
      expect(x.llm.models.mock.calls.length).toBeGreaterThan(before);
    });
  });

  describe("mount nach destroy (Tab-Wechsel im Hub: dieselbe Instanz)", () => {
    it("der Verlauf bleibt, es gibt genau ein Fenster und genau eine Modellzeile", async () => {
      const x = mkPanel();
      await ask(x, "eins");
      expect(text(x.container)).toContain("eins");
      x.panel.destroy();
      x.panel.mount(x.container);
      expect(all(x.container, ".okit-chat").length).toBe(1);
      expect(all(x.container, ".okit-model-bar").length).toBe(1);
      expect(text(x.container)).toContain("eins");
      expect(text(x.container)).toContain("Antwort");
      await ask(x, "zwei");
      expect(x.stream.mock.calls[1]![0].map((m: any) => m.content)).toContain("eins");
    });

    it("destroy löscht die Entprellung: danach läuft keine Suche mehr", async () => {
      vi.useFakeTimers();
      const x = mkPanel();
      typeInto(x, "retrieval");
      x.panel.destroy();
      await vi.advanceTimersByTimeAsync(1000);
      expect(x.embed).not.toHaveBeenCalled();
    });
  });
});
