import { describe, it, expect, vi, afterEach } from "vitest";
import { probeEndpoint } from "../src/http";
import { requestUrl } from "obsidian";

afterEach(() => vi.mocked(requestUrl).mockReset());

describe("probeEndpoint", () => {
  it("ok bei 200 + {data:[…]}", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { data: [{ id: "m" }] } } as any);
    const s = await probeEndpoint("http://localhost:1234");
    expect(s.kind).toBe("ok");
    expect(s.reachable).toBe(true);
  });
  it("not-an-llm-api bei 200 + Fremd-Body", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { foo: 1 } } as any);
    expect((await probeEndpoint("http://192.168.178.27:1234")).kind).toBe("not-an-llm-api");
  });
  it("refused bei geworfenem ECONNREFUSED", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
    expect((await probeEndpoint("http://localhost:1243")).kind).toBe("refused");
  });
  it("unknown-host bei ENOTFOUND", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("getaddrinfo ENOTFOUND foo.invalid"));
    expect((await probeEndpoint("http://foo.invalid:1234")).kind).toBe("unknown-host");
  });
  it("timeout wenn requestUrl hängt", async () => {
    vi.mocked(requestUrl).mockImplementation(() => new Promise(() => {}) as any);
    expect((await probeEndpoint("http://192.0.2.1:1234", 20)).kind).toBe("timeout");
  });
});
