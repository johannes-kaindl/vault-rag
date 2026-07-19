import { App, FuzzySuggestModal, Modal, ButtonComponent } from "obsidian";
import { TRANSFORMS, TransformDef } from "./reformat_transforms";

class TransformPicker extends FuzzySuggestModal<TransformDef> {
  private settled = false;
  constructor(app: App, private done: (d: TransformDef | null) => void) {
    super(app);
    this.setPlaceholder("Umformatieren als…");
  }
  private settle(d: TransformDef | null): void { if (!this.settled) { this.settled = true; this.done(d); } }
  getItems(): TransformDef[] { return TRANSFORMS; }
  getItemText(d: TransformDef): string { return d.label; }
  onChooseItem(d: TransformDef): void { this.settle(d); }
  onClose(): void {
    super.onClose();
    // Abbruch (null) erst nach einem Tick: onChooseItem + onClose feuern bei einer Auswahl
    // gemeinsam; so gewinnt die Auswahl unabhängig von der Reihenfolge (Muster aus note_picker.ts).
    window.setTimeout(() => this.settle(null), 0);
  }
}

/** Öffnet den Fuzzy-Picker über die Transform-Registry; gewählter TransformDef oder null. */
export function pickTransform(app: App): Promise<TransformDef | null> {
  return new Promise(resolve => new TransformPicker(app, resolve).open());
}

class InstructionModal extends Modal {
  private settled = false;
  private value = "";
  constructor(app: App, private done: (v: string | null) => void) { super(app); }
  private settle(v: string | null): void { if (!this.settled) { this.settled = true; this.done(v); } }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Eigene Anweisung" });
    const ta = contentEl.createEl("textarea", { cls: "vault-rag-reformat-instruction" });
    ta.setAttr("rows", "3");
    ta.setAttr("placeholder", "z.B. mach eine Vergleichstabelle mit Pro/Contra");
    ta.addEventListener("input", () => { this.value = ta.value; });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(row).setButtonText("Abbrechen").onClick(() => this.close());
    new ButtonComponent(row).setButtonText("Umformatieren").setCta()
      .onClick(() => { const v = this.value.trim(); if (v) { this.settle(v); this.close(); } });
    window.setTimeout(() => ta.focus(), 0);
  }
  onClose(): void {
    this.contentEl.empty();
    window.setTimeout(() => this.settle(null), 0);
  }
}

/** Öffnet ein kleines Textfeld für die Freitext-Anweisung; getrimmter Text oder null (abgebrochen/leer). */
export function promptInstruction(app: App): Promise<string | null> {
  return new Promise(resolve => new InstructionModal(app, resolve).open());
}
