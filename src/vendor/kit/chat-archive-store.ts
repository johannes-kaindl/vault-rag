// vendored from code-kit@0.87.0, src/ts/pure/chat-archive-store.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** The store of the chat history: one `.json` per chat in a vault folder, through a narrow adapter (`app.vault.adapter` satisfies it).
 *  **No `obsidian` import** (decision of the master F-G2, 2026-10-27): adapter, clock and `normalizePath` come as parameters, so that
 *  Koda uses the same store with `payloadType: "koda-log/1"`. The dialog (`SuggestModal`) and the settings rows live in their own files
 *  in obsidian-kit. The pure parts (title, file name, header, restore, choosing the chats to delete) are `chat-archive` in this
 *  library; here is only what concerns folder, adapter and the order of accesses.
 *
 *  Origin: obsidian-kit `src/obsidian/chat-archive.ts` (0.73.0), moved here in wave 33 (decision of Johannes, 2026-11-12) because it
 *  imports nothing of Obsidian. The name is `chat-archive-store` because `chat-archive` is the pure record module; obsidian-kit
 *  vendors this file back. The messages thrown into `onError`'s second argument are English now (they were German); the texts shown
 *  to the user come from `chat-archive-strings` and did not change.
 *
 *  Promises, each with a test and a counter-probe:
 *  - **A chat is a file, the folder is the list.** `list()` reads the headers (`updated` and unreadable come from the content, one truth).
 *    A file that cannot be read (broken, higher schema version, read error) stays untouched on disk and is counted, not hidden. Exports
 *    (`.md`), sub-folders and chats of other plugins never appear and are never deleted.
 *  - **Clean-up never runs with `keep <= 0`** (`selectChatsToDelete` returns every name for 0; here 0 means "no history", not "delete
 *    all"), never retroactively when the setting changes, only after a successful save and **never the chat just written** (the clock of
 *    another device can make a chat "newer" than the one just saved).
 *  - **Writes run one after another** per folder (`runExclusive`): the end of a round and then "New" do not overtake each other.
 *  - **`save` never throws.** An adapter error, an invalid date, an empty `plugin`, a cycle in the payload: one message through `onError`,
 *    result `null`. An invalid folder saves nothing and reports once per value, it does not silently fall back to the default.
 *  - `list()` on a folder that does not exist is empty (Obsidian's `list` throws there), every path goes through `normalizePath`.
 *
 *  Limits: a host calls `save` only when `enabled()` is true (the store does not ask itself: the window decides about "New" and the
 *  hint). Two Obsidian windows or two devices writing the same chat are not covered by the serialization (sync measurement, own task).
 *  The payload is not checked (`chat-archive`: "nobody looks inside"). Deleting is final (`adapter.remove`, no trash; F-G4). */
import {
  buildChatRecord, chatFileName, chatTitle, parseChatRecord, selectChatsToDelete, uniqueChatFileName, MAX_KEEP_CHATS, type ChatRecord,
} from "./chat-archive";
import { chatRounds, type ChatHistory, type JsonValue } from "./chat-history";
import { resolveChatArchiveStrings, type ChatArchiveStrings, type ChatArchiveStringsOverride } from "./chat-archive-strings";
import { baseName, checkRelPath, isPathSegment } from "./rel-path";
import { runExclusive } from "./run-exclusive";
import { neutralizeModelMarkdown } from "./safe-markdown";
import type { ThinkingLevel } from "./sampling-profiles";

/** What the store needs from the vault; `app.vault.adapter` satisfies it. */
export interface ChatArchiveAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** Not recursive; `files` carries full vault paths. Throws for a folder that does not exist. */
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** One row of the list: the header of a chat, never its payload (500 chats of 40 KB each would otherwise stay in memory). */
export interface ChatArchiveEntry {
  /** Dateiname im Ordner (`2026-10-27 14-02 Titel.json`). */
  name: string;
  title: string;
  /** ISO-8601. */
  created: string;
  /** ISO-8601; the list is ordered by it. */
  updated: string;
  model: string | null;
  thinking: ThinkingLevel | null;
  payloadType: string;
}

export interface ChatArchiveList {
  entries: ChatArchiveEntry[];
  /** `.json` files in the folder that could not be read as a chat of this history and were left untouched. */
  unreadable: number;
}

export interface SaveChatInput {
  /** If missing, the store picks a free name from stamp and title; a host keeps writing the same conversation under the name from the first `save`. */
  name?: string;
  /** The first question or a finished title: the store makes the title from it (`chatTitle`, at most 60 characters, empty: the `untitled` string). */
  title: string;
  /** ISO-8601 of the first save; if missing, now. */
  created?: string;
  model: string | null;
  thinking: ThinkingLevel | null;
  /** `okit-chat-history/1` for a chat window, `koda-log/1` for Koda, … */
  payloadType: string;
  payload: JsonValue;
}

export interface ChatArchiveOptions {
  adapter: ChatArchiveAdapter;
  /** The folder from the settings; a getter so a change takes effect without rebuilding. Empty counts as `defaultFolder`. */
  folder: () => string;
  /** The default (`Plugin display name/Chats`). */
  defaultFolder: string;
  /** Keep count 0 to 500, a getter. 0 and anything that is not a number above 0: no history, nothing is deleted. */
  keep: () => number;
  /** The writer (`koda-agent`); the store shows and deletes only chats with this value in the header. */
  plugin: string;
  /** The vault's configuration folder (`app.vault.configDir`): off limits as a history folder. */
  configDir?: string;
  /** Obsidian's `normalizePath`; without it the path stays as it is (a checked folder plus a file name is already normalized). */
  normalizePath?: (path: string) => string;
  now?: () => Date;
  strings?: ChatArchiveStringsOverride;
  /** A message for the user (`new Notice(message)`); `error` is the cause. */
  onError?: (message: string, error?: unknown) => void;
}

export interface ChatArchive {
  /** Is the history on (`keep() > 0`)? */
  enabled(): boolean;
  /** Writes the chat, cleans up afterwards. `null` after a message through `onError`. */
  save(input: SaveChatInput): Promise<{ name: string } | null>;
  list(): Promise<ChatArchiveList>;
  /** The record of a file; `null` for missing, unreadable, foreign, or a name that is not a single `.json` file name. */
  load(name: string): Promise<ChatRecord | null>;
  /** Deletes a chat of this history (final). `false` for anything else. */
  remove(name: string): Promise<boolean>;
  /** Writes the chat as `.md` next to the file (one-way, never read again) and returns the path; `null` after a message. For a payload other than `okit-chat-history/1` the host renders. */
  exportNote(name: string, render?: (record: ChatRecord) => string | null): Promise<string | null>;
}

export type ChatArchiveFolderCheck = { ok: true; folder: string } | { ok: false; reason: string };

/** The folder from a setting: empty (only whitespace) counts as the default, a trailing slash is forgiven. Invalid: absolute, `..`, a `.` segment,
 *  backslash, empty segment, a folder starting with `.` (Obsidian neither shows nor syncs hidden folders), the config folder. */
export function checkChatArchiveFolder(raw: string, defaultFolder: string, configDir?: string): ChatArchiveFolderCheck {
  const trimmed = raw.trim();
  let value = defaultFolder;
  if (trimmed !== "") {
    let end = trimmed.length;
    while (end > 0 && trimmed[end - 1] === "/") end -= 1;
    value = trimmed.slice(0, end);
  }
  const r = checkRelPath(value);
  if (!r.ok) return { ok: false, reason: r.problem };
  const first = r.segments[0] ?? "";
  if (first.startsWith(".")) return { ok: false, reason: "hidden" };
  if (configDir !== undefined && configDir !== "" && first.toLowerCase() === configDir.toLowerCase()) return { ok: false, reason: "config-dir" };
  return { ok: true, folder: r.path };
}

const READ_CHUNK = 16;
const isJsonName = (name: string): boolean => name.length > 5 && name.toLowerCase().endsWith(".json");
/** A single file name ending in `.json` (no path, no `..`). */
const isChatFileName = (name: string): boolean => typeof name === "string" && isPathSegment(name) && isJsonName(name);

export function createChatArchive(opts: ChatArchiveOptions): ChatArchive {
  const { adapter, plugin } = opts;
  const strings: ChatArchiveStrings = resolveChatArchiveStrings(opts.strings);
  const norm = opts.normalizePath ?? ((p: string): string => p);
  const now = opts.now ?? ((): Date => new Date());
  const report = (message: string, error?: unknown): void => { try { opts.onError?.(message, error); } catch { /* a message must never disturb the store */ } };

  // An invalid folder reports once per value: a conversation of twenty rounds shows no twenty hints.
  let reportedInvalid: string | null = null;
  function folderOf(): string | null {
    const raw = opts.folder();
    const check = checkChatArchiveFolder(raw, opts.defaultFolder, opts.configDir);
    if (check.ok) { reportedInvalid = null; return check.folder; }
    if (reportedInvalid !== raw) { reportedInvalid = raw; report(strings.invalidFolder(raw.trim() === "" ? opts.defaultFolder : raw)); }
    return null;
  }
  const queued = <T>(folder: string, job: () => Promise<T>): Promise<T> => runExclusive(`chat-archive:${folder}`, job);

  async function ensureFolder(folder: string): Promise<void> {
    const segments = folder.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const path = norm(segments.slice(0, i + 1).join("/"));
      if (!(await adapter.exists(path))) await adapter.mkdir(path);
    }
  }

  /** The header of a file: `"unreadable"` (counted), `null` (a chat of another plugin: neither shown nor counted), else the record. */
  async function readRecord(path: string): Promise<ChatRecord | "unreadable" | null> {
    try {
      const record = parseChatRecord(JSON.parse(await adapter.read(path)));
      if (record === null) return "unreadable";
      return record.plugin === plugin ? record : null;
    } catch { return "unreadable"; }
  }

  async function scan(folder: string): Promise<ChatArchiveList> {
    const folderPath = norm(folder);
    if (!(await adapter.exists(folderPath))) return { entries: [], unreadable: 0 };
    const { files } = await adapter.list(folderPath);
    const jsons = files.filter((f) => isJsonName(baseName(f)));
    const found: { entry: ChatArchiveEntry; ms: number }[] = [];
    let unreadable = 0;
    for (let i = 0; i < jsons.length; i += READ_CHUNK) {
      const part = await Promise.all(jsons.slice(i, i + READ_CHUNK).map(async (f) => ({ f, r: await readRecord(f) })));
      for (const { f, r } of part) {
        if (r === "unreadable") unreadable += 1;
        else if (r !== null) {
          found.push({
            ms: Date.parse(r.updated),
            entry: { name: baseName(f), title: r.title, created: r.created, updated: r.updated, model: r.model, thinking: r.thinking, payloadType: r.payloadType },
          });
        }
      }
    }
    // Newest first; at the same time the larger name first (the reverse of the delete order of `selectChatsToDelete`).
    found.sort((a, b) => (a.ms !== b.ms ? b.ms - a.ms : a.entry.name < b.entry.name ? 1 : a.entry.name > b.entry.name ? -1 : 0));
    return { entries: found.map((x) => x.entry), unreadable };
  }

  async function cleanup(folder: string, justWritten: string): Promise<void> {
    const keep = opts.keep();
    // The rounding down belongs BEFORE the check: 0.5 counts as 0 for `selectChatsToDelete`, and 0 returns every name.
    const limit = typeof keep === "number" ? Math.min(MAX_KEEP_CHATS, Math.floor(keep)) : Number.NaN;
    if (!(limit >= 1)) return;
    const { files } = await adapter.list(norm(folder));
    // It takes more files than `limit` for anything to be deleted at all: below that the headers stay unread.
    if (files.filter((f) => isJsonName(baseName(f))).length <= limit) return;
    const { entries } = await scan(folder);
    const doomed = selectChatsToDelete(entries.map((e) => ({ name: e.name, updated: Date.parse(e.updated) })), limit).filter((n) => n !== justWritten);
    let failed: unknown;
    for (const name of doomed) {
      try { await adapter.remove(norm(`${folder}/${name}`)); } catch (e) { failed ??= e; }
    }
    if (failed !== undefined) throw failed instanceof Error ? failed : new Error("chat-archive: delete failed", { cause: failed });
  }

  function save(input: SaveChatInput): Promise<{ name: string } | null> {
    const folder = folderOf();
    if (folder === null) return Promise.resolve(null);
    return queued(folder, async () => {
      let name: string;
      try {
        const when = now();
        const title = chatTitle(input.title, 60, strings.untitled);
        await ensureFolder(folder);
        if (input.name !== undefined) {
          if (!isChatFileName(input.name)) throw new TypeError(`chat-archive: invalid file name “${input.name}”`);
          name = input.name;
        } else {
          const taken = new Set((await adapter.list(norm(folder))).files.map(baseName));
          name = uniqueChatFileName(chatFileName(title, when), taken);
        }
        const record = buildChatRecord({
          plugin, title, created: input.created ?? when, updated: when, model: input.model, thinking: input.thinking,
          payloadType: input.payloadType, payload: input.payload,
        });
        await adapter.write(norm(`${folder}/${name}`), JSON.stringify(record));
      } catch (e) {
        report(strings.saveFailed, e);
        return null;
      }
      try { await cleanup(folder, name); } catch (e) { report(strings.removeFailed, e); }
      return { name };
    });
  }

  function list(): Promise<ChatArchiveList> {
    const folder = folderOf();
    if (folder === null) return Promise.resolve({ entries: [], unreadable: 0 });
    return queued(folder, async () => {
      try { return await scan(folder); } catch (e) { report(strings.listFailed, e); return { entries: [], unreadable: 0 }; }
    });
  }

  function load(name: string): Promise<ChatRecord | null> {
    const folder = folderOf();
    if (folder === null || !isChatFileName(name)) return Promise.resolve(null);
    return queued(folder, async () => {
      const r = await readRecord(norm(`${folder}/${name}`));
      return r === "unreadable" ? null : r;
    });
  }

  function remove(name: string): Promise<boolean> {
    const folder = folderOf();
    if (folder === null || !isChatFileName(name)) return Promise.resolve(false);
    return queued(folder, async () => {
      const path = norm(`${folder}/${name}`);
      // Only a chat of this history: a name that points to a foreign or unreadable file deletes nothing.
      const r = await readRecord(path);
      if (r === null || r === "unreadable") return false;
      try { await adapter.remove(path); return true; } catch (e) { report(strings.removeFailed, e); return false; }
    });
  }

  function exportNote(name: string, render?: (record: ChatRecord) => string | null): Promise<string | null> {
    const folder = folderOf();
    if (folder === null) return Promise.resolve(null);
    return queued(folder, async () => {
      try {
        if (!isChatFileName(name)) throw new TypeError(`chat-archive: invalid file name “${name}”`);
        const r = await readRecord(norm(`${folder}/${name}`));
        if (r === null || r === "unreadable") throw new Error(`chat-archive: ${name} is not a readable chat of this history`);
        const body = render ? render(r) : renderChatNote(r, strings);
        if (body === null) throw new TypeError(`chat-archive: no export for payload type ${r.payloadType}`);
        const taken = new Set((await adapter.list(norm(folder))).files.map(baseName));
        const mdName = uniqueChatFileName(`${name.slice(0, -".json".length)}.md`, taken);
        const path = norm(`${folder}/${mdName}`);
        await adapter.write(path, noteWithHead(r, body));
        return path;
      } catch (e) {
        report(strings.exportFailed, e);
        return null;
      }
    });
  }

  return { enabled: () => { const k = opts.keep(); return typeof k === "number" && k > 0; }, save, list, load, remove, exportNote };
}

// ── Export as note ──────────────────────────────────────────────────────────────────────────────

const PLAIN_YAML = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** The head of the note: `okit_chat_export: true` (so a `.md` in the folder never counts as a chat), `created`, `model` (only if there is one). */
function noteWithHead(record: ChatRecord, body: string): string {
  const model = record.model === null ? [] : [`model: ${PLAIN_YAML.test(record.model) ? record.model : JSON.stringify(record.model)}`];
  return ["---", "okit_chat_export: true", `created: ${record.created}`, ...model, "---", "", body].join("\n");
}

/** Per round `## Question`, the collapsed thinking block (`> [!note]-`, every line with `> `, empty lines too), `## Answer` (headings from the strings). The question is the user's own text and goes in
 *  unchanged; answer and thinking block are model text and go through `neutralizeModelMarkdown` (no remote image, no processor fence). Only for
 *  `okit-chat-history/1`; otherwise `null` (the host renders itself). */
function renderChatNote(record: ChatRecord, strings: ChatArchiveStrings): string | null {
  if (record.payloadType !== "okit-chat-history/1") return null;
  const parts: string[] = [];
  for (const round of chatRounds(record.payload as unknown as ChatHistory)) {
    parts.push(`## ${strings.exportQuestion}\n\n${round.user.text}`);
    for (const e of round.entries) {
      if (e.kind !== "assistant") continue;
      if (e.reasoning.trim() !== "") {
        const lines = neutralizeModelMarkdown(e.reasoning).split(/\r?\n/).map((l) => `> ${l}`);
        parts.push([`> [!note]- ${strings.exportThinking}`, ...lines].join("\n"));
      }
      if (e.text.trim() !== "") parts.push(`## ${strings.exportAnswer}\n\n${neutralizeModelMarkdown(e.text)}`);
    }
  }
  return `${parts.join("\n\n")}\n`;
}
