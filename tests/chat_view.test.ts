import { describe, it, expect, vi } from "vitest";
import { ChatView, VIEW_TYPE_CHAT } from "../src/chat_view";
import { makeFakeApp } from "./__mocks__/obsidian";

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}

function mkView(opts: { send?: any; ping?: any } = {}) {
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
  const view = new ChatView({ app: makeFakeApp() } as any, {
    session, openPath: (p: string) => opened.push(p),
    ping: opts.ping ?? (async () => true),
    getActivePath: () => "aktiv.md",
    embed: async () => new Float32Array([1, 0]),
    search: () => ["x.md"],
    pickNote: async () => null,
    autoK: 3,
  });
  return { view, session, opened };
}

describe("ChatView", () => {
  it("getViewType ist VIEW_TYPE_CHAT", () => {
    expect(mkView().view.getViewType()).toBe(VIEW_TYPE_CHAT);
  });
  it("submit ruft session.send mit (query, paths, onToken) und rendert", async () => {
    const { view, session, opened } = mkView();
    await view.onOpen();
    (view as any).inputEl.value = "frage";
    await view.submit();
    expect(session.send).toHaveBeenCalledWith("frage", expect.any(Array), expect.any(Function));
    expect(all(view.contentEl, "vault-rag-chat-msg").length).toBe(2);
    const chips = all(view.contentEl, "vault-rag-chat-source");
    expect(chips.length).toBe(1);
    chips[0].click();
    expect(opened).toEqual(["notes/a.md"]);
  });
  it("Multi-Turn: Quellen früherer Turns bleiben", async () => {
    const { view } = mkView();
    await view.onOpen();
    (view as any).inputEl.value = "eins"; await view.submit();
    (view as any).inputEl.value = "zwei"; await view.submit();
    expect(all(view.contentEl, "vault-rag-chat-source").length).toBe(2);
  });
  it("Fehler-Zustand wird gerendert", async () => {
    const send = vi.fn(async (q: string) => {
      const s: any = (send as any)._s;
      s.messages.push({ role: "user", content: q });
      s.messages.push({ role: "assistant", content: "", error: "Chat-LLM nicht erreichbar (lokal/VPN)." });
      return { sources: [], error: "x" };
    });
    const { view, session } = mkView({ send });
    (send as any)._s = session;
    await view.onOpen();
    (view as any).inputEl.value = "frage";
    await view.submit();
    expect(all(view.contentEl, "vault-rag-chat-state").length).toBe(1);
  });
  it("leere Eingabe ruft send nicht", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    (view as any).inputEl.value = "  ";
    await view.submit();
    expect(session.send).not.toHaveBeenCalled();
  });
  it("zeigt Verbindungsstatus nach onOpen", async () => {
    const okV = mkView({ ping: async () => true });
    await okV.view.onOpen();
    expect(all(okV.view.contentEl, "vault-rag-chat-status")[0].textContent).toContain("verbunden");
    const offV = mkView({ ping: async () => false });
    await offV.view.onOpen();
    expect(all(offV.view.contentEl, "vault-rag-chat-status")[0].textContent).toContain("offline");
  });
  it("Senden-Button wird zu Stop während einer laufenden Anfrage", async () => {
    let finish: () => void = () => {};
    const send = vi.fn(() => new Promise<{ sources: string[] }>(r => { finish = () => r({ sources: [] }); }));
    const { view } = mkView({ send });
    await view.onOpen();
    (view as any).inputEl.value = "frage";
    const p = view.submit();
    const btn = () => all(view.contentEl, "vault-rag-chat-send")[0];
    expect(btn().textContent).toBe("Stop");
    finish(); await p;
    expect(btn().textContent).toBe("Senden");
  });
  it("Neuer Chat leert den Verlauf und die Anzeige", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    (view as any).inputEl.value = "frage"; await view.submit();
    expect(all(view.contentEl, "vault-rag-chat-msg").length).toBeGreaterThan(0);
    view.newChat();
    expect(session.reset).toHaveBeenCalled();
    expect(all(view.contentEl, "vault-rag-chat-msg").length).toBe(0);
  });
  it("Kontext-Panel ist gemountet", async () => {
    const { view } = mkView();
    await view.onOpen();
    expect(all(view.contentEl, "vault-rag-ctx-list").length).toBe(1);
  });
  it("rendert aufklappbaren Gedanken-Block, zugeklappt wenn Antwort da", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    session.messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "Antwort", reasoning: "weil X" },
    ];
    (view as any).renderMessages();
    const blocks = all(view.contentEl, "vault-rag-chat-reasoning");
    expect(blocks.length).toBe(1);
    expect(blocks[0].open).toBe(false);
    expect(all(view.contentEl, "vault-rag-chat-reasoning-body")[0].textContent).toBe("weil X");
    expect(all(view.contentEl, "vault-rag-chat-reasoning-sum")[0].textContent).toContain("Gedanken");
  });
  it("Gedanken-Block ist offen + 'denkt nach' während des Denkens", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    session.messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "", reasoning: "denke gerade" },
    ];
    (view as any).renderMessages();
    expect(all(view.contentEl, "vault-rag-chat-reasoning")[0].open).toBe(true);
    expect(all(view.contentEl, "vault-rag-chat-reasoning-sum")[0].textContent).toContain("denkt nach");
  });
  it("kein Gedanken-Block ohne reasoning", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    session.messages = [
      { role: "user", content: "q" },
      { role: "assistant", content: "Antwort" },
    ];
    (view as any).renderMessages();
    expect(all(view.contentEl, "vault-rag-chat-reasoning").length).toBe(0);
  });
});
