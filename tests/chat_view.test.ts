import { describe, it, expect, vi } from "vitest";
import { ChatView, VIEW_TYPE_CHAT } from "../src/chat_view";
import { makeFakeApp } from "./__mocks__/obsidian";

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}

function mkView(opts: { send?: any; activePath?: string | null } = {}) {
  const session: any = {
    mode: "auto-rag", picked: [], messages: [],
    send: opts.send ?? vi.fn(async (q: string, onToken: (t: string) => void) => {
      session.messages.push({ role: "user", content: q });
      const a: any = { role: "assistant", content: "" }; session.messages.push(a);
      onToken("Ant"); a.content = "Ant"; onToken("wort"); a.content = "Antwort"; a.sources = ["notes/a.md"];
      return { sources: ["notes/a.md"] };
    }),
    abort: vi.fn(),
  };
  const opened: string[] = [];
  const view = new ChatView({ app: makeFakeApp() } as any, {
    session, openPath: (p: string) => opened.push(p),
    getActivePath: () => (opts.activePath !== undefined ? opts.activePath : "aktiv.md"),
  });
  return { view, session, opened };
}

describe("ChatView", () => {
  it("getViewType ist VIEW_TYPE_CHAT", () => {
    expect(mkView().view.getViewType()).toBe(VIEW_TYPE_CHAT);
  });
  it("submit rendert user+assistant und Quellen-Chip", async () => {
    const { view, session, opened } = mkView();
    await view.onOpen();
    (view as any).inputEl.value = "frage";
    await view.submit();
    expect(session.send).toHaveBeenCalled();
    expect(all(view.contentEl, "vault-rag-chat-msg").length).toBe(2);
    const chips = all(view.contentEl, "vault-rag-chat-source");
    expect(chips.length).toBe(1);
    chips[0].click();
    expect(opened).toEqual(["notes/a.md"]);
  });
  it("Multi-Turn: Quellen früherer Turns bleiben erhalten", async () => {
    const { view } = mkView();
    await view.onOpen();
    (view as any).inputEl.value = "eins"; await view.submit();
    (view as any).inputEl.value = "zwei"; await view.submit();
    expect(all(view.contentEl, "vault-rag-chat-msg").length).toBe(4);
    expect(all(view.contentEl, "vault-rag-chat-source").length).toBe(2);
  });
  it("Fehler-Zustand (error an der Nachricht) wird gerendert", async () => {
    const send = vi.fn(async (q: string) => {
      const s: any = (send as any)._s;
      s.messages.push({ role: "user", content: q });
      s.messages.push({ role: "assistant", content: "", error: "Chat-LLM nicht erreichbar (lokal/VPN)." });
      return { sources: [], error: "Chat-LLM nicht erreichbar (lokal/VPN)." };
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
  it("setMode ändert den Session-Modus", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    view.setMode("active-note");
    expect(session.mode).toBe("active-note");
  });
  it("picked-notes: '+ Aktive Notiz' fügt die aktive Notiz hinzu", async () => {
    const { view, session } = mkView({ activePath: "ordner/x.md" });
    await view.onOpen();
    view.setMode("picked-notes");
    const add = all(view.contentEl, "vault-rag-chat-pick-add");
    expect(add.length).toBe(1);
    add[0].click();
    expect(session.picked).toEqual(["ordner/x.md"]);
  });
});
