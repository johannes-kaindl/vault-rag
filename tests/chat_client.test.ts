import { describe, it, expect, vi, afterEach } from "vitest";
import { ChatClient } from "../src/chat_client";
import { requestUrl } from "obsidian";
import { installFakeXHR } from "./fake_xhr";

const DONE = "data: [DONE]\n\n";

describe("ChatClient", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(requestUrl).mockReset(); });
  it("stream akkumuliert content und gibt {content,reasoning} zurück", async () => {
    const xhr = installFakeXHR();
    const content: string[] = [];
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], t => content.push(t), () => {});
    xhr.feed([
      'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' + DONE,
    ]);
    expect(await p).toEqual({ content: "Hallo", reasoning: "" });
    expect(content).toEqual(["Hal", "lo"]);
  });
  it("stream routet reasoning_content an onReasoning", async () => {
    const xhr = installFakeXHR();
    const reasoning: string[] = []; const content: string[] = [];
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], c => content.push(c), r => reasoning.push(r));
    xhr.feed([
      'data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"ke"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\n' + DONE,
    ]);
    expect(await p).toEqual({ content: "Antwort", reasoning: "denke" });
  });
  it("stream zieht inline <think> in den reasoning-Kanal", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed([
      'data: {"choices":[{"delta":{"content":"<think>weil</think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\n' + DONE,
    ]);
    expect(await p).toEqual({ content: "Antwort", reasoning: "weil" });
  });
  it("stream wirft bei HTTP-Fehlerstatus", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "x" }], () => {}, () => {});
    xhr.feed([], 500);
    await expect(p).rejects.toThrow("500");
  });
  it("stream verliert keinen Tag-Rest am Stream-Ende (splitter flush)", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "x" }], () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"content":"Ende <"}}]}\n\n' + DONE]);
    expect((await p).content).toBe("Ende <");
  });
  it("stream schickt model+temperature aus opts im Body", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {}, undefined, { model: "m2", temperature: 0.2 });
    xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
    await p;
    const body = JSON.parse(xhr.body) as { model: string; temperature: number };
    expect(body.model).toBe("m2");
    expect(body.temperature).toBe(0.2);
  });
  it("stream ohne opts: model = Konstruktor-Wert, kein temperature-Key", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
    await p;
    const body = JSON.parse(xhr.body) as Record<string, unknown>;
    expect(body.model).toBe("qwen3");
    expect("temperature" in body).toBe(false);
  });
  it("stream mischt Suppress-Params in den Body wenn suppressThinking", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://x", "m").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {}, undefined, { suppressThinking: true });
    xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
    await p;
    const body = JSON.parse(xhr.body) as { reasoning_effort: string; chat_template_kwargs: unknown; reasoning_budget: number };
    expect(body.reasoning_effort).toBe("none");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.reasoning_budget).toBe(0);
  });
  it("stream ohne suppressThinking sendet keine Suppress-Keys", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://x", "m").stream([{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
    await p;
    const body = JSON.parse(xhr.body) as Record<string, unknown>;
    expect("reasoning_effort" in body).toBe(false);
  });
  it("ping true bei 200", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: {} } as any);
    expect(await new ChatClient("http://localhost:8080", "qwen3").ping()).toBe(true);
  });
});

describe("ChatClient Modelle", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(requestUrl).mockReset(); });
  const ok = (json: unknown) => ({ status: 200, json });
  it("listModels parst data[].id und sortiert", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "qwen" }, { id: "deepseek" }] }) as any);
    expect(await new ChatClient("http://x", "m").listModels()).toEqual(["deepseek", "qwen"]);
  });
  it("listModels gibt [] bei HTTP-Fehler", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 500 } as any);
    expect(await new ChatClient("http://x", "m").listModels()).toEqual([]);
  });
  it("listModels gibt [] bei Netzwerkfehler", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("offline"));
    expect(await new ChatClient("http://x", "m").listModels()).toEqual([]);
  });
  it("modelInfo parst /api/v0/models-Eintrag", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m", max_context_length: 8192, loaded_context_length: 4096, quantization: "Q4_K_M", arch: "qwen2", state: "loaded" }] }) as any);
    const info = await new ChatClient("http://x", "m").modelInfo("m");
    expect(info).toMatchObject({ id: "m", contextLength: 8192, loadedContextLength: 4096, quantization: "Q4_K_M", arch: "qwen2", state: "loaded" });
  });
  it("modelInfo gibt null wenn Modell fehlt", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "andere" }] }) as any);
    expect(await new ChatClient("http://x", "m").modelInfo("m")).toBeNull();
  });
  it("modelInfo gibt null bei Fehler", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("offline"));
    expect(await new ChatClient("http://x", "m").modelInfo("m")).toBeNull();
  });
  it("fetchCapabilities liest LM Studio /api/v1/models", async () => {
    vi.mocked(requestUrl).mockImplementation((p: any) => Promise.resolve(
      p.url.endsWith("/api/v1/models")
        ? ok({ data: [{ id: "m", capabilities: { vision: true } }] })
        : { status: 404 },
    ) as any);
    const c = await new ChatClient("http://localhost:1234", "m").fetchCapabilities("m");
    expect(c?.vision).toBe("confirmed");
  });
  it("fetchCapabilities gibt null wenn nichts greift", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as any);
    expect(await new ChatClient("http://x", "m").fetchCapabilities("m")).toBeNull();
  });
});
