/** Fehlerarten des Chat-Transports und ihre Abbildung auf das Ergebnis, das das Kit-Chat-Fenster erwartet.
 *  Kein Transport, kein obsidian-Import.
 *
 *  Warum es das gibt: `ChatClient.stream` WIRFT (`ChatHttpError`, `ChatTimeoutError`, `ChatNoEndpointError`, `ChatNetworkError`, `AbortError`),
 *  das Fenster (`buildChatWindow`) erwartet ein `ChatSendResult`. Ein geworfener Fehler würde dort nur zu „Die Anfrage ist fehlgeschlagen: …“
 *  und verlöre die Begründung des Servers (HTTP 401 mit `{"detail":"Not authenticated"}`, unbekannter Modellname). Die Texte dazu stehen im Bündel
 *  des Kits (`errHttp`, `errServer`, `errTimeout`, `errNetwork`, …); hier bleibt nur die Zuordnung. Bis 0.45.0 übersetzte `chatErrorMessage` selbst:
 *  die Fassung des Kits ist inhaltsgleich (401/403 Schlüssel, 404 Adresse, 429 später, 5xx Server), die Feld-Kaskade des Bodys liegt im Kit
 *  (`error_body`, Kit 0.27.0).
 */

import { t } from "./vendor/kit/i18n";

/** Transportfehler MIT HTTP-Antwort. Trägt Status + Rohbody, damit die Anzeige-Schicht
 *  entscheiden kann — ein `Error("Chat HTTP 401")` hätte den Body bereits weggeworfen. */
export class ChatHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Chat HTTP ${status}`);
    this.name = "ChatHttpError";
  }
}

/** Der Server hat länger geschwiegen als die Frist des Kit-Clients (Idle-Timeout, bzw. bis zum
 *  ersten Chunk). Neu seit Welle 11 — vorher gab es überhaupt keinen Timeout. Die Nachricht ist
 *  schon übersetzt, weil dieser Fehler auch roh in Fehlerboxen landet (Reformat-Vorschau,
 *  Smart Apply). */
export class ChatTimeoutError extends Error {
  constructor(readonly seconds: number) {
    super(t("chatError.timeout", seconds));
    this.name = "ChatTimeoutError";
  }
}

/** Kein Chat-Endpunkt erreichbar. Die Nachricht ist übersetzt (Reformat-Vorschau und Smart Apply zeigen sie roh). */
export class ChatNoEndpointError extends Error {
  constructor() {
    super(t("error.noEndpoint"));
    this.name = "ChatNoEndpointError";
  }
}

/** Netzfehler ohne HTTP-Antwort. Die Nachricht ist übersetzt (siehe oben). */
export class ChatNetworkError extends Error {
  constructor() {
    super(t("sse.networkError"));
    this.name = "ChatNetworkError";
  }
}

/** Ein gescheiterter Chat-Aufruf in der Form, die das Kit-Fenster liest (`ChatSendFailure`: `kind`, `status`, `body`, `detail`). */
export interface ChatSendError {
  ok: false;
  kind: "http" | "timeout" | "no-endpoint" | "network" | "aborted";
  status?: number;
  body?: string;
  detail?: string;
}

/** Ordnet einen geworfenen Fehler des Chat-Clients dem Ergebnis des Fensters zu; `null` für alles Unbekannte (der Aufrufer wirft es weiter,
 *  das Fenster zeigt dann „Die Anfrage ist fehlgeschlagen: <Nachricht>“). */
export function chatSendFailure(e: unknown): ChatSendError | null {
  if (e instanceof ChatHttpError) return { ok: false, kind: "http", status: e.status, body: e.body };
  // Das Fenster liest die Frist aus `detail` („… 120s“).
  if (e instanceof ChatTimeoutError) return { ok: false, kind: "timeout", detail: `no data for ${e.seconds}s` };
  if (e instanceof ChatNoEndpointError) return { ok: false, kind: "no-endpoint" };
  if (e instanceof ChatNetworkError) return { ok: false, kind: "network" };
  if ((e as { name?: unknown } | null)?.name === "AbortError") return { ok: false, kind: "aborted" };
  return null;
}
