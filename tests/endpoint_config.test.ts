import { describe, it, expect } from "vitest";
import { authHeaders, effectiveModel } from "../src/endpoint_config";

describe("authHeaders", () => {
  it("ohne Schlüssel → keine Header", () => {
    expect(authHeaders(undefined)).toEqual({});
    expect(authHeaders("")).toEqual({});
    expect(authHeaders("   ")).toEqual({});
  });

  it("mit Schlüssel → Bearer, getrimmt", () => {
    expect(authHeaders("  sk-abc  ")).toEqual({ Authorization: "Bearer sk-abc" });
  });
});

describe("effectiveModel", () => {
  it("ohne Override gilt das globale Modell", () => {
    expect(effectiveModel({ url: "u" }, "qwen3")).toBe("qwen3");
    expect(effectiveModel({ url: "u", model: "  " }, "qwen3")).toBe("qwen3");
  });

  it("Override gewinnt und wird getrimmt", () => {
    expect(effectiveModel({ url: "u", model: " gpt-4o " }, "qwen3")).toBe("gpt-4o");
  });
});
