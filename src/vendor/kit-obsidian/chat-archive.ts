// vendored from obsidian-kit@0.76.1, src/obsidian/chat-archive.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Speicher des Chat-Verlaufs: eine `.json` je Chat in einem Vault-Ordner, über einen schmalen Adapter (`app.vault.adapter` erfüllt ihn).
 *  **Kein `obsidian`-Import** (Entscheidung des Masters F-G2, 2026-10-27): Adapter, Uhr und `normalizePath` kommen als Parameter, damit der Speicher
 *  später nach `src/pure/` oder code-kit wandern kann und Koda ihn mit `payloadType: "koda-log/1"` über denselben Weg nutzt. Der Dialog (`SuggestModal`)
 *  und die Einstellungszeilen stehen in eigenen Dateien. Die reinen Teile (Titel, Dateiname, Kopf, Wiederherstellen, Auswahl der zu löschenden Chats)
 *  sind code-kit `chat-archive` (vendort); hier steht nur, was Ordner, Adapter und Reihenfolge der Zugriffe betrifft.
 *
 *  Zusagen, jede mit einem Test und einer Gegenprobe:
 *  - **Ein Chat ist eine Datei, der Ordner ist die Liste.** `list()` liest die Köpfe (`updated` und Unlesbare kommen aus dem Inhalt, eine Wahrheit).
 *    Eine Datei, die sich nicht lesen lässt (kaputt, höhere Schema-Version, Lesefehler), bleibt unangetastet auf der Platte und wird gezählt, nicht
 *    versteckt. Exporte (`.md`), Unterordner und Chats anderer Plugins erscheinen nie und werden nie gelöscht.
 *  - **Aufräumen nie mit `keep <= 0`** (`selectChatsToDelete` liefert bei 0 jeden Namen; 0 heißt hier „kein Verlauf“, nicht „alles löschen“), nie rückwirkend
 *    beim Ändern der Einstellung, nur nach einem erfolgreichen Speichern und **nie den eben geschriebenen Chat** (die Uhr eines anderen Geräts kann einen
 *    Chat „neuer“ machen als den, der gerade gespeichert wurde).
 *  - **Schreibzugriffe laufen hintereinander** je Ordner (`runExclusive`): das Ende einer Runde und dann Neu überholen sich nicht.
 *  - **`save` wirft nie.** Ein Adapterfehler, ein ungültiges Datum, ein leeres `plugin`, ein Zyklus im Payload: eine Meldung über `onError`, Ergebnis `null`.
 *    Ein ungültiger Ordner speichert nichts und meldet sich einmal je Wert, er fällt nicht still auf die Vorgabe zurück.
 *  - `list()` auf einen Ordner, den es nicht gibt, ist leer (Obsidians `list` wirft dort), jeder Pfad geht durch `normalizePath`.
 *
 *  Grenzen: ein Wirt ruft `save` nur, wenn `enabled()` wahr ist (der Speicher fragt nicht selbst: das Fenster entscheidet über „Neu“ und Hinweis). Zwei
 *  Obsidian-Fenster oder zwei Geräte, die denselben Chat schreiben, deckt die Serialisierung nicht ab (Sync-Messung, eigene Task). Der Payload wird
 *  nicht geprüft (code-kit `chat-archive`: „nobody looks inside“). Löschen ist endgültig (`adapter.remove`, kein Papierkorb; F-G4). */
import {
  buildChatRecord, chatFileName, chatTitle, parseChatRecord, selectChatsToDelete, uniqueChatFileName, MAX_KEEP_CHATS, type ChatRecord,
} from "../kit/chat-archive";
import { chatRounds, type ChatHistory, type JsonValue } from "../kit/chat-history";
import { checkRelPath, isPathSegment } from "../kit/rel-path";
import { neutralizeModelMarkdown } from "../kit/safe-markdown";
import type { ThinkingLevel } from "../kit/sampling-profiles";
import { resolveChatArchiveStrings, type ChatArchiveStrings, type ChatArchiveStringsOverride } from "./chat-archive-strings";
import { runExclusive } from "./run-exclusive";

/** Was der Speicher vom Vault braucht; `app.vault.adapter` erfüllt es. */
export interface ChatArchiveAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** Nicht rekursiv; `files` trägt volle Vault-Pfade. Wirft bei einem Ordner, den es nicht gibt. */
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** Eine Zeile der Liste: der Kopf eines Chats, nie sein Payload (500 Chats zu je 40 KB blieben sonst im Speicher). */
export interface ChatArchiveEntry {
  /** Dateiname im Ordner (`2026-10-27 14-02 Titel.json`). */
  name: string;
  title: string;
  /** ISO-8601. */
  created: string;
  /** ISO-8601; die Liste ordnet danach. */
  updated: string;
  model: string | null;
  thinking: ThinkingLevel | null;
  payloadType: string;
}

export interface ChatArchiveList {
  entries: ChatArchiveEntry[];
  /** Dateien `.json` im Ordner, die sich nicht als Chat dieses Verlaufs lesen ließen und unangetastet blieben. */
  unreadable: number;
}

export interface SaveChatInput {
  /** Fehlt er, wählt der Speicher einen freien Namen aus Zeitstempel und Titel; ein Wirt schreibt dasselbe Gespräch mit dem Namen aus dem ersten `save` weiter. */
  name?: string;
  /** Die erste Frage oder ein fertiger Titel: der Speicher macht daraus den Titel (`chatTitle`, höchstens 60 Zeichen, leer: „Unbenanntes Gespräch“). */
  title: string;
  /** ISO-8601 des ersten Speicherns; fehlt es, gilt jetzt. */
  created?: string;
  model: string | null;
  thinking: ThinkingLevel | null;
  /** `okit-chat-history/1` für ein Chat-Fenster, `koda-log/1` für Koda, … */
  payloadType: string;
  payload: JsonValue;
}

export interface ChatArchiveOptions {
  adapter: ChatArchiveAdapter;
  /** Der Ordner aus den Einstellungen; ein Getter, damit eine Änderung ohne Neuaufbau wirkt. Leer gilt als `defaultFolder`. */
  folder: () => string;
  /** Die Vorgabe (`Plugin-Anzeigename/Chats`). */
  defaultFolder: string;
  /** Aufbewahrung 0 bis 500, ein Getter. 0 und alles, was keine Zahl über 0 ist: kein Verlauf, nichts wird gelöscht. */
  keep: () => number;
  /** Der Schreiber (`koda-agent`); der Speicher zeigt und löscht nur Chats mit diesem Wert im Kopf. */
  plugin: string;
  /** Der Ordner mit der Konfiguration des Vaults (`app.vault.configDir`): als Verlauf-Ordner tabu. */
  configDir?: string;
  /** Obsidians `normalizePath`; ohne Angabe bleibt der Pfad, wie er ist (ein geprüfter Ordner plus ein Dateiname ist schon normalisiert). */
  normalizePath?: (path: string) => string;
  now?: () => Date;
  strings?: ChatArchiveStringsOverride;
  /** Eine Meldung für den Nutzer (`new Notice(message)`); `error` ist die Ursache. */
  onError?: (message: string, error?: unknown) => void;
}

export interface ChatArchive {
  /** Ist der Verlauf an (`keep() > 0`)? */
  enabled(): boolean;
  /** Schreibt den Chat, räumt danach auf. `null` nach einer Meldung über `onError`. */
  save(input: SaveChatInput): Promise<{ name: string } | null>;
  list(): Promise<ChatArchiveList>;
  /** Der Record einer Datei; `null` für fehlend, unlesbar, fremd oder einen Namen, der kein einzelner `.json`-Dateiname ist. */
  load(name: string): Promise<ChatRecord | null>;
  /** Löscht einen Chat dieses Verlaufs (endgültig). `false` für alles andere. */
  remove(name: string): Promise<boolean>;
  /** Schreibt den Chat als `.md` neben die Datei (einweg, wird nie wieder gelesen) und gibt den Pfad zurück; `null` nach einer Meldung. Für einen anderen Payload als `okit-chat-history/1` rendert der Wirt. */
  exportNote(name: string, render?: (record: ChatRecord) => string | null): Promise<string | null>;
}

export type ChatArchiveFolderCheck = { ok: true; folder: string } | { ok: false; reason: string };

/** Der Ordner aus einer Einstellung: leer (nur Leerraum) gilt als Vorgabe, ein Schrägstrich am Ende wird verziehen. Ungültig: absolut, `..`, `.`-Segment,
 *  Rückwärtsschrägstrich, leeres Segment, ein Ordner, der mit `.` beginnt (Obsidian zeigt und synchronisiert keine versteckten Ordner), der Konfigurationsordner. */
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
const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const isJsonName = (name: string): boolean => name.length > 5 && name.toLowerCase().endsWith(".json");
/** Ein einzelner Dateiname mit `.json` (kein Pfad, kein `..`). */
const isChatFileName = (name: string): boolean => typeof name === "string" && isPathSegment(name) && isJsonName(name);

export function createChatArchive(opts: ChatArchiveOptions): ChatArchive {
  const { adapter, plugin } = opts;
  const strings: ChatArchiveStrings = resolveChatArchiveStrings(opts.strings);
  const norm = opts.normalizePath ?? ((p: string): string => p);
  const now = opts.now ?? ((): Date => new Date());
  const report = (message: string, error?: unknown): void => { try { opts.onError?.(message, error); } catch { /* eine Meldung darf den Speicher nie stören */ } };

  // Ein ungültiger Ordner meldet sich einmal je Wert: ein Gespräch mit zwanzig Runden zeigt keine zwanzig Hinweise.
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

  /** Der Kopf einer Datei: `"unreadable"` (zählt), `null` (ein Chat eines anderen Plugins: weder gezeigt noch gezählt), sonst der Record. */
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
    const jsons = files.filter((f) => isJsonName(baseOf(f)));
    const found: { entry: ChatArchiveEntry; ms: number }[] = [];
    let unreadable = 0;
    for (let i = 0; i < jsons.length; i += READ_CHUNK) {
      const part = await Promise.all(jsons.slice(i, i + READ_CHUNK).map(async (f) => ({ f, r: await readRecord(f) })));
      for (const { f, r } of part) {
        if (r === "unreadable") unreadable += 1;
        else if (r !== null) {
          found.push({
            ms: Date.parse(r.updated),
            entry: { name: baseOf(f), title: r.title, created: r.created, updated: r.updated, model: r.model, thinking: r.thinking, payloadType: r.payloadType },
          });
        }
      }
    }
    // Neueste zuerst; bei gleicher Zeit der größere Name zuerst (die Umkehrung der Löschreihenfolge von `selectChatsToDelete`).
    found.sort((a, b) => (a.ms !== b.ms ? b.ms - a.ms : a.entry.name < b.entry.name ? 1 : a.entry.name > b.entry.name ? -1 : 0));
    return { entries: found.map((x) => x.entry), unreadable };
  }

  async function cleanup(folder: string, justWritten: string): Promise<void> {
    const keep = opts.keep();
    // Die Abrundung gehört VOR die Prüfung: 0,5 zählt für `selectChatsToDelete` als 0, und 0 liefert jeden Namen.
    const limit = typeof keep === "number" ? Math.min(MAX_KEEP_CHATS, Math.floor(keep)) : Number.NaN;
    if (!(limit >= 1)) return;
    const { files } = await adapter.list(norm(folder));
    // Mehr Dateien als `limit` braucht es, damit überhaupt etwas zu löschen ist: darunter bleiben die Köpfe ungelesen.
    if (files.filter((f) => isJsonName(baseOf(f))).length <= limit) return;
    const { entries } = await scan(folder);
    const doomed = selectChatsToDelete(entries.map((e) => ({ name: e.name, updated: Date.parse(e.updated) })), limit).filter((n) => n !== justWritten);
    let failed: unknown;
    for (const name of doomed) {
      try { await adapter.remove(norm(`${folder}/${name}`)); } catch (e) { failed ??= e; }
    }
    if (failed !== undefined) throw failed instanceof Error ? failed : new Error("chat-archive: Löschen fehlgeschlagen", { cause: failed });
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
          if (!isChatFileName(input.name)) throw new TypeError(`chat-archive: ungültiger Dateiname „${input.name}“`);
          name = input.name;
        } else {
          const taken = new Set((await adapter.list(norm(folder))).files.map(baseOf));
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
      // Nur ein Chat dieses Verlaufs: ein Name, der auf eine fremde oder unlesbare Datei zeigt, löscht nichts.
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
        if (!isChatFileName(name)) throw new TypeError(`chat-archive: ungültiger Dateiname „${name}“`);
        const r = await readRecord(norm(`${folder}/${name}`));
        if (r === null || r === "unreadable") throw new Error(`chat-archive: ${name} ist kein lesbarer Chat dieses Verlaufs`);
        const body = render ? render(r) : renderChatNote(r, strings);
        if (body === null) throw new TypeError(`chat-archive: kein Export für den Payload-Typ ${r.payloadType}`);
        const taken = new Set((await adapter.list(norm(folder))).files.map(baseOf));
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

// ── Export als Notiz ──────────────────────────────────────────────────────────────────────────────

const PLAIN_YAML = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Der Kopf der Notiz: `okit_chat_export: true` (damit eine `.md` im Ordner nie als Chat gilt), `created`, `model` (nur wenn es eines gibt). */
function noteWithHead(record: ChatRecord, body: string): string {
  const model = record.model === null ? [] : [`model: ${PLAIN_YAML.test(record.model) ? record.model : JSON.stringify(record.model)}`];
  return ["---", "okit_chat_export: true", `created: ${record.created}`, ...model, "---", "", body].join("\n");
}

/** Je Runde `## Frage`, der zugeklappte Denkblock (`> [!note]-`, jede Zeile mit `> `, auch Leerzeilen), `## Antwort`. Die Frage ist der eigene Text des Nutzers und geht
 *  unverändert hinein; Antwort und Denkblock sind Modelltext und gehen durch `neutralizeModelMarkdown` (kein Fernbild, kein Prozessor-Fence). Nur für
 *  `okit-chat-history/1`; sonst `null` (der Wirt rendert selbst). */
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
