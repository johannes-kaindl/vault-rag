import { describe, it, expect } from "vitest";
import { suppressParams, reasoningHappened, isAlwaysOnThinker } from "../src/vendor/kit/reasoning";

describe("suppressParams", () => {
  it("liefert leeres Objekt wenn nicht unterdrückt", () => {
    expect(suppressParams(false)).toEqual({});
  });
  it("liefert die Cross-Server-Union wenn unterdrückt", () => {
    expect(suppressParams(true)).toEqual({
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false },
      reasoning_budget: 0,
    });
  });
  it("sendet reasoning_effort nie als Boolean und nie 'minimal'", () => {
    const p = suppressParams(true);
    expect(typeof p.reasoning_effort).toBe("string");
    expect(p.reasoning_effort).not.toBe("minimal");
  });
});

describe("reasoningHappened", () => {
  it("true bei nicht-leerem reasoning-Feld", () => {
    expect(reasoningHappened("Antwort", "weil X")).toBe(true);
  });
  it("false bei leerem reasoning und reinem Content", () => {
    expect(reasoningHappened("Antwort", "")).toBe(false);
    expect(reasoningHappened("Antwort", undefined)).toBe(false);
  });
  it("true bei inline <think> im Content", () => {
    expect(reasoningHappened("<think>weil</think>Antwort", "")).toBe(true);
  });
  it("false bei leerem <think></think> ohne Inhalt", () => {
    expect(reasoningHappened("<think>  </think>Antwort", undefined)).toBe(false);
  });
});

describe("isAlwaysOnThinker", () => {
  it("true für gpt-oss / Harmony", () => {
    expect(isAlwaysOnThinker("gpt-oss-20b")).toBe(true);
  });
  it("false für gewöhnliche Modelle", () => {
    expect(isAlwaysOnThinker("qwen3")).toBe(false);
  });
});
