/** Setup-Snippets für externe MCP-Clients. Rein datengetrieben (URL + Token rein, String raus),
 *  obsidian-frei → in Node testbar. Servername überall "vault-retrieval".
 *  `label` trägt einen `labelKey` statt des fertigen Textes (wie `reformat_transforms.ts`) —
 *  MCP_CLIENTS ist eine Modul-Konstante, `t()` darf dort nicht direkt stehen (t() niemals auf
 *  Modul-Ebene); der Renderer (`settings.ts`) übersetzt erst zur Zeichenzeit. `hint` ist dagegen
 *  ein technischer Konfigurations-Fragment-Bezeichner (CLI-Aufruf-Anfang, JSON-Blockname) —
 *  aktuell nirgends gerendert und selbst wenn: kein Fließtext, keine Übersetzung nötig. */

export type McpClientId = "claude-code" | "opencode" | "openclaw" | "generic";

export interface McpClient { id: McpClientId; labelKey: string; hint: string }

export const MCP_CLIENTS: McpClient[] = [
  { id: "claude-code", labelKey: "mcpClient.label.claudeCode", hint: "claude mcp add …" },   // i18n-exempt: technischer Konfig-Fragment-Bezeichner, kein Fließtext
  { id: "opencode", labelKey: "mcpClient.label.opencode", hint: "mcp-Block" },   // i18n-exempt: technischer Konfig-Fragment-Bezeichner, kein Fließtext
  { id: "openclaw", labelKey: "mcpClient.label.openclaw", hint: "mcp.servers-Block" },   // i18n-exempt: technischer Konfig-Fragment-Bezeichner, kein Fließtext
  { id: "generic", labelKey: "mcpClient.label.generic", hint: "mcpServers-Block" },   // i18n-exempt: technischer Konfig-Fragment-Bezeichner, kein Fließtext
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
