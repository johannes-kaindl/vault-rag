// vendored from obsidian-kit@0.74.0, src/obsidian/chat-archive-dialog.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Dialog „Vergangene Chats“ (UI-STANDARD § 8, Baustein Chat-Verlauf): `SuggestModal` mit Suche, Titel und Datum je Zeile und zwei Zeilenaktionen, Export und Löschen.
 *
 *  Die Klasse ist dünn. Was sich ohne Obsidians Dialog prüfen lässt, steht außerhalb und wird ohne Stub getestet: `filterArchiveEntries`, `formatArchiveDate`,
 *  `archiveKeyAction`, `archiveInstructions`, `drawArchiveRow`. Der Ereignisfluss des echten Containers (ein Klick auf ein Symbol wählt die Zeile nicht, die Liste
 *  zeichnet nach dem Löschen neu, Umschalt+Enter erreicht die Auswahl) ist im Fake-DOM nicht zu zeigen; ihn belegt der Pilot (`chat-archive-shots`).
 *
 *  ## Wie das echte `SuggestModal` sich verhält (Programmtext Obsidian 1.15.0, Gegenlese 2026-10-27)
 *
 *  1. `selectSuggestion(value, evt)` **schließt den Dialog** und ruft dann `onChooseSuggestion`. Export und Löschen müssen ihn offen lassen, deshalb überschreibt die
 *     Klasse `selectSuggestion` (öffentlich) und schließt nur bei der Wahl der Zeile.
 *  2. Die Klicks der Zeilen hängt der Chooser per Delegation an den Ergebnis-Container und prüft `defaultPrevented`: das Symbol ruft `preventDefault()` **und**
 *     `stopPropagation()`.
 *  3. Enter ist ohne Modifikator registriert; **Umschalt+Enter und Alt+Enter** erreichen `onChooseSuggestion` nicht von selbst und stehen deshalb als `scope.register` da
 *     (`scope` und `selectActiveSuggestion` sind öffentlich). Löschen und Speichern als Notiz gehen damit ohne Maus (CORE-META-20), ohne die private `chooser`-API.
 *  4. `limit` steht auf 100; `0` hebt die Kappung auf (der Verlauf hält bis zu 500 Chats).
 *  5. `onNoSuggestion` ersetzt die Liste durch `emptyStateText`: die Zeile „N Dateien nicht lesbar“ hängt deshalb als eigenes Element an `modalEl`.
 *  6. Jeder Tastendruck baut die ganze Liste neu (`renderSuggestions`): die Liste wird einmal gelesen und je Öffnen im Speicher gehalten, nicht je Taste.
 *
 *  Der Dialog gibt den gelesenen `ChatRecord` an den Wirt (`onPick`), nie eine `ChatHistory`: so liest Koda seinen `koda-log/1`-Payload über denselben Dialog. */
import { Notice, SuggestModal, setIcon, type App } from "obsidian";
import type { ChatRecord } from "../kit/chat-archive";
import { realClock, type ClockPort } from "./clock";
import type { ChatArchive, ChatArchiveEntry, ChatArchiveList } from "./chat-archive";
import { resolveChatArchiveStrings, type ChatArchiveStrings, type ChatArchiveStringsOverride } from "./chat-archive-strings";
import { confirmAction } from "./confirm";

export type ArchiveLang = "en" | "de";

/** Suche über die Titel: Teilstring ohne Beachtung der Groß- und Kleinschreibung, mehrere Wörter müssen alle vorkommen. Die Reihenfolge bleibt die der Liste (neueste
 *  zuerst). Obsidians Fuzzy-Suche gibt es im Fake-DOM nicht, und für Titel, die eine Frage abbilden, trägt ein Teilstring. */
export function filterArchiveEntries(entries: readonly ChatArchiveEntry[], query: string): ChatArchiveEntry[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const title = e.title.toLocaleLowerCase();
    return words.every((w) => title.includes(w));
  });
}

const dayStart = (ms: number): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/** „heute 14:02“, „gestern“, „24.10.“ (in einem anderen Jahr „24.10.2025“). Der Kalendertag in der Ortszeit entscheidet, nicht ein Abstand von 24 Stunden.
 *  `""` für ein Datum, das keins ist. Reines `Intl`: Obsidians `moment` kennt im Fake-DOM nur eine Teilmenge der Formate. */
export function formatArchiveDate(iso: string, now: number, lang: ArchiveLang, strings: ChatArchiveStrings): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const days = Math.round((dayStart(now) - dayStart(ms)) / 86_400_000);
  if (days === 0) return strings.dateToday(new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(ms));
  if (days === 1) return strings.dateYesterday;
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  const opts: Intl.DateTimeFormatOptions = lang === "de"
    ? { day: "2-digit", month: "2-digit", ...(sameYear ? {} : { year: "numeric" }) }
    : { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) };
  return new Intl.DateTimeFormat(lang, opts).format(ms);
}

/** Was ein Ereignis in der Liste bedeutet. Nur eine Taste (`keydown`) mit Umschalt oder Alt wählt die Zeilenaktion; ein Mausklick mit gedrückter Taste öffnet nur. */
export function archiveKeyAction(evt: { type: string; shiftKey: boolean; altKey: boolean }): "open" | "export" | "delete" {
  if (evt.type !== "keydown") return "open";
  if (evt.shiftKey) return "export";
  if (evt.altKey) return "delete";
  return "open";
}

/** Die Anweisungszeile unter dem Suchfeld: was Enter, Umschalt+Enter, Alt+Enter und Esc tun. Die Zwecke heißen wie die Symbole der Zeile. */
export function archiveInstructions(strings: ChatArchiveStrings): Array<{ command: string; purpose: string }> {
  return [
    { command: "↵", purpose: strings.instructionOpen },
    { command: "⇧ ↵", purpose: strings.rowExport },
    { command: "⌥ ↵", purpose: strings.rowDelete },
    { command: "esc", purpose: strings.instructionClose },
  ];
}

export interface ArchiveRowContext {
  strings: ChatArchiveStrings;
  lang: ArchiveLang;
  /** Jetzt in ms (`ClockPort.now()`). */
  now: number;
  onExport: (entry: ChatArchiveEntry) => void;
  onDelete: (entry: ChatArchiveEntry) => void;
}

/** Eine Zeile: Titel, darunter das Datum, rechts die zwei Symbole. Ein Klick auf ein Symbol ruft nur seine Aktion und hält die Wahl der Zeile an. */
export function drawArchiveRow(el: HTMLElement, entry: ChatArchiveEntry, ctx: ArchiveRowContext): void {
  el.addClass("okit-chat-archive-row");
  const text = el.createDiv({ cls: "okit-chat-archive-text" });
  text.createDiv({ cls: "okit-chat-archive-title", text: entry.title });
  text.createDiv({ cls: "okit-chat-archive-date", text: formatArchiveDate(entry.updated, ctx.now, ctx.lang, ctx.strings) });
  const actions = el.createDiv({ cls: "okit-chat-archive-actions" });
  const action = (cls: string, icon: string, label: string, run: (e: ChatArchiveEntry) => void): void => {
    const btn = actions.createEl("button", { cls: `clickable-icon ${cls}`, attr: { type: "button", "aria-label": label } });
    setIcon(btn, icon);
    btn.addEventListener("click", (evt) => { evt.preventDefault(); evt.stopPropagation(); run(entry); });
  };
  action("okit-chat-archive-export", "file-down", ctx.strings.rowExport, ctx.onExport);
  action("okit-chat-archive-delete", "trash-2", ctx.strings.rowDelete, ctx.onDelete);
}

export interface OpenChatArchiveOptions {
  /** Der gewählte Chat, gelesen: der Wirt wendet seinen Payload an (`okit-chat-history/1` im Chat-Fenster, `koda-log/1` bei Koda). Der Dialog schließt vorher. `entry` trägt den Dateinamen: ein Wirt, der den Chat fortsetzt, schreibt in dieselbe Datei zurück. */
  onPick: (record: ChatRecord, entry: ChatArchiveEntry) => void;
  strings?: ChatArchiveStringsOverride;
  /** Für ein Datum in Tests; sonst die Uhr des Fensters. */
  clock?: ClockPort;
  /** Export für einen anderen Payload als `okit-chat-history/1` (der Speicher rendert nur den eigenen). */
  render?: (record: ChatRecord) => string | null;
}

export class ChatArchiveModal extends SuggestModal<ChatArchiveEntry> {
  private readonly strings: ChatArchiveStrings;
  private readonly lang: ArchiveLang;
  private readonly clock: ClockPort;
  private cache: Promise<ChatArchiveList> | null = null;
  private unreadableEl: HTMLElement | null = null;

  constructor(app: App, private readonly archive: ChatArchive, private readonly opts: OpenChatArchiveOptions) {
    super(app);
    this.strings = resolveChatArchiveStrings(opts.strings);
    this.lang = opts.strings?.lang === "de" ? "de" : "en";
    this.clock = opts.clock ?? realClock;
    this.limit = 0;
    this.emptyStateText = this.strings.empty;
    this.setPlaceholder(this.strings.placeholder);
    this.setInstructions(archiveInstructions(this.strings));
    // Die Tasten ohne Maus: beide über den öffentlichen Weg (`selectActiveSuggestion`), das Ereignis ist damit verbraucht.
    for (const mod of ["Shift", "Alt"] as const) {
      this.scope.register([mod], "Enter", (evt) => { this.selectActiveSuggestion(evt); return false; });
    }
  }

  /** Die Liste einmal je Öffnen (und nach einem Löschen), nicht je Tastendruck: jede Taste ruft `getSuggestions` und baut die ganze Liste neu. */
  private load(): Promise<ChatArchiveList> {
    this.cache ??= this.archive.list();
    return this.cache;
  }

  private showUnreadable(n: number): void {
    if (n === 0) { this.unreadableEl?.remove(); this.unreadableEl = null; return; }
    this.unreadableEl ??= this.modalEl.createDiv({ cls: "okit-chat-archive-unreadable" });
    this.unreadableEl.setText(this.strings.unreadable(n));
  }

  async getSuggestions(query: string): Promise<ChatArchiveEntry[]> {
    const list = await this.load();
    this.showUnreadable(list.unreadable);
    this.emptyStateText = list.entries.length === 0 ? this.strings.empty : this.strings.noMatch;
    return filterArchiveEntries(list.entries, query);
  }

  renderSuggestion(entry: ChatArchiveEntry, el: HTMLElement): void {
    drawArchiveRow(el, entry, {
      strings: this.strings, lang: this.lang, now: this.clock.now(),
      onExport: (e) => { void this.exportEntry(e); },
      onDelete: (e) => { void this.deleteEntry(e); },
    });
  }

  /** Die Wahl der Zeile schließt den Dialog (Obsidian); Umschalt+Enter und Alt+Enter sind Zeilenaktionen und lassen ihn offen. */
  override selectSuggestion(entry: ChatArchiveEntry, evt: MouseEvent | KeyboardEvent): void {
    const action = archiveKeyAction(evt);
    if (action === "export") { void this.exportEntry(entry); return; }
    if (action === "delete") { void this.deleteEntry(entry); return; }
    super.selectSuggestion(entry, evt);
  }

  onChooseSuggestion(entry: ChatArchiveEntry): void { void this.pick(entry); }

  private async pick(entry: ChatArchiveEntry): Promise<void> {
    const record = await this.archive.load(entry.name);
    if (record === null) { new Notice(this.strings.openFailed); return; }
    this.opts.onPick(record, entry);
  }

  private async exportEntry(entry: ChatArchiveEntry): Promise<void> {
    // Der Speicher meldet einen Fehler selbst (`onError`); eine Erfolgsmeldung gibt es nur mit einem Pfad.
    const path = await this.archive.exportNote(entry.name, this.opts.render);
    if (path !== null) new Notice(this.strings.exported(path));
  }

  private async deleteEntry(entry: ChatArchiveEntry): Promise<void> {
    const ok = await confirmAction(this.app, {
      message: this.strings.deleteMessage, confirmLabel: this.strings.deleteConfirm, cancelLabel: this.strings.deleteCancel, warning: true,
    });
    if (!ok) return;
    if (!(await this.archive.remove(entry.name))) return;
    this.cache = null;
    // So zeichnet Obsidian die Liste neu: das Eingabefeld meldet eine Eingabe, `getSuggestions` liest die Liste frisch.
    this.inputEl.dispatchEvent(new Event("input"));
  }
}

/** Öffnet den Dialog. Der Wirt ruft ihn aus dem Verlauf-Knopf (`ChatWindow.openArchive`) und aus einem Befehl („Vergangene Chats“, UI-STANDARD § 4). */
export function openChatArchive(app: App, archive: ChatArchive, opts: OpenChatArchiveOptions): ChatArchiveModal {
  const modal = new ChatArchiveModal(app, archive, opts);
  modal.open();
  return modal;
}
