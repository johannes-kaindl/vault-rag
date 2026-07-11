import { describe, it, expect } from "vitest";
import { MCP_CLIENTS, buildClientSnippet, maskToken } from "../src/mcp/client_snippets";

const CTX = { url: "http://127.0.0.1:8123/mcp", token: "abcd1234abcd1234" };

describe("MCP_CLIENTS", () => {
  it("listet genau die vier Clients in stabiler Reihenfolge", () => {
    expect(MCP_CLIENTS.map(c => c.id)).toEqual(["claude-code", "opencode", "openclaw", "generic"]);
  });
});

describe("buildClientSnippet", () => {
  it("claude-code: CLI-Einzeiler mit transport http, url und Bearer-Header", () => {
    const s = buildClientSnippet("claude-code", CTX);
    expect(s).toContain("claude mcp add --transport http vault-retrieval");
    expect(s).toContain(CTX.url);
    expect(s).toContain(`Authorization: Bearer ${CTX.token}`);
  });

  it("opencode: gültiges JSON mit type=remote, url, headers", () => {
    const obj = JSON.parse(buildClientSnippet("opencode", CTX));
    expect(obj.mcp["vault-retrieval"]).toMatchObject({
      type: "remote",
      url: CTX.url,
      enabled: true,
      headers: { Authorization: `Bearer ${CTX.token}` },
    });
  });

  it("openclaw: gültiges JSON mit transport=streamable-http unter mcp.servers", () => {
    const obj = JSON.parse(buildClientSnippet("openclaw", CTX));
    expect(obj.mcp.servers["vault-retrieval"]).toMatchObject({
      url: CTX.url,
      transport: "streamable-http",
      headers: { Authorization: `Bearer ${CTX.token}` },
    });
  });

  it("generic: gültiges .mcp.json mit type=http unter mcpServers", () => {
    const obj = JSON.parse(buildClientSnippet("generic", CTX));
    expect(obj.mcpServers["vault-retrieval"]).toMatchObject({
      type: "http",
      url: CTX.url,
      headers: { Authorization: `Bearer ${CTX.token}` },
    });
  });
});

describe("maskToken", () => {
  it("zeigt die ersten 4 Zeichen + Ellipse bei langem Token", () => {
    expect(maskToken("abcd1234abcd1234")).toBe("abcd…");
  });
  it("maskiert kurze/leere Token vollständig", () => {
    expect(maskToken("")).toBe("••••");
    expect(maskToken("ab")).toBe("••••");
  });
});
