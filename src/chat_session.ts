import { ChatClient, ChatMessage } from "./chat_client";
import { ChatMode, ContextResult } from "./context_source";

const SYSTEM_PREAMBLE =
  "Du beantwortest Fragen gegroundet in den bereitgestellten Notizen des Nutzers. " +
  "Wenn die Antwort nicht aus ihnen hervorgeht, sag das offen. Antworte knapp und auf Deutsch.";

export interface ChatSessionDeps {
  client: ChatClient;
  assemble: (mode: ChatMode, query: string, picked: string[]) => Promise<ContextResult>;
}

export class ChatSession {
  messages: ChatMessage[] = [];
  mode: ChatMode = "auto-rag";
  picked: string[] = [];
  private controller: AbortController | null = null;

  constructor(private deps: ChatSessionDeps) {}

  async send(query: string, onToken: (t: string) => void): Promise<{ sources: string[]; error?: string }> {
    // User + leeren Assistenten SOFORT (synchron, vor jedem await) anhängen → die View kann die
    // Frage + einen Arbeits-Indikator rendern, bevor Retrieval/LLM (Zeit bis zum ersten Token) anlaufen.
    this.messages.push({ role: "user", content: query });
    const assistant: ChatMessage = { role: "assistant", content: "" };
    this.messages.push(assistant);

    let ctx: ContextResult;
    try { ctx = await this.deps.assemble(this.mode, query, this.picked); }
    catch { assistant.error = "Kontext konnte nicht geladen werden."; return { sources: [], error: assistant.error }; }

    const system: ChatMessage = { role: "system", content: ctx.text ? `${SYSTEM_PREAMBLE}\n\n${ctx.text}` : SYSTEM_PREAMBLE };
    // Verlauf an das LLM: prior Turns (ohne den aktuellen, die letzten zwei) mit Inhalt, auf role/content reduziert.
    const history = this.messages.slice(0, -2).filter(m => m.content.length > 0).map(m => ({ role: m.role, content: m.content }));
    const sent: ChatMessage[] = [system, ...history, { role: "user", content: query }];

    this.controller = new AbortController();
    try {
      const full = await this.deps.client.stream(sent, t => { assistant.content += t; onToken(t); }, this.controller.signal);
      assistant.content = full;
      assistant.sources = ctx.sources;
      if (full.trim() === "") assistant.error = "Leere Antwort vom Chat-LLM — Endpoint/Modell in den Settings prüfen.";
      return { sources: ctx.sources };
    } catch (e) {
      const aborted = (e as { name?: string })?.name === "AbortError";
      if (!aborted) assistant.error = "Chat-LLM nicht erreichbar (lokal/VPN).";
      return { sources: ctx.sources, error: aborted ? undefined : assistant.error };
    }
  }

  reset(): void { this.abort(); this.messages = []; }

  abort(): void { this.controller?.abort(); }
}
