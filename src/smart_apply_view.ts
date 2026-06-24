import { ItemView, WorkspaceLeaf, setIcon, Notice } from "obsidian";
import type { FmValue, FmChange } from "./frontmatter";
import type { ApplyProposal, ApplyResult } from "./smart_apply";
import { isAlwaysOnThinker } from "./reasoning";

// Re-export for consumers (e.g. tests) that import from this module
export type { ApplyProposal, ApplyResult, SectionDiff } from "./smart_apply";

// ── Deps ────────────────────────────────────────────────────────────────────

export interface SmartApplyViewDeps {
  build: (notePath: string, templatePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  accept: (p: ApplyProposal) => Promise<ApplyResult>;
  reroll: (p: ApplyProposal, templatePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  openPath: (p: string) => void;
  abort: () => void;
  activeNotePath: () => string | null;
  listModels: () => Promise<string[]>;
  getModel: () => string;
  setModel: (m: string) => void;
  listTemplates: () => Promise<string[]>;
  getSuppress: () => boolean;
  setSuppress: (v: boolean) => void;
  ping: () => Promise<boolean>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const VIEW_TYPE_SMART_APPLY = "vault-rag-smart-apply";

type CockpitState = "idle" | "running" | "diff" | "applied" | "stale" | "error";

const CHANGE_ICON: Record<FmChange, string> = {
  unveraendert: "minus",
  geaendert: "pencil",
  neu: "plus",
  entfernt: "trash-2",
};

// ── SmartApplyView (persistent cockpit) ─────────────────────────────────────────

export class SmartApplyView extends ItemView {
  // State machine
  private state: CockpitState = "idle";
  private proposal: ApplyProposal | null = null;
  private lastUndo: (() => Promise<void>) | null = null;
  private errorText = "";
  private templateHint = "";

  // Live stream buffers (the running body re-uses these on re-render)
  private streamText = "";
  private reasoningText = "";
  private streamPaneEl: HTMLElement | null = null;
  private reasoningBodyEl: HTMLElement | null = null;
  private elapsedEl: HTMLElement | null = null;

  // Header refs
  private modelSel: HTMLSelectElement | null = null;
  private templateSel: HTMLSelectElement | null = null;
  private connEl: HTMLElement | null = null;
  private thinkEl: HTMLElement | null = null;

  // Dropdown / connection cache — populated by refresh* methods, filled synchronously on every render
  private models: string[] = [];
  private templates: string[] = [];
  private connected: boolean | null = null;
  private selectedTemplate = "";

  // Timer / guards
  private timer: ReturnType<typeof window.setInterval> | null = null;
  private workStart = 0;
  private accepting = false;

  constructor(leaf: WorkspaceLeaf, private deps: SmartApplyViewDeps) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_SMART_APPLY; }
  getDisplayText(): string { return "Smart Apply"; }
  getIcon(): string { return "wand-2"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("vault-rag-sa-root");
    this.render();
    await this.refreshModels();
    await this.refreshTemplates();
    await this.refreshConn();
  }

  async onClose(): Promise<void> {
    this.contentEl.removeClass("vault-rag-sa-root");
    this.stopTimer();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private render(): void {
    const c = this.contentEl;
    c.empty();
    // Re-build resets transient element refs (no leaks across re-renders).
    this.streamPaneEl = null;
    this.reasoningBodyEl = null;
    this.elapsedEl = null;
    this.renderHeader(c);
    const body = c.createDiv({ cls: "vault-rag-sa-body" });
    switch (this.state) {
      case "idle": this.renderIdle(body); break;
      case "running": this.renderRunning(body); break;
      case "diff": this.renderDiff(body); break;
      case "applied": this.renderApplied(body); break;
      case "stale": this.renderStale(body); break;
      case "error": this.renderError(body); break;
    }
  }

  // ── Header (always visible) ─────────────────────────────────────────────────

  private renderHeader(c: HTMLElement): void {
    const header = c.createDiv({ cls: "vault-rag-sa-header" });

    const row1 = header.createDiv({ cls: "vault-rag-sa-header-row" });
    this.modelSel = row1.createEl("select", { cls: "vault-rag-sa-model dropdown" });
    // Fill model select synchronously from cache
    const cur = this.deps.getModel();
    const modelList = this.models.length > 0
      ? (this.models.includes(cur) ? this.models : [cur, ...this.models])
      : [cur];
    for (const m of modelList) { const o = this.modelSel.createEl("option", { text: m }); o.value = m; }
    this.modelSel.value = cur;
    this.modelSel.addEventListener("change", () => {
      this.deps.setModel(this.modelSel?.value ?? "");
      this.renderThink();
    });

    this.connEl = row1.createDiv({ cls: "vault-rag-sa-conn" });
    // Reflect cached connection state synchronously
    this.connEl.empty();
    const dot = this.connEl.createSpan({ cls: "vault-rag-conn-dot" });
    const label = this.connEl.createSpan();
    if (this.connected === null) {
      label.setText('Smart-Apply-LLM: prüfe…');
    } else if (this.connected) {
      dot.toggleClass("is-ok", true);
      label.setText('Smart-Apply-LLM verbunden');
    } else {
      dot.toggleClass("is-error", true);
      label.setText('Smart-Apply-LLM offline — in den Settings prüfen');
    }
    this.connEl.addEventListener("click", () => void this.refreshConn());

    this.thinkEl = row1.createEl("button", { cls: "vault-rag-sa-think clickable-icon" });
    this.thinkEl.addEventListener("click", () => {
      if (isAlwaysOnThinker(this.deps.getModel())) return;   // nicht abschaltbar
      this.deps.setSuppress(!this.deps.getSuppress());
      this.renderThink();
    });
    this.renderThink();

    const row2 = header.createDiv({ cls: "vault-rag-sa-header-row" });
    this.templateSel = row2.createEl("select", { cls: "vault-rag-sa-template dropdown" });
    // Fill template select synchronously from cache
    const autoOpt = this.templateSel.createEl("option", { text: "automatisch erkennen" });
    autoOpt.value = "";
    for (const t of this.templates) {
      const o = this.templateSel.createEl("option", { text: t.split("/").pop()?.replace(/\.md$/, "") ?? t });
      o.value = t;
    }
    this.templateSel.value = this.selectedTemplate;
    this.templateSel.addEventListener("change", () => {
      this.selectedTemplate = this.templateSel?.value ?? "";
    });

    const running = this.state === "running";
    const runBtn = row2.createEl("button", { cls: "vault-rag-sa-run mod-cta", text: "Auf aktive Notiz anwenden" });
    runBtn.toggleClass("is-disabled", running);
    runBtn.addEventListener("click", () => { if (!running) void this.start(); });

    const stopBtn = row2.createEl("button", { cls: "vault-rag-sa-stop", text: "Stop" });
    stopBtn.toggleClass("is-disabled", !running);
    stopBtn.addEventListener("click", () => this.deps.abort());
  }

  private renderThink(): void {
    const el = this.thinkEl; if (!el) return;
    const always = isAlwaysOnThinker(this.deps.getModel());
    const suppressed = this.deps.getSuppress();
    el.empty();
    const icon = el.createSpan({ cls: "vault-rag-sa-think-icon" });
    setIcon(icon, "brain");
    el.createSpan({
      cls: "vault-rag-sa-think-label",
      text: always ? "Thinking: immer an" : suppressed ? "Thinking: aus" : "Thinking: an",
    });
    el.setAttribute("aria-label", always
      ? "Dieses Modell denkt immer (nicht abschaltbar)"
      : suppressed ? "Thinking ist aus — klicken zum Einschalten" : "Thinking ist an — klicken zum Ausschalten");
    el.toggleClass("is-disabled", always);
    el.toggleClass("is-off", !always && suppressed);
  }

  private async refreshModels(): Promise<void> {
    const models = await this.deps.listModels();
    this.models = models;
    this.render();
  }

  private async refreshTemplates(): Promise<void> {
    const templates = await this.deps.listTemplates();
    this.templates = templates;
    this.render();
  }

  private async refreshConn(): Promise<void> {
    this.connected = null;
    this.render();
    const ok = await this.deps.ping();
    this.connected = ok;
    this.render();
  }

  // ── Body: idle ──────────────────────────────────────────────────────────────

  private renderIdle(c: HTMLElement): void {
    c.createDiv({
      cls: "vault-rag-sa-idle",
      text: "Wähle eine Notiz und drücke 'Auf aktive Notiz anwenden'.",
    });
    if (this.templateHint) {
      c.createDiv({ cls: "vault-rag-sa-template-hint", text: this.templateHint });
    }
  }

  // ── Body: running ─────────────────────────────────────────────────────────────

  private renderRunning(c: HTMLElement): void {
    const wrap = c.createDiv({ cls: "vault-rag-sa-running" });
    this.elapsedEl = wrap.createDiv({ cls: "vault-rag-sa-elapsed" });
    this.elapsedEl.setText("● arbeitet… 0.0 s");

    const det = wrap.createEl("details", { cls: "vault-rag-sa-reasoning" });
    det.open = true;
    det.createEl("summary", { cls: "vault-rag-sa-reasoning-sum", text: "💭 Denken" });
    this.reasoningBodyEl = det.createDiv({ cls: "vault-rag-sa-reasoning-body" });
    this.reasoningBodyEl.setText(this.reasoningText);

    const stream = wrap.createEl("details", { cls: "vault-rag-sa-stream-wrap" });
    stream.open = false;
    stream.createEl("summary", { cls: "vault-rag-sa-stream-sum", text: "Roh-Stream" });
    this.streamPaneEl = stream.createEl("pre", { cls: "vault-rag-sa-stream" });
    this.streamPaneEl.setText(this.streamText);
  }

  private onToken(t: string): void {
    this.streamText += t;
    if (this.streamPaneEl) this.streamPaneEl.setText(this.streamText);
  }

  private onReasoning(t: string): void {
    this.reasoningText += t;
    if (this.reasoningBodyEl) this.reasoningBodyEl.setText(this.reasoningText);
  }

  // ── Body: diff ────────────────────────────────────────────────────────────────

  private renderDiff(c: HTMLElement): void {
    const p = this.proposal;
    if (!p) { this.renderIdle(c); return; }
    const wrap = c.createDiv({ cls: "vault-rag-sa-diff" });

    this.renderGuard(wrap, p);
    this.renderTwoSurface(wrap, p);
    this.renderFrontmatter(wrap, p);
    this.renderActions(wrap, p);
    this.renderReasoning(wrap, p.reasoning);
  }

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

  private renderTwoSurface(c: HTMLElement, p: ApplyProposal): void {
    const surfaces = c.createDiv({ cls: "vault-rag-sa-surfaces" });

    const origCol = surfaces.createDiv({ cls: "vault-rag-sa-surface" });
    origCol.createDiv({ cls: "vault-rag-sa-surface-title", text: "Original" });
    origCol.createEl("pre", { cls: "vault-rag-sa-orig", text: p.originalText });

    const propCol = surfaces.createDiv({ cls: "vault-rag-sa-surface" });
    propCol.createDiv({ cls: "vault-rag-sa-surface-title", text: "Vorschlag" });
    propCol.createEl("pre", { cls: "vault-rag-sa-prop", text: p.proposedText });
  }

  private fmCell(v: FmValue | undefined): string {
    if (v === undefined) return "—";
    return Array.isArray(v) ? v.join(", ") : v;
  }

  private renderFrontmatter(c: HTMLElement, p: ApplyProposal): void {
    if (p.fmRows.length === 0) return;
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

  private renderActions(c: HTMLElement, p: ApplyProposal): void {
    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });

    const apply = bar.createEl("button", { cls: "vault-rag-sa-apply mod-cta", text: "Anwenden" });
    apply.toggleClass("is-disabled", !p.hardOk);
    apply.addEventListener("click", () => { if (p.hardOk) void this.onAccept(p); });

    bar.createEl("button", { cls: "vault-rag-sa-discard", text: "Verwerfen" })
      .addEventListener("click", () => this.onDiscard());

    bar.createEl("button", { cls: "vault-rag-sa-reroll", text: "Neu würfeln" })
      .addEventListener("click", () => void this.onReroll(p));

    bar.createEl("button", { cls: "vault-rag-sa-open-tpl", text: "Vorlage öffnen" })
      .addEventListener("click", () => this.deps.openPath(p.templatePath));
  }

  private renderReasoning(c: HTMLElement, reasoning: string): void {
    if (!reasoning) return;
    const det = c.createEl("details", { cls: "vault-rag-sa-reasoning" });
    det.open = false;
    det.createEl("summary", { cls: "vault-rag-sa-reasoning-sum", text: "💭 Gedanken" });
    det.createDiv({ cls: "vault-rag-sa-reasoning-body", text: reasoning });
  }

  // ── Body: applied ─────────────────────────────────────────────────────────────

  private renderApplied(c: HTMLElement): void {
    const path = this.proposal?.notePath ?? "";
    const name = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    const box = c.createDiv({ cls: "vault-rag-sa-applied" });
    box.toggleClass("is-ok", true);
    box.setText(`✓ angewendet: ${name}`);
    const icon = box.createSpan({ cls: "vault-rag-sa-applied-icon" });
    setIcon(icon, "check");

    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });
    const undoBtn = bar.createEl("button", { cls: "vault-rag-sa-undo", text: "Rückgängig" });
    undoBtn.toggleClass("is-disabled", !this.lastUndo);
    undoBtn.addEventListener("click", () => { if (this.lastUndo) void this.onUndo(); });
  }

  // ── Body: stale ───────────────────────────────────────────────────────────────

  private renderStale(c: HTMLElement): void {
    const box = c.createDiv({ cls: "vault-rag-sa-stale" });
    box.setText("Notiz wurde zwischenzeitlich geändert (z.B. durch einen Linter) — neu erzeugen?");

    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });
    bar.createEl("button", { cls: "vault-rag-sa-rebuild mod-cta", text: "Neu erzeugen & anwenden" })
      .addEventListener("click", () => void this.onRebuild());

    bar.createEl("button", { cls: "vault-rag-sa-discard", text: "Verwerfen" })
      .addEventListener("click", () => this.onDiscard());
  }

  // ── Body: error ───────────────────────────────────────────────────────────────

  private renderError(c: HTMLElement): void {
    const box = c.createDiv({ cls: "vault-rag-sa-error" });
    box.setText(this.errorText || "Fehler");
    c.createDiv({ cls: "vault-rag-sa-actions" })
      .createEl("button", { cls: "vault-rag-sa-discard", text: "Zurück" })
      .addEventListener("click", () => this.onDiscard());
  }

  // ── Run timer ─────────────────────────────────────────────────────────────────

  private startTimer(): void {
    this.workStart = Date.now();
    const tick = (): void => {
      if (this.elapsedEl) {
        this.elapsedEl.setText(`● arbeitet… ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
      }
    };
    tick();
    this.timer = window.setInterval(tick, 100);
  }

  private stopTimer(): void {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
  }

  // ── Behaviors ───────────────────────────────────────────────────────────────

  /** "Auf aktive Notiz anwenden" handler. Never throws. */
  async start(): Promise<void> {
    const path = this.deps.activeNotePath();
    if (path === null) {
      new Notice("Keine aktive Markdown-Notiz — öffne eine Notiz und versuche es erneut.");
      return;
    }
    const templatePath = this.selectedTemplate;
    await this.runBuild(() => this.deps.build(path, templatePath, (t) => this.onToken(t), (t) => this.onReasoning(t)));
  }

  /** Shared build→diff pipeline used by start(), reroll() and stale-rebuild. */
  private async runBuild(builder: () => Promise<ApplyProposal>): Promise<void> {
    this.streamText = "";
    this.reasoningText = "";
    this.templateHint = "";
    this.proposal = null;
    this.lastUndo = null;
    this.state = "running";
    this.render();
    this.startTimer();
    try {
      const proposal = await builder();
      this.proposal = proposal;
      this.state = "diff";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "abgebrochen") {
        this.errorText = "Verworfen";
        this.state = "error";
      } else if (msg === "vorlage-waehlen" || msg === "keine-vorlage") {
        this.state = "idle";
        this.errorText = "";
        this.templateHint = 'Konnte den Typ nicht automatisch zuordnen — bitte Vorlage oben wählen';
      } else {
        this.errorText = msg;
        new Notice(`Smart Apply: ${msg}`);
        this.state = "error";
      }
    } finally {
      this.stopTimer();
    }
    this.render();
  }

  private async onAccept(p: ApplyProposal): Promise<void> {
    if (this.accepting) return;
    this.accepting = true;
    try {
      const res = await this.deps.accept(p);
      if (res.written) {
        this.lastUndo = res.undo ?? null;
        this.state = "applied";
      } else if (res.reason === "stale") {
        this.state = "stale";
      }
      // reason === "blocked" → stay in diff (guard banner already explains it)
    } catch (e) {
      new Notice(`Smart Apply: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.accepting = false;
    }
    this.render();
  }

  private onDiscard(): void {
    this.proposal = null;
    this.lastUndo = null;
    this.streamText = "";
    this.reasoningText = "";
    this.errorText = "";
    this.templateHint = "";
    this.state = "idle";
    this.render();
  }

  private async onReroll(p: ApplyProposal): Promise<void> {
    const templatePath = this.selectedTemplate || p.templatePath;
    await this.runBuild(() => this.deps.reroll(p, templatePath, (t) => this.onToken(t), (t) => this.onReasoning(t)));
  }

  /** Stale rebuild: re-build against current note, accept again if hardOk. */
  private async onRebuild(): Promise<void> {
    const path = this.proposal?.notePath ?? this.deps.activeNotePath();
    if (path === null || path === undefined) {
      new Notice("Keine aktive Markdown-Notiz — öffne eine Notiz und versuche es erneut.");
      this.state = "idle";
      this.render();
      return;
    }
    const templatePath = this.selectedTemplate || (this.proposal?.templatePath ?? "");
    await this.runBuild(() => this.deps.build(path, templatePath, (t) => this.onToken(t), (t) => this.onReasoning(t)));
    if (this.state === "diff" && this.proposal && this.proposal.hardOk) {
      await this.onAccept(this.proposal);
    }
  }

  private async onUndo(): Promise<void> {
    const undo = this.lastUndo;
    if (!undo) return;
    try {
      await undo();
    } catch (e) {
      new Notice(`Smart Apply: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.lastUndo = null;
    this.state = "idle";
    this.render();
  }
}
