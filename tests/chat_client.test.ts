import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/strings";
import { ChatHttpError, ChatTimeoutError, chatErrorMessage } from "../src/chat_error";
import { requestUrl } from "obsidian";
import { installFakeXHR } from "./fake_xhr";
import { harness, recordingTransport, fakeSecretStorage } from "./helpers/llm";
import { migrateEndpointList } from "../src/endpoint_config";
import type { SseTransport } from "../src/vendor/kit-obsidian/chat-client";

const DONE = "data: [DONE]\n\n";
const msgs = [{ role: "user" as const, content: "hi" }];
const chat = (o: Parameters<typeof harness>[0] = {}) => harness(o).client;

// Die Fassade `ChatClient` sitzt auf der echten Chat-Verbindung des Plugins (`chatConnectionOptions`
// aus Kit `createLlmConnection`); nur Netz und Plattform sind ersetzt (tests/helpers/llm.ts).
describe("ChatClient", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(requestUrl).mockReset(); });
  it("stream akkumuliert content und gibt {content,reasoning} zurück", async () => {
    const xhr = installFakeXHR();
    const content: string[] = [];
    const p = chat().stream(msgs, t => content.push(t), () => {});
    await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
    xhr.feed([
      'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' + DONE,
    ]);
    expect(await p).toEqual({ content: "Hallo", reasoning: "" });
    expect(content).toEqual(["Hal", "lo"]);
  });

  async function streamed(
    c: ReturnType<typeof chat>, chunks: string[], opts?: Parameters<ReturnType<typeof chat>["stream"]>[4], status = 200,
  ): Promise<ReturnType<ReturnType<typeof chat>["stream"]>> {
    const xhr = installFakeXHR();
    const p = c.stream(msgs, () => {}, () => {}, undefined, opts);
    await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
    xhr.feed(chunks, status);
    return p;
  }

  it("stream reicht finishReason durch — der Aufrufer muss eine Truncation von einem Inhaltsfehler trennen koennen", async () => {
    const r = await streamed(chat(), ['data: {"choices":[{"delta":{"content":"halb"},"finish_reason":"length"}]}\n\n' + DONE]);
    expect(r).toEqual({ content: "halb", reasoning: "", finishReason: "length" });
  });
  it("stream routet reasoning_content an onReasoning", async () => {
    const xhr = installFakeXHR();
    const reasoning: string[] = []; const content: string[] = [];
    const p = chat().stream(msgs, c => content.push(c), r => reasoning.push(r));
    await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
    xhr.feed([
      'data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"ke"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\n' + DONE,
    ]);
    expect(await p).toEqual({ content: "Antwort", reasoning: "denke" });
    expect(reasoning.join("")).toBe("denke");
  });
  it("stream zieht inline <think> in den reasoning-Kanal", async () => {
    const r = await streamed(chat(), [
      'data: {"choices":[{"delta":{"content":"<think>weil</think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\n' + DONE,
    ]);
    expect(r).toEqual({ content: "Antwort", reasoning: "weil" });
  });
  it("stream wirft bei HTTP-Fehlerstatus", async () => {
    await expect(streamed(chat(), [], undefined, 500)).rejects.toThrow("500");
  });
  it("stream verliert keinen Tag-Rest am Stream-Ende (splitter flush)", async () => {
    const r = await streamed(chat(), ['data: {"choices":[{"delta":{"content":"Ende <"}}]}\n\n' + DONE]);
    expect(r.content).toBe("Ende <");
  });

  describe("Anfrage-Parameter entscheidet die Verbindung, nicht der Aufrufer", () => {
    const sent = async (opts?: Parameters<ReturnType<typeof chat>["stream"]>[4], model = "qwen3"): Promise<Record<string, unknown>> => {
      const { transport, calls } = recordingTransport();
      const c = chat({ transport, endpoints: [{ url: "http://localhost:8080", model }] });
      await c.stream(msgs, () => {}, () => {}, undefined, opts);
      return calls[0]!.body;
    };
    it("model aus opts steht im Body, der Modus liefert die Temperatur (Chat = grounded 0,4)", async () => {
      const body = await sent({ model: "m2" });
      expect(body.model).toBe("m2");
      expect(body.temperature).toBe(0.4);
    });
    // E1 (2026-09-07): ein Feature-Modell (Smart Apply) schlägt das Zeilen-Modell. Vorher schlug die
    // Zeile das Feature; damit war `smartApplyModel` wirkungslos, sobald die Zeile ein Modell trug.
    // Preis: kennt ein Fallback-Endpunkt den Namen nicht, scheitert Smart Apply laut statt still zu wechseln.
    it("ein Feature-Modell schlägt das Zeilen-Modell — getrimmt", async () => {
      expect((await sent({ model: " gemma " })).model).toBe("gemma");
    });
    it("ein leeres Feature-Modell lässt das Zeilen-Modell gelten", async () => {
      expect((await sent({ model: "" })).model).toBe("qwen3");
      expect((await sent({ model: "   " })).model).toBe("qwen3");
    });
    it("ohne opts: model = Zeilen-Modell, kein max_tokens im Chat", async () => {
      const body = await sent();
      expect(body.model).toBe("qwen3");
      expect("max_tokens" in body).toBe(false);
    });
    it("mode wählt die Modus-Werte: structured 0,1 mit Plugin-Budget, transform 0,2 mit Umform-Budget", async () => {
      const a = await sent({ mode: "structured" });
      expect(a.temperature).toBe(0.1);
      expect(a.max_tokens).toBe(4096);
      const b = await sent({ mode: "transform" });
      expect(b.temperature).toBe(0.2);
      expect(b.max_tokens).toBe(4096);
    });
    it("kein Suppress-Schlüssel mehr im Body (chat_template_kwargs, reasoning_budget)", async () => {
      const body = await sent();
      for (const k of ["chat_template_kwargs", "reasoning_budget"]) expect(k in body, k).toBe(false);
    });
  });

  describe("Antwort gegen das Profil", () => {
    it("meldet „Denken trotz aus“, wenn Reasoning zurückkommt, obwohl die Stufe off war", async () => {
      const h = harness({ endpoints: [{ url: "http://x", model: "qwen3.6-27b" }] });
      h.settings.request.thinking.grounded = "off";
      await streamed(h.client, [
        'data: {"choices":[{"delta":{"reasoning_content":"ich denke"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\n' + DONE,
      ]);
      expect(h.llm.session.deviations().map(d => d.kind)).toContain("thinking-despite-off");
    });
    it("meldet eine abgelehnte Anfrage (HTTP 400) als rejected und wirft weiter", async () => {
      const h = harness();
      await expect(streamed(h.client, [], undefined, 400)).rejects.toThrow("400");
      expect(h.llm.session.deviations().map(d => d.kind)).toContain("rejected");
    });
  });

  describe("kein Endpunkt", () => {
    it("ohne erreichbare Zeile wirft stream den übersetzten Text und ping ist false", async () => {
      const c = chat({ probe: () => Promise.resolve(false) });
      await expect(c.stream(msgs, () => {}, () => {})).rejects.toThrow(/No chat endpoint|Kein Chat-Endpunkt/);
      expect(await c.ping()).toBe(false);
    });
  });

  describe("Schwärzung (Verhaltenswechsel, Kit 0.51)", () => {
    const TOKEN = "Bearer abcdefghijklmnop1234567890";
    /** Antwortet mit dem Platzhalter, den es im gesendeten Text findet — wie ein Modell, das die Stelle zitiert. */
    function echoTransport(wrap = (ph: string) => `Das war ${ph} gewesen`): { transport: SseTransport; bodies: string[] } {
      const bodies: string[] = [];
      return {
        bodies,
        transport: {
          postStream: (_u, body, _h, onChunk) => {
            const text = JSON.stringify(body);
            bodies.push(text);
            const ph = /\[redacted-[a-z0-9-]+-\d+\]/.exec(text)?.[0] ?? "KEIN-PLATZHALTER";
            onChunk(`data: ${JSON.stringify({ choices: [{ delta: { content: wrap(ph) }, finish_reason: "stop" }] })}\n\n${DONE}`);
            return Promise.resolve(200);
          },
        },
      };
    }

    it("das Modell sieht einen Platzhalter, der Aufrufer bekommt das Original zurück", async () => {
      const { transport, bodies } = echoTransport();
      const r = await chat({ transport }).stream([{ role: "user", content: `Der Zugang ist ${TOKEN} ok.` }], () => {}, () => {});
      expect(bodies[0]).not.toContain("abcdefghijklmnop1234567890");
      expect(bodies[0]).toMatch(/\[redacted-/);
      expect(r.content).toContain("abcdefghijklmnop1234567890");
    });

    it("Roundtrip für Smart Apply: der Token bleibt im JSON-Ergebnis erhalten (restoreContent json)", async () => {
      const { transport } = echoTransport((ph) => JSON.stringify({ v: ph }));
      const r = await chat({ transport }).stream(
        [{ role: "user", content: `Notiz mit ${TOKEN}` }], () => {}, () => {}, undefined, { mode: "structured", restoreContent: "json" });
      expect((JSON.parse(r.content) as { v: string }).v).toBe(TOKEN);
    });

    it("das Lab bekommt den GESENDETEN Text: Platzhalter statt Original, auch in Antwort und Prompt-Anteil", async () => {
      const { transport } = echoTransport();
      let seen: any;
      const app = { plugins: { plugins: { "llm-lab": { api: { apiVersion: 4, status: () => ({ apiVersion: 4, recording: true }), log: (i: unknown) => { seen = i; return "id"; } } } } } };
      await chat({ transport }).stream(
        [{ role: "system", content: `Regeln mit ${TOKEN}` }, { role: "user", content: `Frage mit ${TOKEN}` }], () => {}, () => {}, undefined,
        { trace: { feature: "chat", app, promptTemplate: `Regeln mit ${TOKEN}` } });
      const logged = JSON.stringify(seen);
      expect(logged).not.toContain("abcdefghijklmnop1234567890");
      expect(logged).toMatch(/\[redacted-/);
      // Derselbe Wert trägt in Nachricht, Antwort und Prompt-Anteil denselben Platzhalter.
      const phs = new Set(logged.match(/\[redacted-[a-z0-9-]+-\d+\]/g));
      expect(phs.size).toBe(1);
    });
  });

  describe("llm-lab trace", () => {
    function fakeLabApp(log: (input: any) => unknown): unknown {
      return { plugins: { plugins: { "llm-lab": { api: { apiVersion: 4, status: () => ({ apiVersion: 4, recording: true }), log } } } } };
    }
    const ok = ['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE];

    it("ein werfendes log() darf den aufgeloesten Wert nicht veraendern", async () => {
      const app = fakeLabApp(() => { throw new Error("lab kaputt"); });
      const r = await streamed(chat(), [
        'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' + DONE,
      ], { trace: { feature: "chat", app } });
      expect(r).toEqual({ content: "Hallo", reasoning: "" });
    });

    it("reicht die turnId der Nutzer-Handlung unveraendert ans Lab", async () => {
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      await streamed(chat(), ok, { trace: { feature: "chat", app, turnId: "turn-1" } });
      expect(seen.turnId).toBe("turn-1");
    });

    it("ohne turnId bleibt das Feld weg statt undefined zu tragen", async () => {
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      await streamed(chat(), ok, { trace: { feature: "chat", app } });
      expect("turnId" in seen).toBe(false);
    });

    it("meldet Plugin, Feature, gesendetes Modell und Endpunkt", async () => {
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      await streamed(chat({ endpoints: [{ url: "http://localhost:8080", model: "qwen3" }] }), ok, { trace: { feature: "chat", app } });
      expect(seen.plugin).toBe("vault-retrieval");
      expect(seen.feature).toBe("chat");
      expect(seen.model).toBe("qwen3");
      expect(seen.endpointUrl).toBe("http://localhost:8080");
    });

    it("HTTP-500 rejected wie zuvor UND meldet dem Lab error + leeren content", async () => {
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      await expect(streamed(chat(), [], { trace: { feature: "chat", app } }, 500)).rejects.toThrow("500");
      expect(seen.content).toBe("");
      expect(typeof seen.error).toBe("string");
      expect(seen.error).toContain("500");
    });

    // Der gescheiterte Lauf ist der interessante Debug-Fall: auch der bis dahin gestreamte Teiltext
    // gehört in die Aufzeichnung.
    it("ein abgebrochener Stream meldet dem Lab den bis dahin gestreamten Teiltext", async () => {
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      const xhr = installFakeXHR();
      const ac = new AbortController();
      const p = chat().stream(msgs, () => {}, () => {}, ac.signal, { trace: { feature: "chat", app } });
      await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
      xhr.progress([
        'data: {"choices":[{"delta":{"content":"Teil"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"text"}}]}\n\n',
      ]);
      ac.abort();
      await expect(p).rejects.toThrow();
      expect(seen.content).toBe("Teiltext");
      expect(typeof seen.error).toBe("string");
    });

    it("ein abgebrochener Stream meldet auch das bis dahin gestreamte reasoning", async () => {
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      const xhr = installFakeXHR();
      const ac = new AbortController();
      const p = chat().stream(msgs, () => {}, () => {}, ac.signal, { trace: { feature: "chat", app } });
      await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
      xhr.progress(['data: {"choices":[{"delta":{"reasoning_content":"denke"}}]}\n\n']);
      ac.abort();
      await expect(p).rejects.toThrow();
      expect(seen.reasoning).toBe("denke");
    });

    it("ttftMs <= latencyMs, Token-Reihenfolge unveraendert wenn trace gesetzt ist", async () => {
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      const xhr = installFakeXHR();
      const content: string[] = [];
      const p = chat().stream(msgs, t => content.push(t), () => {}, undefined, { trace: { feature: "chat", app } });
      await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
      xhr.feed([
        'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' + DONE,
      ]);
      await p;
      expect(content).toEqual(["Hal", "lo"]);
      expect(seen.ttftMs).toBeGreaterThanOrEqual(0);
      expect(seen.ttftMs).toBeLessThanOrEqual(seen.latencyMs);
    });

    // Ein leeres Array ist in JS truthy — `contextPaths: []` (kein Retrieval-Treffer) darf trotzdem
    // nicht als Feld ans Lab durchgereicht werden.
    it("leere contextPaths werden NICHT ans Lab gemeldet — nur ein nicht-leeres Array", async () => {
      let seenEmpty: any;
      await streamed(chat(), ok, { trace: { feature: "chat", app: fakeLabApp((i: any) => { seenEmpty = i; return "id"; }), contextPaths: [] } });
      expect(seenEmpty.contextPaths).toBeUndefined();
      let seenFull: any;
      await streamed(chat(), ok, { trace: { feature: "chat", app: fakeLabApp((i: any) => { seenFull = i; return "id"; }), contextPaths: ["a.md"] } });
      expect(seenFull.contextPaths).toEqual(["a.md"]);
    });
  });

  describe("ping", () => {
    const real = { probe: undefined } as const;
    it("true bei 200 mit gültiger Modell-Liste", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { data: [] } } as any);
      expect(await chat({ ...real, probe: undefined }).ping()).toBe(true);
    });
    it("false wenn 200 aber kein OpenAI-Body (Fremd-Server)", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: {} } as any);
      expect(await harness({ overrides: { probe: undefined } }).client.ping()).toBe(false);
    });
    it("false wenn nicht erreichbar", async () => {
      vi.mocked(requestUrl).mockRejectedValue(new Error("ECONNREFUSED"));
      expect(await harness({ overrides: { probe: undefined } }).client.ping()).toBe(false);
    });
    it("false bei HTTP 500", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 500 } as any);
      expect(await harness({ overrides: { probe: undefined } }).client.ping()).toBe(false);
    });
  });
});

describe("ChatClient über den Kit-Client (Welle 11)", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(requestUrl).mockReset(); });
  const chunk = (c: string): string => `data: {"choices":[{"delta":{"content":"${c}"}}]}\n\n`;

  it("Stille nach dem ersten Chunk bricht nach der Idle-Frist ab (vorher: gar kein Timeout)", async () => {
    vi.useFakeTimers();
    const xhr = installFakeXHR();
    const p = chat().stream(msgs, () => {}, () => {});
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    xhr.progress([chunk("a")]);
    await vi.advanceTimersByTimeAsync(119_000);
    xhr.progress([chunk("b")]); // Lebenszeichen setzt die Frist zurück
    await vi.advanceTimersByTimeAsync(119_000);
    await vi.advanceTimersByTimeAsync(2_000);
    const e = await caught;
    expect(e).toBeInstanceOf(ChatTimeoutError);
    expect(chatErrorMessage(e)).toMatch(/120/);
  });

  it("bis zum ersten Chunk gilt eine längere Frist (ein JIT-ladendes Modell braucht Minuten)", async () => {
    vi.useFakeTimers();
    installFakeXHR();
    const p = chat().stream(msgs, () => {}, () => {});
    let state = "offen";
    p.then(() => { state = "erfüllt"; }, () => { state = "abgelehnt"; });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(state).toBe("offen");
    await vi.advanceTimersByTimeAsync(301_000);
    expect(state).toBe("abgelehnt");
  });

  it("HTTP 200 mit Fehlerkörper ist ein Fehler, kein leerer Erfolg (vorher: content \"\")", async () => {
    const xhr = installFakeXHR();
    const p = chat().stream(msgs, () => {}, () => {});
    await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
    xhr.feed(['{"error":{"message":"model not loaded"}}'], 200);
    const e = await p.catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ChatHttpError);
    expect(chatErrorMessage(e)).toContain("model not loaded");
  });

  it("abgeschnitten OHNE Text bleibt ein Ergebnis mit finishReason length — kein Wurf, wie zuvor", async () => {
    const xhr = installFakeXHR();
    const p = chat().stream(msgs, () => {}, () => {});
    await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
    xhr.feed(['data: {"choices":[{"delta":{"reasoning_content":"denke"},"finish_reason":"length"}]}\n\n' + DONE]);
    expect(await p).toEqual({ content: "", reasoning: "denke", finishReason: "length" });
  });

  it("weist der Server den XHR ab, wiederholt der Client ohne Stream über requestUrl und bleibt dabei", async () => {
    const xhr = installFakeXHR();
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, text: JSON.stringify({ choices: [{ message: { content: "Antwort" }, finish_reason: "stop" }] }) } as never);
    const c = chat();
    const p = c.stream(msgs, () => {}, () => {});
    await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
    xhr.error();
    expect(await p).toEqual({ content: "Antwort", reasoning: "", finishReason: "stop" });
    const first = JSON.parse(vi.mocked(requestUrl).mock.calls[0]![0].body as string) as { stream: boolean };
    expect(first.stream).toBe(false);
    expect(await c.stream(msgs, () => {}, () => {})).toEqual({ content: "Antwort", reasoning: "", finishReason: "stop" });
    expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(2);
  });

  it("ein Netzfehler ohne Fallback-Erfolg wirft weiter den übersetzten Netzfehlertext", async () => {
    const xhr = installFakeXHR();
    vi.mocked(requestUrl).mockRejectedValue(new Error("offline"));
    const p = chat().stream(msgs, () => {}, () => {});
    await vi.waitFor(() => { expect(xhr.body).not.toBe(""); });
    xhr.error();
    await expect(p).rejects.toThrow(/Chat network error|Chat-Netzwerkfehler/);
  });

  it("ttftMs misst das erste BYTE, auch wenn es Reasoning ist (Verhaltenswechsel, vorher erster Content-Token)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const xhr = installFakeXHR();
    let seen: any;
    const app = { plugins: { plugins: { "llm-lab": { api: { apiVersion: 4, status: () => ({ apiVersion: 4, recording: true }), log: (i: unknown) => { seen = i; return "id"; } } } } } };
    const p = chat().stream(msgs, () => {}, () => {}, undefined, { trace: { feature: "chat", app } });
    await vi.advanceTimersByTimeAsync(1_000);
    xhr.progress(['data: {"choices":[{"delta":{"reasoning_content":"denke"}}]}\n\n']);
    await vi.advanceTimersByTimeAsync(2_000);
    xhr.feed([chunk("A") + DONE]);
    await p;
    expect(seen.ttftMs).toBe(1_000);
    expect(seen.latencyMs).toBe(3_000);
  });
});

describe("ChatClient Modelle", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(requestUrl).mockReset(); });
  const ok = (json: unknown) => ({ status: 200, json });
  const real = (o: Parameters<typeof harness>[0] = {}) => harness({ ...o, overrides: { probe: undefined } }).client;
  it("listModels parst data[].id und sortiert", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "qwen" }, { id: "deepseek" }] }) as any);
    expect(await real().listModels()).toEqual(["deepseek", "qwen"]);
  });
  it("listModels gibt [] bei HTTP-Fehler", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 500 } as any);
    expect(await real().listModels()).toEqual([]);
  });
  it("listModels gibt [] bei Netzwerkfehler", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("offline"));
    expect(await real().listModels()).toEqual([]);
  });
  it("modelInfo parst /api/v0/models-Eintrag", async () => {
    vi.mocked(requestUrl).mockImplementation((p: any) => Promise.resolve(
      p.url.endsWith("/api/v0/models")
        ? ok({ data: [{ id: "m", max_context_length: 8192, loaded_context_length: 4096, quantization: "Q4_K_M", arch: "qwen2", state: "loaded" }] })
        : ok({ data: [{ id: "m" }] }),
    ) as any);
    const info = await real().modelInfo("m");
    expect(info).toMatchObject({ id: "m", contextLength: 8192, loadedContextLength: 4096, quantization: "Q4_K_M", arch: "qwen2", state: "loaded" });
  });
  it("modelInfo gibt null wenn Modell fehlt", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "andere" }] }) as any);
    expect(await real().modelInfo("m")).toBeNull();
  });
  it("modelInfo gibt null bei Fehler", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("offline"));
    expect(await real().modelInfo("m")).toBeNull();
  });
  it("fetchCapabilities liest LM Studio /api/v1/models", async () => {
    vi.mocked(requestUrl).mockImplementation((p: any) => Promise.resolve(
      p.url.endsWith("/api/v1/models")
        ? ok({ data: [{ id: "m", capabilities: { vision: true } }] })
        : ok({ data: [{ id: "m" }] }),
    ) as any);
    const c = await real({ endpoints: [{ url: "http://localhost:1234", model: "m" }] }).fetchCapabilities("m");
    expect(c?.vision).toBe("confirmed");
  });
  it("fetchCapabilities gibt null wenn nichts greift", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as any);
    expect(await real().fetchCapabilities("m")).toBeNull();
  });
});

describe("API-Schlüssel", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(requestUrl).mockReset(); });
  const ok = (json: unknown) => ({ status: 200, json });
  const lastHeaders = (): Record<string, string> => {
    const calls = vi.mocked(requestUrl).mock.calls;
    return (calls[calls.length - 1]![0] as { headers?: Record<string, string> }).headers ?? {};
  };
  const real = (apiKey?: string, url = "https://x/api") =>
    harness({ endpoints: [{ url, model: "m", ...(apiKey ? { apiKey } : {}) }], overrides: { probe: undefined } }).client;

  it("stream sendet den Bearer an chat/completions", async () => {
    const { transport, calls } = recordingTransport();
    await chat({ transport, endpoints: [{ url: "https://x/api", model: "m", apiKey: "sk-1" }] }).stream(msgs, () => {}, () => {});
    expect(calls[0]!.headers.Authorization).toBe("Bearer sk-1");
  });

  it("ohne Schlüssel bleibt der Header beim Streamen weg", async () => {
    const { transport, calls } = recordingTransport();
    await chat({ transport, endpoints: [{ url: "http://localhost:1234", model: "m" }] }).stream(msgs, () => {}, () => {});
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("listModels sendet den Bearer mit", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m" }] }) as any);
    await real("sk-1").listModels();
    expect(lastHeaders().Authorization).toBe("Bearer sk-1");
  });
  it("listModels: ohne Schlüssel bleibt der Header weg", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m" }] }) as any);
    await real(undefined, "http://localhost:1234").listModels();
    expect(lastHeaders().Authorization).toBeUndefined();
  });
  it("modelInfo sendet den Bearer mit", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m" }] }) as any);
    await real("sk-1").modelInfo("m");
    expect(lastHeaders().Authorization).toBe("Bearer sk-1");
  });
  it("modelInfo: ohne Schlüssel bleibt der Header weg", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m" }] }) as any);
    await real(undefined, "http://localhost:1234").modelInfo("m");
    expect(lastHeaders().Authorization).toBeUndefined();
  });
  it("probe sendet den Bearer mit", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [] }) as any);
    await real("sk-1").probe();
    expect(lastHeaders().Authorization).toBe("Bearer sk-1");
  });
  it("probe: ohne Schlüssel bleibt der Header weg", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [] }) as any);
    await real(undefined, "http://localhost:1234").probe();
    expect(lastHeaders().Authorization).toBeUndefined();
  });
  it("fetchCapabilities sendet den Bearer mit", async () => {
    vi.mocked(requestUrl).mockImplementation((p: any) => Promise.resolve(
      p.url.endsWith("/api/v1/models") ? ok({ data: [{ id: "m", capabilities: { vision: true } }] }) : ok({ data: [{ id: "m" }] }),
    ) as any);
    await real("sk-1").fetchCapabilities("m");
    expect(lastHeaders().Authorization).toBe("Bearer sk-1");
  });
  it("fetchCapabilities: ohne Schlüssel bleibt der Header weg", async () => {
    vi.mocked(requestUrl).mockImplementation((p: any) => Promise.resolve(
      p.url.endsWith("/api/v1/models") ? ok({ data: [{ id: "m", capabilities: { vision: true } }] }) : ok({ data: [{ id: "m" }] }),
    ) as any);
    await real(undefined, "http://localhost:1234").fetchCapabilities("m");
    expect(lastHeaders().Authorization).toBeUndefined();
  });
});

describe("Schlüsselbund (Kit 0.48): der Schlüssel verlässt data.json und überlebt den Neustart", () => {
  const msgs2 = [{ role: "user" as const, content: "hi" }];

  it("der erste Aufruf migriert den Klartext-Schlüssel in den Schlüsselbund und sendet ihn weiter als Bearer", async () => {
    const secrets = fakeSecretStorage();
    const { transport, calls } = recordingTransport();
    const h = harness({ transport, app: { secretStorage: secrets }, endpoints: [{ url: "https://x/api", model: "m", apiKey: "sk-geheim" }] });
    await h.client.stream(msgs2, () => {}, () => {});
    expect(calls[0]!.headers.Authorization).toBe("Bearer sk-geheim");
    const row = h.settings.chatEndpoints[0]!;
    expect(row.apiKey).toBeUndefined();
    expect(row.secretId).toMatch(/^vault-retrieval-ep-/);
    expect(JSON.stringify(h.settings)).not.toContain("sk-geheim");
  });

  it("nach ZWEI Neustarts trägt die Zeile weiter secretId, und der Schlüssel löst auf", async () => {
    const secrets = fakeSecretStorage();
    const first = harness({ transport: recordingTransport().transport, app: { secretStorage: secrets }, endpoints: [{ url: "https://x/api", model: "m", apiKey: "sk-geheim" }] });
    await first.client.stream(msgs2, () => {}, () => {});

    // Neustart: data.json -> Laden (wie `loadSettings` in main.ts) -> neue Verbindung, derselbe Schlüsselbund.
    let stored = JSON.parse(JSON.stringify(first.settings.chatEndpoints)) as unknown[];
    for (let start = 1; start <= 2; start++) {
      const loaded = migrateEndpointList(undefined, stored as never);
      const { transport, calls } = recordingTransport();
      const h = harness({ transport, app: { secretStorage: secrets }, endpoints: loaded });
      await h.client.stream(msgs2, () => {}, () => {});
      expect(calls[0]!.headers.Authorization, `Neustart ${start}`).toBe("Bearer sk-geheim");
      expect(h.settings.chatEndpoints[0]!.secretId, `Neustart ${start}`).toMatch(/^vault-retrieval-ep-/);
      stored = JSON.parse(JSON.stringify(h.settings.chatEndpoints)) as unknown[];
    }
  });
});
