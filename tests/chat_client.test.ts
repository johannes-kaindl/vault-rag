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
    expect(r.deltas).toEqual(["Hal", "lo"]);
    expect(r.done).toBe(false);
    expect(r.rest).toBe("");
  });
  it("setzt done bei [DONE]", () => {
    expect(parseSSE("data: [DONE]\n").done).toBe(true);
  });
  it("unvollständige letzte Zeile bleibt in rest", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: {"cho');
    expect(r.deltas).toEqual(["x"]);
    expect(r.rest).toBe('data: {"cho');
  });
});

describe("ChatClient", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("stream akkumuliert Tokens und gibt Volltext zurück", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const tokens: string[] = [];
    const full = await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], t => tokens.push(t));
    expect(tokens).toEqual(["Hal", "lo"]);
    expect(full).toBe("Hallo");
  });
  it("stream wirft bei HTTP-Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([], false, 500)));
    await expect(new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "x" }], () => {})).rejects.toThrow("500");
  });
  it("ping true bei 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    expect(await new ChatClient("http://localhost:8080", "qwen3").ping()).toBe(true);
  });
});
