import { describe, it, expect } from "vitest";
import { ChatHttpError, ChatNetworkError, ChatNoEndpointError, ChatTimeoutError, chatSendFailure } from "../src/chat_error";
import { CHAT_WINDOW_STRINGS_EN } from "../src/vendor/kit-obsidian/chat-window-strings";
import { setLang } from "../src/vendor/kit/i18n";
import "../src/i18n/strings"; // Register i18n strings

// `ChatClient.stream` wirft, das Kit-Fenster erwartet ein Ergebnis. Was DIESES Repo zusagt: jede Fehlerart des Clients kommt als die passende Art
// beim Fenster an, und die Begründung des Servers geht dabei nicht verloren (HTTP 401 mit `{"detail":"Not authenticated"}` war der Anlass der Übersetzung,
// 2026-08-05). Den Text bildet das Fenster aus seinem Bündel; hier steht die Zuordnung.
describe("chatSendFailure", () => {
  it("HTTP: Status und Rohbody gehen unverändert durch (die Serverbegründung entscheidet das Fenster)", () => {
    expect(chatSendFailure(new ChatHttpError(401, '{"detail":"Not authenticated"}'))).toEqual({ ok: false, kind: "http", status: 401, body: '{"detail":"Not authenticated"}' });
    expect(chatSendFailure(new ChatHttpError(0, ""))).toEqual({ ok: false, kind: "http", status: 0, body: "" });
  });
  it("Timeout: die Frist steht in `detail`, wo das Fenster sie liest", () => {
    expect(chatSendFailure(new ChatTimeoutError(120))).toEqual({ ok: false, kind: "timeout", detail: "no data for 120s" });
    expect(CHAT_WINDOW_STRINGS_EN.errTimeout(120)).toContain("120");
  });
  it("kein Endpunkt, Netzfehler und Abbruch haben je eine eigene Art", () => {
    expect(chatSendFailure(new ChatNoEndpointError())).toEqual({ ok: false, kind: "no-endpoint" });
    expect(chatSendFailure(new ChatNetworkError())).toEqual({ ok: false, kind: "network" });
    const abort = new Error("Aborted"); abort.name = "AbortError";
    expect(chatSendFailure(abort)).toEqual({ ok: false, kind: "aborted" });
  });
  it("ein Netzfehler trägt das Detail des Transports in `detail`, wo das Fenster es liest (Kit 0.70.0); ohne Detail bleibt es bei der Art", () => {
    expect(chatSendFailure(new ChatNetworkError("fetch failed: connect ECONNREFUSED 127.0.0.1:1234"))).toEqual({ ok: false, kind: "network", detail: "fetch failed: connect ECONNREFUSED 127.0.0.1:1234" });
    expect(chatSendFailure(new ChatNetworkError(""))).toEqual({ ok: false, kind: "network" });
    expect(new ChatNetworkError("x").message).toBe("Chat network error");   // die übersetzte Nachricht bleibt (Reformat-Vorschau, Smart Apply)
  });
  it("alles Unbekannte bleibt ein Wurf (`null`): das Fenster zeigt dann die Nachricht, statt sie zu erfinden", () => {
    expect(chatSendFailure(new Error("boom"))).toBeNull();
    expect(chatSendFailure("text")).toBeNull();
    expect(chatSendFailure(null)).toBeNull();
  });
});

describe("Fehlertexte der Fehlerklassen (Reformat-Vorschau und Smart Apply zeigen sie roh)", () => {
  it("sind übersetzt, in der Sprache der Oberfläche", () => {
    setLang("en");
    expect(new ChatNoEndpointError().message).toBe("No chat endpoint is reachable. Check the endpoints in the settings (or the LLM Endpoint Manager).");
    expect(new ChatNetworkError().message).toBe("Chat network error");
    expect(new ChatTimeoutError(120).message).toMatch(/120/);
    setLang("de");
    expect(new ChatNoEndpointError().message).toContain("Kein Chat-Endpunkt erreichbar");
    expect(new ChatNetworkError().message).toBe("Chat-Netzwerkfehler");
    setLang("en");
  });
  it("die Klassen sind Errors mit eigenem Namen", () => {
    expect(new ChatHttpError(500, "x")).toBeInstanceOf(Error);
    expect(new ChatNoEndpointError().name).toBe("ChatNoEndpointError");
    expect(new ChatNetworkError().name).toBe("ChatNetworkError");
  });
});
