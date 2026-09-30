import {
  resolveRequestParams, thinkingFor, onLevelFor, validateOverride,
  type BackendId, type FamilyId, type FieldId, type ModeId, type RequestSettings, type ResolvedRequest, type ThinkingLevel,
} from "./vendor/kit/sampling-profiles";

// Anfrage-Profile (Welle 14, Sampling-Profile Plan Teil E Task 16). Die Werte, die ein Plugin
// sendet (Temperatur, Sampling-Felder, Denk-Stufe), entscheidet die Kit-Tabelle
// `sampling-profiles`; dieses Plugin nennt nur den MODUS je Aufrufstelle und sein Budget.
//
// Drei Modi, je ein duenner Wrapper mit fest verdrahtetem Modus (Nachtrag 3 des Rezepts,
// Vorbild `buildTuneParams` in lingotuner): Chat = `grounded`, Smart Apply = `structured`,
// Umformatieren = `transform`. Die goldenen Requests rufen DIESE Wrapper, nicht
// `resolveRequestParams` — sonst pruefte der Test das Kit statt das Plugin.

export const MODE_CHAT = "grounded" satisfies ModeId;
export const MODE_SMART_APPLY = "structured" satisfies ModeId;
export const MODE_REFORMAT = "transform" satisfies ModeId;

/** Die Modi dieses Plugins in der Reihenfolge des Abschnitts „Anfrage“. */
export const PLUGIN_MODES: ModeId[] = [MODE_CHAT, MODE_SMART_APPLY, MODE_REFORMAT];

/** Was ueber den aktiven Chat-Endpunkt bekannt ist: Familie und Backend samt Quelle, das
 *  Modell und seine gesendete Schreibweise. Traegt der Abschnitt „Anfrage“ und die Anfrage. */
export interface SourceFacts {
  family: FamilyId | null;
  familySource: "manager" | "name" | "none";
  backend: BackendId;
  backendSource: "manager" | "probe" | "none";
  model: string;
  sentModel: string;
  defaultModel?: string;
}

export const NO_SOURCE: SourceFacts = {
  family: null, familySource: "none", backend: "unknown", backendSource: "none", model: "", sentModel: "",
};

export interface BuiltRequest extends ResolvedRequest {
  /** Die Denk-Stufe, mit der gebaut wurde — `checkResponse` braucht sie. */
  level: ThinkingLevel;
}

/** Gemeinsamer Kern der drei Wrapper. `maxTokens` ist das Budget des PLUGINS; fehlt es, wird
 *  kein `max_tokens` gesendet (das Kit hebt ein vorhandenes auf die Reserve der Familie). */
function build(
  mode: ModeId,
  src: Pick<SourceFacts, "family" | "backend">,
  settings: RequestSettings,
  maxTokens?: number,
): BuiltRequest {
  const level = thinkingFor(settings, mode);
  const overrides = settings.overrides[mode]?.[src.family ?? "unknown"] ?? {};
  const resolved = resolveRequestParams({
    family: src.family, mode, backend: src.backend, thinking: level,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    overrides,
  });
  return { ...resolved, level };
}

export function buildChatParams(src: Pick<SourceFacts, "family" | "backend">, settings: RequestSettings, maxTokens?: number): BuiltRequest {
  return build(MODE_CHAT, src, settings, maxTokens);
}

export function buildSmartApplyParams(src: Pick<SourceFacts, "family" | "backend">, settings: RequestSettings, maxTokens?: number): BuiltRequest {
  return build(MODE_SMART_APPLY, src, settings, maxTokens);
}

export function buildReformatParams(src: Pick<SourceFacts, "family" | "backend">, settings: RequestSettings, maxTokens?: number): BuiltRequest {
  return build(MODE_REFORMAT, src, settings, maxTokens);
}

// --- Legacy-Migration -------------------------------------------------------------------------
// Bis 0.36 hatte das Plugin drei eigene Regler: Chat-Temperatur, Smart-Apply-Temperatur und je
// einen „Thinking unterdruecken“-Schalter. Sie gehen in den Abschnitt „Anfrage“ auf. Eine
// Temperatur, die vom alten Default abweicht, war eine Nutzerwahl und wird Ueberschreibung unter
// `unknown` (die Familie ist beim Laden nicht bekannt); gleich dem Default wird sie verworfen,
// der neue Moduswert gilt. Die Schalter werden Denk-Stufen nach Rezept 3.

const LEGACY_DEFAULT_CHAT_TEMPERATURE = 0.7;
const LEGACY_DEFAULT_SMART_APPLY_TEMPERATURE = 0;

/** Schluessel, die nach der Migration aus den gespeicherten Einstellungen verschwinden. */
export const LEGACY_SAMPLING_KEYS = ["chatTemperature", "suppressThinking", "smartApplyTemperature", "smartApplySuppressThinking"] as const;

export interface LegacyMigration {
  request: RequestSettings;
  /** Mindestens eine Nutzer-Temperatur wurde Ueberschreibung — einmalig melden. */
  overridesCreated: boolean;
  /** Es gab ueberhaupt Alt-Schluessel zu bereinigen. */
  touched: boolean;
}

function setOverride(s: RequestSettings, mode: ModeId, field: FieldId, value: number): boolean {
  const ok = validateOverride(field, value);
  if (ok === null) return false;
  const byFam = (s.overrides[mode] ??= {});
  const fields = (byFam.unknown ??= {});
  // Eine schon gesetzte Ueberschreibung ist die neuere Wahl und bleibt.
  if (fields[field] === undefined) fields[field] = ok;
  return true;
}

/** Zieht die Alt-Regler aus den rohen gespeicherten Einstellungen in `request`. Pur: liefert
 *  eine neue Struktur, mutiert weder `raw` noch `request`. */
export function migrateLegacySampling(raw: Record<string, unknown>, request: RequestSettings): LegacyMigration {
  const next: RequestSettings = structuredClone(request);
  let overridesCreated = false;
  const touched = LEGACY_SAMPLING_KEYS.some((k) => raw[k] !== undefined);

  const t1 = raw.chatTemperature;
  if (typeof t1 === "number" && t1 !== LEGACY_DEFAULT_CHAT_TEMPERATURE) {
    overridesCreated = setOverride(next, MODE_CHAT, "temperature", t1) || overridesCreated;
  }
  const t2 = raw.smartApplyTemperature;
  if (typeof t2 === "number" && t2 !== LEGACY_DEFAULT_SMART_APPLY_TEMPERATURE) {
    overridesCreated = setOverride(next, MODE_SMART_APPLY, "temperature", t2) || overridesCreated;
  }
  if (typeof raw.suppressThinking === "boolean" && next.thinking[MODE_CHAT] === undefined) {
    next.thinking[MODE_CHAT] = raw.suppressThinking ? "off" : onLevelFor(next, MODE_CHAT);
  }
  if (typeof raw.smartApplySuppressThinking === "boolean" && next.thinking[MODE_SMART_APPLY] === undefined) {
    next.thinking[MODE_SMART_APPLY] = raw.smartApplySuppressThinking ? "off" : onLevelFor(next, MODE_SMART_APPLY);
  }
  return { request: next, overridesCreated, touched };
}
