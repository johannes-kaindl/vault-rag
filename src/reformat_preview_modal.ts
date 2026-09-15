import { App, Modal, ButtonComponent, Notice } from "obsidian";
import { waitingMessage, truncationKey } from "./reformat_progress";
import { t } from "./vendor/kit/i18n";
import { buildStreamArea, type StreamArea } from "./vendor/kit-obsidian/stream-area";
import { writeClipboard } from "./vendor/kit/clipboard";

export interface ReformatPreviewOpts {
  /** Der markierte Ur-Text (nur Anzeige). */
  original: string;
  /** Startet einen Stream: ruft onToken je Token, resolved mit dem Volltext und dem
   *  `finish_reason` des Servers, bricht bei signal ab. */
  stream: (onToken: (t: string) => void, signal: AbortSignal) => Promise<{ text: string; finishReason?: string }>;
  /** Wird bei „Anwenden" mit dem finalen Ergebnis aufgerufen. */
  onApply: (result: string) => void;
}

/** Zeigt Ur-Text vs. gestreamtes Ergebnis; Anwenden/Neu generieren/Kopieren/Verwerfen.
 *  Destruktiv erst bei Anwenden.
 *
 *  Der Ergebnisbereich kommt aus dem Kit (§8, `buildStreamArea`) — kein Reasoning (der
 *  Stream hier liefert keine getrennten Denk-Tokens, `stream` kennt nur `onToken`), aber
 *  derselbe Statuszeilen-/Scroll-Vertrag wie die anderen Streaming-Bereiche. `scrollEl`
 *  zeigt auf das Modal selbst: vorher trug das Ergebnisfeld einen EIGENEN Scrollbereich
 *  (`max-height: 40vh; overflow: auto`) neben dem des Modals — zwei Ebenen für dieselbe
 *  Geste. `okit-stream--host-scroll` schaltet den inneren Scroll ab, das Modal rollt jetzt
 *  als Ganzes (Quicktask d, Johannes 2026-09-15). */
export class ReformatPreviewModal extends Modal {
  private controller: AbortController | null = null;
  private result = "";
  private area: StreamArea | null = null;
  private applyBtn: ButtonComponent | null = null;
  private copyBtn: ButtonComponent | null = null;
  private waitTimer: number | null = null;

  constructor(app: App, private opts: ReformatPreviewOpts) { super(app); }

  private stopWaitTimer(): void {
    if (this.waitTimer !== null) { window.clearInterval(this.waitTimer); this.waitTimer = null; }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("vault-rag-reformat-modal");
    contentEl.createEl("h2", { text: t("reformatPreview.title") });
    contentEl.createEl("p", { cls: "vault-rag-reformat-label", text: t("reformatPreview.original") });
    contentEl.createEl("pre", { cls: "vault-rag-reformat-original", text: this.opts.original });
    contentEl.createEl("p", { cls: "vault-rag-reformat-label", text: t("reformatPreview.result") });
    this.area = buildStreamArea(contentEl, {
      strings: { reasoning: t("reformatPreview.thinking") },
      cls: "vault-rag-reformat-stream",
      scrollEl: contentEl,
    });
    this.area.bodyEl.addClass("vault-rag-reformat-result");
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(row).setButtonText(t("reformatPreview.discard")).onClick(() => this.close());
    new ButtonComponent(row).setButtonText(t("reformatPreview.regenerate")).onClick(() => void this.run());
    this.copyBtn = new ButtonComponent(row).setButtonText(t("reformatPreview.copy"))
      .setDisabled(true)
      .onClick(() => {
        void writeClipboard(this.result, {
          onCopied: () => new Notice(t("reformatPreview.copied")),
          onFailed: () => new Notice(t("reformatPreview.copyFailed")),
        });
      });
    // (a) Anwenden bleibt gesperrt, solange der Lauf steht — ButtonComponent.setDisabled
    // setzt das echte disabled-Attribut (anders als die eigene `.is-disabled`-Klasse auf
    // rohen <button>s im Smart-Apply-Cockpit, s. dortiger Gotcha); Obsidians Theme stylt das
    // korrekt, kein zusaetzlicher Guard noetig.
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
    this.copyBtn?.setDisabled(true);
    this.area?.reset();
    this.area?.statusEl.setText("");

    // Wartezustand bis zum ersten Token: ohne ihn ist ein kalter Modell-Start nicht von
    // einem Haenger zu unterscheiden — der leere Ergebnisbereich sagt nichts.
    const startedAt = Date.now();
    let firstToken = false;
    this.area?.setTail(waitingMessage(0));
    this.waitTimer = window.setInterval(() => {
      if (this.controller !== ctrl || firstToken) return;
      this.area?.setTail(waitingMessage(Date.now() - startedAt));
    }, 1000);

    try {
      const out = await this.opts.stream((tok) => {
        if (this.controller !== ctrl) return;
        // Erstes Token: Wartetext verwerfen, ab hier zeigt der Stream sich selbst.
        if (!firstToken) { firstToken = true; this.stopWaitTimer(); }
        this.result += tok;
        this.area?.setTail(this.result);
        this.area?.followTail();
      }, ctrl.signal);
      if (this.controller !== ctrl) return;
      this.stopWaitTimer();
      this.result = out.text;
      this.area?.setTail(out.text);
      // Abgeschnitten ist nicht kaputt: der Text bleibt anwendbar, der Hinweis nennt nur den Grund.
      const key = truncationKey(out.finishReason);
      this.area?.statusEl.setText(key ? t(key) : "");
      this.applyBtn?.setDisabled(out.text.trim().length === 0);
      this.copyBtn?.setDisabled(out.text.trim().length === 0);
    } catch (e) {
      if (this.controller !== ctrl) return;
      this.stopWaitTimer();
      this.area?.setTail(t("reformatPreview.error", e instanceof Error ? e.message : String(e)));
      this.applyBtn?.setDisabled(true);
      this.copyBtn?.setDisabled(true);
    }
  }

  onClose(): void {
    this.controller?.abort();
    this.controller = null;
    this.stopWaitTimer();
    this.area = null;
    this.contentEl.empty();
  }
}
