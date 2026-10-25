import { HubPanel } from "./hub_panel";
import { TransformDef, transformLabel } from "./reformat_transforms";
import {
  ReformatReadiness, canRun, readinessMessage, selectionPreview, groupTransforms,
} from "./reformat_selection_state";
import type { App } from "obsidian";
import { getLang, t } from "./vendor/kit/i18n";
import type { ThinkingControlOptions } from "./vendor/kit-obsidian/thinking-control";
import { buildModelBar, type ModelBar, type ModelBarConnection } from "./vendor/kit-obsidian/model-bar";

export interface ReformatPanelDeps {
  /** Aktueller Bereitschaftszustand (vom Plugin mitgeschrieben). */
  getReadiness: () => ReformatReadiness;
  /** Führt den Transform auf der gemerkten Auswahl aus. */
  run: (def: TransformDef, instruction?: string) => void;
  /** Die aktuelle Registry samt eigener Funktionen aus den Einstellungen. */
  transforms: () => TransformDef[];
  app: App;
  /** Die Verbindung der Modellzeile: dieselbe wie im Chat. Die Umformatier-Anfragen gehen über den Chat-Client mit dem Chat-Modell,
   *  ein Wechsel hier ist ein Wechsel im Chat (kein eigenes Setting). */
  llm: ModelBarConnection;
  /** Denk-Steuerung (Kit `thinking-control`) in der Modellzeile, Modus `reformat`. */
  thinking: Omit<ThinkingControlOptions, "containerEl">;
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
  private bar: ModelBar | null = null;

  constructor(private deps: ReformatPanelDeps) {}

  private container: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
    // Das Kit gibt eine alte Modellzeile nicht frei: vor dem Leeren abmelden, sonst zeichnet sie weiter in einen abgehängten Knoten.
    this.bar?.destroy();
    this.bar = null;
    container.empty();
    this.buttons = [];
    this.instructionEl = null;
    container.addClass("vault-rag-reformat-panel");
    // Modell und Denk-Steuerung in einer Zeile (Kit `buildModelBar`). Nie gesperrt: die Vorschau ist ein Modal, das Panel ist währenddessen
    // ohnehin nicht bedienbar, und ein Wechsel gilt für die nächste Anfrage.
    this.bar = buildModelBar({
      app: this.deps.app,
      containerEl: container,
      llm: this.deps.llm,
      label: t("panel.reformat.modelLabel"),
      strings: { lang: getLang() },
      thinking: this.deps.thinking,
    });
    this.statusEl = container.createDiv({ cls: "vault-rag-reformat-status" });

    const groups = groupTransforms(this.deps.transforms());
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
      const btn = container.createEl("button", { cls: "vault-rag-reformat-btn", text: transformLabel(def) });
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

  /** Die Registry hat sich geändert (Einstellungen): Knöpfe neu aufbauen. */
  rebuild(): void { if (this.container) this.mount(this.container); }

  onShow(): void {
    this.refresh();
    this.bar?.update();   // Modell, Stufe oder Stufenwahl können in den Einstellungen oder im Chat geändert worden sein
  }

  /** Modell, Endpunkt oder Denkstufe haben sich außerhalb des Panels geändert (Einstellungen, Chat, Manager). */
  refreshModelBar(opts: { models?: boolean } = {}): void {
    this.bar?.update();
    if (opts.models === true) void this.bar?.refresh();
  }

  destroy(): void {
    this.bar?.destroy();
    this.bar = null;
    this.buttons = [];
    this.statusEl = null;
    this.instructionEl = null;
  }
}
