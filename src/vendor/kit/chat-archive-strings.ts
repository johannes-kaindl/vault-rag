// vendored from code-kit@0.87.0, src/ts/pure/chat-archive-strings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Default texts (EN/DE) for the chat history (`chat-archive-store`: store; the dialog and the settings rows live in obsidian-kit),
 *  after the pattern of obsidian-kit `chat-window-strings.ts`. The German values are data, not code: they stay German.
 *
 *  Origin of the wording: own phrasing in the tone of the kit texts (`chat-window-strings.ts`, `share-export.ts`); no plugin has a
 *  history to take them from. The store's texts are messages through `onError` and the headings of the note export; the rest is for
 *  the dialog and the settings rows of obsidian-kit, which vendors this file back (moved here from obsidian-kit
 *  `src/obsidian/chat-archive-strings.ts` together with the store, wave 33: the store needs `resolveChatArchiveStrings`).
 *
 *  Override: `strings: { lang: "de", untitled: "Ohne Titel" }` — partial merge over the default of the language. */

export interface ChatArchiveStrings {
  /** Title of a chat whose first question was empty. */
  untitled: string;
  /** Message (`onError`) when saving failed (write error, invalid data). */
  saveFailed: string;
  /** Message (`onError`) for a folder the store does not use (empty is fine, but `..`, an absolute path, the config folder are not). */
  invalidFolder(folder: string): string;
  /** Message (`onError`) when the list could not be read. */
  listFailed: string;
  /** Message (`onError`) when deleting failed. */
  removeFailed: string;
  /** Message (`onError`) when the note was not created. */
  exportFailed: string;
  /** Headings of the note ("Save as note"): per round the question, the answer and the collapsed thinking block. */
  exportQuestion: string;
  exportAnswer: string;
  exportThinking: string;
  /** Heading of the settings group. */
  settingsHeading: string;
  folderName: string;
  /** Description of the folder setting: where the chats live, what empty means, that changing the folder moves nothing, and no promise about a sync
   *  service (whether Obsidian Sync takes a `.json` in the vault along is unmeasured; F-B3). */
  folderDesc(defaultFolder: string): string;
  /** Hint under the field while the entered folder cannot be used (symbol and text, not only colour). */
  folderInvalid: string;
  keepName: string;
  /** Description of the keep setting: 0 means no history, existing chats stay, and lowering it deletes the surplus at the next save. */
  keepDesc: string;
  /** Dialog "Past chats" (since 0.73.0, part 2b). */
  placeholder: string;
  /** Empty state while there is no chat (UI-STANDARD § 8 "Empty-State"). */
  empty: string;
  /** Empty state when there are chats but the search matches none. */
  noMatch: string;
  /** Instruction line under the search field: Enter opens, the row actions are named like the symbols (`rowExport`, `rowDelete`). */
  instructionOpen: string;
  instructionClose: string;
  /** `aria-label` and tooltip of the two symbols in the row, also the purpose of Shift+Enter and Alt+Enter in the instruction line. */
  rowExport: string;
  rowDelete: string;
  /** Delete confirmation: one paragraph, confirm and cancel. Deleting is final (no trash). */
  deleteMessage: string;
  deleteConfirm: string;
  deleteCancel: string;
  /** Message after the export; `path` is the path of the new note in the vault. */
  exported(path: string): string;
  /** Message when a chosen chat could not be opened (the store did not touch the file). */
  openFailed: string;
  /** Line at the dialog: this many `.json` files in the folder could not be read as a chat and stay unchanged (counted, not hidden). */
  unreadable(n: number): string;
  /** Date of the row: today with the time, yesterday. Older days are written by `Intl` in the language. */
  dateToday(time: string): string;
  dateYesterday: string;
}

export interface ChatArchiveStringsOverride extends Partial<ChatArchiveStrings> {
  lang?: "en" | "de";
}

export const CHAT_ARCHIVE_STRINGS_EN: ChatArchiveStrings = {
  untitled: "Untitled chat",
  saveFailed: "This chat could not be saved to past chats.",
  invalidFolder: (folder) => `The folder for past chats is not valid: “${folder}”.`,
  listFailed: "Past chats could not be read.",
  removeFailed: "The chat could not be deleted.",
  exportFailed: "The chat could not be saved as a note.",
  exportQuestion: "Question",
  exportAnswer: "Answer",
  exportThinking: "Thinking",
  settingsHeading: "Past chats",
  folderName: "Folder for past chats",
  folderDesc: (defaultFolder) => `Chats are saved as .json files in this folder of your vault. Empty means “${defaultFolder}”. Changing the folder does not move chats that are already saved. Whether your sync service picks them up depends on its settings.`,
  folderInvalid: "This folder can’t be used. Choose a folder inside your vault whose name doesn’t start with a dot.",
  keepName: "Chats to keep",
  keepDesc: "How many past chats are kept, from 0 to 500. 0 turns past chats off; chats that are already saved stay where they are. Saving a chat deletes the oldest ones beyond this number, so lowering it deletes the surplus at the next save.",
  placeholder: "Search past chats…",
  empty: "No past chats yet",
  noMatch: "No chat matches your search",
  instructionOpen: "Open chat",
  instructionClose: "Close",
  rowExport: "Save as note",
  rowDelete: "Delete",
  deleteMessage: "Delete this chat? This can’t be undone.",
  deleteConfirm: "Delete",
  deleteCancel: "Cancel",
  exported: (path) => `Saved as note: ${path}`,
  openFailed: "This chat could not be opened.",
  unreadable: (n) => (n === 1 ? "1 file could not be read (left unchanged)" : `${n} files could not be read (left unchanged)`),
  dateToday: (time) => `today ${time}`,
  dateYesterday: "yesterday",
};

export const CHAT_ARCHIVE_STRINGS_DE: ChatArchiveStrings = {
  untitled: "Unbenanntes Gespräch",
  saveFailed: "Das Gespräch ließ sich nicht im Verlauf ablegen.",
  invalidFolder: (folder) => `Der Ordner für vergangene Chats ist ungültig: „${folder}“.`,
  listFailed: "Vergangene Chats ließen sich nicht lesen.",
  removeFailed: "Das Gespräch ließ sich nicht löschen.",
  exportFailed: "Das Gespräch ließ sich nicht als Notiz speichern.",
  exportQuestion: "Frage",
  exportAnswer: "Antwort",
  exportThinking: "Denken",
  settingsHeading: "Vergangene Chats",
  folderName: "Ordner für vergangene Chats",
  folderDesc: (defaultFolder) => `Gespräche liegen als .json-Dateien in diesem Ordner deines Vaults. Leer heißt „${defaultFolder}“. Ein anderer Ordner verschiebt schon gespeicherte Chats nicht. Ob dein Sync-Dienst sie mitnimmt, hängt von dessen Einstellungen ab.`,
  folderInvalid: "Dieser Ordner lässt sich nicht verwenden. Nimm einen Ordner im Vault, dessen Name nicht mit einem Punkt beginnt.",
  keepName: "Gespräche aufbewahren",
  keepDesc: "Wie viele vergangene Chats aufbewahrt werden, von 0 bis 500. Bei 0 ist der Verlauf aus; schon gespeicherte Chats bleiben liegen. Beim Speichern werden die ältesten Chats gelöscht, die über diese Zahl hinausgehen: wer die Zahl senkt, löscht den Überschuss beim nächsten Speichern.",
  placeholder: "Vergangene Chats durchsuchen …",
  empty: "Noch keine vergangenen Chats",
  noMatch: "Kein Chat passt zur Suche",
  instructionOpen: "Chat öffnen",
  instructionClose: "Schließen",
  rowExport: "Als Notiz speichern",
  rowDelete: "Löschen",
  deleteMessage: "Diesen Chat löschen? Das lässt sich nicht rückgängig machen.",
  deleteConfirm: "Löschen",
  deleteCancel: "Abbrechen",
  exported: (path) => `Als Notiz gespeichert: ${path}`,
  openFailed: "Dieser Chat ließ sich nicht öffnen.",
  unreadable: (n) => (n === 1 ? "1 Datei nicht lesbar (bleibt unverändert)" : `${n} Dateien nicht lesbar (bleiben unverändert)`),
  dateToday: (time) => `heute ${time}`,
  dateYesterday: "gestern",
};

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The default of the language (EN without one), overlaid field by field by `override`; an explicit `undefined` overrides nothing. */
export function resolveChatArchiveStrings(override?: ChatArchiveStringsOverride): ChatArchiveStrings {
  const base = override?.lang === "de" ? CHAT_ARCHIVE_STRINGS_DE : CHAT_ARCHIVE_STRINGS_EN;
  if (!override) return base;
  const { lang: _lang, ...fields } = override;
  return { ...base, ...definedOnly(fields) };
}
