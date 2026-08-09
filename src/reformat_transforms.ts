import type { ChatMessage } from "./chat_client";
import { transposeTable, tableToList, wrapInCallout } from "./reformat_mechanical";
import { buildTransformMessages } from "./reformat_prompts";

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
}

export type TransformDef = MechanicalTransform | LlmTransform;

/** Einzige Wahrheit über die verfügbaren Transforms — Picker (Anzeige) und Dispatch lesen sie. */
export const TRANSFORMS: TransformDef[] = [
  { id: "transpose", labelKey: "transform.transpose", kind: "mechanical", run: transposeTable },
  { id: "table-to-list", labelKey: "transform.tableToList", kind: "mechanical", run: tableToList },
  { id: "wrap-callout", labelKey: "transform.wrapCallout", kind: "mechanical", run: (text) => wrapInCallout(text, "note") },
  { id: "to-list", labelKey: "transform.toList", kind: "llm", buildMessages: (text) => buildTransformMessages("to-list", text) },
  { id: "to-prose", labelKey: "transform.toProse", kind: "llm", buildMessages: (text) => buildTransformMessages("to-prose", text) },
  { id: "to-table", labelKey: "transform.toTable", kind: "llm", buildMessages: (text) => buildTransformMessages("to-table", text) },
  { id: "to-mermaid", labelKey: "transform.toMermaid", kind: "llm", buildMessages: (text) => buildTransformMessages("to-mermaid", text) },
  { id: "freetext", labelKey: "transform.freetext", kind: "llm", freetext: true, buildMessages: (text, instr) => buildTransformMessages("freetext", text, instr) },
];
