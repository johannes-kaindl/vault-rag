// vendored from obsidian-kit@0.16.0, src/obsidian/confirm.ts — do not hand-edit
import { App, Modal, Setting } from "obsidian";

export interface ConfirmOptions {
  /** Gesetzt → Modal-Titelzeile; weggelassen → titelloser Dialog. */
  title?: string;
  /** Ein Absatz oder mehrere <p>-Zeilen. */
  message: string | string[];
  /** Default "Confirm" — i18n-Plugins reichen t(...) durch (Kit bleibt i18n-frei). */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Default true → setWarning() (destruktiv); false → setCta(). */
  warning?: boolean;
}

/** Bestätigungs-Modal hinter einer Promise-Fassade (REGISTRY „Bestätigungs-Modal", n=5).
 *  Zwei load-bearing Details: finish() nullt den Callback VOR dem Auflösen (Button-Klick +
 *  nachlaufendes onClose lösen sonst doppelt auf bzw. rekursieren über close()), und
 *  onClose() → finish(false) (sonst hängt das Promise bei Esc/Klick-daneben). */
class ConfirmModal extends Modal {
  private done: ((confirmed: boolean) => void) | null;

  constructor(
    app: App,
    private readonly opts: ConfirmOptions,
    done: (confirmed: boolean) => void,
  ) {
    super(app);
    this.done = done;
  }

  onOpen(): void {
    if (this.opts.title !== undefined) this.titleEl.setText(this.opts.title);
    const lines = Array.isArray(this.opts.message) ? this.opts.message : [this.opts.message];
    for (const line of lines) this.contentEl.createEl("p", { text: line });
    const warning = this.opts.warning ?? true;
    new Setting(this.contentEl)
      .addButton((b) => {
        b.setButtonText(this.opts.confirmLabel ?? "Confirm").onClick(() => { this.finish(true); });
        if (warning) b.setWarning();
        else b.setCta();
      })
      .addButton((b) => b.setButtonText(this.opts.cancelLabel ?? "Cancel").onClick(() => { this.finish(false); }));
  }

  onClose(): void {
    this.finish(false);
    this.contentEl.empty();
  }

  private finish(confirmed: boolean): void {
    if (!this.done) return;
    const cb = this.done;
    this.done = null;
    cb(confirmed);
    this.close();
  }
}

/** Öffnet den Dialog; resolved true nur bei explizitem Bestätigen.
 *  @example if (await confirmAction(app, { message: "Alles löschen?" })) { … } */
export function confirmAction(app: App, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, opts, resolve).open();
  });
}
