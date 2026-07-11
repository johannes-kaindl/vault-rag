// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
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

// Roher node:http-Request mit gefälschtem Host-Header (fetch() verbietet das Überschreiben
// von Host, daher hier bewusst node:http statt fetch).
function rawRequest(port: number, host: string, body: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Host": host,
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c: Buffer) => { text += c.toString("utf-8"); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
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

  it("lehnt gefälschten Host-Header ab (DNS-Rebinding-Schutz)", async () => {
    handle = await startMcpServer({ port: 0, token: "", tools: new McpTools(deps), version: "9.9.9" });
    const r = await rawRequest(handle.port, "evil.com", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(r.status).toBe(403);
  });
});
