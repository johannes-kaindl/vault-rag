import { App, FuzzySuggestModal, TFile } from "obsidian";

class TemplatePicker extends FuzzySuggestModal<TFile> {
  private settled = false;
  constructor(
    app: App,
    private templateDir: string,
    private preselect: string | null,
    private done: (p: string | null) => void,
  ) {
    super(app);
    this.setPlaceholder("Vorlage wählen…");
    if (preselect) {
      // Seedet die Sucheingabe; Ranking ist score-basiert, daher zusätzlich der (Vorschlag)-Marker.
      this.inputEl.value = preselect.split("/").pop()!.replace(/\.md$/, "");
    }
  }
  private settle(p: string | null): void { if (!this.settled) { this.settled = true; this.done(p); } }
  // Nur Markdown-Dateien unter templateDir — die Template-Dateien sind die Struktur-Wahrheit.
  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(this.templateDir));
  }
  getItemText(f: TFile): string {
    // (Vorschlag)-Marker ist das echte Signal: Obsidians Fuzzy-Ranking sortiert score-basiert
    // und garantiert KEIN Top-Sticking des geseedeten Eintrags.
    return f.path === this.preselect ? `${f.path}  (Vorschlag)` : f.path;
  }
  onChooseItem(f: TFile): void { this.settle(f.path); }
  onClose(): void {
    super.onClose();
    // Abbruch (null) erst nach einem Tick: onChooseItem + onClose feuern bei einer Auswahl
    // gemeinsam; so gewinnt die Auswahl unabhängig von der Reihenfolge (sonst überschreibt null den Pfad).
    window.setTimeout(() => this.settle(null), 0);
  }
}

/** Nur für Tests: zuletzt geöffneter Picker, um die Auswahl zu simulieren. */
export let _lastPicker: TemplatePicker | null = null;

/**
 * Öffnet einen Fuzzy-Picker über templateDir/*.md; gewählter Pfad oder null (abgebrochen).
 * `preselect` seedet die Sucheingabe (inputEl.value) UND wird per "(Vorschlag)"-Label markiert.
 */
export function pickTemplate(app: App, templateDir: string, preselect: string | null): Promise<string | null> {
  return new Promise(resolve => {
    const picker = new TemplatePicker(app, templateDir, preselect, resolve);
    _lastPicker = picker;
    picker.open();
  });
}
