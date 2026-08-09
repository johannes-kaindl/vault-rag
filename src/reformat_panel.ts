import { HubPanel } from "./hub_panel";
import { TRANSFORMS, TransformDef } from "./reformat_transforms";
import {
  ReformatReadiness, canRun, readinessMessage, selectionPreview, groupTransforms,
} from "./reformat_selection_state";
import { t } from "./vendor/kit/i18n";

export interface ReformatPanelDeps {
  /** Aktueller Bereitschaftszustand (vom Plugin mitgeschrieben). */
  getReadiness: () => ReformatReadiness;
  /** Führt den Transform auf der gemerkten Auswahl aus. */
  run: (def: TransformDef, instruction?: string) => void;
}

/** Sidebar-Tab: launcht die Transforms aus der Registry. Buttons sind deaktiviert,
 *  solange keine brauchbare Auswahl existiert — der Grund steht in der Kopfzeile. */
export class ReformatPanel implements HubPanel {
  readonly id = "reformat" as const;
  get label(): string { return t("panel.reformat.label"); }
  readonly icon = "wand";

  private statusEl: HTMLElement | null = null;
  private buttons: HTMLButtonElement[] = [];
  private instructionEl: HTMLTextAreaElement | null = null;

  constructor(private deps: ReformatPanelDeps) {}

  mount(container: HTMLElement): void {
    container.addClass("vault-rag-reformat-panel");
    this.statusEl = container.createDiv({ cls: "vault-rag-reformat-status" });

    const groups = groupTransforms(TRANSFORMS);
    const freetext = groups.llm.filter(d => d.freetext);
    const plainLlm = groups.llm.filter(d => !d.freetext);

    this.renderGroup(container, t("panel.reformat.groupInstant"), groups.mechanical);
    this.renderGroup(container, t("panel.reformat.groupPreview"), plainLlm);

    const ft = freetext[0];
    if (ft) {
      container.createDiv({ cls: "vault-rag-reformat-group-title", text: t("panel.reformat.groupFreetext") });
      const row = container.createDiv({ cls: "vault-rag-reformat-freetext" });
      const ta = row.createEl("textarea", { cls: "vault-rag-reformat-panel-instruction" });
      ta.setAttr("rows", "2");
      ta.setAttr("placeholder", t("panel.reformat.instructionPlaceholder"));
      this.instructionEl = ta;
      const btn = row.createEl("button", { cls: "vault-rag-reformat-btn", text: t("panel.reformat.run") });
      btn.addEventListener("click", () => {
        const instr = ta.value.trim();
        if (!instr) return;
        this.deps.run(ft, instr);
        ta.value = "";
      });
      this.buttons.push(btn);
    }

    this.refresh();
  }

  private renderGroup(container: HTMLElement, title: string, defs: TransformDef[]): void {
    if (!defs.length) return;
    container.createDiv({ cls: "vault-rag-reformat-group-title", text: title });
    for (const def of defs) {
      const btn = container.createEl("button", { cls: "vault-rag-reformat-btn", text: t(def.labelKey) });
      btn.addEventListener("click", () => this.deps.run(def));
      this.buttons.push(btn);
    }
  }

  /** Kopfzeile und Button-Zustand an die aktuelle Bereitschaft angleichen. */
  refresh(): void {
    const r = this.deps.getReadiness();
    const enabled = canRun(r);

    if (this.statusEl) {
      this.statusEl.empty();
      if (r.kind === "ready") {
        const { snippet, lines } = selectionPreview(r.text);
        this.statusEl.createDiv({ cls: "vault-rag-reformat-sel", text: t("panel.reformat.selected", snippet) });
        this.statusEl.createDiv({
          cls: "vault-rag-reformat-meta",
          text: lines === 1 ? t("panel.reformat.lineOne") : t("panel.reformat.lineMany", lines),
        });
      } else {
        this.statusEl.createDiv({ cls: "vault-rag-reformat-blocked", text: readinessMessage(r) });
      }
    }

    for (const b of this.buttons) b.disabled = !enabled;
    if (this.instructionEl) this.instructionEl.disabled = !enabled;
  }

  onShow(): void { this.refresh(); }

  destroy(): void {
    this.buttons = [];
    this.statusEl = null;
    this.instructionEl = null;
  }
}
