import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/strings";
import { ChatClient } from "../src/chat_client";
import { ChatHttpError, ChatTimeoutError, chatErrorMessage } from "../src/chat_error";
import { requestUrl } from "obsidian";
import { installFakeXHR } from "./fake_xhr";

const DONE = "data: [DONE]\n\n";

describe("ChatClient", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(requestUrl).mockReset(); });
  it("stream akkumuliert content und gibt {content,reasoning} zurück", async () => {
    const xhr = installFakeXHR();
    const content: string[] = [];
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], t => content.push(t), () => {});
    xhr.feed([
      'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' + DONE,
    ]);
    expect(await p).toEqual({ content: "Hallo", reasoning: "" });
    expect(content).toEqual(["Hal", "lo"]);
  });
  it("stream reicht finishReason durch — der Aufrufer muss eine Truncation von einem Inhaltsfehler trennen koennen", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"content":"halb"},"finish_reason":"length"}]}\n\n' + DONE]);
    expect(await p).toEqual({ content: "halb", reasoning: "", finishReason: "length" });
  });

  it("stream routet reasoning_content an onReasoning", async () => {
    const xhr = installFakeXHR();
    const reasoning: string[] = []; const content: string[] = [];
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], c => content.push(c), r => reasoning.push(r));
    xhr.feed([
      'data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"ke"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\n' + DONE,
    ]);
    expect(await p).toEqual({ content: "Antwort", reasoning: "denke" });
  });
  it("stream zieht inline <think> in den reasoning-Kanal", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed([
      'data: {"choices":[{"delta":{"content":"<think>weil</think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\n' + DONE,
    ]);
    expect(await p).toEqual({ content: "Antwort", reasoning: "weil" });
  });
  it("stream wirft bei HTTP-Fehlerstatus", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "x" }], () => {}, () => {});
    xhr.feed([], 500);
    await expect(p).rejects.toThrow("500");
  });
  it("stream verliert keinen Tag-Rest am Stream-Ende (splitter flush)", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "x" }], () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"content":"Ende <"}}]}\n\n' + DONE]);
    expect((await p).content).toBe("Ende <");
  });
  it("stream schickt model und die fertigen params aus opts im Body", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {}, undefined, { model: "m2", params: { temperature: 0.2 } });
    xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
    await p;
    const body = JSON.parse(xhr.body) as { model: string; temperature: number };
    expect(body.model).toBe("m2");
    expect(body.temperature).toBe(0.2);
  });
  it("stream ohne opts: model = Konstruktor-Wert, kein temperature-Key", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:8080", "qwen3").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
    await p;
    const body = JSON.parse(xhr.body) as Record<string, unknown>;
    expect(body.model).toBe("qwen3");
    expect("temperature" in body).toBe(false);
  });
  it("stream schickt ALLE params unverändert in den Body — entschieden wird im Plugin, nicht im Client", async () => {
    const xhr = installFakeXHR();
    const params = { temperature: 0.4, top_p: 0.95, top_k: 20, reasoning_effort: "none", max_tokens: 512 };
    const p = new ChatClient("http://x", "m").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {}, undefined, { params });
    xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
    await p;
    const body = JSON.parse(xhr.body) as Record<string, unknown>;
    expect(body).toMatchObject(params);
  });
  it("stream ohne params sendet keine Sampling-Keys (auch keine Suppress-Keys mehr)", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://x", "m").stream([{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
    await p;
    const body = JSON.parse(xhr.body) as Record<string, unknown>;
    for (const k of ["reasoning_effort", "chat_template_kwargs", "reasoning_budget", "temperature", "max_tokens"]) {
      expect(k in body, k).toBe(false);
    }
  });
  describe("check (Antwort gegen das Profil)", () => {
    it("meldet „Denken trotz aus“, wenn Reasoning zurückkommt, obwohl die Stufe off war", async () => {
      const xhr = installFakeXHR();
      const report = vi.fn();
      const p = new ChatClient("http://x", "m").stream(
        [{ role: "user", content: "hi" }], () => {}, () => {}, undefined,
        { check: { family: "qwen3.6", thinking: "off", report } });
      xhr.feed([
        'data: {"choices":[{"delta":{"reasoning_content":"ich denke"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\n' + DONE,
      ]);
      await p;
      expect(report).toHaveBeenCalledTimes(1);
      const kinds = (report.mock.calls[0]?.[0] as { kind: string }[]).map(d => d.kind);
      expect(kinds).toContain("thinking-despite-off");
    });
    it("meldet eine abgelehnte Anfrage (HTTP 400) als rejected und wirft weiter", async () => {
      const xhr = installFakeXHR();
      const report = vi.fn();
      const p = new ChatClient("http://x", "m").stream(
        [{ role: "user", content: "hi" }], () => {}, () => {}, undefined,
        { check: { family: null, thinking: "off", report } });
      xhr.feed([], 400);
      await expect(p).rejects.toThrow("400");
      const kinds = (report.mock.calls[0]?.[0] as { kind: string }[]).map(d => d.kind);
      expect(kinds).toContain("rejected");
    });
    it("ein werfendes report() reißt die Antwort nicht mit", async () => {
      const xhr = installFakeXHR();
      const p = new ChatClient("http://x", "m").stream(
        [{ role: "user", content: "hi" }], () => {}, () => {}, undefined,
        { check: { family: null, thinking: "off", report: () => { throw new Error("kaputt"); } } });
      xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
      expect((await p).content).toBe("x");
    });
  });
  it("stream ohne params: kein max_tokens-Key im Body", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://x", "m").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
    await p;
    const body = JSON.parse(xhr.body) as Record<string, unknown>;
    expect("max_tokens" in body).toBe(false);
  });
  describe("llm-lab trace", () => {
    function fakeLabApp(log: (input: any) => unknown): unknown {
      return { plugins: { plugins: { "llm-lab": { api: { apiVersion: 4, status: () => ({ apiVersion: 4, recording: true }), log } } } } };
    }

    it("ein werfendes log() darf den aufgeloesten Wert nicht veraendern", async () => {
      const xhr = installFakeXHR();
      const app = fakeLabApp(() => { throw new Error("lab kaputt"); });
      const content: string[] = [];
      const p = new ChatClient("http://localhost:8080", "qwen3").stream(
        [{ role: "user", content: "hi" }], t => content.push(t), () => {}, undefined,
        { trace: { feature: "chat", app } });
      xhr.feed([
        'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' + DONE,
      ]);
      await expect(p).resolves.toEqual({ content: "Hallo", reasoning: "" });
      expect(content).toEqual(["Hal", "lo"]);
    });

    it("reicht die turnId der Nutzer-Handlung unveraendert ans Lab", async () => {
      const xhr = installFakeXHR();
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      const p = new ChatClient("http://localhost:8080", "qwen3").stream(
        [{ role: "user", content: "hi" }], () => {}, () => {}, undefined,
        { trace: { feature: "chat", app, turnId: "turn-1" } });
      xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
      await p;
      expect(seen.turnId).toBe("turn-1");
    });

    it("ohne turnId bleibt das Feld weg statt undefined zu tragen", async () => {
      const xhr = installFakeXHR();
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      const p = new ChatClient("http://localhost:8080", "qwen3").stream(
        [{ role: "user", content: "hi" }], () => {}, () => {}, undefined,
        { trace: { feature: "chat", app } });
      xhr.feed(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n' + DONE]);
      await p;
      expect("turnId" in seen).toBe(false);
    });

    it("HTTP-500 rejected wie zuvor UND meldet dem Lab error + leeren content", async () => {
      const xhr = installFakeXHR();
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      const p = new ChatClient("http://localhost:8080", "qwen3").stream(
        [{ role: "user", content: "x" }], () => {}, () => {}, undefined,
        { trace: { feature: "chat", app } });
      xhr.feed([], 500);
      await expect(p).rejects.toThrow("500");
      expect(seen.content).toBe("");
      expect(typeof seen.error).toBe("string");
      expect(seen.error).toContain("500");
      expect(seen.plugin).toBe("vault-retrieval");
      expect(seen.feature).toBe("chat");
    });

    // Der Kommentar im catch-Zweig nennt den gescheiterten Lauf "den interessanten Debug-Fall".
    // Mit content:"" war die Zusage nur halb eingeloest: dass ein Modell bis zum Abbruch
    // Quelltext produziert hat statt zu antworten, stand danach in keiner Aufzeichnung.
    it("ein abgebrochener Stream meldet dem Lab den bis dahin gestreamten Teiltext", async () => {
      const xhr = installFakeXHR();
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      const ac = new AbortController();
      const p = new ChatClient("http://localhost:8080", "qwen3").stream(
        [{ role: "user", content: "hi" }], () => {}, () => {}, ac.signal,
        { trace: { feature: "chat", app } });
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
      const xhr = installFakeXHR();
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      const ac = new AbortController();
      const p = new ChatClient("http://localhost:8080", "qwen3").stream(
        [{ role: "user", content: "hi" }], () => {}, () => {}, ac.signal,
        { trace: { feature: "chat", app } });
      xhr.progress(['data: {"choices":[{"delta":{"reasoning_content":"denke"}}]}\n\n']);
      ac.abort();
      await expect(p).rejects.toThrow();
      expect(seen.reasoning).toBe("denke");
    });

    it("ttftMs <= latencyMs, Token-Reihenfolge unveraendert wenn trace gesetzt ist", async () => {
      const xhr = installFakeXHR();
      let seen: any;
      const app = fakeLabApp((input: any) => { seen = input; return "rec-id"; });
      const content: string[] = [];
      const p = new ChatClient("http://localhost:8080", "qwen3").stream(
        [{ role: "user", content: "hi" }], t => content.push(t), () => {}, undefined,
        { trace: { feature: "chat", app } });
      xhr.feed([
        'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' + DONE,
      ]);
      await p;
      expect(content).toEqual(["Hal", "lo"]);
      expect(seen.ttftMs).toBeGreaterThanOrEqual(0);
      expect(seen.latencyMs).toBeGreaterThanOrEqual(0);
      expect(seen.ttftMs).toBeLessThanOrEqual(seen.latencyMs);
    });

    // Regression Fix-Runde 1: ein leeres Array ist in JS truthy — `contextPaths: []` (kein
    // Retrieval-Treffer) darf trotzdem nicht als Feld ans Lab durchgereicht werden, sonst
    // behauptet der Record faelschlich "gemeldet, aber leer" statt "nicht gemeldet".
    it("leere contextPaths werden NICHT ans Lab gemeldet — nur ein nicht-leeres Array", async () => {
      const xhr = installFakeXHR();
      let seenEmpty: any;
      const appEmpty = fakeLabApp((input: any) => { seenEmpty = input; return "rec-id"; });
      const p1 = new ChatClient("http://localhost:8080", "qwen3").stream(
        [{ role: "user", content: "hi" }], () => {}, () => {}, undefined,
        { trace: { feature: "chat", app: appEmpty, contextPaths: [] } });
      xhr.feed(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' + DONE]);
      await p1;
      expect(seenEmpty.contextPaths).toBeUndefined();

      const xhr2 = installFakeXHR();
      let seenFull: any;
      const appFull = fakeLabApp((input: any) => { seenFull = input; return "rec-id"; });
      const p2 = new ChatClient("http://localhost:8080", "qwen3").stream(
        [{ role: "user", content: "hi" }], () => {}, () => {}, undefined,
        { trace: { feature: "chat", app: appFull, contextPaths: ["a.md"] } });
      xhr2.feed(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' + DONE]);
      await p2;
      expect(seenFull.contextPaths).toEqual(["a.md"]);
    });
  });

  describe("ping", () => {
    it("true bei 200 mit gültiger Modell-Liste", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { data: [] } } as any);
      expect(await new ChatClient("http://localhost:8080", "qwen3").ping()).toBe(true);
    });
    it("false wenn 200 aber kein OpenAI-Body (Fremd-Server)", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: {} } as any);
      expect(await new ChatClient("http://localhost:8080", "qwen3").ping()).toBe(false);
    });
    it("false wenn nicht erreichbar", async () => {
      vi.mocked(requestUrl).mockRejectedValue(new Error("ECONNREFUSED"));
      expect(await new ChatClient("http://localhost:8080", "qwen3").ping()).toBe(false);
    });
    it("false bei HTTP 500", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 500 } as any);
      expect(await new ChatClient("http://localhost:8080", "qwen3").ping()).toBe(false);
    });
  });

  describe("probe", () => {
    it("liefert kind=refused mit Klartext bei ECONNREFUSED", async () => {
      vi.mocked(requestUrl).mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
      const s = await new ChatClient("http://localhost:1243", "m").probe();
      expect(s.kind).toBe("refused");
      expect(s.klartext).toContain("Port");
    });
  });
});

describe("ChatClient über den Kit-Client (Welle 11)", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(requestUrl).mockReset(); });
  const msgs = [{ role: "user" as const, content: "hi" }];
  const chunk = (c: string): string => `data: {"choices":[{"delta":{"content":"${c}"}}]}\n\n`;

  it("Stille nach dem ersten Chunk bricht nach der Idle-Frist ab (vorher: gar kein Timeout)", async () => {
    vi.useFakeTimers();
    const xhr = installFakeXHR();
    const p = new ChatClient("http://x", "m").stream(msgs, () => {}, () => {});
    const caught = p.catch((e: unknown) => e);
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
    const p = new ChatClient("http://x", "m").stream(msgs, () => {}, () => {});
    let state = "offen";
    p.then(() => { state = "erfüllt"; }, () => { state = "abgelehnt"; });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(state).toBe("offen");
    await vi.advanceTimersByTimeAsync(301_000);
    expect(state).toBe("abgelehnt");
  });

  it("HTTP 200 mit Fehlerkörper ist ein Fehler, kein leerer Erfolg (vorher: content \"\")", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://x", "m").stream(msgs, () => {}, () => {});
    xhr.feed(['{"error":{"message":"model not loaded"}}'], 200);
    const e = await p.catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ChatHttpError);
    expect(chatErrorMessage(e)).toContain("model not loaded");
  });

  it("abgeschnitten OHNE Text bleibt ein Ergebnis mit finishReason length — kein Wurf, wie zuvor", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://x", "m").stream(msgs, () => {}, () => {});
    xhr.feed(['data: {"choices":[{"delta":{"reasoning_content":"denke"},"finish_reason":"length"}]}\n\n' + DONE]);
    expect(await p).toEqual({ content: "", reasoning: "denke", finishReason: "length" });
  });

  it("weist der Server den XHR ab, wiederholt der Client ohne Stream über requestUrl und bleibt dabei", async () => {
    const xhr = installFakeXHR();
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, text: JSON.stringify({ choices: [{ message: { content: "Antwort" }, finish_reason: "stop" }] }) } as never);
    const c = new ChatClient("http://x", "m");
    const p = c.stream(msgs, () => {}, () => {});
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
    const p = new ChatClient("http://x", "m").stream(msgs, () => {}, () => {});
    xhr.error();
    await expect(p).rejects.toThrow(/Chat network error|Chat-Netzwerkfehler/);
  });

  it("ttftMs misst das erste BYTE, auch wenn es Reasoning ist (Verhaltenswechsel, vorher erster Content-Token)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const xhr = installFakeXHR();
    let seen: any;
    const app = { plugins: { plugins: { "llm-lab": { api: { apiVersion: 4, status: () => ({ apiVersion: 4, recording: true }), log: (i: unknown) => { seen = i; return "id"; } } } } } };
    const p = new ChatClient("http://x", "m").stream(msgs, () => {}, () => {}, undefined, { trace: { feature: "chat", app } });
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
  it("listModels parst data[].id und sortiert", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "qwen" }, { id: "deepseek" }] }) as any);
    expect(await new ChatClient("http://x", "m").listModels()).toEqual(["deepseek", "qwen"]);
  });
  it("listModels gibt [] bei HTTP-Fehler", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 500 } as any);
    expect(await new ChatClient("http://x", "m").listModels()).toEqual([]);
  });
  it("listModels gibt [] bei Netzwerkfehler", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("offline"));
    expect(await new ChatClient("http://x", "m").listModels()).toEqual([]);
  });
  it("modelInfo parst /api/v0/models-Eintrag", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m", max_context_length: 8192, loaded_context_length: 4096, quantization: "Q4_K_M", arch: "qwen2", state: "loaded" }] }) as any);
    const info = await new ChatClient("http://x", "m").modelInfo("m");
    expect(info).toMatchObject({ id: "m", contextLength: 8192, loadedContextLength: 4096, quantization: "Q4_K_M", arch: "qwen2", state: "loaded" });
  });
  it("modelInfo gibt null wenn Modell fehlt", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "andere" }] }) as any);
    expect(await new ChatClient("http://x", "m").modelInfo("m")).toBeNull();
  });
  it("modelInfo gibt null bei Fehler", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("offline"));
    expect(await new ChatClient("http://x", "m").modelInfo("m")).toBeNull();
  });
  it("fetchCapabilities liest LM Studio /api/v1/models", async () => {
    vi.mocked(requestUrl).mockImplementation((p: any) => Promise.resolve(
      p.url.endsWith("/api/v1/models")
        ? ok({ data: [{ id: "m", capabilities: { vision: true } }] })
        : { status: 404 },
    ) as any);
    const c = await new ChatClient("http://localhost:1234", "m").fetchCapabilities("m");
    expect(c?.vision).toBe("confirmed");
  });
  it("fetchCapabilities gibt null wenn nichts greift", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as any);
    expect(await new ChatClient("http://x", "m").fetchCapabilities("m")).toBeNull();
  });
});

describe("API-Schlüssel", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(requestUrl).mockReset(); });
  const ok = (json: unknown) => ({ status: 200, json });
  const headersOf = (call: number): Record<string, string> =>
    (vi.mocked(requestUrl).mock.calls[call][0] as { headers?: Record<string, string> }).headers ?? {};

  it("stream sendet den Bearer an chat/completions", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("https://x/api", "m", "sk-1")
      .stream([{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed([DONE]);
    await p;
    expect(xhr.headers.Authorization).toBe("Bearer sk-1");
    expect(xhr.headers["Content-Type"]).toBe("application/json");
  });

  it("ohne Schlüssel bleibt der Header beim Streamen weg", async () => {
    const xhr = installFakeXHR();
    const p = new ChatClient("http://localhost:1234", "m")
      .stream([{ role: "user", content: "hi" }], () => {}, () => {});
    xhr.feed([DONE]);
    await p;
    expect(xhr.headers.Authorization).toBeUndefined();
  });

  it("listModels sendet den Bearer mit", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m" }] }) as any);
    await new ChatClient("https://x/api", "m", "sk-1").listModels();
    expect(headersOf(0).Authorization).toBe("Bearer sk-1");
  });

  it("listModels: ohne Schlüssel bleibt der Header weg", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m" }] }) as any);
    await new ChatClient("http://localhost:1234", "m").listModels();
    expect(headersOf(0).Authorization).toBeUndefined();
  });

  it("modelInfo sendet den Bearer mit", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m" }] }) as any);
    await new ChatClient("https://x/api", "m", "sk-1").modelInfo("m");
    expect(headersOf(0).Authorization).toBe("Bearer sk-1");
  });

  it("modelInfo: ohne Schlüssel bleibt der Header weg", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "m" }] }) as any);
    await new ChatClient("http://localhost:1234", "m").modelInfo("m");
    expect(headersOf(0).Authorization).toBeUndefined();
  });

  it("probe sendet den Bearer mit", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [] }) as any);
    await new ChatClient("https://x/api", "m", "sk-1").probe();
    expect(headersOf(0).Authorization).toBe("Bearer sk-1");
  });

  it("probe: ohne Schlüssel bleibt der Header weg", async () => {
    vi.mocked(requestUrl).mockResolvedValue(ok({ data: [] }) as any);
    await new ChatClient("http://localhost:1234", "m").probe();
    expect(headersOf(0).Authorization).toBeUndefined();
  });

  it("fetchCapabilities sendet den Bearer mit", async () => {
    vi.mocked(requestUrl).mockImplementation((p: any) => Promise.resolve(
      p.url.endsWith("/api/v1/models")
        ? ok({ data: [{ id: "m", capabilities: { vision: true } }] })
        : { status: 404 },
    ) as any);
    await new ChatClient("https://x/api", "m", "sk-1").fetchCapabilities("m");
    expect(headersOf(0).Authorization).toBe("Bearer sk-1");
  });

  it("fetchCapabilities: ohne Schlüssel bleibt der Header weg", async () => {
    vi.mocked(requestUrl).mockImplementation((p: any) => Promise.resolve(
      p.url.endsWith("/api/v1/models")
        ? ok({ data: [{ id: "m", capabilities: { vision: true } }] })
        : { status: 404 },
    ) as any);
    await new ChatClient("http://localhost:1234", "m").fetchCapabilities("m");
    expect(headersOf(0).Authorization).toBeUndefined();
  });
});
