import { ItemView, WorkspaceLeaf } from "obsidian";
import { ChatSession } from "./chat_session";
import { ChatMode } from "./context_source";

export const VIEW_TYPE_CHAT = "vault-rag-chat";

const MODES: { id: ChatMode; label: string }[] = [
  { id: "auto-rag", label: "Vault" },
  { id: "active-note", label: "Aktive Notiz" },
  { id: "picked-notes", label: "Gewählt" },
];

export interface ChatViewDeps { session: ChatSession; openPath: (path: string) => void }

export class ChatView extends ItemView {
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: ChatViewDeps) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_CHAT; }
  getDisplayText(): string { return "Vault Chat"; }
  getIcon(): string { return "message-square"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl; c.empty();
    const bar = c.createDiv({ cls: "vault-rag-chat-modes" });
    for (const m of MODES) {
      const b = bar.createEl("button", { cls: "vault-rag-chat-mode", text: m.label });
      if (m.id === this.deps.session.mode) b.addClass("is-active");
      b.addEventListener("click", () => this.setMode(m.id));
    }
    this.messagesEl = c.createDiv({ cls: "vault-rag-chat-messages" });
    const row = c.createDiv({ cls: "vault-rag-chat-input-row" });
    const input = row.createEl("input", { cls: "vault-rag-chat-input" }) as HTMLInputElement;
    input.type = "text"; input.placeholder = "Frag deinen Vault…";
    this.inputEl = input;
    input.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") void this.submit(); });
    row.createEl("button", { cls: "vault-rag-chat-send", text: "Senden" }).addEventListener("click", () => void this.submit());
    row.createEl("button", { cls: "vault-rag-chat-stop", text: "Stop" }).addEventListener("click", () => this.deps.session.abort());
    this.renderMessages();
  }

  setMode(mode: ChatMode): void { this.deps.session.mode = mode; }

  async submit(): Promise<void> {
    const q = (this.inputEl?.value ?? "").trim();
    if (!q) return;
    if (this.inputEl) this.inputEl.value = "";
    const { sources, error } = await this.deps.session.send(q, () => this.renderMessages());
    this.renderMessages();
    if (error) this.messagesEl?.createDiv({ cls: "vault-rag-chat-state", text: error });
    else this.renderSources(sources);
  }

  private renderMessages(): void {
    const el = this.messagesEl; if (!el) return; el.empty();
    for (const m of this.deps.session.messages) {
      el.createDiv({ cls: `vault-rag-chat-msg is-${m.role}`, text: m.content });
    }
  }

  private renderSources(sources: string[]): void {
    const el = this.messagesEl; if (!el || sources.length === 0) return;
    const row = el.createDiv({ cls: "vault-rag-chat-sources" });
    for (const p of sources) {
      const chip = row.createEl("span", { cls: "vault-rag-chat-source", text: p.split("/").pop()?.replace(/\.md$/, "") ?? p });
      chip.addEventListener("click", () => this.deps.openPath(p));
    }
  }
}
