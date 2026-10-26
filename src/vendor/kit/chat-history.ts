// vendored from code-kit@0.38.0, src/ts/pure/chat-history.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** The history of a chat window as pure data: rounds of one question and one answer, with the rule
 *  "only completed rounds go back to the model".
 *
 *  Four chat windows built this rule on their own (obsidian-plugins/, 2026-06..2026-10):
 *  `vault-rag/src/chat_session.ts`, `settings-assistant/src/obsidian/chat-session.ts` (`history()`),
 *  `kuro-gamification` `ChatSession.historyForPrompt()` and `neurovim-obsidian` `historyForPrompt`.
 *  All four drop a failed round, none stores the history (a stored history drags schema migrations
 *  into `data.json`). This module is that rule once, plus the bookkeeping around it.
 *
 *  ── What stayed with the callers, and why ───────────────────────────────────────────────
 *  Transport, streaming, abort, rendering and storage. The state holds plain JSON values only
 *  (`JSON.parse(JSON.stringify(h))` is a valid state with the same behaviour), so a caller that wants
 *  to keep a chat can; this module has no storage API and no clock. Data a plugin hangs on an answer
 *  (sources, the context that was sent) is `meta`; the model never reads it.
 *
 *  ── Rounds ───────────────────────────────────────────────────────────────────────────────
 *  A round is a `user` entry and every entry up to the next `user` entry. It is **complete** when
 *  its last answer is `done` with a non-empty text. Only complete rounds are sent to the model
 *  (`historyForModel`), plus the question of the round that is running right now. A failed or
 *  aborted round is dropped whole, question included: a half answer in the context makes the next
 *  answer worse, and the user sees the failed round and can retry it (`retryLast`).
 *
 *  ── Extension entries ────────────────────────────────────────────────────────────────────
 *  `ext` entries carry what a plugin shows between question and answer (a tool card, a step). They
 *  may carry `toModel` messages, which join the model history exactly when their round is complete.
 *
 *  All functions are pure: they return a new state or, where nothing changes, the same object, so a
 *  caller can skip a redraw with `next === prev`. A late call for an answer that is no longer
 *  running (an old stream, a cleared chat) changes nothing.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** One message as it goes to the model. Structurally assignable to obsidian-kit `ChatWireMessage`. */
export interface ChatModelMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: JsonValue;
  tool_call_id?: string;
  name?: string;
}

export type AnswerState = "streaming" | "done" | "aborted" | "failed";

export interface ChatError {
  /** `timeout`, `network`, `http`, `overflow`, `truncated`, `no-endpoint`, `empty`, `error`, ... as the caller names them. */
  kind: string;
  status?: number;
  seconds?: number;
  message?: string;
  detail?: string;
}

export interface ChatUserEntry { kind: "user"; id: number; text: string }

export interface ChatAnswerEntry {
  kind: "assistant";
  id: number;
  text: string;
  reasoning: string;
  state: AnswerState;
  error?: ChatError;
  /** `finish_reason: "length"` with text: valid, but cut off at the token limit. */
  truncated?: boolean;
  /** Data of the plugin on this answer (sources, the context that was sent, profile blocks). Never sent to the model. */
  meta?: JsonValue;
}

export interface ChatExtEntry { kind: "ext"; id: number; type: string; data: JsonValue; toModel?: ChatModelMessage[] }

export type ChatEntry = ChatUserEntry | ChatAnswerEntry | ChatExtEntry;

export interface ChatHistory {
  readonly entries: readonly ChatEntry[];
  /** The next id to hand out. Never goes back, not even after `clearChat`. */
  readonly nextId: number;
}

/** A user entry and what follows it up to the next user entry. */
export interface ChatRound {
  readonly user: ChatUserEntry;
  readonly entries: readonly ChatEntry[];
  readonly complete: boolean;
}

/** The empty chat. Shared and immutable. */
export const EMPTY_CHAT: ChatHistory = Object.freeze({ entries: Object.freeze<ChatEntry[]>([]), nextId: 1 });

function replaceAt(h: ChatHistory, index: number, entry: ChatEntry): ChatHistory {
  const entries = h.entries.slice();
  entries[index] = entry;
  return { entries, nextId: h.nextId };
}

function indexOfAnswer(h: ChatHistory, id: number): number {
  return h.entries.findIndex((e) => e.id === id && e.kind === "assistant");
}

/** The answer `id` if it exists and is still running, else `null`: every change to an answer goes through here. */
function running(h: ChatHistory, id: number): { index: number; entry: ChatAnswerEntry } | null {
  const index = indexOfAnswer(h, id);
  const entry = h.entries[index];
  return entry !== undefined && entry.kind === "assistant" && entry.state === "streaming" ? { index, entry } : null;
}

/** A new question. Returns the new state and the id of the entry. */
export function addUser(h: ChatHistory, text: string): { history: ChatHistory; id: number } {
  const id = h.nextId;
  return { history: { entries: [...h.entries, { kind: "user", id, text }], nextId: id + 1 }, id };
}

/** A new, running answer at the end. Returns the new state and the id of the answer. */
export function startAnswer(h: ChatHistory): { history: ChatHistory; id: number } {
  const id = h.nextId;
  const entry: ChatAnswerEntry = { kind: "assistant", id, text: "", reasoning: "", state: "streaming" };
  return { history: { entries: [...h.entries, entry], nextId: id + 1 }, id };
}

/** Text and reasoning that arrived on a running answer. */
export function appendAnswer(h: ChatHistory, id: number, patch: { text?: string; reasoning?: string }): ChatHistory {
  const hit = running(h, id);
  const text = patch.text ?? "";
  const reasoning = patch.reasoning ?? "";
  if (hit === null || (text === "" && reasoning === "")) return h;
  return replaceAt(h, hit.index, { ...hit.entry, text: hit.entry.text + text, reasoning: hit.entry.reasoning + reasoning });
}

/** Takes back the text shown so far, keeps the reasoning. For a model that wrote its thinking into the answer
 *  until a closing marker gave it away (Gemma 4 without an opener, `onContentReset` of the chat client). */
export function resetAnswerText(h: ChatHistory, id: number): ChatHistory {
  const hit = running(h, id);
  if (hit === null || hit.entry.text === "") return h;
  return replaceAt(h, hit.index, { ...hit.entry, text: "" });
}

/** Data of the plugin on an answer, in any state: a plugin may still add its sources after the answer ended. */
export function setAnswerMeta(h: ChatHistory, id: number, meta: JsonValue): ChatHistory {
  const index = indexOfAnswer(h, id);
  const entry = h.entries[index];
  if (entry === undefined || entry.kind !== "assistant") return h;
  return replaceAt(h, index, { ...entry, meta });
}

/** The answer ended well. `text` is the final text; it may differ from what was streamed (restored values). */
export function finishAnswer(h: ChatHistory, id: number, end: { text: string; truncated?: boolean }): ChatHistory {
  const hit = running(h, id);
  if (hit === null) return h;
  const next: ChatAnswerEntry = { ...hit.entry, text: end.text, state: "done" };
  if (end.truncated === true) next.truncated = true;
  return replaceAt(h, hit.index, next);
}

/** The answer failed. The partial text stays. */
export function failAnswer(h: ChatHistory, id: number, error: ChatError): ChatHistory {
  const hit = running(h, id);
  return hit === null ? h : replaceAt(h, hit.index, { ...hit.entry, state: "failed", error });
}

/** The answer was aborted. The partial text stays. */
export function abortAnswer(h: ChatHistory, id: number): ChatHistory {
  const hit = running(h, id);
  return hit === null ? h : replaceAt(h, hit.index, { ...hit.entry, state: "aborted" });
}

/** An entry of the plugin. While an answer runs it goes **before** that answer (the steps of a run stand before its
 *  answer, in the view and in the model history); otherwise it goes to the end. */
export function addExt(h: ChatHistory, type: string, data: JsonValue, toModel?: ChatModelMessage[]): { history: ChatHistory; id: number } {
  const id = h.nextId;
  const entry: ChatExtEntry = { kind: "ext", id, type, data };
  if (toModel !== undefined) entry.toModel = toModel;
  const last = h.entries[h.entries.length - 1];
  const entries = h.entries.slice();
  if (last !== undefined && last.kind === "assistant" && last.state === "streaming") entries.splice(entries.length - 1, 0, entry);
  else entries.push(entry);
  return { history: { entries, nextId: id + 1 }, id };
}

/** New data (and, when given, new `toModel`) for an ext entry. `[]` clears `toModel`. */
export function updateExt(h: ChatHistory, id: number, data: JsonValue, toModel?: ChatModelMessage[]): ChatHistory {
  const index = h.entries.findIndex((e) => e.id === id && e.kind === "ext");
  const entry = h.entries[index];
  if (entry === undefined || entry.kind !== "ext") return h;
  const next: ChatExtEntry = { ...entry, data };
  if (toModel !== undefined) next.toModel = toModel;
  return replaceAt(h, index, next);
}

function lastAnswer(entries: readonly ChatEntry[]): ChatAnswerEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e !== undefined && e.kind === "assistant") return e;
  }
  return null;
}

/** The rounds of a chat, in order. Entries before the first question belong to no round. */
export function chatRounds(h: ChatHistory): ChatRound[] {
  const rounds: ChatRound[] = [];
  let user: ChatUserEntry | null = null;
  let rest: ChatEntry[] = [];
  const close = (): void => {
    if (user === null) return;
    const answer = lastAnswer(rest);
    rounds.push({ user, entries: rest, complete: answer !== null && answer.state === "done" && answer.text !== "" });
  };
  for (const e of h.entries) {
    if (e.kind === "user") {
      close();
      user = e;
      rest = [];
    } else rest.push(e);
  }
  close();
  return rounds;
}

/** The last round, or `null` without one. */
export function lastRound(h: ChatHistory): ChatRound | null {
  const rounds = chatRounds(h);
  return rounds[rounds.length - 1] ?? null;
}

/** What goes to the model: every completed round (question, `toModel` messages of its ext entries, answer text) and,
 *  if the last round is running, its question. The reasoning never goes. Failed and aborted rounds do not go, question included. */
export function historyForModel(h: ChatHistory): ChatModelMessage[] {
  const out: ChatModelMessage[] = [];
  const rounds = chatRounds(h);
  rounds.forEach((round, i) => {
    const answer = lastAnswer(round.entries);
    const runningNow = i === rounds.length - 1 && answer !== null && answer.state === "streaming";
    if (!round.complete && !runningNow) return;
    out.push({ role: "user", content: round.user.text });
    if (!round.complete) return;
    for (const e of round.entries) {
      if (e.kind === "ext" && e.toModel !== undefined) out.push(...e.toModel);
      else if (e === answer && answer !== null) out.push({ role: "assistant", content: answer.text });
    }
  });
  return out;
}

/** Whether the last round failed or was aborted, so `retryLast` would do something. */
export function canRetry(h: ChatHistory): boolean {
  const round = lastRound(h);
  const answer = round === null ? null : lastAnswer(round.entries);
  return answer !== null && (answer.state === "failed" || answer.state === "aborted");
}

/** Takes the failed or aborted answer of the last round and its ext entries away and leaves the question standing.
 *  The caller then starts a new answer for the same question. Anything else: the same object. */
export function retryLast(h: ChatHistory): ChatHistory {
  if (!canRetry(h)) return h;
  let lastUser = -1;
  h.entries.forEach((e, i) => { if (e.kind === "user") lastUser = i; });
  return { entries: h.entries.slice(0, lastUser + 1), nextId: h.nextId };
}

/** The empty chat, but the ids keep counting: a late call with an old id must not hit a new entry. */
export function clearChat(h: ChatHistory): ChatHistory {
  return h.entries.length === 0 ? h : { entries: [], nextId: h.nextId };
}
