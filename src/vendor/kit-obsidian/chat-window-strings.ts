// vendored from obsidian-kit@0.72.0, src/obsidian/chat-window-strings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Default-Texte (EN/DE) für `buildChatWindow` — nach dem Muster von `llm-connection-strings.ts`. Ohne sie formulierte jedes Plugin rund
 *  zwanzig Texte selbst, obwohl „Senden“ oder „Zugriff verweigert (HTTP 401)“ je Plugin nichts anderes heißen soll.
 *
 *  Herkunft des Wortlauts (UI-STANDARD § 10, die reichste Fassung je Text): vault-rag `src/i18n/strings.ts` (`panel.chat.*`,
 *  `chatError.*`, `chatSession.emptyResponse`) für Senden/Stop/Neu, Zustandszeile, Zeitanzeige und die HTTP-Fehler nach Status;
 *  kuro-gamification `src/i18n/` (`chat.err.*`, `chat.warn.truncated`) für Netz, Überlauf und das Abschneiden am Token-Limit;
 *  settings-assistant `src/i18n/strings.ts` (`chat.aborted`, `chat.stop`) für die Abbruchzeile. Eigene Formulierung, in keiner Fassung
 *  belegt: die `aria-label` der Kopier-Knöpfe, die Zustandszeile „fertig“/„Fehler“ und `errThrown`.
 *
 *  Nicht im Bündel: der Text für einen fehlenden Endpunkt. Er hängt an der Quelle (Manager oder lokale Liste) und liegt einmal in
 *  `LLM_CONNECTION_STRINGS_*` (`noEndpointText`); das Fenster holt ihn von dort, damit es eine Wahrheit bleibt.
 *
 *  Überschreiben: `strings: { lang: "de", placeholder: "Frag deinen Vault…" }` — Teil-Merge über dem Default der Sprache. */

export interface ChatWindowStrings {
  send: string;
  stop: string;
  newChat: string;
  /** `aria-label` des Textfelds. */
  inputLabel: string;
  placeholder: string;
  /** `aria-label` des Kopier-Knopfs an einer Frage. */
  copyQuestion: string;
  /** `aria-label` des Kopier-Knopfs an einer Antwort. */
  copyAnswer: string;
  /** Notice nach dem Kopieren; `""` heißt: nur die Quittung am Knopf. */
  copied: string;
  retry: string;
  /** Beschriftung des Denkblocks, solange die Antwort läuft. */
  reasoning: string;
  /** Beschriftung des Denkblocks nach dem Ende der Antwort. */
  reasoningDone: string;
  copyReasoning: string;
  copiedReasoning: string;
  /** Zustandszeile (`aria-live="polite"`): ändert sich nur bei einem Zustandswechsel. */
  statusThinking: string;
  statusWriting: string;
  statusDone: string;
  statusAborted: string;
  statusFailed: string;
  /** Zeitanzeige neben der Zustandszeile (`aria-hidden`, tickt im 100-ms-Takt). Nur die Dauer: dass die Antwort fertig ist, sagt die Zustandszeile (`statusDone`), die Anzeige darf es nicht wiederholen (Bildabnahme 2026-10-23: „done“ links, „✓ done in 3.0 s“ rechts). */
  timerRunning: (seconds: number) => string;
  timerDone: (seconds: number) => string;
  /** Zeile unter einer abgebrochenen Antwort. */
  abortedLine: string;
  /** Hinweis unter einer am Token-Limit abgeschnittenen Antwort. */
  hintTruncated: string;
  errEmpty: string;
  /** `seconds` fehlt, wenn die Frist aus dem Ergebnis nicht zu lesen war. */
  errTimeout: (seconds: number | undefined) => string;
  errNetwork: string;
  /** Hängt das (geschwärzte, gekürzte) Detail des Transports an den Netzfehlertext („fetch failed: connect ECONNREFUSED …“). */
  errNetworkDetail: (text: string, detail: string) => string;
  /** Nach Status: 401/403, 404, 429, 5xx, sonst „abgelehnt“. */
  errHttp: (status: number | undefined) => string;
  /** Hängt die gekürzte Begründung des Servers an einen HTTP-Text. */
  errServer: (text: string, reason: string) => string;
  errOverflow: string;
  errTruncated: string;
  errGeneric: string;
  /** Wurf aus `send`: allgemeiner Text plus die Meldung des Wurfs. */
  errThrown: (message: string) => string;
  /** Hinweis im leeren Verlauf (optional). */
  emptyHistory?: string;
}

export interface ChatWindowStringsOverride extends Partial<ChatWindowStrings> {
  lang?: "en" | "de";
}

export const CHAT_WINDOW_STRINGS_EN: ChatWindowStrings = {
  send: "Send",
  stop: "Stop",
  newChat: "New",
  inputLabel: "Message",
  placeholder: "Write a message…",
  copyQuestion: "Copy question",
  copyAnswer: "Copy answer",
  copied: "",
  retry: "Send again",
  reasoning: "💭 thinking…",
  reasoningDone: "💭 Thoughts",
  copyReasoning: "Copy thinking",
  copiedReasoning: "",
  statusThinking: "thinking",
  statusWriting: "writing",
  statusDone: "done",
  statusAborted: "stopped",
  statusFailed: "error",
  timerRunning: (s) => `${s.toFixed(1)} s`,
  timerDone: (s) => `${s.toFixed(1)} s`,
  abortedLine: "Stopped.",
  hintTruncated: "The answer was cut off at the token limit.",
  errEmpty: "Empty response from the model — check the endpoint and model in the settings.",
  errTimeout: (s) => (s === undefined
    ? "No answer from the model — it may still be loading or is stuck. Try again."
    : `No answer from the model for ${s} s — it may still be loading or is stuck. Try again.`),
  errNetwork: "Could not reach the endpoint — server down, wrong address, or network/VPN not connected.",
  errHttp: (status) => {
    if (status === undefined) return "Request rejected.";
    if (status === 401 || status === 403) return `Access denied (HTTP ${status}) — API key missing, invalid or expired.`;
    if (status === 404) return "Chat path not found (HTTP 404) — check the endpoint address.";
    if (status === 429) return "Too many requests (HTTP 429) — try again later.";
    if (status >= 500) return `Server error at the endpoint (HTTP ${status}).`;
    return `Request rejected (HTTP ${status}).`;
  },
  errServer: (text, reason) => `${text} — server: ${reason}`,
  errNetworkDetail: (text, detail) => `${text} (${detail})`,
  errOverflow: "The conversation is too long for the model.",
  errTruncated: "The answer was cut off before the first word — thinking used up the token limit.",
  errGeneric: "The request failed.",
  errThrown: (m) => `The request failed: ${m}`,
};

export const CHAT_WINDOW_STRINGS_DE: ChatWindowStrings = {
  send: "Senden",
  stop: "Stopp",
  newChat: "Neu",
  inputLabel: "Nachricht",
  placeholder: "Nachricht schreiben…",
  copyQuestion: "Frage kopieren",
  copyAnswer: "Antwort kopieren",
  copied: "",
  retry: "Erneut senden",
  reasoning: "💭 denkt nach…",
  reasoningDone: "💭 Gedanken",
  copyReasoning: "Gedanken kopieren",
  copiedReasoning: "",
  statusThinking: "denkt nach",
  statusWriting: "schreibt",
  statusDone: "fertig",
  statusAborted: "gestoppt",
  statusFailed: "Fehler",
  timerRunning: (s) => `${s.toFixed(1).replace(".", ",")} s`,
  timerDone: (s) => `${s.toFixed(1).replace(".", ",")} s`,
  abortedLine: "Abgebrochen.",
  hintTruncated: "Die Antwort wurde am Token-Limit abgeschnitten.",
  errEmpty: "Leere Antwort vom Modell — Endpunkt und Modell in den Einstellungen prüfen.",
  errTimeout: (s) => (s === undefined
    ? "Keine Antwort vom Modell — es lädt vielleicht noch oder hängt. Später erneut versuchen."
    : `Seit ${s} s keine Antwort vom Modell — es lädt vielleicht noch oder hängt. Später erneut versuchen.`),
  errNetwork: "Keine Verbindung zum Endpunkt — Server aus, Adresse falsch oder Netz/VPN nicht verbunden.",
  errHttp: (status) => {
    if (status === undefined) return "Anfrage abgelehnt.";
    if (status === 401 || status === 403) return `Zugriff verweigert (HTTP ${status}) — API-Schlüssel fehlt, ist ungültig oder abgelaufen.`;
    if (status === 404) return "Chat-Pfad nicht gefunden (HTTP 404) — Adresse des Endpunkts prüfen.";
    if (status === 429) return "Zu viele Anfragen (HTTP 429) — später erneut versuchen.";
    if (status >= 500) return `Server-Fehler am Endpunkt (HTTP ${status}).`;
    return `Anfrage abgelehnt (HTTP ${status}).`;
  },
  errServer: (text, reason) => `${text} — Server: ${reason}`,
  errNetworkDetail: (text, detail) => `${text} (${detail})`,
  errOverflow: "Das Gespräch ist zu lang für das Modell.",
  errTruncated: "Die Antwort wurde vor dem ersten Wort abgeschnitten — das Denken hat das Token-Limit verbraucht.",
  errGeneric: "Die Anfrage ist fehlgeschlagen.",
  errThrown: (m) => `Die Anfrage ist fehlgeschlagen: ${m}`,
};

/** Nur die gesetzten Felder: ein ausdrückliches `undefined` im Override überschriebe sonst den Default. */
function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Default der Sprache (EN ohne Angabe), Feld für Feld von `override` überlagert. */
export function resolveChatWindowStrings(override?: ChatWindowStringsOverride): ChatWindowStrings {
  const base = override?.lang === "de" ? CHAT_WINDOW_STRINGS_DE : CHAT_WINDOW_STRINGS_EN;
  if (!override) return base;
  const { lang: _lang, ...fields } = override;
  return { ...base, ...definedOnly(fields) };
}
