// Sechster Hub-Tab: Review-Inbox des Integrators (Spec §7). Einziger obsidian-Import: setIcon.
// Bausteine nach UI-STANDARD §8: Info-Karte (Rezept vault-crews renderSummary), Listen-Zeile
// ueber renderHits (view.ts), Empty-State mit genau einem CTA, Status-Indikator is-checking.
import { setIcon } from "obsidian";
import type { HubPanel, TabId } from "./hub_panel";
import type { LinkProposal } from "./integrator_store";
import { renderHits } from "./view";
import { t } from "./vendor/kit/i18n";

export type AcceptOutcome =
  | { kind: "written" } | { kind: "unchanged" } | { kind: "stale" } | { kind: "error"; reason: string };

export interface IntegratorPanelDeps {
  list(): LinkProposal[];
  activePath(): string | null;
  openPath(path: string): void;
  accept(path: string, target: string): Promise<AcceptOutcome>;
  reject(path: string, target: string): Promise<void>;
  recompute(path: string): Promise<void>;
  proposeActive(): Promise<void>;
  proposeScope(): Promise<void>;
  isBusy(): boolean;
  notify(text: string): void;
}

function nameOf(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

export class IntegratorPanel implements HubPanel {
  readonly id: TabId = "integrator";
  get label(): string { return t("panel.integrator.label"); }
  readonly icon = "link";
  private container!: HTMLElement;
  private activePath: string | null = null;
  private pending = false;

  constructor(private deps: IntegratorPanelDeps) {}

  mount(container: HTMLElement): void { this.container = container; this.activePath = this.deps.activePath(); this.refresh(); }
  onFileOpen(path: string | null): void { this.activePath = path; this.refresh(); }
  destroy(): void {}

  refresh(): void {
    const c = this.container; c.empty();
    const items = this.sorted(this.deps.list());
    this.renderHead(c, items.length);
    if (items.length === 0) {
      const empty = c.createDiv({ cls: "vault-rag-empty", text: t("panel.integrator.empty") });
      const cta = this.button(empty, "mod-cta", t("panel.integrator.proposeActive"));
      cta.addEventListener("click", () => void this.run(() => this.deps.proposeActive()));
      return;
    }
    for (const p of items) this.renderCard(c, p);
  }

  /** Einzige Stelle, an der ein Button entsteht — sperrt ihn sofort mit, solange eine
   *  Aktion läuft (Doppelklick-Schutz nach dem `reformat_panel.ts`-Muster). */
  private button(parent: HTMLElement, cls: string, text: string): HTMLButtonElement {
    const b = parent.createEl("button", { cls, text });
    b.disabled = this.pending;
    return b;
  }

  private sorted(list: LinkProposal[]): LinkProposal[] {
    return [...list].sort((a, b) => {
      if (a.notePath === this.activePath) return -1;
      if (b.notePath === this.activePath) return 1;
      return b.createdAt - a.createdAt;
    });
  }

  private renderHead(c: HTMLElement, n: number): void {
    const head = c.createDiv({ cls: "vault-rag-int-head" });
    head.createSpan({ cls: "vault-rag-int-count", text: t("panel.integrator.count", String(n)) });
    const active = this.button(head, "", t("panel.integrator.proposeActive"));
    active.addEventListener("click", () => void this.run(() => this.deps.proposeActive()));
    const scope = this.button(head, "", t("panel.integrator.proposeScope"));
    scope.addEventListener("click", () => void this.run(() => this.deps.proposeScope()));
    if (this.deps.isBusy()) {
      const st = head.createSpan({ cls: "vault-rag-int-status is-checking", attr: { "aria-label": t("panel.integrator.busy") } });
      setIcon(st, "loader");
    }
  }

  private renderCard(c: HTMLElement, p: LinkProposal): void {
    const card = c.createDiv({ cls: "vault-rag-int-card" });
    const title = card.createEl("h3", { cls: "vault-rag-int-card-title", text: nameOf(p.notePath) });
    title.addEventListener("click", () => this.deps.openPath(p.notePath));
    card.createDiv({ cls: "vault-rag-int-card-meta", text: t("panel.integrator.meta", String(p.links.length)) });
    if (p.stale) {
      const warn = card.createDiv({ cls: "vault-rag-int-stale" });
      const icon = warn.createSpan({ cls: "vault-rag-int-stale-icon" });
      setIcon(icon, "alert-triangle");
      warn.createSpan({ text: t("panel.integrator.stale") });
      const re = this.button(warn, "vault-rag-int-recompute", t("panel.integrator.recompute"));
      re.addEventListener("click", () => void this.run(() => this.deps.recompute(p.notePath)));
    }
    renderHits(card, p.links, path => this.deps.openPath(path), (row, hit) => {
      const acts = row.createSpan({ cls: "vault-rag-int-row-actions" });
      const ok = this.button(acts, "mod-cta vault-rag-int-accept", t("panel.integrator.accept"));
      ok.addEventListener("click", () => void this.run(() => this.acceptOne(p.notePath, hit.path)));
      const no = this.button(acts, "vault-rag-int-reject", t("panel.integrator.reject"));
      no.addEventListener("click", () => void this.run(() => this.deps.reject(p.notePath, hit.path)));
    });
    const actions = card.createDiv({ cls: "vault-rag-int-card-actions" });
    const all = this.button(actions, "vault-rag-int-accept-all", t("panel.integrator.acceptAll"));
    all.addEventListener("click", () => void this.run(async () => { for (const l of p.links) await this.acceptOne(p.notePath, l.path); }));
    const none = this.button(actions, "vault-rag-int-reject-all", t("panel.integrator.rejectAll"));
    none.addEventListener("click", () => void this.run(async () => { for (const l of p.links) await this.deps.reject(p.notePath, l.path); }));
  }

  private async acceptOne(path: string, target: string): Promise<void> {
    const r = await this.deps.accept(path, target);
    if (r.kind === "stale") this.deps.notify(t("integrator.reason.stale"));
    else if (r.kind === "error") {
      // Dynamischer Key (Code aus AcceptOutcome) — bewusst nicht als t()-Literal geschrieben,
      // sonst würde der i18n-Key-Guard (der Backtick-Inhalte wörtlich prüft) ihn als unbekannten
      // Key melden. Vollständigkeit sichert stattdessen der dedizierte Test in
      // integrator_panel.test.ts ("jeder WriteResult-/Accept-Fehlercode hat einen i18n-Key").
      const reasonKey = `integrator.reason.${r.reason}`;
      this.deps.notify(t(reasonKey));
    }
  }

  /** Jede Aktion zeichnet danach neu — der Store ist die Wahrheit, das Panel nur ihre Sicht.
   *  Doppelklick-Schutz: läuft schon eine Aktion, verpufft ein zweiter Aufruf (Muster aus
   *  `reformat_panel.ts` — dort per `disabled`-Button, hier zusätzlich hart im Guard, weil
   *  der Klick auch über einen bereits gerenderten, noch nicht neu gezeichneten Button kommen
   *  kann). */
  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    try { await fn(); }
    catch (e) { console.error("[vault-rag] integrator panel", e); this.deps.notify(t("integrator.reason.write-failed")); }
    finally { this.pending = false; this.refresh(); }
  }
}
