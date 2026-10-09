import { vi } from "vitest";
import { createLlmConnection, type LlmConnection, type LlmConnectionOptions } from "../../src/vendor/kit-obsidian/llm-connection";
import type { SseTransport } from "../../src/vendor/kit-obsidian/chat-client";
import { DEFAULT_REQUEST_SETTINGS, type BackendId } from "../../src/vendor/kit/sampling-profiles";
import { chatConnectionOptions } from "../../src/connection_options";
import { DEFAULT_SETTINGS, type VaultRagSettings } from "../../src/settings_core";
import type { EndpointConfig } from "../../src/endpoint_config";
import { ChatClient } from "../../src/chat_client";

/** Obsidians Schlüsselbund als Map: `setSecret`/`getSecret` wie `app.secretStorage`. */
export function fakeSecretStorage(): { setSecret(id: string, v: string): void; getSecret(id: string): string | null; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, setSecret: (id, v) => { map.set(id, v); }, getSecret: (id) => map.get(id) ?? null };
}

export interface Harness {
  llm: LlmConnection;
  client: ChatClient;
  settings: VaultRagSettings;
  saved: () => number;
}

/** Eine echte Chat-Verbindung mit den Optionen des Plugins (`chatConnectionOptions`) — nur Netz und
 *  Plattform sind ersetzt: `app` ist ein Stub (ohne Manager, optional mit Schlüsselbund), die
 *  Erreichbarkeit und das Backend liefern Stubs, der Transport ist frei wählbar (Default: der XHR
 *  des Kits, im Test von `installFakeXHR` ersetzt). */
export function harness(o: {
  endpoints?: EndpointConfig[];
  app?: Record<string, unknown>;
  probe?: LlmConnectionOptions["probe"];
  backend?: BackendId | null;
  transport?: SseTransport;
  overrides?: Partial<LlmConnectionOptions>;
} = {}): Harness {
  const settings: VaultRagSettings = structuredClone(DEFAULT_SETTINGS);
  settings.chatEndpoints = o.endpoints ?? [{ url: "http://localhost:8080", model: "qwen3" }];
  settings.request = structuredClone(DEFAULT_REQUEST_SETTINGS);
  const save = vi.fn(() => Promise.resolve());
  const app = { plugins: { plugins: {} }, ...(o.app ?? {}) };
  const base = chatConnectionOptions({
    app: app as never, pluginId: "vault-retrieval", settings: () => settings, save, lang: () => "en",
  });
  const llm = createLlmConnection({
    ...base,
    probe: o.probe ?? (() => Promise.resolve(true)),
    backendOf: () => Promise.resolve(o.backend ?? null),
    ...(o.transport ? { transports: { http: o.transport, fallback: "none" as const } } : {}),
    ...(o.overrides ?? {}),
  });
  return { llm, client: new ChatClient(llm), settings, saved: () => save.mock.calls.length };
}

/** Ein Transport, der den Body aufzeichnet und eine feste SSE-Antwort liefert. */
export function recordingTransport(reply = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'): {
  transport: SseTransport;
  calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[];
} {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const transport: SseTransport = {
    postStream: (url, body, headers, onChunk) => {
      calls.push({ url, body: JSON.parse(JSON.stringify(body)) as Record<string, unknown>, headers });
      onChunk(reply);
      return Promise.resolve(200);
    },
  };
  return { transport, calls };
}
