import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSSE, streamSSE } from "../src/sse";
import { installFakeXHR } from "./fake_xhr";

const init = { method: "POST", headers: {}, body: "" };

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
  it("liest model aus dem Chunk (erstes Vorkommen)", () => {
    const r = parseSSE('data: {"model":"qwen2-vl","choices":[{"delta":{"content":"a"}}]}\ndata: {"model":"andere","choices":[{"delta":{"content":"b"}}]}\n');
    expect(r.model).toBe("qwen2-vl");
  });
  it("model ist undefined ohne model-Feld", () => {
    expect(parseSSE('data: {"choices":[{"delta":{"content":"a"}}]}\n').model).toBeUndefined();
  });
});

describe("streamSSE (XHR)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("akkumuliert content + ruft onContent pro Delta", async () => {
    const xhr = installFakeXHR();
    const got: string[] = [];
    const p = streamSSE("u", init, t => got.push(t), () => {});
    xhr.feed([
      'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const r = await p;
    expect(got).toEqual(["Hal", "lo"]);
    expect(r.content).toBe("Hallo");
    expect(r.reasoning).toBe("");
  });

  it("routet reasoning_content an onReasoning", async () => {
    const xhr = installFakeXHR();
    const reasoning: string[] = [];
    const p = streamSSE("u", init, () => {}, t => reasoning.push(t));
    xhr.feed([
      'data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const r = await p;
    expect(reasoning.join("")).toBe("den");
    expect(r).toMatchObject({ content: "A", reasoning: "den" });
  });

  it("zieht inline <think> in den reasoning-Kanal", async () => {
    const xhr = installFakeXHR();
    const p = streamSSE("u", init, () => {}, () => {});
    xhr.feed([
      'data: {"choices":[{"delta":{"content":"<think>weil</think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\ndata: [DONE]\n\n',
    ]);
    expect(await p).toMatchObject({ content: "Antwort", reasoning: "weil" });
  });

  it("verliert keinen Tag-Rest am Stream-Ende (flush)", async () => {
    const xhr = installFakeXHR();
    const p = streamSSE("u", init, () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"content":"Ende <"}}]}\n\ndata: [DONE]\n\n']);
    expect((await p).content).toBe("Ende <");
  });

  it("liefert model aus dem ersten Chunk", async () => {
    const xhr = installFakeXHR();
    const p = streamSSE("u", init, () => {}, () => {});
    xhr.feed(['data: {"model":"qwen2-vl","choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n']);
    expect((await p).model).toBe("qwen2-vl");
  });

  it("wirft bei HTTP-Fehlerstatus", async () => {
    const xhr = installFakeXHR();
    const p = streamSSE("u", init, () => {}, () => {});
    xhr.feed([""], 500);
    await expect(p).rejects.toThrow("500");
  });
});
