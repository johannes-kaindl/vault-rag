import type { ChatMessage } from "./chat_client";

export type LlmFormat = "to-list" | "to-prose" | "to-table" | "to-mermaid" | "freetext";

/** Token-Deckel für Transform-Streams (Selektionen sind klein; 4096 ist reichlich). */
export const REFORMAT_MAX_TOKENS = 4096;

const BASE = [
  "Du bist ein Markdown-Formatierungs-Assistent.",
  "Erfinde keine Fakten, füge keine neuen Inhalte hinzu und fasse nicht zusammen — strukturiere ausschließlich den gegebenen Text um.",
  "Gib AUSSCHLIESSLICH das umformatierte Markdown zurück — keine Erklärung, kein einleitender Satz.",
].join(" ");

const FORMAT_INSTRUCTION: Record<Exclude<LlmFormat, "freetext">, string> = {
  "to-list": "Wandle den Text in eine Markdown-Aufzählungsliste um (`- ` pro Punkt), ein Listenpunkt je Kernaussage.",
  "to-prose": "Wandle die Stichpunkte bzw. die Liste in zusammenhängenden Fließtext um.",
  "to-table": "Wandle den Inhalt in eine Markdown-Tabelle um; leite sinnvolle Spalten aus der Struktur des Textes ab.",
  "to-mermaid": "Wandle den Inhalt in ein Mermaid-Diagramm um und gib es in einem ```mermaid-Codeblock zurück. Wähle den passenden Diagrammtyp (z.B. flowchart TD, sequenceDiagram).",
};

/** Baut die [system, user]-Messages für einen LLM-Transform. */
export function buildTransformMessages(format: LlmFormat, text: string, instruction?: string): ChatMessage[] {
  const system = format === "freetext"
    ? `${BASE} Befolge die Anweisung des Nutzers: ${(instruction ?? "").trim()}`.trim()
    : `${BASE} ${FORMAT_INSTRUCTION[format]}`;
  return [
    { role: "system", content: system },
    { role: "user", content: text },
  ];
}
