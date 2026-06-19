import { describe, it, expect, vi } from "vitest";
import { ChatView, VIEW_TYPE_CHAT } from "../src/chat_view";
import { makeFakeApp } from "./__mocks__/obsidian";

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}

function mkView(sendImpl?: any) {
  const session: any = {
    mode: "auto-rag", picked: [], messages: [],
    send: sendImpl ?? vi.fn(async (q: string, onToken: (t: string) => void) => {
      session.messages.push({ role: "user", content: q });
      const a = { role: "assistant", content: "" }; session.messages.push(a);
      onToken("Ant"); a.content = "Ant"; onToken("wort"); a.content = "Antwort";
      return { sources: ["notes/a.md"] };
    }),
    abort: vi.fn(),
  };
  const opened: string[] = [];
  const view = new ChatView({ app: makeFakeApp() } as any, { session, openPath: (p: string) => opened.push(p) });
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
  it("Fehler-Zustand wird gerendert", async () => {
    const { view } = mkView(async () => ({ sources: [], error: "Chat-LLM nicht erreichbar (lokal/VPN)." }));
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
});
