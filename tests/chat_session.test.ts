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
  });
  it("assemble-Fehler → error, ohne Nachrichten anzuhängen", async () => {
    const { s } = mkSession(undefined, async () => { throw new Error("ctx weg"); });
    const r = await s.send("x", () => {});
    expect(r.error).toBeTruthy();
    expect(s.messages.length).toBe(0);
  });
});
