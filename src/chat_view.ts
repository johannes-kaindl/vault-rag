import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { ChatSession } from "./chat_session";
import { ContextPanel, ContextPanelDeps } from "./context_panel";

export const VIEW_TYPE_CHAT = "vault-rag-chat";

export interface ChatViewDeps extends ContextPanelDeps {
  session: ChatSession;
  openPath: (path: string) => void;
  ping: () => Promise<boolean>;
  copyText: (text: string) => void;
  autoK: number;
}

export class ChatView extends ItemView {
  private panel: ContextPanel;
  private messagesEl: HTMLElement | null = null;
  private workingEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendBtn: HTMLElement | null = null;
  private timer: ReturnType<typeof window.setInterval> | null = null;
  private debTimer: ReturnType<typeof window.setTimeout> | null = null;
  private workStart = 0;
  private running = false;

  constructor(leaf: WorkspaceLeaf, private deps: ChatViewDeps) {
    super(leaf);
    this.panel = new ContextPanel(deps, deps.autoK);
  }
  getViewType(): string { return VIEW_TYPE_CHAT; }
  getDisplayText(): string { return "Vault Chat"; }
  getIcon(): string { return "message-square"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl; c.empty();
    c.addClass("vault-rag-chat-root");
    this.statusEl = c.createDiv({ cls: "vault-rag-chat-status" });
    this.statusEl.addEventListener("click", () => void this.refreshStatus());
    this.messagesEl = c.createDiv({ cls: "vault-rag-chat-messages" });
    this.workingEl = c.createDiv({ cls: "vault-rag-chat-working" });
    this.panel.mount(c.createDiv({ cls: "vault-rag-chat-context" }));
    const row = c.createDiv({ cls: "vault-rag-chat-input-row" });
    const input = row.createEl("input", { cls: "vault-rag-chat-input" }) as HTMLInputElement;
    input.type = "text"; input.placeholder = "Frag deinen Vault…";
    this.inputEl = input;
    input.addEventListener("input", () => this.scheduleQuery(input.value ?? ""));
    input.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") void this.submit(); });
    this.sendBtn = row.createEl("button", { cls: "vault-rag-chat-send mod-cta", text: "Senden" });
    this.sendBtn.addEventListener("click", () => this.onSendClick());
    row.createEl("button", { cls: "vault-rag-chat-new", text: "Neu" }).addEventListener("click", () => this.newChat());
    this.renderMessages();
    await this.refreshStatus();
  }

  private scheduleQuery(q: string): void {
    if (this.debTimer !== null) window.clearTimeout(this.debTimer);
    this.debTimer = window.setTimeout(() => void this.panel.setQuery(q), 400);
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
    const el = this.messagesEl; if (!el) return; el.empty();
    const msgs = this.deps.session.messages;
    const last = msgs[msgs.length - 1];
    for (const m of msgs) {
      if (m.role === "assistant" && m.reasoning) {
        const live = m === last && m.content === "" && !m.error;
        const det = el.createEl("details", { cls: "vault-rag-chat-reasoning" }) as HTMLDetailsElement;
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
    el.scrollTop = el.scrollHeight;   // dem Stream folgen: neueste Antwort sichtbar halten
  }

  async onClose(): Promise<void> {
    this.contentEl.removeClass("vault-rag-chat-root");
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    if (this.debTimer !== null) { window.clearTimeout(this.debTimer); this.debTimer = null; }
  }
}
