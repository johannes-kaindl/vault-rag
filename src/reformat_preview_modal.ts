import { App, Modal, ButtonComponent } from "obsidian";
import { waitingMessage, truncationKey } from "./reformat_progress";
import { t } from "./vendor/kit/i18n";

export interface ReformatPreviewOpts {
  /** Der markierte Ur-Text (nur Anzeige). */
  original: string;
  /** Startet einen Stream: ruft onToken je Token, resolved mit dem Volltext und dem
   *  `finish_reason` des Servers, bricht bei signal ab. */
  stream: (onToken: (t: string) => void, signal: AbortSignal) => Promise<{ text: string; finishReason?: string }>;
  /** Wird bei „Anwenden" mit dem finalen Ergebnis aufgerufen. */
  onApply: (result: string) => void;
}

/** Zeigt Ur-Text vs. gestreamtes Ergebnis; Anwenden/Neu generieren/Verwerfen. Destruktiv erst bei Anwenden. */
export class ReformatPreviewModal extends Modal {
  private controller: AbortController | null = null;
  private result = "";
  private resultEl: HTMLElement | null = null;
  private applyBtn: ButtonComponent | null = null;
  private noticeEl: HTMLElement | null = null;
  private waitTimer: number | null = null;

  constructor(app: App, private opts: ReformatPreviewOpts) { super(app); }

  private stopWaitTimer(): void {
    if (this.waitTimer !== null) { window.clearInterval(this.waitTimer); this.waitTimer = null; }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: t("reformatPreview.title") });
    contentEl.createEl("p", { cls: "vault-rag-reformat-label", text: t("reformatPreview.original") });
    contentEl.createEl("pre", { cls: "vault-rag-reformat-original", text: this.opts.original });
    contentEl.createEl("p", { cls: "vault-rag-reformat-label", text: t("reformatPreview.result") });
    this.resultEl = contentEl.createEl("pre", { cls: "vault-rag-reformat-result" });
    // Traegt den Abschneide-Hinweis; leer, solange es nichts zu melden gibt.
    this.noticeEl = contentEl.createDiv({ cls: "vault-rag-reformat-notice" });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(row).setButtonText(t("reformatPreview.discard")).onClick(() => this.close());
    new ButtonComponent(row).setButtonText(t("reformatPreview.regenerate")).onClick(() => void this.run());
    this.applyBtn = new ButtonComponent(row).setButtonText(t("reformatPreview.apply")).setCta()
      .setDisabled(true)
      .onClick(() => { this.opts.onApply(this.result); this.close(); });
    void this.run();
  }

  private async run(): Promise<void> {
    this.controller?.abort();
    this.stopWaitTimer();
    const ctrl = new AbortController();
    this.controller = ctrl;
    this.result = "";
    this.applyBtn?.setDisabled(true);
    this.noticeEl?.setText("");

    // Wartezustand bis zum ersten Token: ohne ihn ist ein kalter Modell-Start nicht von
    // einem Haenger zu unterscheiden — der leere Ergebnisbereich sagt nichts.
    const startedAt = Date.now();
    let firstToken = false;
    this.resultEl?.setText(waitingMessage(0));
    this.waitTimer = window.setInterval(() => {
      if (this.controller !== ctrl || firstToken) return;
      this.resultEl?.setText(waitingMessage(Date.now() - startedAt));
    }, 1000);

    try {
      const out = await this.opts.stream((t) => {
        if (this.controller !== ctrl) return;
        // Erstes Token: Wartetext verwerfen, ab hier zeigt der Stream sich selbst.
        if (!firstToken) { firstToken = true; this.stopWaitTimer(); }
        this.result += t;
        this.resultEl?.setText(this.result);
      }, ctrl.signal);
      if (this.controller !== ctrl) return;
      this.stopWaitTimer();
      this.result = out.text;
      this.resultEl?.setText(out.text);
      // Abgeschnitten ist nicht kaputt: der Text bleibt anwendbar, der Hinweis nennt nur den Grund.
      const key = truncationKey(out.finishReason);
      this.noticeEl?.setText(key ? t(key) : "");
      this.applyBtn?.setDisabled(out.text.trim().length === 0);
    } catch (e) {
      if (this.controller !== ctrl) return;
      this.stopWaitTimer();
      this.resultEl?.setText(t("reformatPreview.error", e instanceof Error ? e.message : String(e)));
      this.applyBtn?.setDisabled(true);
    }
  }

  onClose(): void {
    this.controller?.abort();
    this.controller = null;
    this.stopWaitTimer();
    this.contentEl.empty();
  }
}
