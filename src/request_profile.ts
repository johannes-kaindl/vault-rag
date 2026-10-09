import {
  onLevelFor, validateOverride,
  type FieldId, type ModeId, type RequestSettings,
} from "./vendor/kit/sampling-profiles";

// Anfrage-Profile (Welle 14, Sampling-Profile Plan Teil E Task 16). Die Werte, die ein Plugin
// sendet (Temperatur, Sampling-Felder, Denk-Stufe), entscheidet die Kit-Tabelle
// `sampling-profiles`; dieses Plugin nennt nur den MODUS je Aufrufstelle. Seit der Verbindung
// (`createLlmConnection`, Welle 15) baut sie die Parameter selbst, hier bleiben die Modi und die
// einmalige Migration der Alt-Regler.
//
// Drei Modi: Chat = `grounded`, Smart Apply = `structured`, Umformatieren = `transform`.

export const MODE_CHAT = "grounded" satisfies ModeId;
export const MODE_SMART_APPLY = "structured" satisfies ModeId;
export const MODE_REFORMAT = "transform" satisfies ModeId;

/** Die Modi dieses Plugins in der Reihenfolge des Abschnitts „Anfrage“. */
export const PLUGIN_MODES: ModeId[] = [MODE_CHAT, MODE_SMART_APPLY, MODE_REFORMAT];

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
