import type { ApplyMode } from "./note_restructurer";
import type { EndpointConfig } from "./endpoint_config";
import { t as uebersetze } from "./vendor/kit/i18n";

/** Obsidian-freie Settings-Wahrheit: Interface, Defaults, Endpoint-Migration.
 *  Von settings.ts (Plugin-UI) re-exportiert und vom MCP-Server (src/mcp/) direkt
 *  importiert — dieses Modul darf NIE obsidian importieren. */

// Endpunkt-Wahrheit (Struktur, Auth, Modellwahl, Migration) lebt in endpoint_config.ts und wird
// von dort importiert — bewusst NICHT durchgereicht: eine öffentliche Fläche pro Wahrheit.

export interface VaultRagSettings {
  k: number;
  minSim: number;
  indexDir: string;
  hideIndexFolder: boolean;
  exclude: string[];
  embeddingEndpoints: EndpointConfig[];
  embeddingModel: string;
  showStatusBar: boolean;
  debounceMs: number;
  chatEndpoints: EndpointConfig[];
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
  mcpEnabled: boolean;
  mcpPort: number;
  mcpToken: string;
  /** Auf-/Zu-Zustand der Settings-Sektionen (key → collapsed). */
  uiCollapsed: Record<string, boolean>;
}

/**
 * Der Chat-System-Prompt, wie er bis 0.25.0 als Auslieferungs-Default ausgeliefert wurde.
 *
 * Bleibt als Konstante bestehen, obwohl er kein Default mehr ist: Bestandsnutzer haben ihn
 * woertlich in ihrer `data.json` stehen (beim ersten Speichern aus DEFAULT_SETTINGS
 * hineinkopiert), und `effectiveSystemPrompt` erkennt daran, dass es sich um einen
 * uebernommenen Default handelt und NICHT um eine bewusste Anpassung.
 */
export const LEGACY_SYSTEM_PROMPT =
  "Du beantwortest Fragen gegroundet in den bereitgestellten Notizen des Nutzers. " +
  "Wenn die Antwort nicht aus ihnen hervorgeht, sag das offen. Antworte knapp und auf Deutsch.";

/**
 * Der wirksame System-Prompt einer Chat-Anfrage.
 *
 * Warum es diese Funktion gibt und der Default nicht einfach ein anderer Satz ist: ein
 * fertiger Satz in `DEFAULT_SETTINGS` wird auf **Modul-Ebene** ausgewertet — vor
 * `setLang()` im `onload` — und ist damit in einer Sprache eingefroren, egal was der Nutzer
 * eingestellt hat. Genau das war der Fehler: der Default verlangte woertlich „Antworte
 * knapp und auf Deutsch.", und eine englische Oberflaeche bekam auf englische Fragen
 * deutsche Antworten. Dieselbe Regel wie bei `labelKey` und `HubPanel.label`, nur dass der
 * Text hier nicht in die Oberflaeche geht, sondern ins Modell — weshalb ihn weder der
 * Sink-Waechter noch der Modul-Ebenen-Check sehen konnten.
 *
 * Leer (oder der alte deutsche Default) heisst „nicht angepasst" und wird zur ANFRAGEZEIT
 * uebersetzt. Ein eigener Prompt bleibt unangetastet, in jeder Sprache.
 */
/**
 * Einmalige Migration beim Laden: der alte deutsche Default wird geraeumt.
 *
 * Warum zusaetzlich zu `effectiveSystemPrompt`: das Einstellungs-Feld zeigt den
 * GESPEICHERTEN Wert. Bliebe der alte Satz dort stehen, laese ein Bestandsnutzer weiter
 * "Antworte knapp und auf Deutsch." und bekaeme trotzdem englische Antworten — ein
 * sichtbarer Widerspruch, den niemand sich erklaeren koennte. Nach der Migration ist das
 * Feld leer, und leer heisst sichtbar "der Default gilt".
 *
 * Ein selbst geschriebener Prompt bleibt unangetastet: nur der woertliche Alt-Default gilt
 * als uebernommen.
 */
export function migrateSystemPrompt(stored: string): string {
  return stored.trim() === LEGACY_SYSTEM_PROMPT ? "" : stored;
}

export function effectiveSystemPrompt(stored: string): string {
  const eigen = stored.trim();
  if (!eigen || eigen === LEGACY_SYSTEM_PROMPT) return uebersetze("chat.systemPrompt.default");
  return stored;
}

export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  hideIndexFolder: true,
  exclude: ["Templates/", "Archive/"],
  embeddingEndpoints: [{ url: "http://localhost:11434" }],
  embeddingModel: "qwen3-embedding:8b",
  showStatusBar: false,
  debounceMs: 3000,
  chatEndpoints: [{ url: "http://localhost:1234" }],
  chatModel: "qwen3",
  chatK: 5,
  contextCharBudget: 12000,
  chatTemperature: 0.7,
  chatSystemPrompt: "",
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
  mcpEnabled: false,
  mcpPort: 8123,
  mcpToken: "",
  uiCollapsed: {},
};

/** Komma-getrennte Ausschluss-Pfade → getrimmte, leer-gefilterte Liste. */
export function splitExcludePaths(input: string): string[] {
  return input.split(",").map(x => x.trim()).filter(Boolean);
}

/** Vorlagen-Ordner normalisieren: getrimmt, mit Trailing-Slash (leer bleibt leer). */
export function normalizeTemplateDir(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  return trimmed.endsWith("/") ? trimmed : trimmed + "/";
}
