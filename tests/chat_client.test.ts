import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSSE, ChatClient } from "../src/chat_client";

function streamRes(chunks: string[], ok = true, status = 200): any {
  let i = 0;
  return { ok, status, body: { getReader: () => ({
    read: async () => i < chunks.length
      ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
      : { done: true, value: undefined },
  }) } };
}

describe("parseSSE", () => {
  it("extrahiert content-Deltas aus data-Zeilen", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"Hal"}}]}\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n');
    expect(r.content).toEqual(["Hal", "lo"]);
    expect(r.reasoning).toEqual([]);
    expect(r.done).toBe(false);
    expect(r.rest).toBe("");
  });
  it("extrahiert reasoning_content-Deltas", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\ndata: {"choices":[{"delta":{"reasoning_content":"ke"}}]}\n');
    expect(r.reasoning).toEqual(["den", "ke"]);
    expect(r.content).toEqual([]);
  });
  it("trennt content und reasoning im selben Buffer", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"reasoning_content":"r"}}]}\ndata: {"choices":[{"delta":{"content":"c"}}]}\n');
    expect(r.reasoning).toEqual(["r"]);
    expect(r.content).toEqual(["c"]);
  });
  it("setzt done bei [DONE]", () => {
    expect(parseSSE("data: [DONE]\n").done).toBe(true);
  });
  it("verarbeitet \\r\\n-Zeilenenden", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"a"}}]}\r\ndata: {"choices":[{"delta":{"content":"b"}}]}\r\n');
    expect(r.content).toEqual(["a", "b"]);
  });
  it("unvollständige letzte Zeile bleibt in rest", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: {"cho');
    expect(r.content).toEqual(["x"]);
    expect(r.rest).toBe('data: {"cho');
  });
});

describe("ChatClient", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("stream akkumuliert content und gibt {content,reasoning} zurück", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const content: string[] = [];
    const res = await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], t => content.push(t), () => {});
    expect(content).toEqual(["Hal", "lo"]);
    expect(res).toEqual({ content: "Hallo", reasoning: "" });
  });
  it("stream routet reasoning_content an onReasoning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"ke"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const reasoning: string[] = []; const content: string[] = [];
    const res = await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], c => content.push(c), r => reasoning.push(r));
    expect(reasoning.join("")).toBe("denke");
    expect(content.join("")).toBe("Antwort");
    expect(res).toEqual({ content: "Antwort", reasoning: "denke" });
  });
  it("stream zieht inline <think> in den reasoning-Kanal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"content":"<think>weil</think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const res = await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {});
    expect(res).toEqual({ content: "Antwort", reasoning: "weil" });
  });
  it("stream wirft bei HTTP-Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([], false, 500)));
    await expect(new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "x" }], () => {}, () => {})).rejects.toThrow("500");
  });
  it("stream verliert keinen Tag-Rest am Stream-Ende (splitter flush)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"content":"Ende <"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const res = await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "x" }], () => {}, () => {});
    expect(res.content).toBe("Ende <");
  });
  it("ping true bei 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    expect(await new ChatClient("http://localhost:8080", "qwen3").ping()).toBe(true);
  });
});
