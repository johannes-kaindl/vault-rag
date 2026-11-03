// vendored from obsidian-kit@0.76.1, src/obsidian/chat-archive-settings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { Setting, setIcon, type App } from "obsidian";
import type { SettingDefinitionRender } from "obsidian";
import { MAX_KEEP_CHATS } from "../kit/chat-archive";
import { checkChatArchiveFolder } from "./chat-archive";
import { resolveChatArchiveStrings, type ChatArchiveStrings, type ChatArchiveStringsOverride } from "./chat-archive-strings";
import { FolderSuggest } from "./folder-suggest";

/** Einstellungszeilen des Chat-Verlaufs (Muster `link-settings.ts`, Schieber und Ordnerfeld nach `settings_walker.ts`): der Ordner (Text mit `FolderSuggest`, leer heißt
 *  Vorgabe) und die Aufbewahrung (Schieber 0 bis 500, Vorgabe 50, 0 heißt kein Verlauf). Native `Setting`, das Kit bleibt i18n-frei (Texte `CHAT_ARCHIVE_STRINGS_*`).
 *
 *  Verdrahtung im Plugin: die zwei Werte in den Einstellungen halten, `onChange` speichert; der Speicher (`createChatArchive`) bekommt **Getter** (`folder: () => s.chatFolder`,
 *  `keep: () => s.chatKeep`), damit eine Änderung ohne Neuaufbau wirkt, und das Chat-Fenster bekommt danach `win.refresh()`, damit der Verlauf-Knopf folgt (Aufbewahrung 0 ↔ über 0).
 *  Werte aus `data.json` zuerst durch `clampChatKeep` schicken. Ein ungültiger Ordner wird **nicht gespeichert**: die Zeile zeigt Symbol und Text (nicht nur Farbe). */
export type ChatArchiveSettingKey = "folder" | "keep";

/** Die Vorgabe der Aufbewahrung. */
export const DEFAULT_CHAT_KEEP = 50;

/** Eine Aufbewahrung aus Nutzereingabe oder `data.json`: ganze Zahl von 0 bis 500; alles, was keine Zahl ist, wird die Vorgabe (ein kaputter Wert löscht nie den Verlauf). */
export function clampChatKeep(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CHAT_KEEP;
  return Math.min(MAX_KEEP_CHATS, Math.max(0, Math.round(value)));
}

export interface ChatArchiveSettingsOptions {
  app: App;
  /** Aktueller Wert der Ordner-Einstellung (leer = Vorgabe). */
  folder: string;
  /** Aktuelle Aufbewahrung. */
  keep: number;
  /** Die Vorgabe des Ordners (`Plugin-Anzeigename/Chats`). */
  defaultFolder: string;
  /** `app.vault.configDir`: als Ordner tabu. */
  configDir?: string;
  /** Eine Einstellung wurde geändert: der Aufrufer speichert (Ordner als Text, schon geprüft; Aufbewahrung als begrenzte ganze Zahl). */
  onChange: (key: ChatArchiveSettingKey, value: string | number) => void | Promise<void>;
  strings?: ChatArchiveStringsOverride;
  /** `false` lässt die Überschrift weg (nur `buildChatArchiveSettings`). Default `true`. */
  heading?: boolean;
}

function applyFolder(setting: Setting, opts: ChatArchiveSettingsOptions, s: ChatArchiveStrings): Setting {
  setting.setName(s.folderName).setDesc(s.folderDesc(opts.defaultFolder));
  // Der Hinweis lebt in der Beschreibung der Zeile und wird nur ein- und ausgeblendet; Symbol und Text tragen ihn, die Farbe unterstützt nur.
  const hint = setting.descEl.createDiv({ cls: "okit-chat-archive-invalid is-hidden", attr: { role: "alert" } });
  setIcon(hint.createSpan({ attr: { "aria-hidden": "true" } }), "alert-triangle");
  hint.createSpan({ text: s.folderInvalid });
  return setting.addText((t) => {
    t.setPlaceholder(opts.defaultFolder).setValue(opts.folder).onChange((raw) => {
      const check = checkChatArchiveFolder(raw, opts.defaultFolder, opts.configDir);
      hint.classList.toggle("is-hidden", check.ok);
      if (!check.ok) return;
      // Leer bleibt leer (= Vorgabe, auch wenn die Vorgabe sich ändert); sonst der verzogene Ordner ohne Schrägstrich am Ende.
      void opts.onChange("folder", raw.trim() === "" ? "" : check.folder);
    });
    new FolderSuggest(opts.app, t.inputEl);
  });
}

function applyKeep(setting: Setting, opts: ChatArchiveSettingsOptions, s: ChatArchiveStrings): Setting {
  return setting.setName(s.keepName).setDesc(s.keepDesc).addSlider((sl) => sl
    .setLimits(0, MAX_KEEP_CHATS, 1)
    .setValue(clampChatKeep(opts.keep))
    .onChange((v) => { void opts.onChange("keep", clampChatKeep(v)); }));
}

/** Für Tabs mit `display()`: Überschrift und die zwei Zeilen. Gibt die Zeilen zurück (für Tests und `setDisabled` im Plugin). */
export function buildChatArchiveSettings(containerEl: HTMLElement, opts: ChatArchiveSettingsOptions): { folder: Setting; keep: Setting } {
  const s = resolveChatArchiveStrings(opts.strings);
  if (opts.heading !== false) new Setting(containerEl).setName(s.settingsHeading).setHeading();
  return {
    folder: applyFolder(new Setting(containerEl), opts, s),
    keep: applyKeep(new Setting(containerEl), opts, s),
  };
}

/** Dieselben zwei Zeilen als deklarative Definitionen (Render-Hatch) für Tabs mit `getSettingDefinitions()`; Name und Beschreibung stehen auch an der Definition (Suche). */
export function chatArchiveSettingDefinitions(opts: ChatArchiveSettingsOptions): SettingDefinitionRender[] {
  const s = resolveChatArchiveStrings(opts.strings);
  return [
    { name: s.folderName, desc: s.folderDesc(opts.defaultFolder), render: (setting) => { applyFolder(setting, opts, s); } },
    { name: s.keepName, desc: s.keepDesc, render: (setting) => { applyKeep(setting, opts, s); } },
  ];
}
