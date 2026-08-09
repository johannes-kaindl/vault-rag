import { setIcon, Notice } from "obsidian";
import { t } from "./vendor/kit/i18n";
import type { FmValue, FmChange, FmRow, Confidence } from "./frontmatter";
import type { ApplyProposal, ApplyResult, ApplySelection } from "./smart_apply";
import { assembleProposedText, defaultSelection } from "./smart_apply";
import type { TemplateRank } from "./template_ranker";
import { isAlwaysOnThinker } from "./vendor/kit/reasoning";
import type { HubPanel, TabId } from "./hub_panel";
import type { ApplyMode } from "./note_restructurer";

// Re-export for consumers (e.g. tests) that import from this module
export type { ApplyProposal, ApplyResult, SectionDiff } from "./smart_apply";

// ── Deps ────────────────────────────────────────────────────────────────────

export interface SmartApplyViewDeps {
  build: (notePath: string, templatePath: string, mode: ApplyMode, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  accept: (p: ApplyProposal, selection: ApplySelection, auditTrail: boolean) => Promise<ApplyResult>;
  reroll: (p: ApplyProposal, templatePath: string, mode: ApplyMode, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  openPath: (p: string) => void;
  abort: () => void;
  activeNotePath: () => string | null;
  listModels: () => Promise<string[]>;
  getModel: () => string;
  setModel: (m: string) => void;
  rankTemplates: (notePath: string) => Promise<TemplateRank[]>;
  getSuppress: () => boolean;
  setSuppress: (v: boolean) => void;
  ping: () => Promise<boolean>;
  /** Liest+parst die Vorlage, liefert ihren defaultMode (Fallback: Settings-Default). */
  templateDefaultMode: (templatePath: string) => Promise<ApplyMode>;
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

// Form (Symbol) trägt die Bedeutung, nicht nur Farbe — lesbar auch bei Farbsehschwäche.
const CONF_SYMBOL: Record<Confidence, string> = { hoch: "●", mittel: "◐", niedrig: "○" };

export const MODE_LABELS: { id: ApplyMode; labelKey: string }[] = [
  { id: "deterministisch", labelKey: "smartApply.modeDeterministic" },
  { id: "additiv", labelKey: "smartApply.modeAdditive" },
  { id: "transformativ", labelKey: "smartApply.modeTransformative" },
];

/** EINE Wahrheit für die Block-Zählung — ersetzt die zwei Inline-Ternaries. */
export function blockCountLabel(n: number): string {
  return n === 1 ? t("smartApply.blocks.singular", n) : t("smartApply.blocks.plural", n);
}

// ── SmartApplyPanel (persistent cockpit) ─────────────────────────────────────────

export class SmartApplyPanel implements HubPanel {
  readonly id: TabId = "smart-apply";
  get label(): string { return t("smartApply.label"); }
  readonly icon = "wand-2";
  private container!: HTMLElement;
  private visible = false;
  private dirty = false;

  // State machine
  private state: CockpitState = "idle";
  private proposal: ApplyProposal | null = null;
  private lastUndo: (() => Promise<void>) | null = null;
  private lastRedo: (() => Promise<void>) | null = null;
  // Nach einem Undo (undone=true) bleibt das Panel im applied-Zustand, der Button wird zum Redo.
  private undone = false;
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
  private connEl: HTMLElement | null = null;
  private thinkEl: HTMLElement | null = null;

  // Dropdown / connection cache — populated by refresh* methods, filled synchronously on every render
  private models: string[] = [];
  private ranking: TemplateRank[] = [];
  private expandedRanks = false;
  private userOverrodeTemplate = false;
  private rankGen = 0;
  private rankTimer: number | null = null;
  private connected: boolean | null = null;
  private selectedTemplate = "";
  // Pfad der Notiz, für die zuletzt gerankt wurde — macht onFileOpen pfad-bewusst (s.u.).
  private lastContextPath: string | null = null;

  // Timer / guards
  private timer: number | null = null;
  private workStart = 0;
  private accepting = false;

  // Non-deterministic Smart Apply (Task 10): Modus-Wahl, granulare Auswahl, Audit-Trail-Toggle.
  private selectedMode: ApplyMode = "deterministisch";
  private selection: ApplySelection = { inferredKeys: new Set(), additionIds: new Set() };
  private auditTrail = false;

  constructor(private deps: SmartApplyViewDeps) {}

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.addClass("vault-rag-sa-root");
    this.render();
    void this.initAsync().catch(() => {});
  }

  private async initAsync(): Promise<void> {
    await this.refreshModels();
    await this.refreshConn();
    await this.recomputeRanking();
  }

  /** Tab wird sichtbar — kontextsensitiv: holt einen ausstehenden Recompute nach. */
  onShow(): void {
    this.visible = true;
    if (this.dirty) { this.scheduleRecompute(); this.dirty = false; }
  }

  /** Tab wird versteckt. */
  onHide(): void {
    this.visible = false;
  }

  /** Aktive Notiz gewechselt (zentral vom Hub gerufen, ersetzt die früher selbst-registrierten
   *  active-leaf-change/file-open-Events). Nur wenn sichtbar sofort ranken, sonst dirty merken.
   *  main.refresh() ruft notifyFileOpen() bei JEDEM Index-Reload (nicht nur bei echtem Notizwechsel) —
   *  bleibt der Pfad gleich, ist es kein Notizwechsel: kein Recompute, kein Reset der manuellen Wahl. */
  onFileOpen(path: string | null): void {
    if (path === this.lastContextPath) return;
    this.lastContextPath = path;
    if (this.visible) { this.scheduleRecompute(); this.dirty = false; } else { this.dirty = true; }
  }

  destroy(): void {
    this.stopTimer();
    if (this.rankTimer !== null) { window.clearTimeout(this.rankTimer); this.rankTimer = null; }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private render(): void {
    const c = this.container;
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

    // Verbindungsstatus zuerst, als eigene ruhige Zeile (gibt dem Modell-Dropdown darunter Platz).
    this.renderConnStatus(header);

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

    this.thinkEl = row1.createEl("button", { cls: "vault-rag-sa-think clickable-icon" });
    this.thinkEl.addEventListener("click", () => {
      if (isAlwaysOnThinker(this.deps.getModel())) return;   // nicht abschaltbar
      this.deps.setSuppress(!this.deps.getSuppress());
      this.renderThink();
    });
    this.renderThink();

    const row2 = header.createDiv({ cls: "vault-rag-sa-header-row" });

    const running = this.state === "running";
    const runBtn = row2.createEl("button", { cls: "vault-rag-sa-run mod-cta", text: t("smartApply.runLabel") });
    runBtn.toggleClass("is-disabled", running);
    runBtn.addEventListener("click", () => { if (!running) void this.start(); });

    const stopBtn = row2.createEl("button", { cls: "vault-rag-sa-stop", text: t("smartApply.stop") });
    stopBtn.toggleClass("is-disabled", !running);
    stopBtn.addEventListener("click", () => this.deps.abort());

    this.renderModeControl(header);
    this.renderAuditToggle(header);
    this.renderRankList(header);
  }

  /** Modus-Segmented-Control: Deterministisch|Additiv|Transformativ (transformativ = Slice 2, disabled).
   *  WCAG 1.4.1: aktiver Modus über Text+`is-active`-Klasse, nicht nur Farbe. */
  private renderModeControl(header: HTMLElement): void {
    const wrap = header.createDiv({ cls: "vault-rag-sa-mode" });
    for (const m of MODE_LABELS) {
      const disabled = m.id === "transformativ";
      const seg = wrap.createEl("button", { cls: "vault-rag-sa-mode-btn", text: t(m.labelKey) });
      seg.toggleClass("is-disabled", disabled);
      seg.toggleClass("is-active", this.selectedMode === m.id);
      if (!disabled) {
        seg.addEventListener("click", () => {
          // Nur den Modus setzen + neu rendern — konsistent mit selectTemplate/Audit-Toggle.
          // Der Run läuft ausschließlich über „Auf aktive Notiz anwenden" (runBtn).
          this.selectedMode = m.id;
          this.render();
        });
      }
    }
  }

  /** Audit-Trail-Toggle: „Provenienz behalten" — steuert, ob erschlossene/ergänzte Anteile im
   *  finalen Text markiert werden (`%%erschlossen: …%%` / `smartapply_erschlossen`). Ändert nur
   *  die Live-Vorschau (reassemble), löst nie einen neuen Stream aus. */
  private renderAuditToggle(header: HTMLElement): void {
    const wrap = header.createDiv({ cls: "vault-rag-sa-audit" });
    const checkbox = wrap.createEl("input", { cls: "vault-rag-sa-audit-check" });
    checkbox.setAttribute("type", "checkbox");
    checkbox.checked = this.auditTrail;
    checkbox.addEventListener("change", () => {
      this.auditTrail = checkbox.checked;
      this.reassemble();
    });
    wrap.createSpan({ cls: "vault-rag-sa-audit-label", text: t("smartApply.provenance") });
  }

  private renderRankList(header: HTMLElement): void {
    const wrap = header.createDiv({ cls: "vault-rag-sa-ranklist" });
    if (this.ranking.length === 0) {
      wrap.createDiv({ cls: "vault-rag-sa-rank-empty", text: t("smartApply.noTemplate") });
      return;
    }
    if (this.ranking.every(r => r.source === "fallback")) {
      wrap.createDiv({ cls: "vault-rag-sa-rank-note", text: t("smartApply.offlineRanking") });
    }
    const maxScore = Math.max(0, ...this.ranking.map(r => r.score));
    const TOP_N = 5;
    const visible = this.expandedRanks ? this.ranking : this.ranking.slice(0, TOP_N);
    for (const r of visible) {
      const row = wrap.createDiv({ cls: "vault-rag-sa-rank-row" });
      const selected = r.templatePath === this.selectedTemplate;
      row.toggleClass("is-selected", selected);
      row.addEventListener("click", () => this.selectTemplate(r.templatePath));
      row.createSpan({ cls: "vault-rag-sa-rank-radio", text: selected ? "◉" : "○" });
      row.createSpan({ cls: "vault-rag-sa-rank-name", text: r.type });
      const pct = r.source === "confirmed" ? 100 : (maxScore > 0 ? Math.round((r.score / maxScore) * 100) : 0);
      const bar = row.createDiv({ cls: "vault-rag-sa-rank-bar" });
      bar.style.setProperty("--vault-rag-sa-rank-pct", `${pct}%`);
      const isConfirmed = r.source === "confirmed";
      const pctLabel = isConfirmed ? t("smartApply.rankFmType") : `${pct}%`;
      row.createSpan({ cls: "vault-rag-sa-rank-pct", text: pctLabel });
    }
    if (this.ranking.length > TOP_N && !this.expandedRanks) {
      const more = wrap.createDiv({ cls: "vault-rag-sa-rank-more", text: t("smartApply.moreRanks", this.ranking.length - TOP_N) });
      more.addEventListener("click", () => { this.expandedRanks = true; this.render(); });
    }
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
      text: always ? t("smartApply.thinkAlwaysOn") : suppressed ? t("smartApply.thinkOff") : t("smartApply.thinkOn"),
    });
    el.setAttribute("aria-label", always
      ? t("smartApply.thinkAriaAlways")
      : suppressed ? t("smartApply.thinkAriaOff") : t("smartApply.thinkAriaOn"));
    el.toggleClass("is-disabled", always);
    el.toggleClass("is-off", !always && suppressed);
  }

  private async refreshModels(): Promise<void> {
    const models = await this.deps.listModels();
    this.models = models;
    this.render();
  }

  private scheduleRecompute(): void {
    if (this.rankTimer !== null) window.clearTimeout(this.rankTimer);
    this.rankTimer = window.setTimeout(() => { this.rankTimer = null; void this.recomputeRanking(true); }, 400);
  }

  /** Rankt für die aktive Notiz neu. noteChanged=true (Notizwechsel) verwirft eine manuelle Auswahl. */
  private async recomputeRanking(noteChanged = false): Promise<void> {
    if (noteChanged) { this.userOverrodeTemplate = false; this.expandedRanks = false; }
    const path = this.deps.activeNotePath();
    this.lastContextPath = path;   // seedet/hält onFileOpen's Vergleichsbasis aktuell
    if (path === null) { this.ranking = []; this.render(); return; }
    const gen = ++this.rankGen;
    let ranks: TemplateRank[] = [];
    try { ranks = await this.deps.rankTemplates(path); } catch { ranks = []; }
    if (gen !== this.rankGen) return; // veraltet — neuerer Lauf gewinnt
    this.ranking = ranks;
    if (!this.userOverrodeTemplate) this.selectedTemplate = ranks[0]?.templatePath ?? "";
    // Echter Notizwechsel (nicht bloß ein Index-Reload): Modus aus der Vorlage seeden.
    if (noteChanged && this.selectedTemplate) {
      try {
        this.selectedMode = await this.deps.templateDefaultMode(this.selectedTemplate);
      } catch {
        // Fallback: bisherigen Modus beibehalten.
      }
      if (gen !== this.rankGen) return; // während des zweiten await veraltet geworden
    }
    this.render();
  }

  private selectTemplate(path: string): void {
    this.selectedTemplate = path;
    this.userOverrodeTemplate = true;
    this.render();
  }

  /** Von außen aufrufbar (z.B. nach Vorlagenpfad-Änderung in den Settings): sofort neu ranken. */
  refreshRanking(): void {
    void this.recomputeRanking(true);
  }

  /** Verbindungsstatus als eigene, ruhige Kopfzeile. Die Form (Icon) trägt die Bedeutung,
   *  Farbe ist nur ein sekundärer Hinweis — lesbar auch bei Farbsehschwäche (WCAG 1.4.1). */
  private renderConnStatus(parent: HTMLElement): void {
    this.connEl = parent.createDiv({ cls: "vault-rag-sa-conn" });
    const dot = this.connEl.createSpan({ cls: "vault-rag-conn-dot" });
    const label = this.connEl.createSpan({ cls: "vault-rag-sa-conn-label" });
    if (this.connected === null) {
      dot.toggleClass("is-checking", true);
      setIcon(dot, "loader");
      label.setText(t("smartApply.llmChecking"));
    } else if (this.connected) {
      dot.toggleClass("is-ok", true);
      setIcon(dot, "circle-check");
      label.setText(t("smartApply.llmConnected"));
    } else {
      dot.toggleClass("is-error", true);
      setIcon(dot, "circle-x");
      label.setText(t("smartApply.llmOffline"));
    }
    this.connEl.setAttribute("aria-label", t("smartApply.recheckAria"));
    this.connEl.setAttribute("title", t("smartApply.recheckTitle"));
    this.connEl.addEventListener("click", () => void this.refreshConn());
    const refresh = this.connEl.createSpan({ cls: "vault-rag-sa-conn-refresh clickable-icon" });
    setIcon(refresh, "refresh-cw");
    refresh.setAttribute("aria-label", t("smartApply.recheckTitle"));
    refresh.addEventListener("click", (e) => { e?.stopPropagation(); void this.refreshConn(); });
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
      text: t("smartApply.pickNote"),
    });
    if (this.templateHint) {
      c.createDiv({ cls: "vault-rag-sa-template-hint", text: this.templateHint });
    }
  }

  // ── Body: running ─────────────────────────────────────────────────────────────

  private renderRunning(c: HTMLElement): void {
    const wrap = c.createDiv({ cls: "vault-rag-sa-running" });
    this.elapsedEl = wrap.createDiv({ cls: "vault-rag-sa-elapsed" });
    this.elapsedEl.setText(t("smartApply.working", "0.0"));

    const det = wrap.createEl("details", { cls: "vault-rag-sa-reasoning" });
    det.open = true;
    det.createEl("summary", { cls: "vault-rag-sa-reasoning-sum", text: t("smartApply.thinkingSummary") });
    this.reasoningBodyEl = det.createDiv({ cls: "vault-rag-sa-reasoning-body" });
    this.reasoningBodyEl.setText(this.reasoningText);

    const stream = wrap.createEl("details", { cls: "vault-rag-sa-stream-wrap" });
    stream.open = false;
    stream.createEl("summary", { cls: "vault-rag-sa-stream-sum", text: t("smartApply.rawStream") });
    this.streamPaneEl = stream.createEl("pre", { cls: "vault-rag-sa-stream" });
    this.streamPaneEl.setText(this.streamText);
  }

  private onToken(chunk: string): void {
    this.streamText += chunk;
    if (this.streamPaneEl) this.streamPaneEl.setText(this.streamText);
  }

  private onReasoning(chunk: string): void {
    this.reasoningText += chunk;
    if (this.reasoningBodyEl) this.reasoningBodyEl.setText(this.reasoningText);
  }

  // ── Body: diff ────────────────────────────────────────────────────────────────

  private renderDiff(c: HTMLElement): void {
    const p = this.proposal;
    if (!p) { this.renderIdle(c); return; }
    const wrap = c.createDiv({ cls: "vault-rag-sa-diff" });

    this.renderGuardScan(wrap, p);
    this.renderFrontmatter(wrap, p);
    this.renderReflow(wrap, p);
    this.renderRawDetails(wrap, p);
    this.renderActions(wrap, p);
    this.renderReasoning(wrap, p.reasoning);
  }

  private truncate(s: string, max: number): string {
    const trimmed = s.replace(/\s+/g, " ").trim();
    return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
  }

  private renderReflow(c: HTMLElement, p: ApplyProposal): void {
    // Kein Routing (z.B. assignment-parse-Fehler) → weder Reflow-Zeilen noch ein
    // irreführendes „nichts verloren". Der Scan-Kopf zeigt den Fehler.
    if (p.sectionDiff.length === 0 && p.unassigned.length === 0) return;
    const sec = c.createDiv({ cls: "vault-rag-sa-reflow" });
    sec.createDiv({ cls: "vault-rag-sa-section-title", text: t("smartApply.bodyReflow") });
    for (const sd of p.sectionDiff) {
      const row = sec.createDiv({ cls: "vault-rag-sa-reflow-row" });
      row.toggleClass("is-empty", sd.blockIds.length === 0);
      const head = row.createDiv({ cls: "vault-rag-sa-reflow-head" });
      head.createSpan({ cls: "vault-rag-sa-reflow-heading", text: sd.heading.replace(/^#+\s*/, "") });
      const n = sd.blockIds.length;
      head.createSpan({
        cls: "vault-rag-sa-reflow-count",
        text: n === 0 ? "—" : blockCountLabel(n),
      });
      if (sd.provenance) {
        row.createDiv({ cls: "vault-rag-sa-reflow-prov", text: this.truncate(sd.provenance, 80) });
      }
      for (const add of p.additions.filter((a) => a.targetHeading === sd.heading)) {
        const addRow = row.createDiv({ cls: "vault-rag-sa-add" });
        addRow.createSpan({ cls: "vault-rag-sa-add-marker", text: t("smartApply.added") });
        addRow.createSpan({ cls: "vault-rag-sa-add-text", text: this.truncate(add.text, 80) });
        this.renderConfidenceBadge(addRow, add.confidence);
        const id = add.id;
        const checkbox = addRow.createEl("input", { cls: "vault-rag-sa-conf-check" });
        checkbox.setAttribute("type", "checkbox");
        checkbox.checked = this.selection.additionIds.has(id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) this.selection.additionIds.add(id);
          else this.selection.additionIds.delete(id);
          this.reassemble();
        });
      }
    }
    const left = sec.createDiv({ cls: "vault-rag-sa-leftover" });
    const icon = left.createSpan({ cls: "vault-rag-sa-leftover-icon" });
    if (p.unassigned.length === 0) {
      left.toggleClass("is-ok", true);
      setIcon(icon, "circle-check");
      left.createSpan({ cls: "vault-rag-sa-leftover-label", text: t("smartApply.nothingLost") });
    } else {
      left.toggleClass("is-warn", true);
      setIcon(icon, "alert-triangle");
      const n = p.unassigned.length;
      left.createSpan({
        cls: "vault-rag-sa-leftover-label",
        text: t("smartApply.unassignedCount", blockCountLabel(n)),
      });
      const list = sec.createDiv({ cls: "vault-rag-sa-leftover-list" });
      for (const b of p.unassigned) {
        list.createDiv({ cls: "vault-rag-sa-leftover-item", text: this.truncate(b.text, 80) });
      }
    }
  }

  private detectionLabel(d: ApplyProposal["detection"]): string {
    if (d.confidence === "confirmed") return t("smartApply.detectFromFrontmatter");
    if (d.source === "rag") return t("smartApply.detectAuto");
    return t("smartApply.manualChoice");
  }

  private renderGuardScan(c: HTMLElement, p: ApplyProposal): void {
    const banner = c.createDiv({ cls: "vault-rag-sa-guard" });
    banner.toggleClass("is-ok", p.hardOk);
    banner.toggleClass("is-error", !p.hardOk);

    const status = banner.createDiv({ cls: "vault-rag-sa-scan-status" });
    const sIcon = status.createSpan({ cls: "vault-rag-sa-scan-status-icon" });
    setIcon(sIcon, p.hardOk ? "circle-check" : "circle-x");
    status.createSpan({
      cls: "vault-rag-sa-scan-status-label",
      text: p.hardOk ? t("smartApply.readyToApply") : t("smartApply.applyBlocked"),
    });

    banner.createDiv({
      cls: "vault-rag-sa-scan-tpl",
      text: t("smartApply.templateLine", p.type, this.detectionLabel(p.detection)),
    });

    const assigned = p.sectionDiff.reduce((sum, sd) => sum + sd.blockIds.length, 0);
    const total = assigned + p.unassigned.length;
    const setCount = p.fmRows.filter((row) => !this.isMutedRow(row)).length;
    banner.createDiv({
      cls: "vault-rag-sa-scan-stats",
      text: t("smartApply.summary", assigned, total, p.unassigned.length, setCount),
    });

    if (!p.hardOk) {
      const list = banner.createDiv({ cls: "vault-rag-sa-guard-list" });
      for (const ch of p.checks.filter((x) => !x.ok)) {
        list.createDiv({
          cls: "vault-rag-sa-guard-fail",
          text: `${ch.id}${ch.detail ? ": " + ch.detail : ""}`,
        });
      }
    }
  }

  private renderRawDetails(c: HTMLElement, p: ApplyProposal): void {
    const det = c.createEl("details", { cls: "vault-rag-sa-raw" });
    det.createEl("summary", { cls: "vault-rag-sa-raw-sum", text: t("smartApply.showRaw") });
    const surfaces = det.createDiv({ cls: "vault-rag-sa-surfaces" });

    const origCol = surfaces.createDiv({ cls: "vault-rag-sa-surface" });
    origCol.createDiv({ cls: "vault-rag-sa-surface-title", text: t("smartApply.original") });
    origCol.createEl("pre", { cls: "vault-rag-sa-orig", text: p.originalText });

    const propCol = surfaces.createDiv({ cls: "vault-rag-sa-surface" });
    propCol.createDiv({ cls: "vault-rag-sa-surface-title", text: t("smartApply.proposal") });
    propCol.createEl("pre", { cls: "vault-rag-sa-prop", text: p.proposedText });
  }

  private fmCell(v: FmValue | undefined): string {
    if (v === undefined) return "—";
    return Array.isArray(v) ? v.join(", ") : String(v);
  }

  private hasValue(v: FmValue | undefined): boolean {
    if (v === undefined) return false;
    return Array.isArray(v) ? v.length > 0 : String(v).trim() !== "";
  }

  /** Zurückhaltend (ausklappbar): unverändert ODER neu-aber-leer. Alles andere ist „gesetzt". */
  private isMutedRow(row: FmRow): boolean {
    return row.change === "unveraendert" || (row.change === "neu" && !this.hasValue(row.proposed));
  }

  /** Form+Text-Badge (nicht nur Farbe): `● hoch` / `◐ mittel` / `○ niedrig`. */
  private renderConfidenceBadge(parent: HTMLElement, confidence: Confidence): void {
    const badge = parent.createSpan({ cls: `vault-rag-sa-conf is-${confidence}` });
    badge.setText(`${CONF_SYMBOL[confidence]} ${confidence}`);
  }

  private renderFmRow(parent: HTMLElement, row: FmRow, p: ApplyProposal): void {
    const r = parent.createDiv({ cls: "vault-rag-sa-fm-row" });
    r.toggleClass(`is-${row.change}`, true);
    const icon = r.createSpan({ cls: "vault-rag-sa-fm-icon" });
    setIcon(icon, CHANGE_ICON[row.change] ?? "minus");
    r.createSpan({ cls: "vault-rag-sa-fm-key", text: row.key });
    r.createSpan({ cls: "vault-rag-sa-fm-orig", text: this.fmCell(row.original) });

    // M1: bei change==="unveraendert" gewinnt der nicht-leere ORIGINAL-Wert in mergeFrontmatter —
    // der inferred-Wert wird nie geschrieben. Checkbox/Badge wären dann ein wirkungsloser No-op
    // und widersprächen der Raw-Preview (die den Original-Wert zeigt) — also nur als gewöhnliche
    // Zeile rendern, kein Badge/Checkbox.
    if (row.source === "inferred" && row.confidence && row.change !== "unveraendert") {
      // CRITICAL (Task 8/10 seam): der Basis-fmRow.proposed ist "" (kein acceptInferred beim
      // Basis-Merge) — der tatsächliche erschlossene Wert lebt in assembly.assignment.frontmatter.
      const inferredValue = p.assembly.assignment.frontmatter[row.key]?.value;
      r.createSpan({ cls: "vault-rag-sa-fm-prop", text: this.fmCell(inferredValue) });
      this.renderConfidenceBadge(r, row.confidence);
      const key = row.key;
      const checkbox = r.createEl("input", { cls: "vault-rag-sa-conf-check" });
      checkbox.setAttribute("type", "checkbox");
      checkbox.checked = this.selection.inferredKeys.has(key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selection.inferredKeys.add(key);
        else this.selection.inferredKeys.delete(key);
        this.reassemble();
      });
    } else {
      r.createSpan({ cls: "vault-rag-sa-fm-prop", text: this.fmCell(row.proposed) });
    }
  }

  private renderFrontmatter(c: HTMLElement, p: ApplyProposal): void {
    if (p.fmRows.length === 0) return;
    const sec = c.createDiv({ cls: "vault-rag-sa-fm" });
    sec.createDiv({ cls: "vault-rag-sa-section-title", text: t("smartApply.frontmatterTitle") });

    const setRows = p.fmRows.filter((row) => !this.isMutedRow(row));
    const mutedRows = p.fmRows.filter((row) => this.isMutedRow(row));

    if (setRows.length > 0) {
      const setBox = sec.createDiv({ cls: "vault-rag-sa-fm-set" });
      const head = setBox.createDiv({ cls: "vault-rag-sa-fm-head" });
      head.createSpan({ cls: "vault-rag-sa-fm-icon" });
      head.createSpan({ cls: "vault-rag-sa-fm-key" });
      head.createSpan({ cls: "vault-rag-sa-fm-orig", text: t("smartApply.original") });
      head.createSpan({ cls: "vault-rag-sa-fm-prop", text: t("smartApply.proposal") });
      for (const row of setRows) this.renderFmRow(setBox, row, p);
    }

    if (mutedRows.length > 0) {
      const empty = mutedRows.filter((row) => row.change === "neu").length;
      const unchanged = mutedRows.length - empty;
      const det = sec.createEl("details", { cls: "vault-rag-sa-fm-muted" });
      const parts: string[] = [];
      if (empty > 0) parts.push(t("smartApply.fmEmptyCount", empty));
      if (unchanged > 0) parts.push(t("smartApply.fmUnchangedCount", unchanged));
      det.createEl("summary", { cls: "vault-rag-sa-fm-muted-sum", text: t("smartApply.fmFieldsSummary", parts.join(" · ")) });
      for (const row of mutedRows) this.renderFmRow(det, row, p);
    }
  }

  private renderActions(c: HTMLElement, p: ApplyProposal): void {
    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });

    const apply = bar.createEl("button", { cls: "vault-rag-sa-apply mod-cta", text: t("smartApply.applyBtn") });
    apply.toggleClass("is-disabled", !p.hardOk);
    apply.addEventListener("click", () => { if (p.hardOk) void this.onAccept(p); });

    bar.createEl("button", { cls: "vault-rag-sa-discard", text: t("smartApply.discardBtn") })
      .addEventListener("click", () => this.onDiscard());

    bar.createEl("button", { cls: "vault-rag-sa-reroll", text: t("smartApply.regenerateBtn") })
      .addEventListener("click", () => void this.onReroll(p));

    bar.createEl("button", { cls: "vault-rag-sa-open-tpl", text: t("smartApply.openTemplate") })
      .addEventListener("click", () => this.deps.openPath(p.templatePath));
  }

  private renderReasoning(c: HTMLElement, reasoning: string): void {
    if (!reasoning) return;
    const det = c.createEl("details", { cls: "vault-rag-sa-reasoning" });
    det.open = false;
    det.createEl("summary", { cls: "vault-rag-sa-reasoning-sum", text: t("smartApply.reasoningSummary") });
    det.createDiv({ cls: "vault-rag-sa-reasoning-body", text: reasoning });
  }

  // ── Body: applied ─────────────────────────────────────────────────────────────

  private renderApplied(c: HTMLElement): void {
    const path = this.proposal?.notePath ?? "";
    const name = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    const box = c.createDiv({ cls: "vault-rag-sa-applied" });
    box.toggleClass("is-ok", !this.undone);
    box.toggleClass("is-undone", this.undone);
    // Status über Text + Icon-Form kodiert (nicht Farbe) — WCAG 1.4.1.
    box.setText(this.undone ? t("smartApply.undone", name) : t("smartApply.applied", name));
    const icon = box.createSpan({ cls: "vault-rag-sa-applied-icon" });
    setIcon(icon, this.undone ? "undo-2" : "check");

    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });
    // EIN Toggle-Button: nach dem Anwenden „Rückgängig", nach einem Undo „Wiederherstellen".
    const toggleBtn = bar.createEl("button", {
      cls: "vault-rag-sa-undo",
      text: this.undone ? t("smartApply.restore") : t("smartApply.undo"),
    });
    toggleBtn.toggleClass("is-redo", this.undone);
    const canAct = this.undone ? !!this.lastRedo : !!this.lastUndo;
    toggleBtn.toggleClass("is-disabled", !canAct);
    toggleBtn.addEventListener("click", () => {
      if (this.undone) { if (this.lastRedo) void this.onRedo(); }
      else { if (this.lastUndo) void this.onUndo(); }
    });
  }

  // ── Body: stale ───────────────────────────────────────────────────────────────

  private renderStale(c: HTMLElement): void {
    const box = c.createDiv({ cls: "vault-rag-sa-stale" });
    box.setText(t("smartApply.noteChanged"));

    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });
    bar.createEl("button", { cls: "vault-rag-sa-rebuild mod-cta", text: t("smartApply.rebuildApply") })
      .addEventListener("click", () => void this.onRebuild());

    bar.createEl("button", { cls: "vault-rag-sa-discard", text: t("smartApply.discardBtn") })
      .addEventListener("click", () => this.onDiscard());
  }

  // ── Body: error ───────────────────────────────────────────────────────────────

  private renderError(c: HTMLElement): void {
    const box = c.createDiv({ cls: "vault-rag-sa-error" });
    box.setText(this.errorText || t("smartApply.genericError"));
    c.createDiv({ cls: "vault-rag-sa-actions" })
      .createEl("button", { cls: "vault-rag-sa-discard", text: t("smartApply.back") })
      .addEventListener("click", () => this.onDiscard());
  }

  // ── Run timer ─────────────────────────────────────────────────────────────────

  private startTimer(): void {
    this.workStart = Date.now();
    const tick = (): void => {
      if (this.elapsedEl) {
        this.elapsedEl.setText(t("smartApply.working", ((Date.now() - this.workStart) / 1000).toFixed(1)));
      }
    };
    tick();
    this.timer = window.setInterval(tick, 100);
  }

  private stopTimer(): void {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
  }

  // ── Behaviors ───────────────────────────────────────────────────────────────

  /** Baut proposedText aus der aktuellen granularen Auswahl neu zusammen — ohne LLM-Call. */
  private reassemble(): void {
    if (this.proposal) {
      this.proposal.proposedText = assembleProposedText(this.proposal.assembly, this.selection, this.auditTrail);
      this.render();
    }
  }

  /** "Auf aktive Notiz anwenden" handler. Never throws. */
  async start(): Promise<void> {
    const path = this.deps.activeNotePath();
    if (path === null) {
      new Notice(t("smartApply.noActiveNote"));
      return;
    }
    const templatePath = this.selectedTemplate;
    await this.runBuild(() => this.deps.build(path, templatePath, this.selectedMode, (chunk) => this.onToken(chunk), (chunk) => this.onReasoning(chunk)));
  }

  /** Shared build→diff pipeline used by start(), reroll() and stale-rebuild. */
  private async runBuild(builder: () => Promise<ApplyProposal>): Promise<void> {
    this.streamText = "";
    this.reasoningText = "";
    this.templateHint = "";
    this.proposal = null;
    this.lastUndo = null;
    this.lastRedo = null;
    this.undone = false;
    this.state = "running";
    this.render();
    this.startTimer();
    try {
      const proposal = await builder();
      this.proposal = proposal;
      this.selection = defaultSelection(proposal.assembly);
      // I1 (WYSIWYG): propose() hardcodes the preview with auditTrail=false; reconcile it here
      // with the live toggle so a fresh build's preview never disagrees with what persistApply()
      // will actually write (which always uses this.auditTrail). Pure re-assembly, no new stream.
      proposal.proposedText = assembleProposedText(proposal.assembly, this.selection, this.auditTrail);
      this.state = "diff";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "abgebrochen") {
        this.errorText = t("smartApply.discardedState");
        this.state = "error";
      } else if (msg === "vorlage-waehlen" || msg === "keine-vorlage") {
        this.state = "idle";
        this.errorText = "";
        this.templateHint = t("smartApply.autoDetectFailed");
      } else {
        this.errorText = msg;
        new Notice(t("smartApply.error", msg));
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
      const res = await this.deps.accept(p, this.selection, this.auditTrail);
      if (res.written) {
        this.lastUndo = res.undo ?? null;
        this.lastRedo = res.redo ?? null;
        this.undone = false;
        this.state = "applied";
      } else if (res.reason === "stale") {
        this.state = "stale";
      }
      // reason === "blocked" → stay in diff (guard banner already explains it)
    } catch (e) {
      new Notice(t("smartApply.error", e instanceof Error ? e.message : String(e)));
    } finally {
      this.accepting = false;
    }
    this.render();
  }

  private onDiscard(): void {
    this.proposal = null;
    this.lastUndo = null;
    this.lastRedo = null;
    this.undone = false;
    this.streamText = "";
    this.reasoningText = "";
    this.errorText = "";
    this.templateHint = "";
    this.state = "idle";
    this.render();
  }

  private async onReroll(p: ApplyProposal): Promise<void> {
    const templatePath = this.selectedTemplate || p.templatePath;
    await this.runBuild(() => this.deps.reroll(p, templatePath, this.selectedMode, (chunk) => this.onToken(chunk), (chunk) => this.onReasoning(chunk)));
  }

  /** Stale rebuild: re-build against current note, accept again if hardOk. */
  private async onRebuild(): Promise<void> {
    const path = this.proposal?.notePath ?? this.deps.activeNotePath();
    if (path === null || path === undefined) {
      new Notice(t("smartApply.noActiveNote"));
      this.state = "idle";
      this.render();
      return;
    }
    const templatePath = this.selectedTemplate || (this.proposal?.templatePath ?? "");
    await this.runBuild(() => this.deps.build(path, templatePath, this.selectedMode, (chunk) => this.onToken(chunk), (chunk) => this.onReasoning(chunk)));
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
      new Notice(t("smartApply.error", e instanceof Error ? e.message : String(e)));
      return; // Write fehlgeschlagen → Zustand nicht togglen (bliebe sonst inkonsistent zur Platte)
    }
    // Im applied-Zustand bleiben, aber als „rückgängig gemacht" — der Button wird zu Redo.
    this.undone = true;
    this.render();
  }

  private async onRedo(): Promise<void> {
    const redo = this.lastRedo;
    if (!redo) return;
    try {
      await redo();
    } catch (e) {
      new Notice(t("smartApply.error", e instanceof Error ? e.message : String(e)));
      return;
    }
    this.undone = false;
    this.render();
  }
}
