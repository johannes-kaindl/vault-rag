import { setIcon } from "obsidian";
import { ChatSession } from "./chat_session";
import { ContextPanel, ContextPanelDeps } from "./context_panel";
import { isAlwaysOnThinker } from "./reasoning";
import { HubPanel, TabId } from "./hub_panel";

export const VIEW_TYPE_CHAT = "vault-rag-chat";

export interface ChatViewDeps extends ContextPanelDeps {
  session: ChatSession;
  openPath: (path: string) => void;
  ping: () => Promise<boolean>;
  copyText: (text: string) => void;
  listModels: () => Promise<string[]>;
  getModel: () => string;
  setModel: (m: string) => void;
  inputPosition: () => "bottom" | "top";
  autoK: number;
  getSuppress: () => boolean;
  setSuppress: (v: boolean) => void;
  enterSends: () => boolean;
}

export class ChatPanel implements HubPanel {
  readonly id: TabId = "chat";
  readonly label = "Chat";
  readonly icon = "message-square";
  private container!: HTMLElement;
  private panel: ContextPanel;
  private messagesEl: HTMLElement | null = null;
  private workingEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private modelSel: HTMLSelectElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private thinkToggleEl: HTMLElement | null = null;
  private sendBtn: HTMLElement | null = null;
  private timer: ReturnType<typeof window.setInterval> | null = null;
  private debTimer: ReturnType<typeof window.setTimeout> | null = null;
  private workStart = 0;
  private running = false;

  constructor(private deps: ChatViewDeps) {
    this.panel = new ContextPanel(deps, deps.autoK);
  }

  mount(container: HTMLElement): void {
    const c = this.container = container; c.empty();
    c.addClass("vault-rag-chat-root");
    this.statusEl = c.createDiv({ cls: "vault-rag-chat-status" });
    this.statusEl.addEventListener("click", () => void this.refreshStatus());
    // Modell-Dropdown + Thinking-Toggle in einer kompakten Zeile (kein zentriertes Einzelelement).
    const modelRow = c.createDiv({ cls: "vault-rag-chat-model-row" });
    this.modelSel = modelRow.createEl("select", { cls: "vault-rag-chat-model dropdown" });
    this.modelSel.addEventListener("change", () => { this.deps.setModel(this.modelSel?.value ?? ""); this.renderThinkToggle(); });
    this.thinkToggleEl = modelRow.createEl("button", { cls: "vault-rag-chat-think-toggle clickable-icon" });
    this.thinkToggleEl.addEventListener("click", () => {
      if (isAlwaysOnThinker(this.deps.getModel())) return;   // nicht abschaltbar
      this.deps.setSuppress(!this.deps.getSuppress());
      this.renderThinkToggle();
    });

    const buildMessages = (): void => {
      this.messagesEl = c.createDiv({ cls: "vault-rag-chat-messages" });
      this.workingEl = c.createDiv({ cls: "vault-rag-chat-working" });
    };
    const buildInput = (): void => {
      this.panel.mount(c.createDiv({ cls: "vault-rag-chat-context" }));
      const row = c.createDiv({ cls: "vault-rag-chat-input-row" });
      const input = row.createEl("textarea", { cls: "vault-rag-chat-input" });
      input.rows = 3; input.placeholder = "Frag deinen Vault…";
      this.inputEl = input;
      input.addEventListener("input", () => { this.autoGrow(); this.scheduleQuery(input.value ?? ""); });
      input.addEventListener("keydown", (e: KeyboardEvent) => this.onKeydown(e));
      this.sendBtn = row.createEl("button", { cls: "vault-rag-chat-send mod-cta", text: "Senden" });
      this.sendBtn.addEventListener("click", () => this.onSendClick());
      row.createEl("button", { cls: "vault-rag-chat-new", text: "Neu" }).addEventListener("click", () => this.newChat());
    };

    if (this.deps.inputPosition() === "top") { buildInput(); buildMessages(); }
    else { buildMessages(); buildInput(); }

    this.renderMessages();
    this.renderThinkToggle();
    void this.initAsync().catch(() => {});
  }

  private async initAsync(): Promise<void> {
    await this.refreshStatus();
    await this.refreshModels();
  }

  private async refreshModels(): Promise<void> {
    const sel = this.modelSel; if (!sel) return;
    const cur = this.deps.getModel();
    const models = await this.deps.listModels();
    sel.empty();
    const list = models.includes(cur) ? models : [cur, ...models];
    for (const m of list) { const o = sel.createEl("option", { text: m }); o.value = m; }
    sel.value = cur;
  }

  private scheduleQuery(q: string): void {
    if (this.debTimer !== null) window.clearTimeout(this.debTimer);
    this.debTimer = window.setTimeout(() => void this.panel.setQuery(q), 400);
  }

  private autoGrow(): void {
    const el = this.inputEl; if (!el) return;
    // Auto-Grow bis 180px (CSS-Klasse cappt zusätzlich). setCssStyles statt direkter style-Zuweisung
    // (Obsidian-Guideline no-static-styles-assignment).
    el.setCssStyles({ height: "auto" });
    el.setCssStyles({ height: `${Math.min(el.scrollHeight, 180)}px` });
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.running) { this.deps.session.abort(); return; }
    if (e.isComposing || e.key === "Process") return;          // IME-Guard
    if (e.key !== "Enter") return;
    const plain = !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    const sends = this.deps.enterSends() ? plain : e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (sends) { e.preventDefault(); void this.submit(); }
  }

  private renderThinkToggle(): void {
    const el = this.thinkToggleEl; if (!el) return;
    const always = isAlwaysOnThinker(this.deps.getModel());
    const suppressed = this.deps.getSuppress();
    el.empty();
    const icon = el.createSpan({ cls: "vault-rag-chat-think-icon" });
    setIcon(icon, "brain");
    el.createSpan({ cls: "vault-rag-chat-think-label", text: always ? "Thinking: immer an" : suppressed ? "Thinking: aus" : "Thinking: an" });
    el.setAttribute("aria-label", always
      ? "Dieses Modell denkt immer (nicht abschaltbar)"
      : suppressed ? "Thinking ist aus — klicken zum Einschalten" : "Thinking ist an — klicken zum Ausschalten");
    el.toggleClass("is-disabled", always);
    el.toggleClass("is-off", !always && suppressed);
  }

  async refreshStatus(): Promise<void> {
    const el = this.statusEl; if (!el) return;
    el.setText("Chat-LLM: prüfe…");
    const ok = await this.deps.ping();
    el.setText(ok ? "● Chat-LLM verbunden" : "○ Chat-LLM offline — in den Settings prüfen");
  }

  newChat(): void {
    this.deps.session.reset();
    this.stopWorking();
    this.running = false; this.sendBtn?.setText("Senden");
    this.workingEl?.setText("");
    this.renderMessages();
  }

  private onSendClick(): void {
    if (this.running) { this.deps.session.abort(); return; }
    void this.submit();
  }

  async submit(): Promise<void> {
    if (this.running) return;
    const q = (this.inputEl?.value ?? "").trim();
    if (!q) return;
    if (this.debTimer !== null) { window.clearTimeout(this.debTimer); this.debTimer = null; }
    if (this.inputEl) this.inputEl.value = "";
    const paths = this.panel.currentPaths();
    this.running = true; this.sendBtn?.setText("Stop");
    const pending = this.deps.session.send(q, paths, () => this.renderMessages());
    this.renderMessages();   // Frage erscheint sofort (User-Nachricht wurde synchron gepusht)
    this.startWorking();
    await pending;
    this.stopWorking();
    this.running = false; this.sendBtn?.setText("Senden");
    this.panel.reset();
    this.renderMessages();
  }

  private startWorking(): void {
    const el = this.workingEl; if (!el) return;
    this.workStart = Date.now();
    const tick = () => {
      const msgs = this.deps.session.messages;
      const live = msgs[msgs.length - 1];
      const thinking = !!live && live.role === "assistant" && live.content === "" && !!(live.reasoning ?? "");
      const phase = thinking ? "denkt nach" : "generiert";
      el.setText(`● ${phase}… ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
    };
    tick();
    this.timer = window.setInterval(tick, 100);
  }

  private stopWorking(): void {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    if (this.workStart && this.workingEl) {
      this.workingEl.setText(`✓ Antwort in ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
    }
  }

  private renderMessages(): void {
    const el = this.messagesEl; if (!el) return;
    // Scroll-Position VOR dem Leeren merken: nur automatisch ans Ende scrollen, wenn der Nutzer
    // ohnehin unten war — sonst reißt es ihn beim Lesen älterer Turns nach unten (beide Eingabe-Positionen).
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.empty();
    const msgs = this.deps.session.messages;
    const last = msgs[msgs.length - 1];
    for (const m of msgs) {
      if (m.role === "assistant" && m.reasoning) {
        const live = m === last && m.content === "" && !m.error;
        const det = el.createEl("details", { cls: "vault-rag-chat-reasoning" });
        det.open = live;
        det.createEl("summary", { cls: "vault-rag-chat-reasoning-sum", text: live ? "💭 denkt nach…" : "💭 Gedanken" });
        det.createDiv({ cls: "vault-rag-chat-reasoning-body", text: m.reasoning });
      }
      if (m.content) el.createDiv({ cls: `vault-rag-chat-msg is-${m.role}`, text: m.content });
      if (m.error) el.createDiv({ cls: "vault-rag-chat-state", text: m.error });
      if (m.role === "assistant" && m.content) {
        const actions = el.createDiv({ cls: "vault-rag-chat-msg-actions" });
        const copyBtn = actions.createEl("button", { cls: "vault-rag-chat-copy clickable-icon", attr: { "aria-label": "Antwort kopieren" } });
        setIcon(copyBtn, "copy");
        copyBtn.addEventListener("click", () => this.deps.copyText(m.content));
      }
      if (m.sources && m.sources.length) {
        const row = el.createDiv({ cls: "vault-rag-chat-sources" });
        for (const p of m.sources) {
          const chip = row.createEl("span", { cls: "vault-rag-chat-source", text: p.split("/").pop()?.replace(/\.md$/, "") ?? p });
          chip.addEventListener("click", () => this.deps.openPath(p));
        }
      }
    }
    if (atBottom) el.scrollTop = el.scrollHeight;   // dem Stream folgen, aber manuelles Hochscrollen respektieren
  }

  destroy(): void {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    if (this.debTimer !== null) { window.clearTimeout(this.debTimer); this.debTimer = null; }
  }
}
