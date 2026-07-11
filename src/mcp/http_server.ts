import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpTools } from "./tools";
import { registerTools } from "./register_tools";
import { isAuthorized } from "./auth";

export interface McpServerHandle { port: number; close(): Promise<void>; }

const BIND_HOST = "127.0.0.1";

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    });
    req.on("error", reject);
  });
}

/** Ein frischer McpServer + stateless Transport pro Request (kein Session-State).
 *  DNS-Rebinding-Schutz per allowedHosts als Defense-in-Depth (der Bearer-Token ist
 *  bereits die primäre Schranke; keine allowedOrigins, da Clients wie Claude Code
 *  keine Browser sind und ggf. keinen Origin-Header senden). */
async function handleMcp(req: IncomingMessage, res: ServerResponse, tools: McpTools, version: string, port: number): Promise<void> {
  const server = new McpServer({ name: "vault-retrieval", version });
  registerTools(server, tools);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
  });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  const body = await readBody(req);
  await transport.handleRequest(req, res, body);
}

/** Startet den in-Plugin HTTP-MCP-Server auf 127.0.0.1. Lazy require("node:http"),
 *  damit auf Mobile (wo der Start gegated ist) nie ein Node-Builtin geladen wird. */
export async function startMcpServer(opts: { port: number; token: string; tools: McpTools; version: string }): Promise<McpServerHandle> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment -- desktop-only, lazy: node:http nie auf Mobile laden (require global ist unbekannten Typs, Signatur via node:http-Typen unten sichergestellt)
  const http: typeof import("node:http") = require("node:http");
  let boundPort = opts.port;
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const url = req.url ?? "";
        if (!url.startsWith("/mcp")) { res.writeHead(404).end("Not Found"); return; }
        if (!isAuthorized(req.headers["authorization"], opts.token)) {
          res.writeHead(401, { "Content-Type": "text/plain" }).end("Unauthorized");
          return;
        }
        if (req.method !== "POST") { res.writeHead(405).end("Method Not Allowed"); return; }
        await handleMcp(req, res, opts.tools, opts.version, boundPort);
      } catch (e) {
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`MCP-Server-Fehler: ${String((e as Error).message ?? e)}`);
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, BIND_HOST, () => { server.off("error", reject); resolve(); });
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  boundPort = port;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
