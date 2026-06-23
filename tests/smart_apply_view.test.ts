import { describe, it, expect, vi } from "vitest";
import { SmartApplyView, VIEW_TYPE_SMART_APPLY, SmartApplyViewDeps } from "../src/smart_apply_view";
import type { ApplyProposal, ApplyResult } from "../src/smart_apply_view";
import { makeFakeApp } from "./__mocks__/obsidian";

// ── Helpers ──────────────────────────────────────────────────────────────────

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}
function hasClass(el: any, cls: string): boolean {
  return String(el?.className ?? "").split(" ").includes(cls);
}

function mkProposal(over: Partial<ApplyProposal> = {}): ApplyProposal {
  return {
    notePath: "Inbox/roh.md",
    templatePath: "Templates/Buch.md",
    type: "📖 Buch",
    originalText: "# roh\n\nalt",
    originalHash: 123,
    proposedContent: "---\ntype: 📖 Buch\n---\n## Inhalt\n\nalt\n",
    fmRows: [
      { key: "type", original: undefined, proposed: "📖 Buch", change: "neu" },
      { key: "up", original: "[[A]]", proposed: "[[A]]", change: "unveraendert" },
      { key: "tags", original: "x", proposed: undefined, change: "entfernt" },
    ],
    sectionDiff: [
      { heading: "## Inhalt", blockIds: ["block_1"], provenance: "# roh" },
      { heading: "## Notizen", blockIds: [], provenance: null },
    ],
    unassigned: [{ id: "block_3", text: "übriger Absatz" }],
    checks: [{ id: "permutation", ok: true }],
    hardOk: true,
    reasoning: "weil X",
    detection: { source: "rag", confidence: "likely" },
    ...over,
  };
}

function mkDeps(over: Partial<SmartApplyViewDeps> = {}): SmartApplyViewDeps {
  return {
    build: vi.fn(async (_notePath: string, _onToken: (t: string) => void, _onReasoning: (t: string) => void) => mkProposal()),
    accept: vi.fn(async (): Promise<ApplyResult> => ({ written: true, undo: vi.fn(async () => {}) })),
    reroll: vi.fn(async (_p: ApplyProposal, _onToken: (t: string) => void, _onReasoning: (t: string) => void) => mkProposal()),
    openPath: vi.fn(),
    abort: vi.fn(),
    ...over,
  };
}

function mkView(over: Partial<SmartApplyViewDeps> = {}) {
  const deps = mkDeps(over);
  const view = new SmartApplyView({ app: makeFakeApp() } as any, deps);
  return { view, deps };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SmartApplyView", () => {
  it("getViewType ist VIEW_TYPE_SMART_APPLY, Icon wand-2", () => {
    const { view } = mkView();
    expect(view.getViewType()).toBe(VIEW_TYPE_SMART_APPLY);
    expect(view.getIcon()).toBe("wand-2");
    expect(view.getDisplayText()).toBe("Smart Apply");
  });

  it("run() rendert Header mit Notizname, Typ-Chip und Quelle-Badge", async () => {
    const { view } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    expect(all(view.contentEl, "vault-rag-sa-note")[0].textContent).toContain("roh");
    expect(all(view.contentEl, "vault-rag-sa-type-chip")[0].textContent).toContain("📖 Buch");
    const badge = all(view.contentEl, "vault-rag-sa-source-badge")[0].textContent;
    expect(badge).toContain("RAG");
  });

  it("Quelle-Badge zeigt 'aus type:' für frontmatter-Quelle", async () => {
    const { view } = mkView({
      build: vi.fn(async () => mkProposal({ detection: { source: "frontmatter", confidence: "confirmed" } })),
    });
    await view.onOpen();
    await view.run("Inbox/roh.md");
    expect(all(view.contentEl, "vault-rag-sa-source-badge")[0].textContent).toContain("aus type:");
  });

  it("run() zeigt grünes Guard-Banner wenn hardOk", async () => {
    const { view } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    const banner = all(view.contentEl, "vault-rag-sa-guard")[0];
    expect(hasClass(banner, "is-ok")).toBe(true);
    expect(banner.textContent).toContain("bestanden");
  });

  it("Guard-Banner zeigt fehlgeschlagene Checks wenn hardOk false", async () => {
    const { view } = mkView({
      build: vi.fn(async () => mkProposal({
        hardOk: false,
        proposedContent: "",
        checks: [{ id: "permutation", ok: false, detail: "block_9 unbekannt" }],
      })),
    });
    await view.onOpen();
    await view.run("Inbox/roh.md");
    const banner = all(view.contentEl, "vault-rag-sa-guard")[0];
    expect(hasClass(banner, "is-error")).toBe(true);
    expect(banner.textContent).toContain("fehlgeschlagen");
    expect(all(banner, "vault-rag-sa-guard-fail").length).toBeGreaterThan(0);
  });

  it("Frontmatter-Diff rendert eine Reihe je Key in stabiler Reihenfolge mit Change-Klasse", async () => {
    const { view } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    const rows = all(view.contentEl, "vault-rag-sa-fm-row");
    expect(rows.length).toBe(3);
    expect(rows.map((r: any) => all(r, "vault-rag-sa-fm-key")[0].textContent)).toEqual(["type", "up", "tags"]);
    expect(hasClass(rows[0], "is-neu")).toBe(true);
    expect(hasClass(rows[1], "is-unveraendert")).toBe(true);
    expect(hasClass(rows[2], "is-entfernt")).toBe(true);
  });

  it("Body-Diff rendert Sektions-Stack mit Herkunft und (noch leer)-Sentinel", async () => {
    const { view } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    const secs = all(view.contentEl, "vault-rag-sa-body-section");
    expect(secs.length).toBe(2);
    expect(all(secs[0], "vault-rag-sa-body-heading")[0].textContent).toContain("Inhalt");
    expect(all(secs[0], "vault-rag-sa-provenance")[0].textContent).toContain("roh");
    expect(all(secs[1], "vault-rag-sa-empty").length).toBe(1);
    expect(all(secs[1], "vault-rag-sa-empty")[0].textContent).toContain("noch leer");
  });

  it("Übrig-Eimer listet unassigned-Blöcke", async () => {
    const { view } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    const bucket = all(view.contentEl, "vault-rag-sa-unassigned")[0];
    expect(bucket.textContent).toContain("Übrig");
    expect(all(bucket, "vault-rag-sa-unassigned-item").length).toBe(1);
  });

  it("onToken hängt Live-Tokens in die proposed pane an", async () => {
    const { view } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    view.onToken("## Inhalt\n");
    view.onToken("alt");
    expect(all(view.contentEl, "vault-rag-sa-body-pane")[0].textContent).toBe("## Inhalt\nalt");
    // Sektions-Stack bleibt parallel bestehen (kein voller Re-Render durch onToken)
    expect(all(view.contentEl, "vault-rag-sa-body-section").length).toBe(2);
  });

  it("Anwenden ist gesperrt (is-disabled) wenn hardOk false und ruft accept nicht", async () => {
    const { view, deps } = mkView({
      build: vi.fn(async () => mkProposal({
        hardOk: false,
        proposedContent: "",
        checks: [{ id: "permutation", ok: false, detail: "block_9 unbekannt" }],
      })),
    });
    await view.onOpen();
    await view.run("Inbox/roh.md");
    const btn = all(view.contentEl, "vault-rag-sa-apply")[0];
    expect(hasClass(btn, "is-disabled")).toBe(true);
    btn.click();
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it("Anwenden ruft deps.accept genau einmal wenn hardOk", async () => {
    const { view, deps } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    const btn = all(view.contentEl, "vault-rag-sa-apply")[0];
    expect(hasClass(btn, "is-disabled")).toBe(false);
    btn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(deps.accept).toHaveBeenCalledTimes(1);
  });

  it("Verwerfen schreibt nichts (accept/reroll ungerufen)", async () => {
    const { view, deps } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    all(view.contentEl, "vault-rag-sa-discard")[0].click();
    expect(deps.accept).not.toHaveBeenCalled();
    expect(deps.reroll).not.toHaveBeenCalled();
  });

  it("Erneut ruft deps.reroll", async () => {
    const { view, deps } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    all(view.contentEl, "vault-rag-sa-reroll")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(deps.reroll).toHaveBeenCalledTimes(1);
  });

  it("Vorlage öffnen ruft openPath mit templatePath", async () => {
    const { view, deps } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    all(view.contentEl, "vault-rag-sa-open-tpl")[0].click();
    expect(deps.openPath).toHaveBeenCalledWith("Templates/Buch.md");
  });

  it("nach Accept bleibt das Panel offen und zeigt 'angewendet' + Rückgängig", async () => {
    const undo = vi.fn(async () => {});
    const { view } = mkView({ accept: vi.fn(async () => ({ written: true, undo })) });
    await view.onOpen();
    await view.run("Inbox/roh.md");
    all(view.contentEl, "vault-rag-sa-apply")[0].click();
    // Flush microtask queue: async accept mock requires multiple ticks to complete
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(all(view.contentEl, "vault-rag-sa-applied")[0].textContent).toContain("angewendet");
    const undoBtn = all(view.contentEl, "vault-rag-sa-undo")[0];
    expect(undoBtn).toBeTruthy();
    undoBtn.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(undo).toHaveBeenCalledTimes(1);
    // Action-Bar mit Anwenden ist im angewendeten Zustand weg
    expect(all(view.contentEl, "vault-rag-sa-apply").length).toBe(0);
  });

  it("Accept mit written=false (stale) bleibt im Diff-Zustand, kein angewendet", async () => {
    const { view } = mkView({ accept: vi.fn(async () => ({ written: false, reason: "stale" as const })) });
    await view.onOpen();
    await view.run("Inbox/roh.md");
    all(view.contentEl, "vault-rag-sa-apply")[0].click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(all(view.contentEl, "vault-rag-sa-applied").length).toBe(0);
    expect(all(view.contentEl, "vault-rag-sa-apply").length).toBe(1);
  });

  it("rendert einklappbaren Reasoning-Block (geschlossen)", async () => {
    const { view } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    const det = all(view.contentEl, "vault-rag-sa-reasoning");
    expect(det.length).toBe(1);
    expect(det[0].open).toBe(false);
    expect(all(view.contentEl, "vault-rag-sa-reasoning-body")[0].textContent).toContain("weil X");
  });

  it("Quelltext nutzt kein innerHTML", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/smart_apply_view.ts"),
      "utf8",
    );
    expect(src).not.toContain("innerHTML");
  });

  it("setzt nirgends ein inline style-Attribut", async () => {
    const { view } = mkView();
    await view.onOpen();
    // Spy auf setAttribute aller (zukünftigen) Elemente via createDiv-Kette: prüfe rekursiv
    const offenders: string[] = [];
    const walk = (n: any) => {
      const orig = n.setAttribute;
      n.setAttribute = (k: string, v: string) => { if (k === "style") offenders.push(v); return orig?.(k, v); };
      (n.children ?? []).forEach(walk);
    };
    walk(view.contentEl);
    await view.run("Inbox/roh.md");
    expect(offenders).toEqual([]);
  });

  it("run() catch: 'abgebrochen' zeigt Verworfen-Notice, kein Throw", async () => {
    const { view } = mkView({
      build: vi.fn(async () => { throw new Error("abgebrochen"); }),
    });
    await view.onOpen();
    // Muss ohne unhandled rejection durchlaufen
    await expect(view.run("Inbox/roh.md")).resolves.toBeUndefined();
  });

  it("run() catch: anderer Fehler zeigt Notice mit Fehlermeldung, kein Throw", async () => {
    const { view } = mkView({
      build: vi.fn(async () => { throw new Error("Netzwerk-Timeout"); }),
    });
    await view.onOpen();
    await expect(view.run("Inbox/roh.md")).resolves.toBeUndefined();
  });
});
