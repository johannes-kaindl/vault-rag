import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { url: string; headers?: Record<string, string> }[] = [];
vi.mock("obsidian", () => ({
  requestUrl: (p: { url: string; headers?: Record<string, string> }) => {
    calls.push({ url: p.url, headers: p.headers });
    return Promise.resolve({ status: 200, json: { data: [] } });
  },
}));

import { probeEndpoint } from "../src/http";

describe("probeEndpoint — Auth", () => {
  beforeEach(() => { calls.length = 0; });

  it("sendet den Bearer an /v1/models", async () => {
    await probeEndpoint("https://x/api", "sk-1");
    expect(calls[0].url).toBe("https://x/api/v1/models");
    expect(calls[0].headers?.Authorization).toBe("Bearer sk-1");
  });

  it("ohne Schlüssel keinen Authorization-Header", async () => {
    await probeEndpoint("http://localhost:1234");
    expect(calls[0].headers?.Authorization).toBeUndefined();
  });
});
