import type { ContextResult } from "./context_source";

/** Was für eine Frage tatsächlich als Kontext mitging: die Notizen, die nach dem Kürzen aufs Budget in den Prompt kamen. Ein `type`-Alias, kein
 *  `interface`: nur so ist die Form ohne Umwandlung als `JsonValue` (Meta einer Kit-Antwort) ablegbar. */
export type ChatSent = { sources: string[] };

/** Eine Nachricht des Verlaufs, wie das Kit sie ans Modell gibt (`historyForModel`). Strukturell ein `ChatModelMessage`. */
export interface HistoryMessage { role: string; content: string }
/** Eine Nachricht auf dem Draht. Strukturell ein `ChatMessage` des Chat-Clients. */
export interface WireMessage { role: "system" | "user" | "assistant"; content: string }

export interface AskDeps {
  /** Liest die Notizen der Pfade und kürzt sie aufs Budget. Wirft, wenn der Kontext nicht zu laden ist. */
  assemble: (paths: string[]) => Promise<ContextResult>;
  /** `hasContext`: gehen nach dem Kürzen aufs Budget wirklich Notizen mit? Danach richtet sich der Default-Prompt. */
  systemPreamble: (hasContext: boolean) => string;
}

export interface PreparedAsk {
  /** `[system(Prompt + Kontext), …frühere Runden, Frage]`. */
  messages: WireMessage[];
  /** Der Prompt-Anteil ohne Kontext: derselbe Text wie in `system`, fürs llm-lab-Tracing (`trace.promptTemplate`). */
  preamble: string;
  sent: ChatSent;
}

/** Baut die Anfrage einer Runde. Welche früheren Runden dazugehören, entscheidet das Kit: `history` ist `historyForModel`, also nur abgeschlossene
 *  Runden plus die laufende Frage am Ende (der Lauf einer abgebrochenen oder gescheiterten Antwort geht nie ans Modell). Frühere Runden tragen nur
 *  Frage und Antwort, nie erneut den Kontext: der aktuelle steht im System-Prompt. Rollen außerhalb von Nutzer und Assistent (`tool`) kennt der
 *  Chat nicht und fallen weg. Wirft, wenn der Kontext nicht zu laden ist (der Aufrufer macht daraus die Fehlerzeile der Runde). */
export async function prepareChatAsk(history: readonly HistoryMessage[], paths: string[], deps: AskDeps): Promise<PreparedAsk> {
  const last = history[history.length - 1];
  if (last === undefined || last.role !== "user") throw new Error("prepareChatAsk: the history does not end with a question");
  const ctx = await deps.assemble(paths);
  // Einmal gebunden statt zweimal aufgerufen: `preamble` (Tracing) ist strukturell dasselbe wie das, was in `system` gesendet wird.
  const preamble = deps.systemPreamble(ctx.sources.length > 0);
  const system: WireMessage = { role: "system", content: [preamble, ctx.text].filter(Boolean).join("\n\n") };
  const earlier: WireMessage[] = [];
  for (const m of history.slice(0, -1)) if (m.role === "user" || m.role === "assistant") earlier.push({ role: m.role, content: m.content });
  return { messages: [system, ...earlier, { role: "user", content: last.content }], preamble, sent: { sources: ctx.sources } };
}

/** Liest die Quellen einer Antwort aus ihrem Meta zurück; jede andere Form ist `null` (das Meta ist `JsonValue`, nicht typisiert). */
export function sentFromMeta(meta: unknown): ChatSent | null {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return null;
  const sources = (meta as Record<string, unknown>).sources;
  if (!Array.isArray(sources) || !sources.every((s): s is string => typeof s === "string")) return null;
  return { sources };
}
