import { describe, it, expect } from "vitest";
import { classifySelfCheck, mapStartError, describeStartError } from "../src/mcp/mcp_diagnostics";
import "../src/i18n/strings"; // Register i18n strings

describe("classifySelfCheck", () => {
  it("Netzwerkfehler → unreachable", () => {
    expect(classifySelfCheck({ networkError: true, status: 0, bodyText: "" })).toBe("unreachable");
  });
  it("401 → unauthorized", () => {
    expect(classifySelfCheck({ networkError: false, status: 401, bodyText: "Unauthorized" })).toBe("unauthorized");
  });
  it("200 mit JSON-RPC-result (application/json) → ok", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "vault-retrieval" } } });
    expect(classifySelfCheck({ networkError: false, status: 200, bodyText: body })).toBe("ok");
  });
  it("200 mit SSE-gerahmtem result (text/event-stream) → ok", () => {
    const body = `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}\n\n`;
    expect(classifySelfCheck({ networkError: false, status: 200, bodyText: body })).toBe("ok");
  });
  it("200 aber kein MCP (z.B. HTML) → wrong-response", () => {
    expect(classifySelfCheck({ networkError: false, status: 200, bodyText: "<html>ok</html>" })).toBe("wrong-response");
  });
  it("406/andere Codes → wrong-response", () => {
    expect(classifySelfCheck({ networkError: false, status: 406, bodyText: "Not Acceptable" })).toBe("wrong-response");
  });
});

describe("mapStartError", () => {
  it("erkennt den belegten Port als eigenen Grund", () => {
    expect(mapStartError({ code: "EADDRINUSE", message: "listen EADDRINUSE" }))
      .toEqual({ kind: "port-in-use" });
  });
  it("reicht jeden anderen Grund als Rohmeldung weiter", () => {
    expect(mapStartError({ message: "boom" })).toEqual({ kind: "other", raw: "boom" });
  });
  it("bleibt ohne Message aussagefähig", () => {
    expect(mapStartError({})).toEqual({ kind: "other", raw: null });
  });
});

// Der Grund ist ein Code, der Text entsteht erst hier — sonst friert die Meldung die
// Sprache zum Fehlerzeitpunkt ein und die zwei Anzeigestellen (Notice + Settings-
// Statuszeile) müssten sie doppelt bauen.
describe("describeStartError", () => {
  it("benennt den belegten Port", () => {
    expect(describeStartError({ kind: "port-in-use" })).toBe("port already in use");
  });
  it("zeigt die Rohmeldung, wenn es eine gibt", () => {
    expect(describeStartError({ kind: "other", raw: "boom" })).toBe("boom");
  });
  it("fällt ohne Rohmeldung auf eine übersetzte Aussage zurück", () => {
    expect(describeStartError({ kind: "other", raw: null })).toBe("unknown error");
  });
});
