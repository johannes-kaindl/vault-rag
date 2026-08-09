/** Pure Übersetzung eines Chat-Transportfehlers in deutschen Klartext.
 *  Kein Transport, kein obsidian-Import — nur Fehler-Shape → Anzeigetext.
 *
 *  Warum es das gibt: der Chat-Pfad ersetzte JEDEN Fehler durch die Festmeldung
 *  „Chat-LLM nicht erreichbar (lokal/VPN)." — auch ein HTTP 401 mit
 *  `{"detail":"Not authenticated"}`. Die Ursache stand also in der Antwort und wurde
 *  gegen eine Vermutung getauscht, die bei einem gehosteten Endpunkt zusätzlich in die
 *  falsche Richtung zeigt (gemeldet 2026-08-05, externer OpenWebUI-Endpunkt).
 *
 *  `extractErrorMessage` ist übernommen aus vault-crews/src/core/chat-response.ts
 *  (REGISTRY: „Non-Streaming Chat-Response interpretieren", erstes Exemplar) und hier um
 *  `detail` ergänzt — die FastAPI-Form, die OpenWebUI und andere Python-Backends schicken.
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

/** Zieht eine einzeilige Fehler-Message aus einem JSON-Fehlerbody.
 *  Reihenfolge: error.message → error (String) → message → detail.
 *  null, wenn kein bekanntes Feld greift (Aufrufer nutzt dann den Rohbody). */
export function extractErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const err = body.error;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  if (typeof err === "string") return err;
  if (typeof body.message === "string") return body.message;
  if (typeof body.detail === "string") return body.detail;
  return null;
}

const MAX_DETAIL = 200;

/** Serverbegründung aus einem Rohbody: erst als JSON, sonst gekürzter Rohtext.
 *  "" wenn nichts Verwertbares drinsteht. */
function serverDetail(body: string): string {
  const raw = body.trim();
  if (!raw) return "";
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  const msg = extractErrorMessage(parsed) ?? raw;
  const oneLine = msg.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL ? `${oneLine.slice(0, MAX_DETAIL)}…` : oneLine;
}

function withDetail(text: string, detail: string): string {
  return detail ? t("chatError.serverDetail", text, detail) : text;
}

/** EINE Wahrheit für den Fehlertext einer fehlgeschlagenen Chat-Anfrage. */
export function chatErrorMessage(e: unknown): string {
  if (e instanceof ChatHttpError) {
    const detail = serverDetail(e.body);
    if (e.status === 401 || e.status === 403) {
      return withDetail(t("chatError.denied", e.status), detail);
    }
    if (e.status === 404) {
      return withDetail(t("chatError.notFound"), detail);
    }
    if (e.status === 429) {
      return withDetail(t("chatError.tooMany"), detail);
    }
    if (e.status >= 500) {
      return withDetail(t("chatError.serverError", e.status), detail);
    }
    // 400 und andere 4xx: die Begründung des Servers ist hier der eigentliche Inhalt
    // (fehlender/unbekannter Modellname, ungültige Parameter).
    return withDetail(t("chatError.rejected", e.status), detail);
  }
  return t("chatError.unreachable");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
