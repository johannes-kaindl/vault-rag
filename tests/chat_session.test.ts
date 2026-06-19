import { describe, it, expect, vi } from "vitest";
import { ChatSession } from "../src/chat_session";

function mkSession(streamImpl?: any, assembleImpl?: any) {
  const client: any = { ping: async () => true, stream: streamImpl ?? (async (_m: any, onToken: (t: string) => void) => { onToken("Hi"); onToken("!"); return "Hi!"; }) };
  const assemble = assembleImpl ?? vi.fn(async () => ({ text: "ctx", sources: ["a.md"] }));
  return { s: new ChatSession({ client, assemble }), assemble };
}

describe("ChatSession", () => {
  it("send hängt user+assistant an und streamt", async () => {
    const { s } = mkSession();
    const tokens: string[] = [];
    const { sources } = await s.send("frage", t => tokens.push(t));
    expect(tokens).toEqual(["Hi", "!"]);
    expect(sources).toEqual(["a.md"]);
    expect(s.messages.map(m => m.role)).toEqual(["user", "assistant"]);
    expect(s.messages[1].content).toBe("Hi!");
    expect(s.messages[1].sources).toEqual(["a.md"]);
  });
  it("multi-turn: Verlauf wächst, assemble bekommt Modus + picked", async () => {
    const { s, assemble } = mkSession();
    await s.send("eins", () => {});
    await s.send("zwei", () => {});
    expect(s.messages.length).toBe(4);
    expect(assemble).toHaveBeenCalledWith("auto-rag", "eins", []);
  });
  it("Client-Fehler → error-Feld, kein throw", async () => {
    const { s } = mkSession(async () => { throw new Error("boom"); });
    const r = await s.send("x", () => {});
    expect(r.error).toContain("nicht erreichbar");
    expect(s.messages[1].error).toContain("nicht erreichbar");
  });
  it("assemble-Fehler → Hinweis an der Assistenten-Nachricht", async () => {
    const { s } = mkSession(undefined, async () => { throw new Error("ctx weg"); });
    const r = await s.send("x", () => {});
    expect(r.error).toBeTruthy();
    expect(s.messages[1].error).toBeTruthy();
  });
  it("leere Antwort → Hinweis an der Assistenten-Nachricht", async () => {
    const { s } = mkSession(async () => "");
    const r = await s.send("x", () => {});
    expect(s.messages[1].error).toContain("Leere Antwort");
    expect(r.error).toBeUndefined();
  });
  it("pusht die User-Nachricht synchron, vor assemble", () => {
    let resolve: (v: any) => void = () => {};
    const client: any = { ping: async () => true, stream: async () => "" };
    const assemble = () => new Promise<any>(r => { resolve = r; });
    const s = new ChatSession({ client, assemble });
    const p = s.send("frage", () => {});
    expect(s.messages[0].content).toBe("frage");
    resolve({ text: "", sources: [] });
    return p;
  });
  it("reset leert den Verlauf", async () => {
    const { s } = mkSession();
    await s.send("a", () => {});
    expect(s.messages.length).toBeGreaterThan(0);
    s.reset();
    expect(s.messages).toEqual([]);
  });
});
