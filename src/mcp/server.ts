import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import { loadConfig } from "./config";
import { McpTools } from "./tools";
import { nodeProbe, embedQueryVector } from "./node_embed";
import manifest from "../../manifest.json";

/** Dünne SDK-Schale um McpTools: Arg-Parsing, Tool-Registrierung, Fehler → isError.
 *  stdout gehört dem Protokoll — Diagnose ausschließlich über stderr. */
const vaultPath = process.argv[2];
if (!vaultPath || !fs.existsSync(vaultPath)) {
  console.error("Usage: node mcp-server.js /pfad/zum/vault  (Vault-Ordner muss existieren)");
  process.exit(1);
}

const cfg = await loadConfig(vaultPath, process.env);
const tools = new McpTools(cfg, { probe: nodeProbe, embedQuery: embedQueryVector });
const server = new McpServer({ name: "vault-retrieval", version: manifest.version });

type ToolOut = { content: { type: "text"; text: string }[]; isError?: boolean };
const wrap = <A>(fn: (args: A) => Promise<unknown>) => async (args: A): Promise<ToolOut> => {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(args)) }] };
  } catch (e) {
    return { content: [{ type: "text", text: String((e as Error).message ?? e) }], isError: true };
  }
};

const kSchema = z.number().int().positive().optional().describe("Max. Trefferzahl (Default: Plugin-Setting)");
const minSimSchema = z.number().min(0).max(1).optional().describe("Mindest-Ähnlichkeit 0..1 (Default: Plugin-Setting)");

server.registerTool("search", {
  description: "Semantische Suche über den Obsidian-Vault (Embedding-Index des vault-retrieval-Plugins). Liefert {path, score}-Treffer; Volltext danach via read_note.",
  inputSchema: { query: z.string().describe("Suchanfrage (natürliche Sprache)"), k: kSchema, min_similarity: minSimSchema },
}, wrap(a => tools.search(a)));

server.registerTool("related", {
  description: "Inhaltlich verwandte Notizen zu einer gegebenen Notiz (offline, direkt aus dem Index).",
  inputSchema: { path: z.string().describe("Vault-relativer Notiz-Pfad, z. B. 'Ordner/Notiz.md'"), k: kSchema, min_similarity: minSimSchema },
}, wrap(a => tools.related(a)));

server.registerTool("read_note", {
  description: "Volltext einer Notiz aus dem Vault lesen (nur .md, exclude-Regeln respektiert).",
  inputSchema: { path: z.string().describe("Vault-relativer Notiz-Pfad") },
}, wrap(a => tools.readNote(a)));

await server.connect(new StdioServerTransport());
console.error(`vault-retrieval MCP ${manifest.version} bereit — Vault: ${vaultPath}`);
