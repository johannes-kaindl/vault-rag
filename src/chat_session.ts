import { ChatClient, ChatMessage } from "./chat_client";
import { ContextResult } from "./context_source";

export interface ChatSessionDeps {
  client: () => ChatClient;
  assemble: (paths: string[]) => Promise<ContextResult>;
  systemPreamble: () => string;
  params: () => { model: string; temperature: number; suppressThinking: boolean };
}

export class ChatSession {
  messages: ChatMessage[] = [];
  private controller: AbortController | null = null;

  constructor(private deps: ChatSessionDeps) {}

  async send(query: string, paths: string[], onToken: (t: string) => void): Promise<{ sources: string[]; error?: string }> {
    // User + leeren Assistenten SOFORT (synchron, vor jedem await) anhängen → die View kann
    // die Frage + den Arbeits-Indikator rendern, bevor Retrieval/LLM anlaufen.
    this.messages.push({ role: "user", content: query });
    const assistant: ChatMessage = { role: "assistant", content: "" };
    this.messages.push(assistant);

    let ctx: ContextResult;
    try { ctx = await this.deps.assemble(paths); }
    catch { assistant.error = "Kontext konnte nicht geladen werden."; return { sources: [], error: assistant.error }; }

    const parts = [this.deps.systemPreamble(), ctx.text].filter(Boolean);
    const system: ChatMessage = { role: "system", content: parts.join("\n\n") };
    // Verlauf an das LLM: nur vollständige Turns (Assistent mit Inhalt, ohne Fehler) — paarweise,
    // damit ein fehlgeschlagener Turn nicht zwei aufeinanderfolgende User-Nachrichten hinterlässt.
    const prior = this.messages.slice(0, -2);
    const history: ChatMessage[] = [];
    for (let i = 0; i + 1 < prior.length; i += 2) {
      const u = prior[i], a = prior[i + 1];
      if (a.content.length > 0 && !a.error) history.push({ role: u.role, content: u.content }, { role: a.role, content: a.content });
    }
    const sent: ChatMessage[] = [system, ...history, { role: "user", content: query }];

    this.controller = new AbortController();
    try {
      // onToken = reiner Re-Render-Notifier (View ignoriert das Argument).
      // reasoning wird am Assistenten akkumuliert, aber NIE in `history` (oben) aufgenommen.
      const p = this.deps.params();
      const result = await this.deps.client().stream(
        sent,
        c => { assistant.content += c; onToken(c); },
        r => { assistant.reasoning = (assistant.reasoning ?? "") + r; onToken(r); },
        this.controller.signal,
        { model: p.model, temperature: p.temperature, suppressThinking: p.suppressThinking },
      );
      assistant.content = result.content;
      assistant.reasoning = result.reasoning || undefined;
      assistant.sources = ctx.sources;
      if (result.content.trim() === "") assistant.error = "Leere Antwort vom Chat-LLM — Endpoint/Modell in den Settings prüfen.";
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
