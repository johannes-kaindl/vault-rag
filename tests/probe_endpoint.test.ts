import { describe, it, expect, vi, afterEach } from "vitest";
import { requestUrl } from "obsidian";
import { probeEndpoint } from "../src/http";

// Erreichbarkeits-Probe des Embedding- und des Chat-Endpunkts (früher über EmbeddingClient.ping/probe getestet).
const ok = (json: unknown) => ({ status: 200, json });
const BASE = "http://localhost:11434";

describe("probeEndpoint", () => {
  afterEach(() => vi.mocked(requestUrl).mockReset());

  it("erreichbar bei 200 mit gültiger Modell-Liste", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [] }) as any);
    expect((await probeEndpoint(BASE)).reachable).toBe(true);
  });
  it("nicht erreichbar, wenn 200 aber kein OpenAI-Body (Fremd-Server)", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({}) as any);
    expect((await probeEndpoint(BASE)).reachable).toBe(false);
  });
  it("nicht erreichbar, wenn die Verbindung scheitert", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await probeEndpoint(BASE)).reachable).toBe(false);
  });
  it("nicht erreichbar bei HTTP 500", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 500 } as any);
    expect((await probeEndpoint(BASE)).reachable).toBe(false);
  });
  it("liefert kind=refused mit Klartext bei ECONNREFUSED", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
    const s = await probeEndpoint("http://localhost:1243");
    expect(s.kind).toBe("refused");
    expect(s.klartext).toContain("Port");
  });

  const headersOf = (call: number): Record<string, string> =>
    (vi.mocked(requestUrl).mock.calls[call][0] as { headers?: Record<string, string> }).headers ?? {};

  it("sendet den Bearer mit, wenn ein Schlüssel da ist", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [] }) as any);
    await probeEndpoint("https://x/api", "sk-1");
    expect(headersOf(0).Authorization).toBe("Bearer sk-1");
  });
  it("ohne Schlüssel bleibt der Header weg", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [] }) as any);
    await probeEndpoint(BASE);
    expect(headersOf(0).Authorization).toBeUndefined();
  });
});
