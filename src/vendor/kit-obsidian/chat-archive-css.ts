// vendored from obsidian-kit@0.76.1, src/obsidian/chat-archive-css.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** CSS des Chat-Verlaufs (nur Wirte mit `archive`): wie die anderen `*_CSS`-Konstanten laut Kit-Vertrag in die `styles.css` des Plugins kopiert, nicht importiert. Nur
 *  Theme-Variablen, keine festen Größen (UI-STANDARD § 1). Der Store-CSS-Lint (`tests/kit-css-store.test.ts`) fährt sie automatisch.
 *
 *  Zwei Teile: der Hinweis unter dem Ordner-Feld der Einstellungen und die Regeln des Dialogs „Vergangene Chats“ (Zeile mit Titel und Datum, die zwei Symbole rechts, die Zielgröße
 *  auf Mobil, die Zeile für unlesbare Dateien). Die Regeln des Dialogs hängen an den Klassen der Zeile, nie an Obsidians `.suggestion-item` allein (das Theme gehört dem Nutzer). */
export const CHAT_ARCHIVE_CSS = `
.okit-chat-archive-invalid {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  margin-top: var(--size-4-1);
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}
.okit-chat-archive-invalid.is-hidden { display: none; }
.okit-chat-archive-invalid svg { width: var(--icon-s); height: var(--icon-s); flex: none; }
/* Dialog „Vergangene Chats“: die Zeile ist Obsidians Vorschlagszeile, die zwei Symbole stehen rechts und halten die Wahl der Zeile an (Klick und Tastatur laufen über den Dialog). */
.okit-chat-archive-row { display: flex; align-items: center; justify-content: space-between; gap: var(--size-4-2); }
.okit-chat-archive-text { display: flex; flex-direction: column; gap: var(--size-2-1); min-width: 0; flex: 1 1 auto; }
.okit-chat-archive-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.okit-chat-archive-date { color: var(--text-muted); font-size: var(--font-ui-smaller); }
.okit-chat-archive-actions { display: flex; align-items: center; gap: var(--size-2-2); flex: none; }
.okit-chat-archive-actions svg { width: var(--icon-s); height: var(--icon-s); }
.okit-chat-archive-delete { color: var(--text-muted); }
.okit-chat-archive-unreadable { padding: var(--size-4-2) var(--size-4-3); color: var(--text-muted); font-size: var(--font-ui-smaller); border-top: var(--border-width) solid var(--background-modifier-border); }
/* Auf Mobil sind die Symbole mindestens 44 px hoch und breit (Zielgröße): 4 × 12 = 48 px. Die Stufe --size-4-11 gibt es in Obsidian nicht (Pilot 2026-10-27: Zielgröße blieb bei 30 × 26 px); die Zeile wächst mit. */
.is-mobile .okit-chat-archive-actions .clickable-icon { min-width: var(--size-4-12); min-height: var(--size-4-12); display: flex; align-items: center; justify-content: center; }
`;
