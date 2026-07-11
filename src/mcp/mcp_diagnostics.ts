/** Klartext-Diagnose für den MCP-Server (Verbindungstest + Start-Fehler). Rein, obsidian-frei —
 *  Muster wie endpoint_diagnostics.ts. */

export type SelfCheckResult = "ok" | "unauthorized" | "wrong-response" | "unreachable";

/** Klassifiziert die Antwort des eigenen Loopback-Servers auf einen initialize/tools-list-Call.
 *  Arbeitet auf dem rohen Text-Body → erkennt das JSON-RPC-result in JSON *und* SSE. */
export function classifySelfCheck(input: { networkError: boolean; status: number; bodyText: string }): SelfCheckResult {
  if (input.networkError) return "unreachable";
  if (input.status === 401) return "unauthorized";
  if (input.status === 200 && /"result"\s*:/.test(input.bodyText)) return "ok";
  return "wrong-response";
}

/** Übersetzt einen Server-Start-Fehler in Klartext für die Statuszeile. */
export function mapStartError(e: { code?: string; message?: string }): string {
  if (e.code === "EADDRINUSE") return "Port belegt";
  return e.message ?? "unbekannter Fehler";
}
