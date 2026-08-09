import type { ChatMessage } from "./chat_client";
import { transposeTable, tableToList, wrapInCallout } from "./reformat_mechanical";
import { buildTransformMessages } from "./reformat_prompts";

export interface MechanicalTransform {
  id: string;
  label: string;
  kind: "mechanical";
  /** null = Auswahl passt strukturell nicht (z.B. Transpose auf Nicht-Tabelle). */
  run: (text: string) => string | null;
}

export interface LlmTransform {
  id: string;
  label: string;
  kind: "llm";
  /** true nur für "Eigene Anweisung": erfordert eine Freitext-Instruktion. */
  freetext?: boolean;
  buildMessages: (text: string, instruction?: string) => ChatMessage[];
}

export type TransformDef = MechanicalTransform | LlmTransform;

/** Einzige Wahrheit über die verfügbaren Transforms — Picker (Anzeige) und Dispatch lesen sie. */
export const TRANSFORMS: TransformDef[] = [
  { id: "transpose", label: "Tabelle kippen", kind: "mechanical", run: transposeTable },
  { id: "table-to-list", label: "Tabelle → Liste", kind: "mechanical", run: tableToList },
  { id: "wrap-callout", label: "In Callout einpacken", kind: "mechanical", run: (text) => wrapInCallout(text, "note") },
  { id: "to-list", label: "→ Liste / Stichpunkte", kind: "llm", buildMessages: (text) => buildTransformMessages("to-list", text) },
  { id: "to-prose", label: "→ Fließtext", kind: "llm", buildMessages: (text) => buildTransformMessages("to-prose", text) },
  { id: "to-table", label: "→ Tabelle", kind: "llm", buildMessages: (text) => buildTransformMessages("to-table", text) },
  { id: "to-mermaid", label: "→ Mermaid-Diagramm", kind: "llm", buildMessages: (text) => buildTransformMessages("to-mermaid", text) },
  { id: "freetext", label: "Eigene Anweisung…", kind: "llm", freetext: true, buildMessages: (text, instr) => buildTransformMessages("freetext", text, instr) },
];
