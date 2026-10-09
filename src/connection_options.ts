import type { LlmConnectionOptions } from "./vendor/kit-obsidian/llm-connection";
import type { VaultRagSettings } from "./settings_core";
import { MODE_CHAT, MODE_SMART_APPLY, MODE_REFORMAT, PLUGIN_MODES } from "./request_profile";
import { REFORMAT_MAX_TOKENS } from "./reformat_prompts";

/** Was die Chat-Verbindung vom Plugin braucht. Ein Host-Objekt statt Einzelwerte, weil die Settings
 *  beim Laden ersetzt werden können: gelesen wird erst, wenn die Verbindung fragt. */
export interface ChatConnectionHost {
  app: LlmConnectionOptions["app"];
  pluginId: string;
  settings(): VaultRagSettings;
  save(): Promise<void>;
  lang(): "en" | "de";
}

/** Die Optionen der Chat-Verbindung (Kit `createLlmConnection`, Welle 15) — an EINER Stelle, damit
 *  `main.ts` und die goldenen Requests (`tests/request-golden.test.ts`) dieselbe Konfiguration prüfen
 *  und nicht eine Kopie davon. Nur die Chat-Verbindung: der Embedding-Pfad bleibt bei seiner eigenen
 *  Auflösung (Index-Guard `fits`/`mismatch`, `capability: "embedding"` ist im Kit reserviert). */
export function chatConnectionOptions(h: ChatConnectionHost): LlmConnectionOptions {
  return {
    app: h.app,
    pluginId: h.pluginId,
    caller: "vault-retrieval",
    capability: "chat",
    mode: MODE_CHAT,
    // Der Abschnitt „Anfrage“ zeigt alle drei Modi dieses Plugins (Chat, Smart Apply, Umformen).
    modes: PLUGIN_MODES,
    // Der Chat zeigt dem Nutzer die Stufenwahl (Denk-Knopf mit Dropdown, `thinkingDeps` in main.ts).
    levelPicker: true,
    lang: () => h.lang(),
    // Das Budget des Plugins je Modus: nur Smart Apply (Einstellung) und Umformen (Konstante) haben
    // eines; der Chat lässt das Kit entscheiden.
    maxTokens: (mode) => mode === MODE_SMART_APPLY ? h.settings().smartApplyMaxTokens
      : mode === MODE_REFORMAT ? REFORMAT_MAX_TOKENS : undefined,
    getSettings: () => {
      const s = h.settings();
      return { endpoints: s.chatEndpoints, choice: s.chatChoice, request: s.request };
    },
    // Erst in die Settings schreiben, dann speichern: die Endpunkt-Liste liest ihre Zeilen danach zurück.
    persist: (patch) => {
      const s = h.settings();
      if (patch.endpoints) s.chatEndpoints = patch.endpoints;
      if (patch.choice) s.chatChoice = patch.choice;
      if (patch.request) s.request = patch.request;
      return h.save();
    },
  };
}
