import { describe, it, expect } from "vitest";
import "../src/i18n/strings";
import { harness, recordingTransport } from "./helpers/llm";
import type { LlmEndpointManagerApi, ResolvedEndpoint, ApiError } from "../src/vendor/kit/endpoint-source";

// Der Manager-Weg der Chat-Verbindung (früher `resolveManagedChat`, jetzt Kit `createLlmConnection`):
// dieselben Regeln, an der echten Verbindung gemessen.
function fakeManager(over: { resolve?: ResolvedEndpoint | ApiError; materialize?: ResolvedEndpoint | ApiError } = {}): LlmEndpointManagerApi {
  const ep: ResolvedEndpoint = { id: "e1", label: "E1", config: { url: "http://m:1", apiKey: "geheim" }, defaultModel: "chat-standard" };
  return {
    version: 1,
    list: () => [], get: () => null,
    resolve: () => Promise.resolve(over.resolve ?? ep),
    materialize: () => Promise.resolve(over.materialize ?? ep),
    models: () => Promise.resolve([]), importEndpoints: () => Promise.resolve({ added: [], merged: [], skipped: [] }),
    on: () => () => {},
  };
}
const withManager = (manager: LlmEndpointManagerApi) => ({ plugins: { plugins: { "llm-endpoint-manager": { api: manager } } } });

describe("Chat-Verbindung mit LLM Endpoint Manager", () => {
  it("nimmt Endpunkt und Standardmodell vom Manager, der Schlüssel bleibt im Speicher", async () => {
    const h = harness({ app: withManager(fakeManager()) });
    const r = await h.llm.resolve();
    expect(r.kind).toBe("manager");
    expect(r.config).toMatchObject({ url: "http://m:1", apiKey: "geheim" });
    expect(r.model).toBe("chat-standard");
    expect(JSON.stringify(h.settings)).not.toContain("geheim");
  });

  it("die Nutzerwahl (chatChoice.model) schlägt das Standardmodell und kommt im Body an", async () => {
    const { transport, calls } = recordingTransport();
    const h = harness({ transport, app: withManager(fakeManager()) });
    h.settings.chatChoice = { model: "mein-modell" };
    await h.client.stream([{ role: "user", content: "hi" }], () => {}, () => {});
    expect(calls[0]!.body.model).toBe("mein-modell");
    expect(calls[0]!.headers.Authorization).toBe("Bearer geheim");
  });

  it("config.model des Managers (== defaultModel) überschreibt die Nutzerwahl NICHT — lingotuner-Fund C1", async () => {
    const ep: ResolvedEndpoint = { id: "e1", label: "E1", config: { url: "http://m:1", model: "default-modell" }, defaultModel: "default-modell" };
    const h = harness({ app: withManager(fakeManager({ resolve: ep })) });
    h.settings.chatChoice = { model: "meine-wahl" };
    expect((await h.llm.resolve()).model).toBe("meine-wahl");
  });

  it("kein Endpunkt beim Manager: config null, kein Rückfall auf die lokale Liste", async () => {
    const h = harness({ app: withManager(fakeManager({ resolve: { error: "no-endpoint" } })) });
    const r = await h.llm.resolve();
    expect(r.config).toBeNull();
    expect(r.reason).toBe("no-endpoint");
    await expect(h.client.stream([{ role: "user", content: "x" }], () => {}, () => {})).rejects.toThrow(/No chat endpoint|Kein Chat-Endpunkt/);
  });

  it("eine alte Manager-Wahl übersteuert ohne Manager das lokale Modell NICHT", async () => {
    const { transport, calls } = recordingTransport();
    const h = harness({ transport, endpoints: [{ url: "http://localhost:8080", model: "lokal" }] });
    h.settings.chatChoice = { model: "alte-manager-wahl" };
    await h.client.stream([{ role: "user", content: "x" }], () => {}, () => {});
    expect(calls[0]!.body.model).toBe("lokal");
  });
});
