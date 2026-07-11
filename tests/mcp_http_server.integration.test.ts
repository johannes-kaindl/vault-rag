// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { VaultIndex, IndexManifest } from "../src/index";
import { McpTools } from "../src/mcp/tools";
import type { McpDeps } from "../src/mcp/mcp_deps";
import { startMcpServer } from "../src/mcp/http_server";

const DIM = 4;
function index(): VaultIndex {
  const m: IndexManifest = { schema_version: 1, embedding_model: "x", index_dim: DIM, scale: 127, count: 2, granularity: "note", quant: "int8" };
  const v = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0]);
  return new VaultIndex(m, ["a.md", "b.md"], v);
}
const deps: McpDeps = {
  getIndex: () => index(),
  embedQuery: async () => new Float32Array([1, 0, 0, 0]),
  readNote: async (p) => `# ${p}`,
  settings: () => ({ k: 20, minSim: 0, exclude: [] }),
};

let handle: { close(): Promise<void>; port: number } | null = null;
afterEach(async () => { await handle?.close(); handle = null; });

// Ein MCP-initialize + tools/call in EINEM stateless POST-Muster.
async function mcpCall(port: number, token: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

describe("MCP HTTP-Server", () => {
  it("bindet auf 127.0.0.1 und liefert den Port", async () => {
    handle = await startMcpServer({ port: 0, token: "", tools: new McpTools(deps), version: "9.9.9" });
    expect(handle.port).toBeGreaterThan(0);
  });

  it("401 ohne/falschen Token wenn Token gesetzt", async () => {
    handle = await startMcpServer({ port: 0, token: "geheim", tools: new McpTools(deps), version: "9.9.9" });
    const r = await mcpCall(handle.port, "", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(r.status).toBe(401);
  });

  it("initialize antwortet mit dem Server-Namen bei gültigem Token", async () => {
    handle = await startMcpServer({ port: 0, token: "geheim", tools: new McpTools(deps), version: "9.9.9" });
    const r = await mcpCall(handle.port, "geheim", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(r.status).toBe(200);
    expect(r.text).toContain("vault-retrieval");
  });
});
