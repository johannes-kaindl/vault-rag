import { Platform } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpTools } from "./tools";
import { registerTools } from "./register_tools";
import { isAuthorized } from "./auth";

export interface McpServerHandle { port: number; close(): Promise<void>; }

const BIND_HOST = "127.0.0.1";

/** Strukturelle Ersatz-Typen für node:http IncomingMessage/ServerResponse, damit diese
 *  Datei nicht mehr statisch aus "node:http" importiert (obsidianmd/no-nodejs-modules
 *  meldet jeden statischen Import bedingungslos, auch `import type`). Nur die Members,
 *  die hier tatsächlich genutzt werden. */
interface HttpRequest {
  url?: string;
  method?: string;
  headers: { authorization?: string } & Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
}

interface HttpResponse {
  headersSent: boolean;
  writeHead(statusCode: number, headers?: Record<string, string>): this;
  end(chunk?: string): void;
  on(event: "close", listener: () => void): this;
}

function readBody(req: HttpRequest): Promise<unknown> {
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
async function handleMcp(req: HttpRequest, res: HttpResponse, tools: McpTools, version: string, port: number): Promise<void> {
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
  // req/res sind zur Laufzeit echte node:http-Objekte (aus http.createServer, s.u.); der Cast
  // auf den vom SDK erwarteten Parametertyp umgeht nur den fehlenden node:http-Typimport in
  // dieser Datei (s. HttpRequest/HttpResponse oben) und ist über Parameters<> an die tatsächliche
  // SDK-Signatur gebunden, statt einen eigenen (potenziell abweichenden) Typ zu behaupten.
  // Warnung für @modelcontextprotocol/sdk-Updates: Falls ein neues Member gefordert wird,
  // meldet der Cast einen Typfehler nicht — Interfaces selbst gegen die SDK-Signatur prüfen.
  await transport.handleRequest(
    req as unknown as Parameters<typeof transport.handleRequest>[0],
    res as unknown as Parameters<typeof transport.handleRequest>[1],
    body,
  );
}

/** node:http nur im `Platform.isDesktop`-Zweig laden. Diese Guard-Form (dynamic import im
 *  Ternary-Consequent) ist die EINZIGE, die BEIDE Store-Scan-Regeln besteht (2026-07-24
 *  durchgemessen, Spec 2026-07-23):
 *    - statischer `import "node:http"`  → obsidianmd/no-nodejs-modules (nie guard-fähig).
 *    - `require("node:http")`           → @typescript-eslint/no-require-imports.
 *    - `await import()` guarded         → besteht beide.
 *  Damit der guarded Import in Electron nicht als Netzwerk-Fetch bricht, schreibt das
 *  esbuild-Plugin `node-builtin-require` (esbuild.config.mjs) `node:*`-Importe im Bundle zu
 *  `require()` um — der Source bleibt store-sauber, das Bundle runtime-sicher. */
function importNodeHttp(): Promise<typeof import("node:http")> {
  return Platform.isDesktop ? import("node:http") : Promise.reject(new Error("Desktop-only"));
}

/** Startet den in-Plugin HTTP-MCP-Server auf 127.0.0.1. node:http kommt über den guarded
 *  dynamic import (s. importNodeHttp), nie auf Mobile geladen. */
export async function startMcpServer(opts: { port: number; token: string; tools: McpTools; version: string }): Promise<McpServerHandle> {
  // Defense-in-Depth: der Aufrufer gated bereits (main.ts), aber node:http darf auf Mobile
  // unter keinen Umständen geladen werden.
  if (!Platform.isDesktop) throw new Error("MCP-Server ist Desktop-only");
  const http = await importNodeHttp();
  let boundPort = opts.port;
  const server = http.createServer((req: HttpRequest, res: HttpResponse) => {
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
