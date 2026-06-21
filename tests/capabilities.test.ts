import { describe, it, expect } from "vitest";
import {
  guessFromName, parseOllamaShow, parseLmStudioV1, parseLmStudioV0,
  mergeCapability, resolveCapabilities, Capabilities,
} from "../src/capabilities";

describe("guessFromName", () => {
  it("erkennt Vision an *-vl", () => {
    expect(guessFromName("qwen2.5-vl-7b").vision).toBe("likely");
  });
  it("erkennt Vision an llava/pixtral/moondream", () => {
    expect(guessFromName("llava:13b").vision).toBe("likely");
    expect(guessFromName("pixtral-12b").vision).toBe("likely");
  });
  it("gemma3 ist Vision, gemma3:1b aber nicht (version-gated)", () => {
    expect(guessFromName("gemma3:4b").vision).toBe("likely");
    expect(guessFromName("gemma3:1b").vision).toBe("no");
  });
  it("glm-4 ohne v ist keine Vision, glm-4v schon", () => {
    expect(guessFromName("glm-4").vision).toBe("no");
    expect(guessFromName("glm-4v").vision).toBe("likely");
  });
  it("deepseek-r1 ist always-on thinking", () => {
    const t = guessFromName("deepseek-r1:8b").thinking;
    expect(t.support).toBe("always");
    expect(t.confidence).toBe("likely");
  });
  it("qwen3 ist hybrid thinking", () => {
    expect(guessFromName("qwen3").thinking.support).toBe("hybrid");
  });
  it("qwen3-instruct-2507 ist non-thinking trotz qwen3-Prefix", () => {
    expect(guessFromName("qwen3-instruct-2507").thinking.support).toBe("none");
  });
  it("reines Textmodell: keine Caps", () => {
    const c = guessFromName("mistral-small");
    expect(c.vision).toBe("no");
    expect(c.thinking.support).toBe("none");
  });
});

describe("parseOllamaShow", () => {
  it("liest capabilities[] (vision + thinking)", () => {
    const c = parseOllamaShow({ capabilities: ["completion", "vision", "thinking"] });
    expect(c?.vision).toBe("confirmed");
    expect(c?.thinking.support).toBe("hybrid");
    expect(c?.thinking.confidence).toBe("confirmed");
  });
  it("ohne vision/thinking → 'no' (Absence ist kein Nachweis)", () => {
    const c = parseOllamaShow({ capabilities: ["completion"] });
    expect(c?.vision).toBe("no");
    expect(c?.thinking.support).toBe("none");
  });
  it("null bei unbrauchbarem JSON", () => {
    expect(parseOllamaShow({})).toBeNull();
    expect(parseOllamaShow(null)).toBeNull();
  });
});

describe("parseLmStudioV1", () => {
  it("liest capabilities.vision/reasoning", () => {
    const j = { data: [{ id: "m", capabilities: { vision: true, reasoning: { default: false } } }] };
    const c = parseLmStudioV1(j, "m");
    expect(c?.vision).toBe("confirmed");
    expect(c?.thinking.support).toBe("hybrid");
    expect(c?.thinking.confidence).toBe("confirmed");
  });
  it("null wenn Modell fehlt", () => {
    expect(parseLmStudioV1({ data: [{ id: "andere" }] }, "m")).toBeNull();
  });
});

describe("parseLmStudioV0", () => {
  it("type vlm → Vision confirmed; thinking unbekannt", () => {
    const c = parseLmStudioV0({ data: [{ id: "m", type: "vlm" }] }, "m");
    expect(c?.vision).toBe("confirmed");
    expect(c?.thinking.support).toBe("none");
  });
  it("type llm → keine Vision", () => {
    expect(parseLmStudioV0({ data: [{ id: "m", type: "llm" }] }, "m")?.vision).toBe("no");
  });
});

describe("mergeCapability", () => {
  const none: Capabilities = { vision: "no", thinking: { support: "none", confidence: "no" } };
  it("Name hebt fehlende Metadaten an", () => {
    const r = mergeCapability(none, guessFromName("qwen2.5-vl"), {});
    expect(r.vision).toBe("likely");
  });
  it("Metadaten schlagen schwache Name-Heuristik (confirmed bleibt)", () => {
    const base: Capabilities = { vision: "confirmed", thinking: { support: "none", confidence: "no" } };
    expect(mergeCapability(base, guessFromName("foo"), {}).vision).toBe("confirmed");
  });
  it("Live-Signal stuft auf confirmed hoch", () => {
    const r = mergeCapability(none, guessFromName("foo"), { thinking: true });
    expect(r.thinking.confidence).toBe("confirmed");
    expect(r.thinking.support).not.toBe("none");
  });
  it("Live-Absence stuft nicht runter", () => {
    const base: Capabilities = { vision: "confirmed", thinking: { support: "always", confidence: "confirmed" } };
    const r = mergeCapability(base, none, { thinking: false, vision: false });
    expect(r.vision).toBe("confirmed");
    expect(r.thinking.confidence).toBe("confirmed");
  });
  it("Name 'always' gewinnt über Basis-'hybrid'", () => {
    const base: Capabilities = { vision: "no", thinking: { support: "hybrid", confidence: "confirmed" } };
    expect(mergeCapability(base, guessFromName("deepseek-r1"), {}).thinking.support).toBe("always");
  });
});

describe("resolveCapabilities", () => {
  it("kombiniert Metadaten + Name + live", () => {
    const r = resolveCapabilities(null, "qwen2.5-vl", {});
    expect(r.vision).toBe("likely");
  });
});
