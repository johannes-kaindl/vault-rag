/** Klartext-Diagnose für den MCP-Server (Verbindungstest + Start-Fehler). Rein, obsidian-frei —
 *  Muster wie endpoint_diagnostics.ts. */

import { t } from "../vendor/kit/i18n";

export type SelfCheckResult = "ok" | "unauthorized" | "wrong-response" | "unreachable";

/** Klassifiziert die Antwort des eigenen Loopback-Servers auf einen initialize/tools-list-Call.
 *  Arbeitet auf dem rohen Text-Body → erkennt das JSON-RPC-result in JSON *und* SSE. */
export function classifySelfCheck(input: { networkError: boolean; status: number; bodyText: string }): SelfCheckResult {
  if (input.networkError) return "unreachable";
  if (input.status === 401) return "unauthorized";
  if (input.status === 200 && /"result"\s*:/.test(input.bodyText)) return "ok";
  return "wrong-response";
}

/** Grund eines fehlgeschlagenen Server-Starts. Ein CODE, kein Text: die Meldung wird an
 *  zwei Stellen angezeigt (Notice beim Start, Settings-Statuszeile) und der Grund wird
 *  dazwischen im Plugin-Zustand gehalten — als fertiger String hätte er die Sprache zum
 *  Fehlerzeitpunkt eingefroren. `raw` ist die Node-Meldung und damit unübersetzbar. */
export type StartErrorReason =
  | { kind: "port-in-use" }
  | { kind: "other"; raw: string | null };

/** Klassifiziert einen Server-Start-Fehler. Der belegte Port ist der einzige Fall, den wir
 *  benennen können — er ist zugleich der häufigste (zweite Obsidian-Instanz, alter Prozess). */
export function mapStartError(e: { code?: string; message?: string }): StartErrorReason {
  if (e.code === "EADDRINUSE") return { kind: "port-in-use" };
  return { kind: "other", raw: e.message ?? null };
}

/** Anzeigetext zu einem `StartErrorReason` — die einzige Stelle, an der aus ihm Text wird. */
export function describeStartError(reason: StartErrorReason): string {
  if (reason.kind === "port-in-use") return t("mcp.startError.portInUse");
  return reason.raw ?? t("mcp.startError.unknown");
}
