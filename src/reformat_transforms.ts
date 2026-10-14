import type { ChatMessage } from "./chat_client";
import { transposeTable, tableToList, removeLineBreaks } from "./reformat_mechanical";
import { wrapCallout } from "./vendor/kit/callout";
import { buildTransformMessages, transformPromptTemplate } from "./reformat_prompts";
import type { ReformatPreset } from "./settings_core";
import { t } from "./vendor/kit/i18n";

export interface MechanicalTransform {
  id: string;
  labelKey: string;
  kind: "mechanical";
  /** null = Auswahl passt strukturell nicht (z.B. Transpose auf Nicht-Tabelle). */
  run: (text: string) => string | null;
}

export interface LlmTransform {
  id: string;
  labelKey: string;
  kind: "llm";
  /** Nur bei selbst angelegten Funktionen: der Titel des Nutzers statt eines Schlüssels (`labelKey` ist dort leer). */
  label?: string;
  /** true nur bei selbst angelegten Funktionen (Titel + feste Anweisung aus den Einstellungen). */
  custom?: boolean;
  /** true nur für "Eigene Anweisung": erfordert eine Freitext-Instruktion. */
  freetext?: boolean;
  buildMessages: (text: string, instruction?: string) => ChatMessage[];
  /** Stabiler Prompt-Anteil fuer llm-labs `promptTemplate` — s. transformPromptTemplate. */
  promptTemplate: () => string;
}

export type TransformDef = MechanicalTransform | LlmTransform;

/** Einzige Wahrheit über die verfügbaren Transforms — Picker (Anzeige) und Dispatch lesen sie. */
export const TRANSFORMS: TransformDef[] = [
  { id: "transpose", labelKey: "transform.transpose", kind: "mechanical", run: transposeTable },
  { id: "table-to-list", labelKey: "transform.tableToList", kind: "mechanical", run: tableToList },
  { id: "wrap-callout", labelKey: "transform.wrapCallout", kind: "mechanical", run: (text) => wrapCallout("", text, "note") },
  { id: "remove-line-breaks", labelKey: "transform.removeLineBreaks", kind: "mechanical", run: removeLineBreaks },
  { id: "to-list", labelKey: "transform.toList", kind: "llm", buildMessages: (text) => buildTransformMessages("to-list", text), promptTemplate: () => transformPromptTemplate("to-list") },
  { id: "to-prose", labelKey: "transform.toProse", kind: "llm", buildMessages: (text) => buildTransformMessages("to-prose", text), promptTemplate: () => transformPromptTemplate("to-prose") },
  { id: "to-table", labelKey: "transform.toTable", kind: "llm", buildMessages: (text) => buildTransformMessages("to-table", text), promptTemplate: () => transformPromptTemplate("to-table") },
  { id: "to-mermaid", labelKey: "transform.toMermaid", kind: "llm", buildMessages: (text) => buildTransformMessages("to-mermaid", text), promptTemplate: () => transformPromptTemplate("to-mermaid") },
  { id: "freetext", labelKey: "transform.freetext", kind: "llm", freetext: true, buildMessages: (text, instr) => buildTransformMessages("freetext", text, instr), promptTemplate: () => transformPromptTemplate("freetext") },
];

/** Anzeigetext eines Transforms: der Titel des Nutzers bei eigenen Funktionen, sonst die Übersetzung des Schlüssels
 *  (zur Anzeigezeit aufgelöst, nie zur Definitionszeit — die Registry ist eine Modul-Konstante). */
export function transformLabel(def: TransformDef): string {
  return def.kind === "llm" && def.label ? def.label : t(def.labelKey);
}

/** Eigene Funktion nur, wenn Titel UND Anweisung etwas enthalten — eine halb ausgefüllte Zeile in den Einstellungen wird nicht angeboten. */
function usable(p: ReformatPreset | null | undefined): p is ReformatPreset {
  return !!p && typeof p.id === "string" && typeof p.title === "string" && typeof p.prompt === "string"
    && p.title.trim() !== "" && p.prompt.trim() !== "";
}

/** Die Registry samt der eigenen Funktionen aus den Einstellungen: Eingebaute zuerst, dann die eigenen, "Eigene Anweisung"
 *  (freetext) bleibt die letzte. Eine eigene Funktion läuft wie freetext, nur mit der gespeicherten Anweisung. */
export function buildTransforms(presets: ReformatPreset[] = []): TransformDef[] {
  const custom: LlmTransform[] = presets.filter(usable).map((p) => ({
    id: `preset:${p.id}`,
    labelKey: "",
    label: p.title.trim(),
    custom: true,
    kind: "llm" as const,
    buildMessages: (text: string) => buildTransformMessages("freetext", text, p.prompt),
    // Die Anweisung ist je Funktion fest und gehört deshalb in die Fassung, die llm-lab hasht.
    promptTemplate: () => `${transformPromptTemplate("freetext")} Befolge die Anweisung des Nutzers: ${p.prompt.trim()}`.trim(),
  }));
  const at = TRANSFORMS.findIndex((d) => d.kind === "llm" && d.freetext);
  const builtIns = [...TRANSFORMS];
  builtIns.splice(at < 0 ? builtIns.length : at, 0, ...custom);
  return builtIns;
}
