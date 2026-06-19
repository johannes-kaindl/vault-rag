import { App, FuzzySuggestModal, TFile } from "obsidian";

class NotePicker extends FuzzySuggestModal<TFile> {
  private picked = false;
  constructor(app: App, private resolve: (p: string | null) => void) {
    super(app);
    this.setPlaceholder("Notiz zum Kontext hinzufügen…");
  }
  getItems(): TFile[] { return this.app.vault.getMarkdownFiles(); }
  getItemText(f: TFile): string { return f.path; }
  onChooseItem(f: TFile): void { this.picked = true; this.resolve(f.path); }
  onClose(): void { super.onClose(); if (!this.picked) this.resolve(null); }
}

/** Öffnet einen Fuzzy-Picker über alle Vault-Notizen; gewählter Pfad oder null (abgebrochen). */
export function pickNote(app: App): Promise<string | null> {
  return new Promise(resolve => new NotePicker(app, resolve).open());
}
