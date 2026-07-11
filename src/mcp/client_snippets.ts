/** Setup-Snippets für externe MCP-Clients. Rein datengetrieben (URL + Token rein, String raus),
 *  obsidian-frei → in Node testbar. Servername überall "vault-retrieval". */

export type McpClientId = "claude-code" | "opencode" | "openclaw" | "generic";

export interface McpClient { id: McpClientId; label: string; hint: string }

export const MCP_CLIENTS: McpClient[] = [
  { id: "claude-code", label: "Claude Code (CLI)", hint: "claude mcp add …" },
  { id: "opencode", label: "OpenCode (opencode.json)", hint: "mcp-Block" },
  { id: "openclaw", label: "OpenClaw (config)", hint: "mcp.servers-Block" },
  { id: "generic", label: "Generisch (.mcp.json)", hint: "mcpServers-Block" },
];

const SERVER_NAME = "vault-retrieval";

export function buildClientSnippet(id: McpClientId, ctx: { url: string; token: string }): string {
  const auth = `Bearer ${ctx.token}`;
  switch (id) {
    case "claude-code":
      return `claude mcp add --transport http ${SERVER_NAME} ${ctx.url} --header "Authorization: ${auth}"`;
    case "opencode":
      return JSON.stringify({
        mcp: { [SERVER_NAME]: { type: "remote", url: ctx.url, enabled: true, headers: { Authorization: auth } } },
      }, null, 2);
    case "openclaw":
      return JSON.stringify({
        mcp: { servers: { [SERVER_NAME]: { url: ctx.url, transport: "streamable-http", headers: { Authorization: auth } } } },
      }, null, 2);
    case "generic":
      return JSON.stringify({
        mcpServers: { [SERVER_NAME]: { type: "http", url: ctx.url, headers: { Authorization: auth } } },
      }, null, 2);
  }
}

/** Anzeige-Maske: erste 4 Zeichen + Ellipse; kurze/leere Token voll maskiert. */
export function maskToken(token: string): string {
  return token.length >= 5 ? `${token.slice(0, 4)}…` : "••••";
}
