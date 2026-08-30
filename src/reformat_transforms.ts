import type { ChatMessage } from "./chat_client";
import { transposeTable, tableToList } from "./reformat_mechanical";
import { wrapCallout } from "./vendor/kit/callout";
import { buildTransformMessages, transformPromptTemplate } from "./reformat_prompts";

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
  { id: "to-list", labelKey: "transform.toList", kind: "llm", buildMessages: (text) => buildTransformMessages("to-list", text), promptTemplate: () => transformPromptTemplate("to-list") },
  { id: "to-prose", labelKey: "transform.toProse", kind: "llm", buildMessages: (text) => buildTransformMessages("to-prose", text), promptTemplate: () => transformPromptTemplate("to-prose") },
  { id: "to-table", labelKey: "transform.toTable", kind: "llm", buildMessages: (text) => buildTransformMessages("to-table", text), promptTemplate: () => transformPromptTemplate("to-table") },
  { id: "to-mermaid", labelKey: "transform.toMermaid", kind: "llm", buildMessages: (text) => buildTransformMessages("to-mermaid", text), promptTemplate: () => transformPromptTemplate("to-mermaid") },
  { id: "freetext", labelKey: "transform.freetext", kind: "llm", freetext: true, buildMessages: (text, instr) => buildTransformMessages("freetext", text, instr), promptTemplate: () => transformPromptTemplate("freetext") },
];
