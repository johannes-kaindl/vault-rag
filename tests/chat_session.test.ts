import { describe, it, expect, vi } from "vitest";
import { ChatSession } from "../src/chat_session";

function mkSession(streamImpl?: any, assembleImpl?: any) {
  const client: any = { ping: async () => true, stream: streamImpl ?? (async (_m: any, onContent: (t: string) => void) => { onContent("Hi"); onContent("!"); return { content: "Hi!", reasoning: "" }; }) };
  const assemble = assembleImpl ?? vi.fn(async () => ({ text: "ctx", sources: ["a.md"] }));
  return { s: new ChatSession({ client, assemble }), assemble };
}

describe("ChatSession", () => {
  it("send hängt user+assistant an und streamt", async () => {
    const { s } = mkSession();
    const tokens: string[] = [];
    const { sources } = await s.send("frage", ["a.md"], t => tokens.push(t));
    expect(tokens).toEqual(["Hi", "!"]);
    expect(sources).toEqual(["a.md"]);
    expect(s.messages.map(m => m.role)).toEqual(["user", "assistant"]);
    expect(s.messages[1].content).toBe("Hi!");
    expect(s.messages[1].sources).toEqual(["a.md"]);
  });
  it("assemble bekommt die Pfadliste; Multi-Turn wächst", async () => {
    const { s, assemble } = mkSession();
    await s.send("eins", ["a.md", "b.md"], () => {});
    await s.send("zwei", ["c.md"], () => {});
    expect(s.messages.length).toBe(4);
    expect(assemble).toHaveBeenCalledWith(["a.md", "b.md"]);
  });
  it("Client-Fehler → error an der Nachricht", async () => {
    const { s } = mkSession(async () => { throw new Error("boom"); });
    const r = await s.send("x", [], () => {});
    expect(r.error).toContain("nicht erreichbar");
    expect(s.messages[1].error).toContain("nicht erreichbar");
  });
  it("assemble-Fehler → Hinweis an der Nachricht", async () => {
    const { s } = mkSession(undefined, async () => { throw new Error("ctx weg"); });
    const r = await s.send("x", [], () => {});
    expect(r.error).toBeTruthy();
    expect(s.messages[1].error).toBeTruthy();
  });
  it("leere Antwort → Hinweis", async () => {
    const { s } = mkSession(async () => ({ content: "", reasoning: "" }));
    await s.send("x", ["a.md"], () => {});
    expect(s.messages[1].error).toContain("Leere Antwort");
  });
  it("pusht die User-Nachricht synchron, vor assemble", () => {
    let resolve: (v: any) => void = () => {};
    const client: any = { ping: async () => true, stream: async () => ({ content: "", reasoning: "" }) };
    const assemble = () => new Promise<any>(r => { resolve = r; });
    const s = new ChatSession({ client, assemble });
    const p = s.send("frage", [], () => {});
    expect(s.messages[0].content).toBe("frage");
    resolve({ text: "", sources: [] });
    return p;
  });
  it("reset leert den Verlauf", async () => {
    const { s } = mkSession();
    await s.send("a", [], () => {});
    expect(s.messages.length).toBeGreaterThan(0);
    s.reset();
    expect(s.messages).toEqual([]);
  });
  it("fehlgeschlagener Turn landet nicht im Folge-Verlauf", async () => {
    let captured: any[] = [];
    let call = 0;
    const stream = async (msgs: any[], onContent: (t: string) => void) => {
      captured = msgs;
      if (call++ === 0) throw new Error("boom");
      onContent("ok"); return { content: "ok", reasoning: "" };
    };
    const { s } = mkSession(stream);
    await s.send("Qf", ["a.md"], () => {});
    await s.send("Qn", ["a.md"], () => {});
    const userContents = captured.filter((m: any) => m.role === "user").map((m: any) => m.content);
    expect(userContents).toEqual(["Qn"]);
  });
  it("akkumuliert reasoning am Assistenten", async () => {
    const stream = async (_m: any, onContent: (t: string) => void, onReasoning: (t: string) => void) => {
      onReasoning("den"); onReasoning("ke"); onContent("Antwort");
      return { content: "Antwort", reasoning: "denke" };
    };
    const { s } = mkSession(stream);
    await s.send("frage", ["a.md"], () => {});
    expect(s.messages[1].reasoning).toBe("denke");
    expect(s.messages[1].content).toBe("Antwort");
  });
  it("reasoning fließt NICHT in die Folge-History ans LLM", async () => {
    let captured: any[] = [];
    const stream = async (msgs: any[], onContent: (t: string) => void, onReasoning: (t: string) => void) => {
      captured = msgs;
      onReasoning("geheim"); onContent("Antwort");
      return { content: "Antwort", reasoning: "geheim" };
    };
    const { s } = mkSession(stream);
    await s.send("eins", ["a.md"], () => {});
    await s.send("zwei", ["a.md"], () => {});
    expect(captured.some((m: any) => "reasoning" in m)).toBe(false);
    const assistantTurn = captured.find((m: any) => m.role === "assistant");
    expect(assistantTurn.content).toBe("Antwort");
  });
});
