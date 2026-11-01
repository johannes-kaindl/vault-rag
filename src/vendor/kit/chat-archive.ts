// vendored from code-kit@0.40.0, src/ts/pure/chat-archive.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** The archive of a chat window as plain data: a title from the first question, a file name, a record with a header
 *  and a payload, the clean-up after a restart, and the choice of what to delete when a keep limit is reached.
 *
 *  Origin (obsidian-kit chat-head design, wave 28, section "Verlauf"; measured 2026-10-27): there is no chat archive in
 *  the workspace. Three things stood near it. `historyLabel` of local-image-generator (`src/core/history.ts`) is the title
 *  rule, taken over here (it can be swapped for {@link chatTitle}). `chat-history` is the pure state this record carries
 *  ("so a caller that wants to keep a chat can"). Koda's `SessionStore` (a JSONL per session, `archive.jsonl` without a
 *  separator) is the counter-example: a log that cannot be split is not an archive, so the record here is one JSON object
 *  per file. The storage itself (folder, read, write, list, `stat`) and the dialog stay with obsidian-kit.
 *
 *  Pure: no file, no clock, no I/O. A `Date` comes from the caller as an argument, as in `local-stamp`.
 *
 *  ── Title ({@link chatTitle}) ────────────────────────────────────────────────────────────
 *  The rule of `historyLabel`: whitespace runs become one space, trim, cut to `max` with an ellipsis, length exactly
 *  `max`. **One difference, on purpose:** `max` counts characters (code points), not UTF-16 units, so the cut never
 *  leaves half of a surrogate pair. For text without emoji the two give the same result (the three cases of
 *  `historyLabel`'s tests are in this module's tests word for word). A multi-code-point emoji (a ZWJ family, a flag) can
 *  still be cut between its parts: that leaves valid text with a different glyph, not a broken string, and grapheme
 *  segmentation is not worth a runtime dependency here. The cut text is not trimmed again (`historyLabel` does not
 *  either), so `"a b c"` cut after the space reads `"a …"`.
 *
 *  ── File name ({@link chatFileName}, {@link uniqueChatFileName}) ─────────────────────────
 *  `2026-10-27 14-02 <title>.json`: the stamp is {@link localFileStamp}, not the `HHmm` of the draft: the library already
 *  has a file stamp and a second spelling of the same thing is drift (decision of the master, 2026-10-27). The stamp
 *  sorts, the title is for the eye; the list of an archive needs no index because the folder is the list.
 *  **The length limit is bytes, not characters:** file systems cap a name at 255 bytes of UTF-8 (APFS, ext4, NTFS in
 *  UTF-16 units is looser). `clipText` (`filename-template.ts`) cuts in UTF-16 units, may split a pair (its comment says
 *  so) and knows no bytes; a half pair in a name is not valid UTF-8. So this module cuts the title by whole code points
 *  until the **whole name** fits in 255 bytes, then trims. `clipText` stays as it is: its callers rely on the exact
 *  `slice` (measured in `filename-template.ts`).
 *  Two chats with the same title in the same minute: uniqueness belongs to the caller, who knows the folder.
 *  {@link uniqueChatFileName} is the small pure part of it (` 2`, ` 3`, … before the extension, compared without regard to
 *  case because macOS and Windows file systems do).
 *
 *  ── Record ({@link buildChatRecord}, {@link parseChatRecord}) ────────────────────────────
 *  Schema `okitChat: 1`. The header is checked, the `payload` is not: it is `JsonValue` and nobody looks inside. A chat
 *  window host stores its `ChatHistory` (`payloadType: "okit-chat-history/1"`), another host stores its own thing (Koda
 *  `"koda-log/1"`) and validates it itself. A broken or unknown file costs its entry, not the list: {@link parseChatRecord}
 *  returns `null` and never throws (an unknown or higher schema version, a missing or mistyped field, a date that is not
 *  a date). The caller leaves such a file untouched on disk and counts it, so the loss is visible (CORE-DATA-01).
 *  `thinking` is one of the six `THINKING_LEVELS` or `null`: a seventh level is a new schema version, an older kit then
 *  skips the file instead of reading a level it does not know. `model` may be `null` (nothing chosen when the chat ended).
 *  Dates are ISO-8601 strings; {@link buildChatRecord} writes UTC (`…Z`), and a string that is passed (the `created` of a
 *  chat that is continued) is kept as it is if it has the shape.
 *
 *  ── Restore ({@link restoreChatHistory}) ─────────────────────────────────────────────────
 *  A history that was written while an answer ran holds an answer in state `streaming`; after a restart nothing is
 *  running, so it becomes `aborted` (the partial text stays, `retryLast` can take it from there). **Only for the payload
 *  type `okit-chat-history/1`.** A host with its own payload does this itself: its state is not an `AnswerState`.
 *
 *  ── Keep limit ({@link selectChatsToDelete}) ─────────────────────────────────────────────
 *  Not `selectRotatedOut` of `rotation.ts`: that one sorts the **names** and needs names that sort in time order. Here
 *  the order is the file's `updated` (a chat that is continued moves up, its name stays), and equal times are decided by
 *  name so the result does not depend on the order of the listing. The function does not know files or the clock.
 */

import { abortAnswer, type ChatHistory, type JsonValue } from "./chat-history";
import { sanitizeFilename } from "./filename-template";
import { localFileStamp } from "./local-stamp";
import { THINKING_LEVELS, type ThinkingLevel } from "./sampling-profiles";

// ── Title ────────────────────────────────────────────────────────────────────────────────

/** The title of an empty first question. A caller that shows another language passes its own `fallback`. */
export const DEFAULT_CHAT_TITLE = "Untitled chat";

/** The default length of a title, in characters. */
const TITLE_MAX = 60;

/** The title of a chat from its first question: whitespace runs to one space, trimmed, at most `max` characters (code
 *  points; default 60), longer text cut to `max - 1` characters plus `…`. Empty text gives `fallback`.
 *  A `max` below 1 counts as 1 and a fraction is floored; `NaN` means the default.
 *  @example chatTitle("  how do\n I link  ") // → "how do I link" */
export function chatTitle(firstQuestion: string, max: number = TITLE_MAX, fallback: string = DEFAULT_CHAT_TITLE): string {
  const flat = firstQuestion.replace(/\s+/g, " ").trim();
  if (flat === "") return fallback;
  const limit = Number.isNaN(max) ? TITLE_MAX : Math.max(1, Math.floor(max));
  // Count one code point past the limit and stop: a first question may be a pasted page.
  let kept = "";
  let n = 0;
  for (const ch of flat) {
    if (n === limit) return `${kept}…`;
    if (n < limit - 1) kept += ch;
    n += 1;
  }
  return flat;
}

// ── File name ────────────────────────────────────────────────────────────────────────────

/** What a file name may take on the usual file systems, in bytes of UTF-8. */
const MAX_NAME_BYTES = 255;

const encoder = new TextEncoder();
const byteLength = (s: string): number => encoder.encode(s).length;

/** `s` cut after whole code points to at most `maxBytes` bytes of UTF-8, then trimmed at the end. */
function clipBytes(s: string, maxBytes: number): string {
  let used = 0;
  let out = "";
  for (const ch of s) {
    const width = byteLength(ch);
    if (used + width > maxBytes) break;
    used += width;
    out += ch;
  }
  return out.trim();
}

/** The file name of a chat: `2026-10-27 14-02 <title>.json`. The stamp is the local time of `when`
 *  ({@link localFileStamp}; an invalid `Date` throws `RangeError`), the title is made safe for a file name
 *  ({@link sanitizeFilename}) and cut so that the whole name stays within 255 bytes of UTF-8, cut by whole code points.
 *  An empty title gives `2026-10-27 14-02.json`. `ext` goes without a dot and is never cut.
 *  @example chatFileName("Re: a/b", new Date(2026, 9, 27, 14, 2)) // → "2026-10-27 14-02 Re_ a_b.json" */
export function chatFileName(title: string, when: Date, ext = "json"): string {
  const stamp = localFileStamp(when);
  const tail = ext === "" ? "" : `.${ext}`;
  const body = clipBytes(sanitizeFilename(title), MAX_NAME_BYTES - byteLength(stamp) - byteLength(tail) - 1);
  return body === "" ? `${stamp}${tail}` : `${stamp} ${body}${tail}`;
}

/** `name` if it is not in `taken`, else `name` with ` 2`, ` 3`, … in front of the extension (the part from the last dot)
 *  until the name is free. Compares without regard to case. If the suffix does not fit in 255 bytes, the part before it
 *  is cut by whole code points. `taken` is not modified. */
export function uniqueChatFileName(name: string, taken: ReadonlySet<string>): string {
  const used = new Set<string>();
  for (const t of taken) used.add(t.toLowerCase());
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${clipBytes(base, MAX_NAME_BYTES - byteLength(ext) - byteLength(suffix))}${suffix}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// ── Record ───────────────────────────────────────────────────────────────────────────────

/** The schema version this module writes and reads. */
export const CHAT_RECORD_VERSION = 1;

/** A chat as one file: the header the archive needs, and the payload of the host. */
export interface ChatRecord {
  okitChat: typeof CHAT_RECORD_VERSION;
  /** The plugin that wrote it (`koda-agent`). */
  plugin: string;
  title: string;
  /** ISO-8601. */
  created: string;
  /** ISO-8601; the chat moves up the list when this rises. */
  updated: string;
  model: string | null;
  thinking: ThinkingLevel | null;
  /** What the payload is, as the host names it: `okit-chat-history/1` (a `ChatHistory`), `koda-log/1`, … */
  payloadType: string;
  payload: JsonValue;
}

/** What {@link buildChatRecord} takes: the record without the version; the dates as `Date` or as ISO strings. */
export type ChatRecordInput = Omit<ChatRecord, "okitChat" | "created" | "updated"> & {
  created: Date | string;
  updated: Date | string;
};

/** Shape of an ISO-8601 date-time, the part that `Date.parse` alone does not guard (`Date.parse("1")` is a date). */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const isIsoDateTime = (v: unknown): v is string => typeof v === "string" && ISO_DATE_TIME.test(v) && !Number.isNaN(Date.parse(v));

function isoOf(value: Date | string, field: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError(`buildChatRecord: ${field} is an invalid Date`);
    return value.toISOString();
  }
  if (!isIsoDateTime(value)) throw new RangeError(`buildChatRecord: ${field} is not an ISO date-time: ${JSON.stringify(value)}`);
  return value;
}

/** A record with the schema version set. Nothing is checked in the payload. Throws `RangeError` for a date that is not
 *  one and `TypeError` for an empty `plugin` or `payloadType`, so that what is built can always be read by
 *  {@link parseChatRecord}. */
export function buildChatRecord(input: ChatRecordInput): ChatRecord {
  if (input.plugin === "") throw new TypeError("buildChatRecord: plugin is empty");
  if (input.payloadType === "") throw new TypeError("buildChatRecord: payloadType is empty");
  return {
    okitChat: CHAT_RECORD_VERSION,
    plugin: input.plugin,
    title: input.title,
    created: isoOf(input.created, "created"),
    updated: isoOf(input.updated, "updated"),
    model: input.model,
    thinking: input.thinking,
    payloadType: input.payloadType,
    payload: input.payload,
  };
}

const isThinkingLevel = (v: unknown): v is ThinkingLevel => typeof v === "string" && (THINKING_LEVELS as readonly string[]).includes(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v !== "";

/** The record in `json` (the result of `JSON.parse`), or `null` if it is not one this module can read: not an object, a
 *  schema version other than {@link CHAT_RECORD_VERSION} (a higher one included), a missing or mistyped field, a date that
 *  is not a date. Never throws. The payload is returned as it is. A field this module does not know is dropped. */
export function parseChatRecord(json: unknown): ChatRecord | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (o.okitChat !== CHAT_RECORD_VERSION) return null;
  if (!isNonEmptyString(o.plugin) || typeof o.title !== "string") return null;
  if (!isIsoDateTime(o.created) || !isIsoDateTime(o.updated)) return null;
  if (o.model !== null && typeof o.model !== "string") return null;
  if (o.thinking !== null && !isThinkingLevel(o.thinking)) return null;
  if (!isNonEmptyString(o.payloadType) || o.payload === undefined) return null;
  return {
    okitChat: CHAT_RECORD_VERSION,
    plugin: o.plugin,
    title: o.title,
    created: o.created,
    updated: o.updated,
    model: o.model,
    thinking: o.thinking,
    payloadType: o.payloadType,
    payload: o.payload as JsonValue,
  };
}

// ── Restore ──────────────────────────────────────────────────────────────────────────────

/** A restored `ChatHistory` (payload type `okit-chat-history/1`): every answer in state `streaming` becomes `aborted`,
 *  because nothing is running after a restart. The partial text stays. Where there is nothing to do the same object is
 *  returned. */
export function restoreChatHistory(h: ChatHistory): ChatHistory {
  let out = h;
  for (const entry of h.entries) {
    if (entry.kind === "assistant" && entry.state === "streaming") out = abortAnswer(out, entry.id);
  }
  return out;
}

// ── Keep limit ───────────────────────────────────────────────────────────────────────────

/** The highest keep limit. */
export const MAX_KEEP_CHATS = 500;

/** The names of the chats to delete so that the newest `keep` survive, oldest first. "Oldest" is the smaller `updated`;
 *  equal times are decided by name (the smaller name goes first). `keep` is floored and clamped to 0..{@link MAX_KEEP_CHATS};
 *  0 returns every name (what 0 means for the user is the caller's business). **A `keep` that is not a number deletes
 *  nothing**, and so does a missing one: a broken setting must not wipe the archive. An entry whose `updated` is not a
 *  finite number counts as the newest and is the last to go, for the same reason. */
export function selectChatsToDelete(entries: readonly { name: string; updated: number }[], keep: number): string[] {
  if (typeof keep !== "number" || Number.isNaN(keep)) return [];
  const limit = Math.min(MAX_KEEP_CHATS, Math.max(0, Math.floor(keep)));
  if (entries.length <= limit) return [];
  const time = (e: { updated: number }): number => (Number.isFinite(e.updated) ? e.updated : Number.POSITIVE_INFINITY);
  const oldestFirst = [...entries].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return oldestFirst.slice(0, entries.length - limit).map((e) => e.name);
}
