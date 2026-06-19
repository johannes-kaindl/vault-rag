import { ItemView, WorkspaceLeaf } from "obsidian";
import { ChatSession } from "./chat_session";
import { ChatMode } from "./context_source";

export const VIEW_TYPE_CHAT = "vault-rag-chat";

const MODES: { id: ChatMode; label: string }[] = [
  { id: "auto-rag", label: "Vault" },
  { id: "active-note", label: "Aktive Notiz" },
  { id: "picked-notes", label: "Gewählt" },
];

export interface ChatViewDeps {
  session: ChatSession;
  openPath: (path: string) => void;
  getActivePath: () => string | null;
  ping: () => Promise<boolean>;
}

export class ChatView extends ItemView {
  private messagesEl: HTMLElement | null = null;
  private workingEl: HTMLElement | null = null;
  private pickedEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendBtn: HTMLElement | null = null;
  private modeButtons = new Map<ChatMode, HTMLElement>();
  private timer: ReturnType<typeof window.setInterval> | null = null;
  private workStart = 0;
  private running = false;

  constructor(leaf: WorkspaceLeaf, private deps: ChatViewDeps) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_CHAT; }
  getDisplayText(): string { return "Vault Chat"; }
  getIcon(): string { return "message-square"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl; c.empty();
    this.modeButtons.clear();
    const bar = c.createDiv({ cls: "vault-rag-chat-modes" });
    for (const m of MODES) {
      const b = bar.createEl("button", { cls: "vault-rag-chat-mode", text: m.label });
      if (m.id === this.deps.session.mode) b.addClass("is-active");
      b.addEventListener("click", () => this.setMode(m.id));
      this.modeButtons.set(m.id, b);
    }
    this.statusEl = c.createDiv({ cls: "vault-rag-chat-status" });
    this.statusEl.addEventListener("click", () => void this.refreshStatus());
    this.pickedEl = c.createDiv({ cls: "vault-rag-chat-picked" });
    this.messagesEl = c.createDiv({ cls: "vault-rag-chat-messages" });
    this.workingEl = c.createDiv({ cls: "vault-rag-chat-working" });
    const row = c.createDiv({ cls: "vault-rag-chat-input-row" });
    const input = row.createEl("input", { cls: "vault-rag-chat-input" }) as HTMLInputElement;
    input.type = "text"; input.placeholder = "Frag deinen Vault…";
    this.inputEl = input;
    input.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") void this.submit(); });
    this.sendBtn = row.createEl("button", { cls: "vault-rag-chat-send", text: "Senden" });
    this.sendBtn.addEventListener("click", () => this.onSendClick());
    row.createEl("button", { cls: "vault-rag-chat-new", text: "Neu" }).addEventListener("click", () => this.newChat());
    this.renderPicked();
    this.renderMessages();
    await this.refreshStatus();
  }

  async refreshStatus(): Promise<void> {
    const el = this.statusEl; if (!el) return;
    el.setText("Chat-LLM: prüfe…");
    const ok = await this.deps.ping();
    el.setText(ok ? "● Chat-LLM verbunden" : "○ Chat-LLM offline — in den Settings prüfen");
  }

  setMode(mode: ChatMode): void {
    this.deps.session.mode = mode;
    for (const [id, b] of this.modeButtons) (id === mode ? b.addClass : b.removeClass).call(b, "is-active");
    this.renderPicked();
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
    if (this.inputEl) this.inputEl.value = "";
    this.running = true; this.sendBtn?.setText("Stop");
    const pending = this.deps.session.send(q, () => this.renderMessages());
    this.renderMessages();   // Frage erscheint sofort (User-Nachricht wurde synchron gepusht)
    this.startWorking();
    await pending;
    this.stopWorking();
    this.running = false; this.sendBtn?.setText("Senden");
    this.renderMessages();
  }

  private startWorking(): void {
    const el = this.workingEl; if (!el) return;
    this.workStart = Date.now();
    const tick = () => el.setText(`● generiert… ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
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
    for (const m of this.deps.session.messages) {
      if (m.content) el.createDiv({ cls: `vault-rag-chat-msg is-${m.role}`, text: m.content });
      if (m.error) el.createDiv({ cls: "vault-rag-chat-state", text: m.error });
      if (m.sources && m.sources.length) {
        const row = el.createDiv({ cls: "vault-rag-chat-sources" });
        for (const p of m.sources) {
          const chip = row.createEl("span", { cls: "vault-rag-chat-source", text: this.basename(p) });
          chip.addEventListener("click", () => this.deps.openPath(p));
        }
      }
    }
  }

  private renderPicked(): void {
    const el = this.pickedEl; if (!el) return; el.empty();
    if (this.deps.session.mode !== "picked-notes") return;
    const add = el.createEl("button", { cls: "vault-rag-chat-pick-add", text: "+ Aktive Notiz" });
    add.addEventListener("click", () => {
      const p = this.deps.getActivePath();
      if (p && !this.deps.session.picked.includes(p)) { this.deps.session.picked.push(p); this.renderPicked(); }
    });
    for (const p of this.deps.session.picked) {
      const chip = el.createEl("span", { cls: "vault-rag-chat-picked-chip", text: `${this.basename(p)} ✕` });
      chip.addEventListener("click", () => {
        this.deps.session.picked = this.deps.session.picked.filter(x => x !== p);
        this.renderPicked();
      });
    }
  }

  private basename(p: string): string { return p.split("/").pop()?.replace(/\.md$/, "") ?? p; }

  async onClose(): Promise<void> {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
  }
}
