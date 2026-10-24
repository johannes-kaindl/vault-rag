// vendored from obsidian-kit@0.67.1, src/obsidian/chat-window.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/**
 * Chat-Fenster (UI-STANDARD §8, Baustein 12): Verlauf, Eingabe, Ablauf, Abbruch, Fehlerzeile und Leerzustand eines Fach-Chats.
 *
 * ## Warum dieses Modul NICHT sendet
 *
 * Vier Plugins haben ein Chat-Fenster je für sich gebaut (vault-rag `chat_view.ts`, kuro-gamification `KuroChatPanel.ts`,
 * settings-assistant `chat-view.ts`, dazu die Logik in neurovim-obsidian). Gleich war der Ablauf — Rundenliste, Denkblock offen
 * während des Laufs, Mitscrollen nur von unten, Senden/Stop, „Neu“, eine Fehlerzeile je Runde, fehlgeschlagene Runden gehen
 * nicht ans Modell. Verschieden war alles, was Fachsache ist: was über der Eingabe steht, was unter einer Antwort hängt.
 * Dieses Modul baut deshalb die Hülle und lässt diese Stellen als Einschübe (`composer`, `afterAnswer`, `header`) offen; den
 * Transport reicht das Plugin als `send(messages, handlers)` herein, das Fenster kennt keinen Endpunkt, keinen System-Prompt
 * und keinen Kontext. Spec: `25_Coding/obsidian-kit/_SDD/2026-10-10-chat-fenster-design.md` (Welle 16, mit Johannes) und die
 * Delta-Spec `2026-10-23-chat-fenster-design.md`; der Verlauf selbst ist code-kit `chat-history`.
 *
 * ## Was das Fenster erzwingt
 *
 * 1. **Die Eingabe verschwindet erst, wenn die Frage im Verlauf steht** (Entscheidung Johannes 2026-10-11): wirft ein Schritt davor,
 *    bleibt der Entwurf im Feld und die Frage wird zurückgenommen.
 * 2. **Eine Laufnummer verwirft alles, was ein alter Lauf noch meldet** (nach „Neu“, Abbruch, Abbau).
 * 3. **Gescheiterte und abgebrochene Runden gehen nicht ans Modell** (`historyForModel`).
 * 4. **Antworten werden immer als Markdown über `createStableWriter` gezeigt**: Neutralisierung als Grenze, `domGuard` als Netz.
 *    Es gibt keinen `raw`-Ausgang. Nutzereinträge sind Klartext.
 * 5. **Serverbegründung nur bei HTTP-Fehlern** (Entscheidung Johannes 2026-10-11); sonst werden `detail` und `body` nie gezeigt.
 *
 * ## Fallen beim Übernehmen
 *
 * 1. **Das Kit injiziert kein CSS.** `CHAT_WINDOW_CSS` gehört zusammen mit `STREAM_AREA_CSS` in die `styles.css` des Consumers.
 * 2. **`render` kommt vom Plugin** (`MarkdownRenderer.render` braucht dessen `App` und `Component`), wie beim `StableMarkdownWriter`.
 * 3. **`refresh()` zeichnet nie das Textfeld**, damit ein getippter Entwurf einen Neuaufbau überlebt.
 * 4. **Kein `role="log"`** am Verlauf: es ist implizit live und sagte jedes Token an. Angesagt wird nur die Zustandszeile.
 */

import { setIcon } from "obsidian";
import { buildReasoningBlock, buildStreamArea, type StreamArea } from "./stream-area";
import { createStableWriter, type StableMarkdownWriter } from "./stable-writer";
import { copyToClipboard } from "./clipboard";
import { realClock, type ClockPort } from "./clock";
import { resolveChatWindowStrings, type ChatWindowStrings, type ChatWindowStringsOverride } from "./chat-window-strings";
import { noEndpointText, resolveLlmConnectionStrings, transportMissingText } from "./llm-connection-strings";
import type { SourceKind } from "../kit/endpoint-source";
import { errorMessageFromText } from "../kit/error_body";
import {
  EMPTY_CHAT, abortAnswer, addExt, addUser, appendAnswer, canRetry, chatRounds, clearChat, failAnswer, finishAnswer, historyForModel,
  resetAnswerText, retryLast, setAnswerMeta, startAnswer, updateExt,
  type ChatAnswerEntry, type ChatError, type ChatExtEntry, type ChatHistory, type ChatModelMessage, type JsonValue,
} from "../kit/chat-history";

export type { ChatAnswerEntry, ChatExtEntry, ChatHistory, ChatModelMessage, JsonValue } from "../kit/chat-history";

/** Wie lange der Kopier-Knopf nach dem Kopieren das Häkchen zeigt. */
const COPIED_FLASH_MS = 1500;
/** Takt der Zeitanzeige neben der Zustandszeile. */
const TIMER_TICK_MS = 100;
/** Höchstlänge der Server-Begründung in der Fehlerzeile (ohne das „…“). */
const MAX_SERVER_REASON = 200;

export interface ChatSendHandlers {
  signal: AbortSignal;
  onToken(text: string): void;
  onReasoning(text: string): void;
  /** Nimmt zurück, was `onToken` bisher geliefert hat: es war das Denken (Gemma 4 ohne Öffner, `onContentReset` des Chat-Clients). */
  onContentReset(): void;
  /** Id der laufenden Antwort; für Plugins, die eigene Daten daran hängen. */
  answerId: number;
  /** Speichert Plugin-Daten an der laufenden Antwort (`meta`) und zeichnet `afterAnswer` für sie neu. */
  setMeta(meta: JsonValue): void;
}

/** Strukturelle Teilmenge von `LlmResult`: ein `LlmResult` ist ohne Umbau zuweisbar (Typtest). Gelesen werden `kind`, `status`,
 *  `body`/`detail` (nur bei `http`, und `detail` bei `timeout` für die Frist) sowie `source`/`reason`/`transport` für `no-endpoint`. */
export type ChatSendResult =
  | { ok: true; content: string; reasoning?: string; truncated?: boolean }
  | {
    ok: false; kind: string; partial?: string; status?: number; detail?: string; body?: string;
    source?: { kind: SourceKind }; reason?: string; transport?: string;
  };

export type ChatSendFailure = Extract<ChatSendResult, { ok: false }>;

export type ChatSend = (messages: readonly ChatModelMessage[], h: ChatSendHandlers) => Promise<ChatSendResult>;

export interface ChatExtensionContext {
  signal: AbortSignal;
  /** Neuer ext-Eintrag in der laufenden Runde, vor der Antwort; gibt die Id zurück. */
  emit(type: string, data: JsonValue, toModel?: ChatModelMessage[]): number;
  update(id: number, data: JsonValue, toModel?: ChatModelMessage[]): void;
  /** Text der Zustandszeile bis zum nächsten Zustandswechsel. */
  setStatus(text: string): void;
}

export interface ChatExtension {
  /** Umhüllt `send`; die erste Erweiterung der Liste ist die äußerste Hülle. */
  wrapSend?(send: ChatSend, ctx: ChatExtensionContext): ChatSend;
  /** Renderer je ext-Typ; `update` zeichnet den Eintrag neu. */
  render?: Record<string, (el: HTMLElement, entry: ChatExtEntry) => void>;
}

export interface ChatWindowOptions {
  send: ChatSend;
  /** Rendert Markdown in ein Element (Obsidian-Renderer, vom Plugin gestellt). */
  render: (el: HTMLElement, markdown: string) => Promise<void>;
  strings?: ChatWindowStringsOverride;
  /** Zusätzliche Klasse an der Wurzel — der Design-Scope des Consumers. */
  cls?: string;
  /** Enter sendet (Default `true`); `false` kehrt um: Umschalt+Enter sendet, Enter macht eine neue Zeile. Cmd/Strg+Enter sendet immer. */
  enterSends?: () => boolean;
  inputPosition?: () => "top" | "bottom";
  /** Kopfzeile des Fensters (Status, Modellzeile, Denk-Knopf). */
  header?: (el: HTMLElement) => void;
  /** Bereich über dem Textfeld (Kontext-Panel, Chips). */
  composer?: (el: HTMLElement) => void;
  /** Bereich unter jeder Antwort (Quellen, Profil-Blöcke); wird nach dem Ende der Antwort und nach jedem `setMeta` neu gezeichnet. */
  afterAnswer?: (el: HTMLElement, entry: ChatAnswerEntry) => void;
  /** Nur Anzeige: vor der Neutralisierung auf jeden stabilen Abschnitt und den Endtext angewandt (`StableWriterOptions.transform`). */
  answerTransform?: (markdown: string) => string;
  /** `false` hält das Senden an (Befehl im Plugin erledigt); der Entwurf bleibt stehen. */
  beforeSubmit?: (text: string) => boolean | Promise<boolean>;
  /** Solange `when()` wahr ist, zeigt das Fenster statt Verlauf und Eingabe eine Aufforderung mit genau einem Knopf. */
  empty?: { when: () => boolean; title: string; text: string; cta: { label: string; onClick: () => void } };
  extensions?: ChatExtension[];
  /** Ein vorhandener Verlauf (aus dem Speicher des Plugins). Eine Antwort, die laufen sollte, gilt als abgebrochen. */
  initial?: ChatHistory;
  onChange?: (history: ChatHistory) => void;
  /** Kopieren; Default `copyToClipboard`. `true` heißt kopiert. */
  copy?: (text: string) => Promise<boolean>;
  /** Durchgriff an `createStableWriter`, Default `true`; `false` nur im Test mit dem Fake-DOM. */
  domGuard?: boolean;
  clock?: ClockPort;
  /** Würfe aus Einschüben und `onChange`. Default `console.error`. */
  onError?: (error: unknown) => void;
  /** Überschreibt den Text zu `no-endpoint` (Default: `noEndpointText` aus dem Bündel der Sprache). */
  noEndpointText?: (r: ChatSendFailure) => string;
}

export interface ChatWindow {
  readonly rootEl: HTMLElement;
  history(): ChatHistory;
  submit(text?: string): Promise<void>;
  abort(): void;
  clear(): void;
  draft(): string;
  setDraft(text: string): void;
  refresh(): void;
  destroy(): void;
}

interface AnswerView {
  id: number;
  roundId: number;
  turnEl: HTMLElement;
  /** Hier hängen Denkblock und Antwortbereich; davor nichts, dahinter Aktionen, Hinweis und `afterAnswer` (Reihenfolge als Bauform). */
  contentEl: HTMLElement;
  area: StreamArea | null;
  writer: StableMarkdownWriter | null;
  actionsEl: HTMLElement;
  noteEl: HTMLElement;
  afterEl: HTMLElement;
  retryBtn: HTMLElement | null;
}

interface RoundView {
  id: number;
  el: HTMLElement;
  userTurnEl: HTMLElement;
  stepsEl: HTMLElement;
}

/** Eine Zeile, höchstens `MAX_SERVER_REASON` Zeichen plus „…“. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_SERVER_REASON ? `${flat.slice(0, MAX_SERVER_REASON)}…` : flat;
}

/** Die Begründung des Servers aus einem HTTP-Ergebnis: Feld-Kaskade über `body`, sonst `detail`; `""` ohne Verwertbares. */
function serverReason(r: ChatSendFailure): string {
  const fromBody = r.body !== undefined && r.body.trim() !== "" ? (errorMessageFromText(r.body.trim()) ?? r.body) : "";
  const raw = fromBody !== "" ? fromBody : (r.detail ?? "");
  return oneLine(raw);
}

/** Die Frist aus `detail` („no data for 600s“); `undefined`, wenn sie nicht zu lesen ist. */
function secondsOf(detail: string | undefined): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*s\b/.exec(detail ?? "");
  return m?.[1] !== undefined ? Number(m[1]) : undefined;
}

function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

export function buildChatWindow(parent: HTMLElement, opts: ChatWindowOptions): ChatWindow {
  const strings: ChatWindowStrings = resolveChatWindowStrings(opts.strings);
  const connectionStrings = resolveLlmConnectionStrings(opts.strings?.lang === undefined ? undefined : { lang: opts.strings.lang });
  const clock = opts.clock ?? realClock;
  const enterSends = opts.enterSends ?? ((): boolean => true);
  const extensions = opts.extensions ?? [];
  const reportError = opts.onError ?? ((e: unknown): void => { console.error(e); });
  const guarded = (fn: () => void): void => { try { fn(); } catch (e) { reportError(e); } };

  // ── Zustand ─────────────────────────────────────────────────────────────────────────────────────
  let history: ChatHistory = EMPTY_CHAT;
  if (opts.initial !== undefined) {
    history = opts.initial;
    // Ein Verlauf aus dem Speicher kann keine laufende Antwort fortsetzen.
    for (const e of history.entries) if (e.kind === "assistant" && e.state === "streaming") history = abortAnswer(history, e.id);
  }
  let runNo = 0;
  let running = false;
  let submitting = false;
  let destroyed = false;
  let controller: AbortController | null = null;
  let runStartedAt = 0;
  let timerHandle: number | null = null;
  let statusText = "";
  const copiedTimers = new Set<number>();
  const answerViews = new Map<number, AnswerView>();
  const roundViews = new Map<number, RoundView>();
  const extEls = new Map<number, HTMLElement>();
  let currentRound: RoundView | null = null;

  // ── Gerüst ──────────────────────────────────────────────────────────────────────────────────────
  const rootEl = parent.createDiv({ cls: "okit-chat" });
  for (const c of (opts.cls ?? "").split(/\s+/)) if (c !== "") rootEl.addClass(c);
  const headerEl = rootEl.createDiv({ cls: "okit-chat-header" });
  const emptyEl = rootEl.createDiv({ cls: "okit-chat-empty okit-chat-hidden" });
  // Die Reihenfolge von Verlauf und Eingabe ist Bauform: bei `"top"` entsteht die Eingabe zuerst.
  let composerTop = opts.inputPosition?.() === "top";
  const firstEl = rootEl.createDiv({ cls: composerTop ? "okit-chat-composer" : "okit-chat-log" });
  const secondEl = rootEl.createDiv({ cls: composerTop ? "okit-chat-log" : "okit-chat-composer" });
  const logEl = composerTop ? secondEl : firstEl;
  const composerEl = composerTop ? firstEl : secondEl;
  const composerExtraEl = composerEl.createDiv({ cls: "okit-chat-composer-extra" });
  const inputEl = composerEl.createEl("textarea", {
    cls: "okit-chat-input",
    attr: { rows: "1", "aria-label": strings.inputLabel, placeholder: strings.placeholder },
  });
  inputEl.value = "";
  const buttonsEl = composerEl.createDiv({ cls: "okit-chat-buttons" });
  const sendBtn = buttonsEl.createEl("button", { cls: "okit-chat-send mod-cta", attr: { type: "button" } });
  const newBtn = buttonsEl.createEl("button", { cls: "okit-chat-new", attr: { type: "button" }, text: strings.newChat });
  const statusbarEl = rootEl.createDiv({ cls: "okit-chat-statusbar" });
  const statusEl = statusbarEl.createDiv({ cls: "okit-chat-status", attr: { "aria-live": "polite" } });
  const timerEl = statusbarEl.createDiv({ cls: "okit-chat-timer", attr: { "aria-hidden": "true" } });
  const emptyHintEl = strings.emptyHistory === undefined ? null : logEl.createDiv({ cls: "okit-chat-hint", text: strings.emptyHistory });

  /** Die Zustandszeile ändert sich nur bei einem Zustandswechsel — sonst sagte ein Screenreader jedes Mal dasselbe an. */
  const setStatus = (text: string): void => {
    if (text === statusText) return;
    statusText = text;
    statusEl.setText(text);
  };

  /** `inputPosition()` kann sich mit einer Einstellung ändern: `refresh()` setzt die Eingabe dann um (im echten DOM verschiebt `insertBefore`). */
  const placeComposer = (): void => {
    const top = opts.inputPosition?.() === "top";
    rootEl.toggleClass("okit-chat--input-top", top);
    if (top === composerTop) return;
    composerTop = top;
    if (top) rootEl.insertBefore(composerEl, logEl); else rootEl.insertBefore(logEl, composerEl);
  };

  const syncSendButton = (): void => {
    const label = running ? strings.stop : strings.send;
    sendBtn.setText(label);
    sendBtn.setAttribute("aria-label", label);
    sendBtn.toggleClass("mod-warning", running);
  };

  const growInput = (): void => {
    // Per Skript statt `field-sizing` (Store-CSS-Lint): erst auf `auto`, dann auf die Inhaltshöhe; die Höchsthöhe steht im CSS.
    inputEl.setCssProps({ height: "auto" });
    const h = inputEl.scrollHeight ?? 0;
    if (h > 0) inputEl.setCssProps({ height: `${h}px` });
  };

  const focusInput = (): void => { inputEl.focus(); };

  // ── Kopieren ────────────────────────────────────────────────────────────────────────────────────
  const flash = (btn: HTMLElement): void => {
    setIcon(btn, "check");
    btn.addClass("is-copied");
    const id = clock.setTimeout(() => {
      copiedTimers.delete(id);
      setIcon(btn, "copy");
      btn.removeClass("is-copied");
    }, COPIED_FLASH_MS);
    copiedTimers.add(id);
  };

  const copyButton = (parentEl: HTMLElement, label: string, text: () => string): HTMLElement => {
    const btn = parentEl.createEl("button", { cls: "clickable-icon okit-chat-copy", attr: { type: "button", "aria-label": label } });
    setIcon(btn, "copy");
    btn.addEventListener("click", () => {
      const value = text();
      const done = opts.copy !== undefined
        ? opts.copy(value)
        : copyToClipboard(value, strings.copied === "" ? {} : { copiedMessage: strings.copied });
      void done.then((ok) => { if (ok && !destroyed) flash(btn); }).catch(reportError);
    });
    return btn;
  };

  // ── Fehlerzeile ─────────────────────────────────────────────────────────────────────────────────
  const errorText = (e: ChatError | undefined): string => {
    if (e === undefined) return strings.errGeneric;
    switch (e.kind) {
      case "timeout": return strings.errTimeout(e.seconds);
      case "network": return strings.errNetwork;
      case "http": {
        const text = strings.errHttp(e.status);
        return e.detail !== undefined && e.detail !== "" ? strings.errServer(text, e.detail) : text;
      }
      case "overflow": return strings.errOverflow;
      case "truncated": return strings.errTruncated;
      case "empty": return strings.errEmpty;
      case "no-endpoint": return e.message ?? strings.errGeneric;
      case "error": return strings.errThrown(e.message ?? "");
      default: return strings.errGeneric;
    }
  };

  const noEndpointMessage = (r: ChatSendFailure): string => {
    if (opts.noEndpointText !== undefined) return opts.noEndpointText(r);
    if (r.reason === "transport-missing" && r.transport !== undefined) return transportMissingText(connectionStrings, r.transport);
    return noEndpointText(connectionStrings, r.source ?? { kind: "local" }, r.detail ?? "");
  };

  const answerEntry = (id: number): ChatAnswerEntry | null => {
    const e = history.entries.find((x) => x.id === id);
    return e?.kind === "assistant" ? e : null;
  };

  /** „Erneut senden“ steht nur an der Antwort der letzten Runde, und nur solange sie gescheitert oder abgebrochen ist. */
  const syncRetry = (view: AnswerView): void => {
    const rounds = chatRounds(history);
    const lastEntries = rounds.length > 0 ? (rounds[rounds.length - 1]?.entries ?? []) : [];
    let lastAnswerId = -1;
    for (const e of lastEntries) if (e.kind === "assistant") lastAnswerId = e.id;
    const wanted = canRetry(history) && lastAnswerId === view.id && !running;
    if (!wanted) {
      view.retryBtn?.remove();
      view.retryBtn = null;
      return;
    }
    if (view.retryBtn !== null) return;
    const btn = view.noteEl.createEl("button", { cls: "okit-chat-retry", attr: { type: "button" }, text: strings.retry });
    btn.addEventListener("click", () => { void retry(); });
    view.retryBtn = btn;
  };

  const syncAllRetry = (): void => { for (const v of answerViews.values()) syncRetry(v); };

  /** Hinweise unter der Antwort: Fehler, Abbruch, Abschneiden. Der Text wird einmal gebaut und nicht neu gezeichnet. */
  const drawNote = (view: AnswerView, entry: ChatAnswerEntry): void => {
    view.noteEl.empty();
    view.retryBtn = null;
    if (entry.state === "failed") view.noteEl.createSpan({ cls: "okit-chat-error", attr: { role: "alert" }, text: errorText(entry.error) });
    else if (entry.state === "aborted") view.noteEl.createSpan({ cls: "okit-chat-aborted", text: strings.abortedLine });
    else if (entry.truncated === true) view.noteEl.createSpan({ cls: "okit-chat-hint", text: strings.hintTruncated });
    syncRetry(view);
  };

  const drawAfter = (view: AnswerView): void => {
    view.afterEl.empty();
    const entry = answerEntry(view.id);
    if (opts.afterAnswer !== undefined && entry !== null && entry.state !== "streaming") guarded(() => { opts.afterAnswer?.(view.afterEl, entry); });
  };

  const drawActions = (view: AnswerView, entry: ChatAnswerEntry): void => {
    view.actionsEl.empty();
    if (entry.text !== "") copyButton(view.actionsEl, strings.copyAnswer, () => answerEntry(entry.id)?.text ?? entry.text);
  };

  // ── Einträge zeichnen ───────────────────────────────────────────────────────────────────────────
  const scrollToEnd = (): void => { logEl.scrollTop = logEl.scrollHeight ?? 0; };

  const makeRound = (text: string, id: number): RoundView => {
    const el = logEl.createDiv({ cls: "okit-chat-round" });
    const userTurnEl = el.createDiv({ cls: "okit-chat-turn is-user" });
    userTurnEl.createDiv({ cls: "okit-chat-text", text });
    copyButton(userTurnEl, strings.copyQuestion, () => text);
    const stepsEl = el.createDiv({ cls: "okit-chat-steps" });
    const view: RoundView = { id, el, userTurnEl, stepsEl };
    roundViews.set(id, view);
    currentRound = view;
    return view;
  };

  const drawExt = (round: RoundView, entry: ChatExtEntry): void => {
    let el = extEls.get(entry.id);
    if (el === undefined) {
      el = round.stepsEl.createDiv({ cls: "okit-chat-turn is-ext" });
      extEls.set(entry.id, el);
    }
    el.empty();
    const target = el;
    for (const ext of extensions) {
      const draw = ext.render?.[entry.type];
      if (draw !== undefined) { guarded(() => { draw(target, entry); }); break; }
    }
  };

  const makeAnswerView = (round: RoundView, id: number): AnswerView => {
    const turnEl = round.el.createDiv({ cls: "okit-chat-turn is-assistant" });
    const contentEl = turnEl.createDiv({ cls: "okit-chat-answer" });
    const actionsEl = turnEl.createDiv({ cls: "okit-chat-actions" });
    const noteEl = turnEl.createDiv({ cls: "okit-chat-note" });
    const afterEl = turnEl.createDiv({ cls: "okit-chat-after" });
    const view: AnswerView = { id, roundId: round.id, turnEl, contentEl, area: null, writer: null, actionsEl, noteEl, afterEl, retryBtn: null };
    answerViews.set(id, view);
    return view;
  };

  const makeWriter = (area: StreamArea): StableMarkdownWriter => createStableWriter({
    area,
    render: opts.render,
    ...(opts.answerTransform === undefined ? {} : { transform: opts.answerTransform }),
    ...(opts.domGuard === undefined ? {} : { domGuard: opts.domGuard }),
    clock,
  });

  const areaStrings = {
    reasoning: strings.reasoning, copyReasoning: strings.copyReasoning,
    ...(strings.copiedReasoning === "" ? {} : { copiedReasoning: strings.copiedReasoning }),
  };

  const reasoningStrings = (summary: string): { summary: string; copyReasoning: string; copiedReasoning?: string } => ({
    summary, copyReasoning: strings.copyReasoning, ...(strings.copiedReasoning === "" ? {} : { copiedReasoning: strings.copiedReasoning }),
  });

  /** Eine fertige Antwort aus dem Verlauf (nicht laufend): derselbe Aufbau wie nach einem Lauf, ohne Strom. */
  const drawStaticAnswer = (round: RoundView, entry: ChatAnswerEntry): void => {
    const view = makeAnswerView(round, entry.id);
    if (entry.reasoning !== "") {
      buildReasoningBlock(view.contentEl, { text: entry.reasoning, strings: reasoningStrings(strings.reasoningDone), open: false, clock });
    }
    const area = buildStreamArea(view.contentEl, {
      strings: { reasoning: strings.reasoning }, scrollEl: logEl, bodyCls: "markdown-rendered", follow: false, clock,
    });
    view.area = area;
    if (entry.text !== "") {
      const writer = makeWriter(area);
      // Absatz für Absatz, wie der Strom: ein einziger Block hätte andere Abstände als derselbe Text nach einem Lauf (Pilot, 2026-10-23).
      for (const part of entry.text.match(/[\s\S]+?(?:\n\n|$)/g) ?? []) writer.push(part);
      writer.push("\n\n");
      writer.destroy();
    }
    drawActions(view, entry);
    drawNote(view, entry);
    drawAfter(view);
  };

  const rebuildLog = (): void => {
    for (const v of answerViews.values()) v.writer?.destroy();
    answerViews.clear();
    roundViews.clear();
    extEls.clear();
    currentRound = null;
    logEl.empty();
    if (emptyHintEl !== null) logEl.appendChild(emptyHintEl);
    for (const round of chatRounds(history)) {
      const rv = makeRound(round.user.text, round.user.id);
      for (const e of round.entries) {
        if (e.kind === "ext") drawExt(rv, e);
        else if (e.kind === "assistant") drawStaticAnswer(rv, e);
      }
    }
    syncAllRetry();
    emptyHintEl?.toggleClass("okit-chat-hidden", history.entries.length > 0);
    scrollToEnd();
  };

  // ── Leerzustand, Einschübe ──────────────────────────────────────────────────────────────────────
  const syncEmpty = (): void => {
    const emptyNow = opts.empty?.when() === true;
    emptyEl.empty();
    if (opts.empty !== undefined && emptyNow) {
      emptyEl.createDiv({ cls: "okit-chat-empty-title", text: opts.empty.title });
      emptyEl.createEl("p", { cls: "okit-chat-empty-text", text: opts.empty.text });
      const cta = emptyEl.createEl("button", { cls: "mod-cta", attr: { type: "button" }, text: opts.empty.cta.label });
      cta.addEventListener("click", () => { guarded(() => { opts.empty?.cta.onClick(); }); });
    }
    emptyEl.toggleClass("okit-chat-hidden", !emptyNow);
    logEl.toggleClass("okit-chat-hidden", emptyNow);
    composerEl.toggleClass("okit-chat-hidden", emptyNow);
    statusbarEl.toggleClass("okit-chat-hidden", emptyNow);
  };

  const drawSlots = (): void => {
    headerEl.empty();
    if (opts.header !== undefined) guarded(() => { opts.header?.(headerEl); });
    composerExtraEl.empty();
    if (opts.composer !== undefined) guarded(() => { opts.composer?.(composerExtraEl); });
    for (const round of chatRounds(history)) {
      const rv = roundViews.get(round.user.id);
      if (rv === undefined) continue;
      for (const e of round.entries) if (e.kind === "ext") drawExt(rv, e);
    }
    for (const v of answerViews.values()) drawAfter(v);
  };

  // ── Zeit und Zustand ────────────────────────────────────────────────────────────────────────────
  const stopTimer = (): void => {
    if (timerHandle !== null) { clock.clearTimeout(timerHandle); timerHandle = null; }
  };

  const tick = (): void => {
    timerEl.setText(strings.timerRunning((clock.now() - runStartedAt) / 1000));
    timerHandle = clock.setTimeout(tick, TIMER_TICK_MS);
  };

  const notifyChange = (): void => { guarded(() => { opts.onChange?.(history); }); };

  // ── Ablauf ──────────────────────────────────────────────────────────────────────────────────────
  /** Beendet den Lauf `myRun` mit dem Ergebnis. Ein veralteter Lauf (nach „Neu“, Abbruch, Abbau) tut nichts. */
  type Outcome = { kind: "ok"; r: Extract<ChatSendResult, { ok: true }> } | { kind: "aborted" } | { kind: "fail"; error: ChatError };
  const endRun = async (myRun: number, view: AnswerView, outcome: Outcome): Promise<void> => {
    if (myRun !== runNo) return;
    const area = view.area;
    const writer = view.writer;
    // Ab hier gehört der Lauf nicht mehr dem Strom: Rückrufe eines nachlaufenden `send` treffen die Laufnummer nicht mehr.
    runNo += 1;
    running = false;
    controller = null;
    stopTimer();
    const elapsed = (clock.now() - runStartedAt) / 1000;

    if (outcome.kind === "ok") {
      const content = outcome.r.content;
      if (content.trim() === "") {
        history = failAnswer(history, view.id, { kind: "empty" });
        setStatus(strings.statusFailed);
        timerEl.setText("");
      } else {
        history = finishAnswer(history, view.id, outcome.r.truncated === true ? { text: content, truncated: true } : { text: content });
        if (writer !== null) {
          // Weicht der Endtext vom gestreamten ab (wiederhergestellte Werte), wird die Antwort einmal neu gezeigt; sonst nur der Rest.
          if (content !== writer.raw()) { writer.resetContent(); writer.push(`${content}\n\n`); } else writer.push("\n\n");
          await writer.settled();
          // Bleibt ein Rest im Tail (ein offener Zaun ohne Schluss), geht er durch denselben Schreiber: ein Rendern daneben liefe am `domGuard` vorbei.
          writer.flush();
          await writer.settled();
          writer.destroy();
        }
        setStatus(strings.statusDone);
        timerEl.setText(strings.timerDone(elapsed));
      }
    } else if (outcome.kind === "aborted") {
      history = abortAnswer(history, view.id);
      writer?.destroy();
      setStatus(strings.statusAborted);
      timerEl.setText("");
    } else {
      history = failAnswer(history, view.id, outcome.error);
      writer?.destroy();
      setStatus(strings.statusFailed);
      timerEl.setText("");
    }

    const entry = answerEntry(view.id);
    if (entry !== null) {
      // Aktionszeile, Hinweis und Quellen machen den Verlauf nach dem Strom noch höher: wer unten stand, bleibt unten (Pilot, 2026-10-23: 49 px daneben).
      const settle = (): void => {
        if (area !== null) {
          if (entry.reasoning !== "") area.setReasoningSummary(strings.reasoningDone);
          area.setReasoningOpen(false);
        }
        drawActions(view, entry);
        drawNote(view, entry);
        drawAfter(view);
      };
      if (area !== null) area.withFollow(settle); else settle();
    }
    syncAllRetry();
    syncSendButton();
    syncEmpty();
    notifyChange();
    focusInput();
  };

  const runAnswer = async (): Promise<void> => {
    const started = startAnswer(history);
    history = started.history;
    const id = started.id;
    const round = currentRound;
    if (round === null) return;
    const view = makeAnswerView(round, id);
    const area = buildStreamArea(view.contentEl, {
      strings: areaStrings, reasoningOpen: true, scrollEl: logEl, bodyCls: "markdown-rendered", clock,
    });
    const writer = makeWriter(area);
    view.area = area;
    view.writer = writer;

    runNo += 1;
    const myRun = runNo;
    running = true;
    const ctl = new AbortController();
    controller = ctl;
    runStartedAt = clock.now();
    syncSendButton();
    syncAllRetry();
    setStatus(strings.statusThinking);
    tick();

    const fresh = (): boolean => myRun === runNo;
    let writing = false;
    const handlers: ChatSendHandlers = {
      signal: ctl.signal,
      answerId: id,
      onToken: (text) => {
        if (!fresh() || text === "") return;
        history = appendAnswer(history, id, { text });
        writer.push(text);
        if (!writing) { writing = true; setStatus(strings.statusWriting); }
      },
      onReasoning: (text) => {
        if (!fresh() || text === "") return;
        history = appendAnswer(history, id, { reasoning: text });
        area.appendReasoning(text);
      },
      onContentReset: () => {
        if (!fresh()) return;
        history = resetAnswerText(history, id);
        writer.resetContent();
      },
      setMeta: (meta) => {
        if (!fresh()) return;
        history = setAnswerMeta(history, id, meta);
        drawAfter(view);
      },
    };

    const ctx: ChatExtensionContext = {
      signal: ctl.signal,
      emit: (type, data, toModel) => {
        if (!fresh()) return -1;
        const added = addExt(history, type, data, toModel);
        history = added.history;
        const entry = history.entries.find((e) => e.id === added.id);
        if (entry?.kind === "ext" && currentRound !== null) drawExt(currentRound, entry);
        return added.id;
      },
      update: (extId, data, toModel) => {
        if (!fresh()) return;
        history = updateExt(history, extId, data, toModel);
        const entry = history.entries.find((e) => e.id === extId);
        if (entry?.kind === "ext" && currentRound !== null) drawExt(currentRound, entry);
      },
      setStatus: (text) => { if (fresh()) setStatus(text); },
    };

    const send = extensions.reduceRight<ChatSend>((inner, ext) => (ext.wrapSend ? ext.wrapSend(inner, ctx) : inner), opts.send);

    // Ein Abbruch beendet den Lauf sofort (`abort()`, `clear()`, `destroy()`), auch wenn `send` das Signal nicht beachtet und nie zurückkehrt:
    // das Rennen gibt `submit` dann frei, ein späteres Ergebnis trifft die Laufnummer nicht mehr.
    const stopped = new Promise<"stopped">((resolve) => { ctl.signal.addEventListener("abort", () => { resolve("stopped"); }); });
    const outcome = (async (): Promise<Outcome> => {
      let result: ChatSendResult;
      try {
        result = await send(historyForModel(history), handlers);
      } catch (e) {
        if (isAbortError(e) || ctl.signal.aborted) return { kind: "aborted" };
        return { kind: "fail", error: { kind: "error", message: e instanceof Error ? e.message : String(e) } };
      }
      if (result.ok) return { kind: "ok", r: result };
      if (result.kind === "aborted") return { kind: "aborted" };
      return { kind: "fail", error: failureOf(result) };
    })();
    const first = await Promise.race([outcome, stopped]);
    if (first === "stopped") { outcome.catch(reportError); return; }
    await endRun(myRun, view, first);
  };

  /** Das Ergebnis einer fehlgeschlagenen Anfrage als `ChatError`; Server-Begründung nur bei `http`. */
  const failureOf = (r: ChatSendFailure): ChatError => {
    const error: ChatError = { kind: r.kind };
    if (r.status !== undefined) error.status = r.status;
    if (r.kind === "timeout") {
      const seconds = secondsOf(r.detail);
      if (seconds !== undefined) error.seconds = seconds;
    } else if (r.kind === "http") {
      const reason = serverReason(r);
      if (reason !== "") error.detail = reason;
    } else if (r.kind === "no-endpoint") {
      error.message = noEndpointMessage(r);
    }
    return error;
  };

  const retry = async (): Promise<void> => {
    if (running || destroyed || !canRetry(history)) return;
    const round = currentRound;
    if (round === null) return;
    history = retryLast(history);
    // Die Runde behält ihre Frage; Antwort und Einträge des gescheiterten Laufs gehen aus der Ansicht.
    for (const [id, v] of answerViews) {
      if (v.roundId === round.id) { v.writer?.destroy(); answerViews.delete(id); }
    }
    for (const id of [...extEls.keys()]) if (!history.entries.some((e) => e.id === id)) extEls.delete(id);
    round.el.empty();
    round.el.appendChild(round.userTurnEl);
    round.stepsEl = round.el.createDiv({ cls: "okit-chat-steps" });
    notifyChange();
    await runAnswer();
  };

  // ── Öffentliche Schritte ────────────────────────────────────────────────────────────────────────
  const submit = async (text?: string): Promise<void> => {
    if (destroyed || running || submitting) return;
    const raw = text ?? inputEl.value;
    if (raw.trim() === "") return;
    submitting = true;
    try {
      if (opts.beforeSubmit !== undefined) {
        let go = true;
        try { go = await opts.beforeSubmit(raw); } catch (e) { reportError(e); go = false; }
        if (!go || destroyed) return;
      }
      // Erst Verlauf, Ansicht und `onChange`; erst danach darf das Textfeld leer werden (Entscheidung Johannes 2026-10-11).
      const before = history;
      const added = addUser(history, raw);
      history = added.history;
      let round: RoundView | null = null;
      try {
        emptyHintEl?.addClass("okit-chat-hidden");
        round = makeRound(raw, added.id);
        syncAllRetry();
        scrollToEnd();
        opts.onChange?.(history);
      } catch (e) {
        history = before;
        round?.el.remove();
        if (round !== null) roundViews.delete(added.id);
        currentRound = [...roundViews.values()].at(-1) ?? null;
        emptyHintEl?.toggleClass("okit-chat-hidden", history.entries.length > 0);
        reportError(e);
        return;
      }
      if (text === undefined || text === inputEl.value) { inputEl.value = ""; growInput(); }
      await runAnswer();
    } finally {
      submitting = false;
    }
  };

  const abort = (): void => {
    if (!running || controller === null) return;
    const ctl = controller;
    const view = [...answerViews.values()].at(-1);
    const myRun = runNo;
    ctl.abort();
    if (view !== undefined) void endRun(myRun, view, { kind: "aborted" });
  };

  const clear = (): void => {
    if (destroyed) return;
    if (running) { controller?.abort(); running = false; controller = null; stopTimer(); }
    runNo += 1;
    history = clearChat(history);
    rebuildLog();
    setStatus("");
    timerEl.setText("");
    syncSendButton();
    syncEmpty();
    notifyChange();
    focusInput();
  };

  const destroy = (): void => {
    if (destroyed) return;
    controller?.abort();
    runNo += 1;
    running = false;
    controller = null;
    stopTimer();
    for (const id of copiedTimers) clock.clearTimeout(id);
    copiedTimers.clear();
    for (const v of answerViews.values()) v.writer?.destroy();
    destroyed = true;
    rootEl.remove();
  };

  const refresh = (): void => {
    if (destroyed) return;
    placeComposer();
    drawSlots();
    syncAllRetry();
    syncEmpty();
  };

  // ── Tasten und Knöpfe ───────────────────────────────────────────────────────────────────────────
  inputEl.addEventListener("input", growInput);
  inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
    // Kompositionssperre zuerst: Enter bestätigt dort eine Umwandlung und sendet nichts.
    if (e.isComposing || e.key === "Process") return;
    if (e.key === "Escape") {
      if (running) { e.preventDefault(); abort(); }
      return;
    }
    if (e.key !== "Enter") return;
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); void submit(); return; }
    if (e.altKey) return;
    if (enterSends() ? !e.shiftKey : e.shiftKey) { e.preventDefault(); void submit(); }
  });
  sendBtn.addEventListener("click", () => { if (running) abort(); else void submit(); });
  newBtn.setAttribute("aria-label", strings.newChat);
  newBtn.addEventListener("click", () => { clear(); });

  // ── Aufbau ──────────────────────────────────────────────────────────────────────────────────────
  rootEl.toggleClass("okit-chat--input-top", composerTop);
  syncSendButton();
  drawSlots();
  rebuildLog();
  syncEmpty();

  return {
    rootEl,
    history: () => history,
    submit,
    abort,
    clear,
    draft: () => inputEl.value,
    setDraft: (text: string) => { inputEl.value = text; growInput(); },
    refresh,
    destroy,
  };
}

/** Gehört in die `styles.css` des Consumers (zusammen mit `STREAM_AREA_CSS`) — das Kit injiziert kein CSS.
 *  Nur Theme-Variablen, keine harten Farben oder Größen (UI-STANDARD). */
export const CHAT_WINDOW_CSS = `
.okit-chat { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: var(--size-4-2); }
.okit-chat-header:empty { display: none; }
.okit-chat-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--size-4-3); }
.okit-chat-round { display: flex; flex-direction: column; gap: var(--size-4-2); }
.okit-chat-turn { display: flex; flex-direction: column; gap: var(--size-4-2); min-width: 0; }
.okit-chat-turn.is-user {
  flex-direction: row; align-items: flex-start; justify-content: space-between; gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3); border-radius: var(--radius-m);
  background: var(--background-secondary);
}
.okit-chat-text { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.okit-chat-steps:empty { display: none; }
.okit-chat-actions { display: flex; gap: var(--size-4-1); }
.okit-chat-actions:empty { display: none; }
.okit-chat-copy { color: var(--text-faint); height: auto; padding: var(--size-2-1) var(--size-2-2); }
.okit-chat-copy.is-copied { color: var(--text-success); }
.okit-chat-copy .svg-icon { width: var(--icon-xs); height: var(--icon-xs); }
.okit-chat-note { display: flex; flex-wrap: wrap; align-items: center; gap: var(--size-4-2); font-size: var(--font-ui-small); }
.okit-chat-note:empty { display: none; }
.okit-chat-error { color: var(--text-error); }
.okit-chat-aborted, .okit-chat-hint { color: var(--text-muted); }
.okit-chat-after:empty { display: none; }
.okit-chat-composer { flex: 0 0 auto; display: flex; flex-direction: column; gap: var(--size-4-2); }
.okit-chat-composer-extra:empty { display: none; }
.okit-chat-input { width: 100%; resize: none; max-height: 12em; overflow-y: auto; }
.okit-chat-buttons { display: flex; gap: var(--size-4-2); justify-content: flex-end; }
.okit-chat-statusbar {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: var(--size-4-2);
  font-size: var(--font-ui-small); color: var(--text-muted);
}
.okit-chat-status:empty, .okit-chat-timer:empty { display: none; }
.okit-chat-empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--size-4-2); padding: var(--size-4-4); }
.okit-chat-empty-title { font-weight: var(--font-semibold); }
.okit-chat-empty-text { margin: 0; color: var(--text-muted); }
.okit-chat-hint { color: var(--text-faint); font-size: var(--font-ui-small); }
.okit-chat--input-top { flex-direction: column; }
/* Ans Ende UND mit der Wurzelklasse davor: die Regeln oben setzen display auf flex, und bei gleicher Spezifität gewönne die spätere. Im Fake-DOM der Tests
   unsichtbar, im echten Renderer blieb der Verlauf unter dem Leerzustand stehen (Pilot, 2026-10-23). */
.okit-chat .okit-chat-hidden { display: none; }
`;
