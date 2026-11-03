// vendored from obsidian-kit@0.77.0, src/obsidian/chat-archive-strings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Default-Texte (EN/DE) für den Chat-Verlauf (`chat-archive`: Speicher, später Dialog und Einstellungen) — nach dem Muster von `chat-window-strings.ts`.
 *
 *  Herkunft des Wortlauts: eigene Formulierung nach dem Ton der Kit-Texte (`chat-window-strings.ts`, `share-export.ts`); kein Plugin hat einen Verlauf,
 *  aus dem sie stammen könnten (Entwurf „Chat-Kopf“ § 3 liefert nur Neu, Verlauf, Hinweis, Suchfeld, Leerzustand, Zeilenaktionen und die Löschfrage,
 *  die mit dem Dialog kommen). Die Texte des Speichers sind Meldungen über `onError` und die Überschriften des Exports.
 *
 *  Überschreiben: `strings: { lang: "de", untitled: "Ohne Titel" }` — Teil-Merge über dem Default der Sprache. */

export interface ChatArchiveStrings {
  /** Titel eines Chats, dessen erste Frage leer war. */
  untitled: string;
  /** Meldung (`onError`), wenn das Speichern scheiterte (Schreibfehler, ungültige Daten). */
  saveFailed: string;
  /** Meldung (`onError`) für einen Ordner, den der Speicher nicht benutzt (leer geht nicht, aber `..`, ein absoluter Pfad, der Konfigurationsordner). */
  invalidFolder(folder: string): string;
  /** Meldung (`onError`), wenn die Liste sich nicht lesen ließ. */
  listFailed: string;
  /** Meldung (`onError`), wenn das Löschen scheiterte. */
  removeFailed: string;
  /** Meldung (`onError`), wenn die Notiz nicht entstand. */
  exportFailed: string;
  /** Überschriften der Notiz („Als Notiz speichern“): je Runde Frage, Antwort und der zugeklappte Denkblock. */
  exportQuestion: string;
  exportAnswer: string;
  exportThinking: string;
  /** Überschrift der Einstellungsgruppe. */
  settingsHeading: string;
  folderName: string;
  /** Beschreibung der Ordner-Einstellung: Wo die Chats liegen, was leer heißt, dass ein Ordnerwechsel nichts verschiebt, und keine Zusage über einen Sync-Dienst
   *  (ob Obsidian Sync eine `.json` im Vault mitnimmt, ist ungemessen; F-B3). */
  folderDesc(defaultFolder: string): string;
  /** Hinweis unter dem Feld, solange der eingegebene Ordner nicht benutzt werden kann (Symbol und Text, nicht nur Farbe). */
  folderInvalid: string;
  keepName: string;
  /** Beschreibung der Aufbewahrung: 0 heißt kein Verlauf, vorhandene Chats bleiben liegen, und eine Absenkung löscht den Überschuss beim nächsten Speichern. */
  keepDesc: string;
  /** Dialog „Vergangene Chats“ (seit 0.73.0, Teil 2b). */
  placeholder: string;
  /** Leerzustand, solange es keinen Chat gibt (UI-STANDARD § 8 „Empty-State“). */
  empty: string;
  /** Leerzustand, wenn es Chats gibt, die Suche aber keinen trifft. */
  noMatch: string;
  /** Anweisungszeile unter dem Suchfeld: Enter öffnet, die Zeilenaktionen heißen wie die Symbole (`rowExport`, `rowDelete`). */
  instructionOpen: string;
  instructionClose: string;
  /** `aria-label` und Tooltip der zwei Symbole in der Zeile, zugleich Zweck der Tasten Umschalt+Enter und Alt+Enter in der Anweisungszeile. */
  rowExport: string;
  rowDelete: string;
  /** Löschbestätigung: ein Absatz, Bestätigen und Abbrechen. Löschen ist endgültig (kein Papierkorb). */
  deleteMessage: string;
  deleteConfirm: string;
  deleteCancel: string;
  /** Meldung nach dem Export; `path` ist der Pfad der neuen Notiz im Vault. */
  exported(path: string): string;
  /** Meldung, wenn sich ein gewählter Chat nicht öffnen ließ (der Speicher hat die Datei nicht angerührt). */
  openFailed: string;
  /** Zeile am Dialog: so viele `.json`-Dateien im Ordner ließen sich nicht als Chat lesen und bleiben unverändert (gezählt, nicht versteckt). */
  unreadable(n: number): string;
  /** Datum der Zeile: heute mit Uhrzeit, gestern. Ältere Tage schreibt `Intl` in der Sprache. */
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

/** Default der Sprache (EN ohne Angabe), Feld für Feld von `override` überlagert; ein ausdrückliches `undefined` überschreibt nichts. */
export function resolveChatArchiveStrings(override?: ChatArchiveStringsOverride): ChatArchiveStrings {
  const base = override?.lang === "de" ? CHAT_ARCHIVE_STRINGS_DE : CHAT_ARCHIVE_STRINGS_EN;
  if (!override) return base;
  const { lang: _lang, ...fields } = override;
  return { ...base, ...definedOnly(fields) };
}
