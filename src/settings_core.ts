import type { ApplyMode } from "./note_restructurer";
import type { EndpointConfig } from "./endpoint_config";
import { t as uebersetze } from "./vendor/kit/i18n";
import type { EndpointChoice } from "./vendor/kit/endpoint-source";

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
  /** Wahl gegenueber dem LLM Endpoint Manager (Endpunkt-ID + Modell); leer = automatisch.
   *  Gilt nur, solange der Manager installiert ist — die lokale Liste bleibt der Rueckfall. */
  embeddingChoice: EndpointChoice;
  showStatusBar: boolean;
  debounceMs: number;
  chatEndpoints: EndpointConfig[];
  chatChoice: EndpointChoice;
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
  // Integrator (Spec 2026-09-07, §5)
  integratorEnabled: boolean;
  /** Pfad-Praefixe wie `exclude`. Leer = automatischer Ausloeser aus, nur Kommandos. */
  integratorFolders: string[];
  linkTarget: "section" | "frontmatter";
  /** Wird UNUEBERSETZT in die Notiz geschrieben (dieselbe Grenze wie UEBRIG_HEADING). */
  linkHeading: string;
  linkField: string;
  linkK: number;
  linkMinSim: number;
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

/**
 * Migration (0.31.0): das globale Modellfeld (`embeddingModel`/`chatModel`) ist entfallen —
 * ein Modellname existiert nur auf dem Endpunkt, der ihn meldet. Der alte globale Wert wandert
 * in jede Zeile, die noch kein eigenes Modell trägt; Zeilen mit Modell bleiben, wie sie sind.
 * Ohne diesen Schritt stünden Bestandsnutzer nach dem Update mit Endpunkten ohne Modell da,
 * und das scheitert STILL (leerer Modellname in der Anfrage) — dieselbe Falle, die bei
 * `chatApiKey` dokumentiert ist. Pure, mutiert die Eingabe nicht.
 */
export function migrateGlobalModels(eps: EndpointConfig[], legacyGlobal: string | undefined): EndpointConfig[] {
  const global = legacyGlobal?.trim();
  if (!global) return eps.map(e => ({ ...e }));
  return eps.map(e => (e.model?.trim() ? { ...e } : { ...e, model: global }));
}

/** Prä-0.31-Schlüssel, die `mergeSettings` aus einer alten data.json mitkopiert (Object.assign
 *  kennt keine Schemagrenze). Nach `migrateGlobalModels` gehören sie weg — sonst liefe die
 *  Migration bei JEDEM Start erneut und füllte ein bewusst geleertes Zeilen-Modell still wieder
 *  aus dem Altwert. Gemessen 2026-09-07 am laufenden Plugin. */
export const LEGACY_GLOBAL_MODEL_KEYS = ["embeddingModel", "chatModel"] as const;
export function stripLegacyGlobalModels<T extends object>(settings: T): T {
  const s = settings as Record<string, unknown>;
  for (const k of LEGACY_GLOBAL_MODEL_KEYS) delete s[k];
  return settings;
}

export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  hideIndexFolder: true,
  exclude: ["Templates/", "Archive/"],
  embeddingEndpoints: [{ url: "http://localhost:11434", model: "qwen3-embedding:8b" }],
  embeddingChoice: {},
  showStatusBar: false,
  debounceMs: 3000,
  chatEndpoints: [{ url: "http://localhost:1234", model: "qwen3" }],
  chatChoice: {},
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
  smartApplySuppressThinking: true,
  smartApplyMaxTokens: 4096,
  smartApplyDefaultMode: "deterministisch",
  integratorEnabled: false,
  integratorFolders: [],
  linkTarget: "section",
  linkHeading: "Verwandte Notizen",
  linkField: "related",
  linkK: 5,
  linkMinSim: 0.5,
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
