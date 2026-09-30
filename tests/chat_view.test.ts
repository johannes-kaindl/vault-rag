import { describe, it, expect, vi } from "vitest";
import { ChatPanel } from "../src/chat_view";
import { makeFakeEl } from "./__mocks__/obsidian";
import "../src/i18n/strings"; // Register i18n strings

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}


/** Denk-Steuerung-Mock (Kit `thinking-control`): Stufe, Familie und Speicherwirkung je Test einstellbar. */
function mkThinking(over: Partial<{ level: string; family: string | null; onLevel: string; picker: boolean }> = {}) {
  const state = { level: over.level ?? "low" };
  return {
    state,
    deps: {
      family: () => (over.family === undefined ? null : over.family),
      current: () => state.level,
      onLevel: () => over.onLevel ?? "low",
      setLevel: vi.fn(async (l: string) => { state.level = l; }),
      levelPicker: () => over.picker ?? false,
      strings: {
        button: (level: string, offNotPossible: boolean) => level === "off"
          ? (offNotPossible ? `Thinking: ${level} (cannot fully turn off)` : "Thinking off")
          : `Thinking: ${level}`,
        level: (l: string) => l,
        pickerLabel: "Thinking level",
      },
    },
  };
}

async function mkPanel(opts: { send?: any; ping?: any; copyText?: any; listModels?: any; getModel?: any; setModel?: any; inputPosition?: any; thinking?: any; enterSends?: any } = {}) {
  const session: any = {
    messages: [],
    send: opts.send ?? vi.fn(async (q: string, _paths: string[], onToken: (t: string) => void) => {
      session.messages.push({ role: "user", content: q });
      const a: any = { role: "assistant", content: "" }; session.messages.push(a);
      onToken("Ant"); a.content = "Antwort"; a.sources = ["notes/a.md"];
      return { sources: ["notes/a.md"] };
    }),
    abort: vi.fn(), reset: vi.fn(() => { session.messages = []; }),
  };
  const opened: string[] = [];
  const panel = new ChatPanel({
    session, openPath: (p: string) => opened.push(p),
    ping: opts.ping ?? (async () => true),
    copyText: opts.copyText ?? vi.fn(),
    listModels: opts.listModels ?? (async () => []),
    getModel: opts.getModel ?? (() => "qwen3"),
    setModel: opts.setModel ?? vi.fn(),
    inputPosition: opts.inputPosition ?? (() => "bottom"),
    thinking: opts.thinking ?? mkThinking().deps,
    enterSends: opts.enterSends ?? (() => true),
    getActivePath: () => "aktiv.md",
    embed: async () => new Float32Array([1, 0]),
    search: () => ["x.md"],
    pickNote: async () => null,
    autoK: 3,
  });
  const container = makeFakeEl();
  panel.mount(container);
  await (panel as any).initAsync();   // mount() ist synchron; Netzwerk-Init (Status/Modelle) explizit abwarten
  return { panel, container, session, opened };
}

describe("ChatPanel label", () => {
  it("nennt den Tab auf Englisch (Default-Sprache)", async () => {
    const { panel } = await mkPanel();
    expect(panel.label).toBe("Chat");
  });
});

describe("ChatPanel", () => {
  it("id ist 'chat'", async () => {
    expect((await mkPanel()).panel.id).toBe("chat");
  });
  it("submit ruft session.send mit (query, paths, onToken) und rendert", async () => {
    const { panel, container, session, opened } = await mkPanel();
    (panel as any).inputEl.value = "frage";
    await panel.submit();
    expect(session.send).toHaveBeenCalledWith("frage", expect.any(Array), expect.any(Function));
    expect(all(container, "vault-rag-chat-msg").length).toBe(2);
    const chips = all(container, "vault-rag-chat-source");
    expect(chips.length).toBe(1);
    chips[0].click();
    expect(opened).toEqual(["notes/a.md"]);
  });
  it("Multi-Turn: Quellen früherer Turns bleiben", async () => {
    const { panel, container } = await mkPanel();
    (panel as any).inputEl.value = "eins"; await panel.submit();
    (panel as any).inputEl.value = "zwei"; await panel.submit();
    expect(all(container, "vault-rag-chat-source").length).toBe(2);
  });
  it("Fehler-Zustand wird gerendert", async () => {
    const send = vi.fn(async (q: string) => {
      const s: any = (send as any)._s;
      s.messages.push({ role: "user", content: q });
      s.messages.push({ role: "assistant", content: "", error: "Chat-LLM nicht erreichbar (lokal/VPN)." });
      return { sources: [], error: "x" };
    });
    const { panel, container, session } = await mkPanel({ send });
    (send as any)._s = session;
    (panel as any).inputEl.value = "frage";
    await panel.submit();
    expect(all(container, "vault-rag-chat-state").length).toBe(1);
  });
  it("leere Eingabe ruft send nicht", async () => {
    const { panel, session } = await mkPanel();
    (panel as any).inputEl.value = "  ";
    await panel.submit();
    expect(session.send).not.toHaveBeenCalled();
  });
  it("zeigt Verbindungsstatus nach mount", async () => {
    const okP = await mkPanel({ ping: async () => true });
    expect(all(okP.container, "vault-rag-chat-status")[0].textContent).toContain("connected");
    const offP = await mkPanel({ ping: async () => false });
    expect(all(offP.container, "vault-rag-chat-status")[0].textContent).toContain("offline");
  });
  it("Senden-Button wird zu Stop während einer laufenden Anfrage", async () => {
    let finish: () => void = () => {};
    const send = vi.fn(() => new Promise<{ sources: string[] }>(r => { finish = () => r({ sources: [] }); }));
    const { panel, container } = await mkPanel({ send });
    (panel as any).inputEl.value = "frage";
    const p = panel.submit();
    const btn = () => all(container, "vault-rag-chat-send")[0];
    expect(btn().textContent).toBe("Stop");
    finish(); await p;
    expect(btn().textContent).toBe("Send");
  });
  it("Neuer Chat leert den Verlauf und die Anzeige", async () => {
    const { panel, container, session } = await mkPanel();
    (panel as any).inputEl.value = "frage"; await panel.submit();
    expect(all(container, "vault-rag-chat-msg").length).toBeGreaterThan(0);
    panel.newChat();
    expect(session.reset).toHaveBeenCalled();
    expect(all(container, "vault-rag-chat-msg").length).toBe(0);
  });
  it("Kontext-Panel ist gemountet", async () => {
    const { container } = await mkPanel();
    expect(all(container, "vault-rag-ctx-list").length).toBe(1);
  });
  it("rendert aufklappbaren Gedanken-Block, zugeklappt wenn Antwort da", async () => {
    const { panel, container, session } = await mkPanel();
    session.messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "Antwort", reasoning: "weil X" },
    ];
    (panel as any).renderMessages();
    const blocks = all(container, "vault-rag-chat-reasoning");
    expect(blocks.length).toBe(1);
    expect(blocks[0].open).toBe(false);
    expect(all(container, "vault-rag-chat-reasoning-body")[0].textContent).toBe("weil X");
    expect(all(container, "vault-rag-chat-reasoning-sum")[0].textContent).toContain("Thoughts");
  });
  it("Gedanken-Block ist offen + 'denkt nach' während des Denkens", async () => {
    const { panel, container, session } = await mkPanel();
    session.messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "", reasoning: "denke gerade" },
    ];
    (panel as any).renderMessages();
    expect(all(container, "vault-rag-chat-reasoning")[0].open).toBe(true);
    expect(all(container, "vault-rag-chat-reasoning-sum")[0].textContent).toContain("thinking");
  });
  it("kein Gedanken-Block ohne reasoning", async () => {
    const { panel, container, session } = await mkPanel();
    session.messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "Antwort" },
    ];
    (panel as any).renderMessages();
    expect(all(container, "vault-rag-chat-reasoning").length).toBe(0);
  });
  it("Eingabezeile ist das letzte Element (unten fixiert)", async () => {
    const { container } = await mkPanel();
    const kids = container.children;
    expect(String(kids[kids.length - 1].className)).toContain("vault-rag-chat-input-row");
  });
  it("Senden-Button nutzt Obsidians mod-cta-Stil", async () => {
    const { container } = await mkPanel();
    expect(String(all(container, "vault-rag-chat-send")[0].className)).toContain("mod-cta");
  });
  it("Kopier-Button an der Antwort kopiert den Antworttext", async () => {
    const copyText = vi.fn();
    const { panel, container, session } = await mkPanel({ copyText });
    session.messages = [
      { role: "user", content: "frage" },
      { role: "assistant", content: "Die Antwort." },
    ];
    (panel as any).renderMessages();
    const btns = all(container, "vault-rag-chat-copy");
    expect(btns.length).toBe(1);
    btns[0].click();
    expect(copyText).toHaveBeenCalledWith("Die Antwort.");
  });
  it("kein Kopier-Button an der User-Nachricht", async () => {
    const { panel, container, session } = await mkPanel();
    session.messages = [{ role: "user", content: "frage" }];
    (panel as any).renderMessages();
    expect(all(container, "vault-rag-chat-copy").length).toBe(0);
  });
  it("Modell-Switcher ruft setModel bei Auswahl", async () => {
    const setModel = vi.fn();
    const { container } = await mkPanel({ setModel, listModels: async () => ["a", "b"] });
    const sel = all(container, "vault-rag-chat-model")[0];
    expect(sel).toBeTruthy();
    sel.value = "b";
    (sel._listeners["change"] ?? []).forEach((cb: any) => cb());
    expect(setModel).toHaveBeenCalledWith("b");
  });
  it("inputPosition 'top' rendert die Eingabe vor den Nachrichten", async () => {
    const { container } = await mkPanel({ inputPosition: () => "top" });
    const kids: any[] = Array.from(container.children);
    const idxInput = kids.findIndex(k => String(k.className).includes("vault-rag-chat-input-row"));
    const idxMsgs = kids.findIndex(k => String(k.className).includes("vault-rag-chat-messages"));
    expect(idxInput).toBeGreaterThanOrEqual(0);
    expect(idxInput).toBeLessThan(idxMsgs);
  });
  it("Eingabe ist eine Textarea", async () => {
    const { panel } = await mkPanel();
    expect(String((panel as any).inputEl.tagName)).toBe("TEXTAREA");
  });
  it("Enter sendet, Shift+Enter nicht (enterSends=true)", async () => {
    const { panel, session } = await mkPanel();
    (panel as any).inputEl.value = "frage";
    const ta = (panel as any).inputEl;
    const ev = (over: any) => ({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, preventDefault: () => {}, ...over });
    (ta._listeners["keydown"] ?? []).forEach((cb: any) => cb(ev({ shiftKey: true })));
    expect(session.send).not.toHaveBeenCalled();
    (ta._listeners["keydown"] ?? []).forEach((cb: any) => cb(ev({})));
    expect(session.send).toHaveBeenCalled();
  });
  it("sendet nicht während IME-Komposition", async () => {
    const { panel, session } = await mkPanel();
    (panel as any).inputEl.value = "字";
    const ta = (panel as any).inputEl;
    (ta._listeners["keydown"] ?? []).forEach((cb: any) =>
      cb({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: true, preventDefault: () => {} }));
    expect(session.send).not.toHaveBeenCalled();
  });
  it("enterSends=false: Enter macht keine Sendung, Shift+Enter schon", async () => {
    const { panel, session } = await mkPanel({ enterSends: () => false });
    (panel as any).inputEl.value = "frage";
    const ta = (panel as any).inputEl;
    const ev = (over: any) => ({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, preventDefault: () => {}, ...over });
    (ta._listeners["keydown"] ?? []).forEach((cb: any) => cb(ev({})));
    expect(session.send).not.toHaveBeenCalled();
    (ta._listeners["keydown"] ?? []).forEach((cb: any) => cb(ev({ shiftKey: true })));
    expect(session.send).toHaveBeenCalled();
  });
  it("Thinking-Toggle: Klick bei „an“ ruft setLevel(off), bei „aus“ setLevel(onLevel)", async () => {
    const on = mkThinking({ level: "low" });
    const a = await mkPanel({ thinking: on.deps });
    all(a.container, "okit-thinking-toggle")[0].click();
    expect(on.deps.setLevel).toHaveBeenCalledWith("off");
    const off = mkThinking({ level: "off", onLevel: "medium" });
    const b = await mkPanel({ thinking: off.deps });
    all(b.container, "okit-thinking-toggle")[0].click();
    expect(off.deps.setLevel).toHaveBeenCalledWith("medium");
  });
  it("Thinking-Toggle zeigt den Zustand über Icon, Text UND aria-pressed (UI-STANDARD §8)", async () => {
    const { container } = await mkPanel({ thinking: mkThinking({ level: "low" }).deps });
    const toggle = all(container, "okit-thinking-toggle")[0];
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.children[0].getAttribute("data-icon")).toBe("brain-cog");
    expect(toggle.textContent).toContain("Thinking: low");
  });
  it("Thinking-Toggle: ausgeschaltet zeigt brain UND aria-pressed=false", async () => {
    const { container } = await mkPanel({ thinking: mkThinking({ level: "off" }).deps });
    const toggle = all(container, "okit-thinking-toggle")[0];
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.children[0].getAttribute("data-icon")).toBe("brain");
    expect(toggle.textContent).toContain("Thinking off");
  });
  it("Familie, die das Denken nicht abschalten kann (gpt-oss): der Text sagt es, der Knopf bleibt bedienbar", async () => {
    const { container } = await mkPanel({ thinking: mkThinking({ level: "off", family: "gpt-oss" }).deps });
    const toggle = all(container, "okit-thinking-toggle")[0];
    expect(toggle.textContent).toContain("cannot fully turn off");
  });
  it("onShow zeichnet die Denk-Steuerung neu (die Stufe kann in den Einstellungen geändert worden sein)", async () => {
    const t = mkThinking({ level: "off" });
    const { panel, container } = await mkPanel({ thinking: t.deps });
    expect(all(container, "okit-thinking-toggle")[0].textContent).toContain("Thinking off");
    t.state.level = "medium";
    panel.onShow();
    expect(all(container, "okit-thinking-toggle")[0].textContent).toContain("Thinking: medium");
  });
  it("ein Modellwechsel zeichnet die Denk-Steuerung neu (die Familie kann sich geändert haben)", async () => {
    let fam: string | null = null;
    const t = mkThinking({ level: "off" });
    t.deps.family = () => fam;
    const { container } = await mkPanel({ thinking: t.deps, listModels: async () => ["a", "b"] });
    expect(all(container, "okit-thinking-toggle")[0].textContent).toContain("Thinking off");
    fam = "gpt-oss";
    const sel = all(container, "vault-rag-chat-model")[0];
    sel.value = "b";
    (sel._listeners?.change ?? []).forEach((cb: any) => cb());
    expect(all(container, "okit-thinking-toggle")[0].textContent).toContain("cannot fully turn off");
  });
});
