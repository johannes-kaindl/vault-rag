import { describe, it, expect } from "vitest";
import { classifySelfCheck, mapStartError } from "../src/mcp/mcp_diagnostics";

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
  it("EADDRINUSE → 'Port belegt'", () => {
    expect(mapStartError({ code: "EADDRINUSE", message: "listen EADDRINUSE" })).toBe("Port belegt");
  });
  it("sonst → Message durchreichen", () => {
    expect(mapStartError({ message: "boom" })).toBe("boom");
  });
  it("ohne Message → Fallback-Text", () => {
    expect(mapStartError({})).toBe("unbekannter Fehler");
  });
});
