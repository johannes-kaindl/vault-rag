import { setIcon, type App } from "obsidian";
import { prepareChatAsk, sentFromMeta, type AskDeps } from "./chat_ask";
import { chatSendFailure } from "./chat_error";
import type { ChatClient } from "./chat_client";
import { ContextPanel, ContextPanelDeps } from "./context_panel";
import { newTurnId } from "./lab_client";
import { MODE_CHAT } from "./request_profile";
import { HubPanel, TabId } from "./hub_panel";
import { getLang, t } from "./vendor/kit/i18n";
import { EMPTY_CHAT, type ChatHistory, type ChatModelMessage } from "./vendor/kit/chat-history";
import { buildChatWindow, type ChatSendHandlers, type ChatSendResult, type ChatWindow, type ChatWindowOptions } from "./vendor/kit-obsidian/chat-window";
import { buildModelBar, type ModelBar, type ModelBarConnection } from "./vendor/kit-obsidian/model-bar";
import type { ThinkingControlOptions } from "./vendor/kit-obsidian/thinking-control";

export const VIEW_TYPE_CHAT = "vault-rag-chat";

/** Der Auto-Kontext sucht beim Tippen mit dieser Verzögerung (wie vor dem Chat-Fenster). */
const CONTEXT_DEBOUNCE_MS = 400;

export interface ChatViewDeps extends ContextPanelDeps, AskDeps {
  app: App;
  /** Modell und Endpunkt der Chat-Verbindung: die Modellzeile im Kopf des Fensters liest und schreibt sie. */
  llm: ModelBarConnection;
  client: () => Pick<ChatClient, "stream">;
  /** Modell der Anfrage; die Sampling-Felder (Modus `grounded`) und die Antwortprüfung baut die Verbindung des Plugins. */
  model: () => string;
  openPath: (path: string) => void;
  inputPosition: () => "bottom" | "top";
  autoK: number;
  /** Denk-Steuerung (Kit `thinking-control`) in der Modellzeile: Stufe je Modus `grounded`, Familie des aktiven Modells, Speichern. */
  thinking: Omit<ThinkingControlOptions, "containerEl">;
  enterSends: () => boolean;
  /** Rendert Modell-Markdown in ein Element (Obsidian-Renderer, vom Plugin gestellt). Das Fenster neutralisiert und schützt selbst (`domGuard`). */
  renderMarkdown: (el: HTMLElement, markdown: string) => Promise<void>;
  /** Nur im Test mit dem Fake-DOM `false` (Durchgriff an den Schreiber des Kits). */
  domGuard?: ChatWindowOptions["domGuard"];
}

/** Der Chat im Hub: eine dünne Hülle um das Kit-Chat-Fenster (`buildChatWindow`, UI-STANDARD § 8 Baustein 12). Hier steht nur, was dieses Plugin selbst
 *  sagt: Kontext und Prompt (`prepareChatAsk`), der Auto-Kontext über dem Textfeld, die Quellen unter der Antwort und die Modellzeile im Kopf. Verlauf,
 *  Eingabe, Abbruch, Fehlerzeile, Kopieren und Markdown trägt das Kit. */
export class ChatPanel implements HubPanel {
  readonly id: TabId = "chat";
  get label(): string { return t("panel.chat.label"); }
  readonly icon = "message-square";
  private container: HTMLElement | null = null;
  private panel: ContextPanel;
  private win: ChatWindow | null = null;
  private bar: ModelBar | null = null;
  private debTimer: number | null = null;
  /** Der Verlauf lebt im Panel, nicht im Fenster: das Panel bleibt über `destroy()` und ein erneutes `mount()` hinweg dieselbe Instanz. */
  private history: ChatHistory = EMPTY_CHAT;

  constructor(private deps: ChatViewDeps) {
    this.panel = new ContextPanel(deps, deps.autoK);
  }

  /** Baut das Fenster in den Container. Wiederholbar: ein zweiter Aufruf (nach `destroy()`) zeichnet mit dem gehaltenen Verlauf neu. */
  mount(container: HTMLElement): void {
    this.container = container;
    this.teardown();
    container.empty();
    // Der Wirt braucht eine begrenzte Höhe, sonst rollt der Verlauf nicht (Kit-Falle); die Regel steht in der styles.css.
    container.addClass("vault-rag-chat-host");
    const d = this.deps;
    this.win = buildChatWindow(container, {
      cls: "vault-rag-chat",
      strings: { lang: getLang(), placeholder: t("panel.chat.inputPlaceholder") },
      send: (messages, h) => this.send(messages, h),
      render: (el, markdown) => d.renderMarkdown(el, markdown),
      enterSends: () => d.enterSends(),
      inputPosition: () => d.inputPosition(),
      // Die Rückgabe meldet die Modellzeile vor der nächsten Zeichnung und bei `destroy()` ab (Kit 0.70.0).
      header: (el) => this.drawHeader(el),
      composer: (el) => { this.drawComposer(el); },
      afterAnswer: (el, entry) => {
        // Das Kit ruft den Einschub auch bei gescheiterten und abgebrochenen Antworten: Quellen gehören nur an eine fertige.
        if (entry.state !== "done") return;
        const sent = sentFromMeta(entry.meta);
        if (sent !== null) this.drawSources(el, sent.sources);
      },
      initial: this.history,
      onChange: (h) => { this.history = h; },
      // Die Zeile sperrt sich während eines Laufs und gibt sich danach frei (Kit `running()`, 0.70.0).
      onRunChange: () => { this.bar?.update(); },
      ...(d.domGuard === undefined ? {} : { domGuard: d.domGuard }),
    });
    // Die Suche beim Tippen: das Fenster hat keinen Rückruf für das Textfeld, das Ereignis bubbelt aber bis zur Wurzel. Im selben Wurzelknoten liegt auch
    // der Auto-Kontext (seine Knöpfe lösen kein `input` aus), gefiltert wird deshalb am Ziel.
    this.win.rootEl.addEventListener("input", (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.hasClass("okit-chat-input")) this.scheduleQuery((el as HTMLTextAreaElement).value);
    });
  }

  private drawHeader(el: HTMLElement): () => void {
    const d = this.deps;
    const bar = buildModelBar({
      app: d.app,
      containerEl: el,
      llm: d.llm,
      label: t("panel.chat.label"),
      strings: { lang: getLang() },
      thinking: d.thinking,
      // Null-sicher: das Fenster ruft `header` und `composer` schon im Konstruktor, `win` ist dann noch nicht zugewiesen.
      disabled: () => this.win?.running() ?? false,
    });
    this.bar = bar;
    return () => {
      bar.destroy();
      if (this.bar === bar) this.bar = null;
    };
  }

  private drawComposer(el: HTMLElement): void {
    this.panel.mount(el.createDiv({ cls: "vault-rag-chat-context" }));
  }

  private drawSources(el: HTMLElement, sources: string[]): void {
    if (sources.length === 0) return;
    const row = el.createDiv({ cls: "vault-rag-chat-sources" });
    for (const p of sources) {
      const chip = row.createEl("button", { cls: "vault-rag-chat-source", attr: { type: "button", "aria-label": p }, text: p.split("/").pop()?.replace(/\.md$/, "") ?? p });
      setIcon(chip.createSpan({ cls: "vault-rag-chat-source-icon" }), "file-text");
      chip.addEventListener("click", () => { this.deps.openPath(p); });
    }
  }

  private scheduleQuery(q: string): void {
    this.clearDebounce();
    this.debTimer = window.setTimeout(() => { void this.panel.setQuery(q); }, CONTEXT_DEBOUNCE_MS);
  }

  private clearDebounce(): void {
    if (this.debTimer !== null) { window.clearTimeout(this.debTimer); this.debTimer = null; }
  }

  /** Eine Runde: Kontext und Prompt bauen, streamen, Fehler dem Fenster so geben, dass die Begründung des Servers erhalten bleibt. */
  private async send(messages: readonly ChatModelMessage[], h: ChatSendHandlers): Promise<ChatSendResult> {
    const d = this.deps;
    // Die Frage ist gesendet: die Entprellung darf nicht mit dem alten Text nachfeuern und die Chips nach dem Zurücksetzen neu schreiben
    // (das programmatische Leeren des Textfelds löst kein `input` aus).
    this.clearDebounce();
    const paths = this.panel.currentPaths();
    this.panel.reset();
    let ask;
    try {
      ask = await prepareChatAsk(messages, paths, d);
    } catch {
      throw new Error(t("chatSession.contextLoadFailed"));
    }
    h.setMeta(ask.sent);
    try {
      const res = await d.client().stream(
        ask.messages,
        (c) => { h.onToken(c); },
        (r) => { h.onReasoning(r); },
        h.signal,
        {
          model: d.model(),
          mode: MODE_CHAT,
          onContentReset: () => { h.onContentReset(); },
          trace: { feature: "chat", app: d.app, contextPaths: ask.sent.sources, promptTemplate: ask.preamble, turnId: newTurnId() },
        },
      );
      return { ok: true, content: res.content, reasoning: res.reasoning, ...(res.finishReason === "length" ? { truncated: true } : {}) };
    } catch (e) {
      const failure = chatSendFailure(e);
      if (failure === null) throw e;
      return failure;
    }
  }

  /** Pause an/aus: Auto-Kontext ruht bzw. sucht die letzte Eingabe neu (Spec 2026-09-17 §3.3). */
  onEmbeddingPause(paused: boolean): void { if (paused) this.panel.onPause(); else this.panel.onResume(); }

  /** Tab wird sichtbar: Modell, Endpunkt und Denkstufe können in den Einstellungen geändert worden sein. */
  onShow(): void { this.bar?.update(); }

  /** Modell oder Endpunkt haben sich außerhalb der Zeile geändert (Einstellungen, Manager): die Zeile zeichnet sich aus dem Zustand neu;
   *  `models: true` lädt zusätzlich die Liste neu (der Endpunkt oder die Liste der Endpunkte hat sich geändert). */
  refreshModelBar(opts: { models?: boolean } = {}): void {
    this.bar?.update();
    if (opts.models === true) void this.bar?.refresh();
  }

  private teardown(): void {
    this.clearDebounce();
    this.win?.destroy();   // meldet auch die Modellzeile ab (Abmelde-Rückgabe des Kopfs)
    this.win = null;
    this.bar = null;
  }

  destroy(): void {
    this.teardown();
    this.container?.removeClass("vault-rag-chat-host");
  }
}
