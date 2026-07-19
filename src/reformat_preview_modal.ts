import { App, Modal, ButtonComponent } from "obsidian";

export interface ReformatPreviewOpts {
  /** Der markierte Ur-Text (nur Anzeige). */
  original: string;
  /** Startet einen Stream: ruft onToken je Token, resolved mit dem Volltext, bricht bei signal ab. */
  stream: (onToken: (t: string) => void, signal: AbortSignal) => Promise<string>;
  /** Wird bei „Anwenden" mit dem finalen Ergebnis aufgerufen. */
  onApply: (result: string) => void;
}

/** Zeigt Ur-Text vs. gestreamtes Ergebnis; Anwenden/Neu generieren/Verwerfen. Destruktiv erst bei Anwenden. */
export class ReformatPreviewModal extends Modal {
  private controller: AbortController | null = null;
  private result = "";
  private resultEl: HTMLElement | null = null;
  private applyBtn: ButtonComponent | null = null;

  constructor(app: App, private opts: ReformatPreviewOpts) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Umformatieren – Vorschau" });
    contentEl.createEl("p", { cls: "vault-rag-reformat-label", text: "Original" });
    contentEl.createEl("pre", { cls: "vault-rag-reformat-original", text: this.opts.original });
    contentEl.createEl("p", { cls: "vault-rag-reformat-label", text: "Ergebnis" });
    this.resultEl = contentEl.createEl("pre", { cls: "vault-rag-reformat-result" });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(row).setButtonText("Verwerfen").onClick(() => this.close());
    new ButtonComponent(row).setButtonText("Neu generieren").onClick(() => void this.run());
    this.applyBtn = new ButtonComponent(row).setButtonText("Anwenden").setCta()
      .setDisabled(true)
      .onClick(() => { this.opts.onApply(this.result); this.close(); });
    void this.run();
  }

  private async run(): Promise<void> {
    this.controller?.abort();
    const ctrl = new AbortController();
    this.controller = ctrl;
    this.result = "";
    this.resultEl?.setText("");
    this.applyBtn?.setDisabled(true);
    try {
      const out = await this.opts.stream((t) => {
        if (this.controller !== ctrl) return;
        this.result += t;
        this.resultEl?.setText(this.result);
      }, ctrl.signal);
      if (this.controller !== ctrl) return;
      this.result = out;
      this.resultEl?.setText(out);
      this.applyBtn?.setDisabled(out.trim().length === 0);
    } catch (e) {
      if (this.controller !== ctrl) return;
      this.resultEl?.setText(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
      this.applyBtn?.setDisabled(true);
    }
  }

  onClose(): void {
    this.controller?.abort();
    this.controller = null;
    this.contentEl.empty();
  }
}
