import { describe, it, expect } from "vitest";
import { parseSSE } from "../src/vendor/kit/sse";

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
  it("liest finish_reason aus dem letzten Chunk", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"a"},"finish_reason":null}]}\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n');
    expect(r.finishReason).toBe("length");
  });
  it("finishReason ist undefined, solange nur null-Werte kamen", () => {
    expect(parseSSE('data: {"choices":[{"delta":{"content":"a"},"finish_reason":null}]}\n').finishReason).toBeUndefined();
  });
  // code-kit 0.5.0: Reasoning kommt je nach Server unter drei Feldnamen. Unser Chat liest den
  // Reasoning-Kanal (ChatClient.stream → Kit-Client), die Varianten erreichen also die Oberfläche.
  it("liest reasoning (MLX) und thinking als Reasoning-Delta", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"reasoning":"a"}}]}\ndata: {"choices":[{"delta":{"thinking":"b"}}]}\n');
    expect(r.reasoning).toEqual(["a", "b"]);
    expect(r.content).toEqual([]);
  });
  it("fällt auf choices[0].message zurück, wenn delta fehlt", () => {
    const r = parseSSE('data: {"choices":[{"message":{"content":"voll","reasoning_content":"den"}}]}\n');
    expect(r.content).toEqual(["voll"]);
    expect(r.reasoning).toEqual(["den"]);
  });
});
