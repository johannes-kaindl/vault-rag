import { describe, it, expect } from "vitest";
import { ChatHttpError, chatErrorMessage } from "../src/chat_error";
import "../src/i18n/strings"; // Register i18n strings

// Die Feld-Kaskade selbst liegt seit Kit 0.27.0 in `vendor/kit/error_body` und ist dort
// getestet. Hier steht, was DIESES Repo zusagt: dass die Begründung des Servers durch
// `serverDetail` hindurch in der Meldung ankommt — über die Kaskade, den Rohtext-Fallback
// und die Kürzung. Geprüft wird über den öffentlichen Weg, nicht am internen Helfer.
describe("Serverbegründung in der Fehlermeldung", () => {
  const detailOf = (body: string) => chatErrorMessage(new ChatHttpError(400, body));

  it("zieht error.message aus einem OpenAI-Fehlerbody", () => {
    expect(detailOf('{"error":{"message":"model not found"}}')).toContain("model not found");
  });
  it("zieht error, wenn es selbst ein String ist", () => {
    expect(detailOf('{"error":"kaputt"}')).toContain("kaputt");
  });
  it("zieht message als Rückfall", () => {
    expect(detailOf('{"message":"hoppla"}')).toContain("hoppla");
  });
  it("zieht detail — die FastAPI-Form, die OpenWebUI schickt", () => {
    expect(detailOf('{"detail":"Not authenticated"}')).toContain("Not authenticated");
  });
  it("nimmt den Rohbody, wenn kein bekanntes Feld greift", () => {
    expect(detailOf('{"irgendwas":1}')).toContain('{"irgendwas":1}');
  });
  it("ein leerer Fehlerwert zeigt jetzt den Rohbody statt gar nichts", () => {
    // Verhaltensänderung mit Kit 0.27.0 (Fix-Richtung): vorher gab die lokale Kaskade für
    // `{"error":""}` den leeren String zurück. `""` ist nicht nullish, der `?? raw`-Fallback
    // griff also NICHT und die Begründung fiel komplett weg. Jetzt fällt der Leerwert durch.
    expect(detailOf('{"error":""}')).toContain('{"error":""}');
  });
  it("kürzt eine überlange Begründung statt sie ungebremst anzuzeigen", () => {
    const msg = detailOf(JSON.stringify({ detail: "x".repeat(500) }));
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(300);
  });
  it("faltet Zeilenumbrüche der Begründung auf eine Zeile", () => {
    expect(detailOf('{"detail":"Zeile1\nZeile2"}')).toContain("Zeile1 Zeile2");
  });
});

describe("chatErrorMessage", () => {
  it("401 nennt den Schlüssel als Ursache statt das Netz", () => {
    const msg = chatErrorMessage(new ChatHttpError(401, '{"detail":"Not authenticated"}'));
    expect(msg).toContain("401");
    expect(msg).toMatch(/API key/);
    expect(msg).not.toMatch(/VPN/);
  });
  it("403 wird wie 401 als Zugriffsproblem gemeldet", () => {
    expect(chatErrorMessage(new ChatHttpError(403, ""))).toMatch(/API key/);
  });
  it("400 zeigt die Serverbegründung — dort steht der eigentliche Grund", () => {
    const msg = chatErrorMessage(new ChatHttpError(400, '{"error":{"message":"model \\"\\" not found"}}'));
    expect(msg).toContain('model "" not found');
  });
  it("404 zeigt auf die Adresse, nicht auf die Erreichbarkeit", () => {
    const msg = chatErrorMessage(new ChatHttpError(404, ""));
    expect(msg).toContain("404");
    expect(msg).toMatch(/address|path/);
  });
  it("5xx wird als Server-Fehler gemeldet, nicht als Konfigurationsfehler", () => {
    expect(chatErrorMessage(new ChatHttpError(502, ""))).toMatch(/Server/);
  });
  it("nicht-JSON-Body wird gekürzt durchgereicht statt verworfen", () => {
    const msg = chatErrorMessage(new ChatHttpError(500, "<html>Gateway kaputt</html>"));
    expect(msg).toContain("Gateway kaputt");
  });
  it("ein Fehler ohne HTTP-Status bleibt der Erreichbarkeits-Fall", () => {
    const msg = chatErrorMessage(new Error("Chat-Netzwerkfehler"));
    expect(msg).toMatch(/unreachable/);
  });
  it("nennt beim Erreichbarkeits-Fall nicht mehr nur lokal/VPN — Cloud-Endpunkte gibt es auch", () => {
    // Regression: die alte Festmeldung riet „(lokal/VPN)" und schickte damit jeden
    // Nutzer eines gehosteten Endpunkts in die falsche Richtung.
    expect(chatErrorMessage(new Error("boom"))).not.toBe("Chat LLM unreachable (local/VPN).");
  });
});

describe("chatErrorMessage i18n", () => {
  it("nennt 401 auf Englisch", () => {
    expect(chatErrorMessage(new ChatHttpError(401, "")))
      .toBe("Access denied (HTTP 401) — API key missing, invalid or expired.");
  });
  it("nennt den Offline-Fall auf Englisch", () => {
    expect(chatErrorMessage(new Error("boom")))
      .toBe("Chat LLM unreachable — server down, wrong address, or network/VPN not connected.");
  });
});
