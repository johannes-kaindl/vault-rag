import type { ApplyMode } from "./note_restructurer";

/** Obsidian-freie Settings-Wahrheit: Interface, Defaults, Endpoint-Migration.
 *  Von settings.ts (Plugin-UI) re-exportiert und vom MCP-Server (src/mcp/) direkt
 *  importiert — dieses Modul darf NIE obsidian importieren. */

/** Migriert alte Einzel-Endpoint-Settings auf eine Liste. Reiner Helfer. */
export function migrateEndpointList(single: string | undefined, list: string[] | undefined): string[] {
  if (list && list.length) return list.filter(e => e && e.trim());
  if (single && single.trim()) return [single.trim()];
  return [];
}

export interface VaultRagSettings {
  k: number;
  minSim: number;
  indexDir: string;
  hideIndexFolder: boolean;
  exclude: string[];
  embeddingEndpoints: string[];
  embeddingModel: string;
  showStatusBar: boolean;
  debounceMs: number;
  chatEndpoints: string[];
  chatModel: string;
  chatK: number;
  contextCharBudget: number;
  chatTemperature: number;
  chatSystemPrompt: string;
  chatInputPosition: "bottom" | "top";
  suppressThinking: boolean;
  enterSends: boolean;
  smartApplyEnabled: boolean;
  templateDir: string;
  smartApplyTemperature: number;
  smartApplyModel: string;
  smartApplySuppressThinking: boolean;
  smartApplyMaxTokens: number;
  smartApplyDefaultMode: ApplyMode;
}

export const DEFAULT_SYSTEM_PROMPT =
  "Du beantwortest Fragen gegroundet in den bereitgestellten Notizen des Nutzers. " +
  "Wenn die Antwort nicht aus ihnen hervorgeht, sag das offen. Antworte knapp und auf Deutsch.";

export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  hideIndexFolder: true,
  exclude: ["Templates/", "Archive/"],
  embeddingEndpoints: ["http://localhost:11434"],
  embeddingModel: "qwen3-embedding:8b",
  showStatusBar: false,
  debounceMs: 3000,
  chatEndpoints: ["http://localhost:1234"],
  chatModel: "qwen3",
  chatK: 5,
  contextCharBudget: 12000,
  chatTemperature: 0.7,
  chatSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  chatInputPosition: "bottom",
  suppressThinking: false,
  enterSends: true,
  smartApplyEnabled: false,
  templateDir: "Templates/",
  smartApplyTemperature: 0,
  smartApplyModel: "",
  smartApplySuppressThinking: false,
  smartApplyMaxTokens: 4096,
  smartApplyDefaultMode: "deterministisch",
};
