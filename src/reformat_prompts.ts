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

/** Baut die [system, user]-Messages für einen LLM-Transform.
 *
 *  Der Nicht-freetext-Zweig bezieht den System-Text aus `transformPromptTemplate`, statt ihn
 *  parallel aus denselben Bausteinen erneut zusammenzusetzen — sonst koennte die Komposition
 *  hier von der Fassung in `transformPromptTemplate` abdriften, ohne dass es auffiele: der
 *  gemeldete `promptTemplate`-Hash bliebe stabil, waere aber ein Hash ueber einen Text, der so
 *  nie gesendet wurde. */
export function buildTransformMessages(format: LlmFormat, text: string, instruction?: string): ChatMessage[] {
  const system = format === "freetext"
    ? `${transformPromptTemplate("freetext")} Befolge die Anweisung des Nutzers: ${(instruction ?? "").trim()}`.trim()
    : transformPromptTemplate(format);
  return [
    { role: "system", content: system },
    { role: "user", content: text },
  ];
}

/** Der ueber Aufrufe hinweg STABILE Anteil des System-Prompts eines Transforms — fuer
 *  llm-labs `promptTemplate`. Bei `freetext` ist das NUR `BASE`: die Nutzer-Anweisung
 *  wechselt je Aufruf und wuerde den Fassungs-Hash wertlos machen. */
export function transformPromptTemplate(format: LlmFormat): string {
  return format === "freetext" ? BASE : `${BASE} ${FORMAT_INSTRUCTION[format]}`;
}
