import { describe, it, expect, vi, afterEach } from "vitest";
import { ChatClient } from "../src/chat_client";

function streamRes(chunks: string[], ok = true, status = 200): any {
  let i = 0;
  return { ok, status, body: { getReader: () => ({
    read: async () => i < chunks.length
      ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
      : { done: true, value: undefined },
  }) } };
}

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
  it("stream schickt model+temperature aus opts im Body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamRes(['data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n']));
    vi.stubGlobal("fetch", fetchMock);
    await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {}, undefined, { model: "m2", temperature: 0.2 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("m2");
    expect(body.temperature).toBe(0.2);
  });
  it("stream ohne opts: model = Konstruktor-Wert, kein temperature-Key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamRes(['data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n']));
    vi.stubGlobal("fetch", fetchMock);
    await new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {});
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("qwen3");
    expect("temperature" in body).toBe(false);
  });
  it("ping true bei 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    expect(await new ChatClient("http://localhost:8080", "qwen3").ping()).toBe(true);
  });
});

describe("ChatClient Modelle", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("listModels parst data[].id und sortiert", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "qwen" }, { id: "deepseek" }] }) }));
    expect(await new ChatClient("http://x", "m").listModels()).toEqual(["deepseek", "qwen"]);
  });
  it("listModels gibt [] bei HTTP-Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await new ChatClient("http://x", "m").listModels()).toEqual([]);
  });
  it("listModels gibt [] bei Netzwerkfehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await new ChatClient("http://x", "m").listModels()).toEqual([]);
  });
  it("modelInfo parst /api/v0/models-Eintrag", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "m", max_context_length: 8192, loaded_context_length: 4096, quantization: "Q4_K_M", arch: "qwen2", state: "loaded" }] }) }));
    const info = await new ChatClient("http://x", "m").modelInfo("m");
    expect(info).toMatchObject({ id: "m", contextLength: 8192, loadedContextLength: 4096, quantization: "Q4_K_M", arch: "qwen2", state: "loaded" });
  });
  it("modelInfo gibt null wenn Modell fehlt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "andere" }] }) }));
    expect(await new ChatClient("http://x", "m").modelInfo("m")).toBeNull();
  });
  it("modelInfo gibt null bei Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await new ChatClient("http://x", "m").modelInfo("m")).toBeNull();
  });
});
