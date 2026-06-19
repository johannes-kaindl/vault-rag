import { App, FuzzySuggestModal, TFile } from "obsidian";

class NotePicker extends FuzzySuggestModal<TFile> {
  private settled = false;
  constructor(app: App, private done: (p: string | null) => void) {
    super(app);
    this.setPlaceholder("Notiz zum Kontext hinzufügen…");
  }
  private settle(p: string | null): void { if (!this.settled) { this.settled = true; this.done(p); } }
  getItems(): TFile[] { return this.app.vault.getMarkdownFiles(); }
  getItemText(f: TFile): string { return f.path; }
  onChooseItem(f: TFile): void { this.settle(f.path); }
  onClose(): void {
    super.onClose();
    // Abbruch (null) erst nach einem Tick melden: feuern onChooseItem + onClose bei einer Auswahl
    // gemeinsam, gewinnt so die Auswahl unabhängig von der Reihenfolge (sonst überschreibt null den Pfad).
    window.setTimeout(() => this.settle(null), 0);
  }
}

/** Öffnet einen Fuzzy-Picker über alle Vault-Notizen; gewählter Pfad oder null (abgebrochen). */
export function pickNote(app: App): Promise<string | null> {
  return new Promise(resolve => new NotePicker(app, resolve).open());
}
