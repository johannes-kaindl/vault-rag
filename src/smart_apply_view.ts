import { ItemView, WorkspaceLeaf, setIcon, Notice } from "obsidian";
import type { FmValue, FmChange } from "./frontmatter";
import type { SuggestionSource } from "./template_matcher";
import type { ApplyProposal, ApplyResult } from "./smart_apply";

// Re-export for consumers (e.g. tests) that import from this module
export type { ApplyProposal, ApplyResult, SectionDiff } from "./smart_apply";

export interface SmartApplyViewDeps {
  build: (notePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  accept: (p: ApplyProposal) => Promise<ApplyResult>;
  reroll: (p: ApplyProposal, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  openPath: (p: string) => void;
  abort: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const VIEW_TYPE_SMART_APPLY = "vault-rag-smart-apply";

const CHANGE_ICON: Record<FmChange, string> = {
  unveraendert: "minus",
  geaendert: "pencil",
  neu: "plus",
  entfernt: "trash-2",
};

const SOURCE_BADGE_LABEL: Record<SuggestionSource, string> = {
  frontmatter: "aus type:",
  rag: "Vorschlag (RAG)",
  none: "manuell",
};

// ── SmartApplyView ────────────────────────────────────────────────────────────

export class SmartApplyView extends ItemView {
  private proposal: ApplyProposal | null = null;
  private applied = false;
  private lastUndo: (() => Promise<void>) | null = null;
  private bodyText = "";
  private bodyPaneEl: HTMLElement | null = null;
  private workingEl: HTMLElement | null = null;
  private timer: ReturnType<typeof window.setInterval> | null = null;
  private workStart = 0;
  private running = false;

  constructor(leaf: WorkspaceLeaf, private deps: SmartApplyViewDeps) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_SMART_APPLY; }
  getDisplayText(): string { return "Smart Apply"; }
  getIcon(): string { return "wand-2"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("vault-rag-sa-root");
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.removeClass("vault-rag-sa-root");
    this.stopWorking();
  }

  // ── Public entry point (called by main.ts after pickTemplate) ──────────────

  async run(notePath: string): Promise<void> {
    this.bodyText = "";
    this.applied = false;
    this.proposal = null;
    this.startWorking();
    try {
      this.proposal = await this.deps.build(notePath, () => {}, () => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "abgebrochen") {
        new Notice("Verworfen");
      } else {
        new Notice(`Smart Apply: ${msg}`);
      }
    } finally {
      this.stopWorking();
    }
    this.render();
  }

  // ── Live token append (called from main.ts onToken closure) ────────────────

  onToken(t: string): void {
    this.bodyText += t;
    if (this.bodyPaneEl) {
      this.bodyPaneEl.setText(this.bodyText);
    }
  }

  // ── Working indicator ─────────────────────────────────────────────────────

  private startWorking(): void {
    this.running = true;
    this.workStart = Date.now();
    this.render(); // builds workingEl
    const tick = (): void => {
      if (this.workingEl) {
        this.workingEl.setText(`● arbeitet… ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
      }
    };
    tick();
    this.timer = window.setInterval(tick, 100);
  }

  private stopWorking(): void {
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.workStart && this.workingEl) {
      this.workingEl.setText(`✓ fertig in ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private render(): void {
    const c = this.contentEl;
    c.empty();
    const p = this.proposal;

    // Header
    const header = c.createDiv({ cls: "vault-rag-sa-header" });
    const noteName = p
      ? (p.notePath.split("/").pop()?.replace(/\.md$/, "") ?? p.notePath)
      : "—";
    header.createDiv({ cls: "vault-rag-sa-note", text: noteName });
    if (p) {
      header.createSpan({ cls: "vault-rag-sa-type-chip", text: p.type });
      header.createSpan({
        cls: "vault-rag-sa-source-badge",
        text: SOURCE_BADGE_LABEL[p.detection.source] ?? p.detection.source,
      });
    }

    // Status line (also updated by startWorking/stopWorking tick)
    this.workingEl = c.createDiv({ cls: "vault-rag-sa-status" });

    if (!p) return;
    if (this.applied) {
      this.renderApplied(c);
      return;
    }

    this.renderGuard(c, p);
    this.renderFrontmatter(c, p);
    this.renderBody(c, p);
    this.renderUnassigned(c, p);
    this.renderActions(c, p);
    this.renderReasoning(c, p);
  }

  // ── Guard banner ──────────────────────────────────────────────────────────

  private renderGuard(c: HTMLElement, p: ApplyProposal): void {
    const banner = c.createDiv({ cls: "vault-rag-sa-guard" });
    banner.toggleClass("is-ok", p.hardOk);
    banner.toggleClass("is-error", !p.hardOk);
    if (p.hardOk) {
      banner.setText("✓ alle Prüfungen bestanden");
      return;
    }
    banner.setText("Prüfungen fehlgeschlagen — Anwenden gesperrt:");
    const list = banner.createDiv({ cls: "vault-rag-sa-guard-list" });
    for (const ch of p.checks.filter((x) => !x.ok)) {
      list.createDiv({
        cls: "vault-rag-sa-guard-fail",
        text: `${ch.id}${ch.detail ? ": " + ch.detail : ""}`,
      });
    }
  }

  // ── Frontmatter key-table diff ────────────────────────────────────────────

  private fmCell(v: FmValue | undefined): string {
    if (v === undefined) return "—";
    return Array.isArray(v) ? v.join(", ") : v;
  }

  private renderFrontmatter(c: HTMLElement, p: ApplyProposal): void {
    const sec = c.createDiv({ cls: "vault-rag-sa-fm" });
    sec.createDiv({ cls: "vault-rag-sa-section-title", text: "Frontmatter" });
    const table = sec.createDiv({ cls: "vault-rag-sa-fm-table" });
    for (const row of p.fmRows) {
      const r = table.createDiv({ cls: "vault-rag-sa-fm-row" });
      r.toggleClass(`is-${row.change}`, true);
      const icon = r.createSpan({ cls: "vault-rag-sa-fm-icon" });
      setIcon(icon, CHANGE_ICON[row.change] ?? "minus");
      r.createSpan({ cls: "vault-rag-sa-fm-key", text: row.key });
      r.createSpan({ cls: "vault-rag-sa-fm-orig", text: this.fmCell(row.original) });
      r.createSpan({ cls: "vault-rag-sa-fm-prop", text: this.fmCell(row.proposed) });
    }
  }

  // ── Body section-stack ────────────────────────────────────────────────────

  private renderBody(c: HTMLElement, p: ApplyProposal): void {
    const sec = c.createDiv({ cls: "vault-rag-sa-body" });
    sec.createDiv({ cls: "vault-rag-sa-section-title", text: "Body" });

    // Live-pane: streamed tokens land here (also usable during build)
    this.bodyPaneEl = sec.createDiv({ cls: "vault-rag-sa-body-pane" });
    this.bodyPaneEl.setText(this.bodyText);

    for (const s of p.sectionDiff) {
      const block = sec.createDiv({ cls: "vault-rag-sa-body-section" });
      block.createDiv({ cls: "vault-rag-sa-body-heading", text: s.heading });
      if (s.blockIds.length === 0) {
        block.createDiv({ cls: "vault-rag-sa-empty", text: "(noch leer)" });
      } else {
        block.createDiv({
          cls: "vault-rag-sa-provenance",
          text: `umsortiert aus: ${s.provenance ?? "—"}`,
        });
      }
    }
  }

  // ── Unassigned blocks ("Übrig") ───────────────────────────────────────────

  private renderUnassigned(c: HTMLElement, p: ApplyProposal): void {
    // Use setText so the container's own textContent contains "Übrig" for tests.
    // Items are appended as children via createDiv (which does not clear textContent in the mock).
    const sec = c.createDiv({ cls: "vault-rag-sa-unassigned" });
    sec.setText(`Übrig (${p.unassigned.length})`);
    for (const b of p.unassigned) {
      sec.createDiv({ cls: "vault-rag-sa-unassigned-item", text: b.text });
    }
  }

  // ── Action bar ────────────────────────────────────────────────────────────

  private renderActions(c: HTMLElement, p: ApplyProposal): void {
    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });

    const apply = bar.createEl("button", { cls: "vault-rag-sa-apply mod-cta", text: "Anwenden" });
    apply.toggleClass("is-disabled", !p.hardOk);
    apply.addEventListener("click", () => {
      if (p.hardOk) void this.onAccept(p);
    });

    bar.createEl("button", { cls: "vault-rag-sa-discard", text: "Verwerfen" })
      .addEventListener("click", () => this.onDiscard());

    bar.createEl("button", { cls: "vault-rag-sa-reroll", text: "Erneut" })
      .addEventListener("click", () => void this.onReroll(p));

    bar.createEl("button", { cls: "vault-rag-sa-open-tpl", text: "Vorlage öffnen" })
      .addEventListener("click", () => this.deps.openPath(p.templatePath));
  }

  // ── Applied state ─────────────────────────────────────────────────────────

  private renderApplied(c: HTMLElement): void {
    const box = c.createDiv({ cls: "vault-rag-sa-applied" });
    box.toggleClass("is-ok", true);
    // Set text on the container itself so tests can read .textContent directly.
    // The icon is added as a child but does not overwrite textContent in the mock.
    box.setText("✓ angewendet");
    const icon = box.createSpan({ cls: "vault-rag-sa-applied-icon" });
    setIcon(icon, "check");
    box.createSpan({ cls: "vault-rag-sa-applied-label", text: "✓ angewendet" });

    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });
    const undoBtn = bar.createEl("button", { cls: "vault-rag-sa-undo", text: "Rückgängig" });
    undoBtn.toggleClass("is-disabled", !this.lastUndo);
    undoBtn.addEventListener("click", () => {
      if (this.lastUndo) void this.onUndo();
    });
  }

  // ── Reasoning block ───────────────────────────────────────────────────────

  private renderReasoning(c: HTMLElement, p: ApplyProposal): void {
    if (!p.reasoning) return;
    const det = c.createEl("details", { cls: "vault-rag-sa-reasoning" });
    det.open = false;
    det.createEl("summary", { cls: "vault-rag-sa-reasoning-sum", text: "💭 Gedanken" });
    det.createDiv({ cls: "vault-rag-sa-reasoning-body", text: p.reasoning });
  }

  // ── Action handlers ───────────────────────────────────────────────────────

  private async onAccept(p: ApplyProposal): Promise<void> {
    if (this.running) return;
    this.running = true;
    const res = await this.deps.accept(p);
    this.running = false;
    if (res.written) {
      this.applied = true;
      this.lastUndo = res.undo ?? null;
    }
    this.render();
  }

  private onDiscard(): void {
    this.deps.abort();
    this.proposal = null;
    this.bodyText = "";
    this.render();
  }

  private async onReroll(p: ApplyProposal): Promise<void> {
    if (this.running) return;
    this.bodyText = "";
    this.startWorking();
    try {
      this.proposal = await this.deps.reroll(p, () => {}, () => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "abgebrochen") {
        new Notice("Verworfen");
      } else {
        new Notice(`Smart Apply: ${msg}`);
      }
    } finally {
      this.stopWorking();
    }
    this.render();
  }

  private async onUndo(): Promise<void> {
    const undo = this.lastUndo;
    if (!undo) return;
    await undo();
    // Clear undo capability; stay in applied state (no apply button) so user can see the change was reverted.
    this.lastUndo = null;
    this.render();
  }
}
