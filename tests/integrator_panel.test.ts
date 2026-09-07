import { describe, it, expect, vi } from "vitest";
import { IntegratorPanel, IntegratorPanelDeps } from "../src/integrator_panel";
import { makeFakeEl } from "./__mocks__/obsidian";
import type { LinkProposal } from "../src/integrator_store";
import { EN } from "../src/i18n/strings";
import "../src/i18n/strings";

const flush = () => new Promise<void>(r => setTimeout(r, 0));

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}
const prop = (notePath: string, links: string[], createdAt = 1, stale = false): LinkProposal =>
  ({ notePath, noteHash: 1, createdAt, stale, links: links.map(l => ({ path: l, score: 0.87 })) });

function mk(list: LinkProposal[], over: Partial<IntegratorPanelDeps> = {}) {
  const deps: IntegratorPanelDeps = {
    list: () => list, activePath: () => null, openPath: vi.fn(),
    accept: vi.fn(async () => ({ kind: "written" as const })), reject: vi.fn(async () => {}),
    recompute: vi.fn(async () => {}), proposeActive: vi.fn(async () => {}), proposeScope: vi.fn(async () => {}),
    isBusy: () => false, notify: vi.fn(), ...over,
  };
  const panel = new IntegratorPanel(deps);
  const el = makeFakeEl(); panel.mount(el);
  return { panel, el, deps };
}

describe("IntegratorPanel", () => {
  it("label ist ein Getter (Sprache zur Anzeigezeit)", () => {
    expect(Object.getOwnPropertyDescriptor(IntegratorPanel.prototype, "label")?.get).toBeTypeOf("function");
  });
  it("Leerzustand mit genau einem CTA", () => {
    const { el, deps } = mk([]);
    expect(all(el, "vault-rag-empty").length).toBe(1);
    const cta = all(el, "mod-cta"); expect(cta.length).toBe(1);
    cta[0].click(); expect(deps.proposeActive).toHaveBeenCalled();
  });
  it("eine Karte je Notiz, eine Zeile je Ziel, Annehmen ruft accept(path, target)", async () => {
    const { el, deps } = mk([prop("Notes/A.md", ["Notes/B.md", "Notes/C.md"])]);
    expect(all(el, "vault-rag-int-card").length).toBe(1);
    expect(all(el, "vault-rag-hit").length).toBe(2);
    const accept = all(el, "vault-rag-int-accept");
    expect(accept.length).toBe(2);
    accept[0].click(); await flush();
    expect(deps.accept).toHaveBeenCalledWith("Notes/A.md", "Notes/B.md");
  });
  it("Ablehnen ruft reject; Alle annehmen ruft accept je Ziel", async () => {
    const { el, deps } = mk([prop("Notes/A.md", ["Notes/B.md", "Notes/C.md"])]);
    all(el, "vault-rag-int-reject")[1].click(); await flush();
    expect(deps.reject).toHaveBeenCalledWith("Notes/A.md", "Notes/C.md");
    all(el, "vault-rag-int-accept-all")[0].click(); await flush();
    expect(deps.accept).toHaveBeenCalledTimes(2);
  });
  it("aktive Notiz steht oben, sonst neueste zuerst", () => {
    const { el } = mk([prop("Notes/Old.md", ["x.md"], 1), prop("Notes/New.md", ["x.md"], 9), prop("Notes/Act.md", ["x.md"], 5)],
      { activePath: () => "Notes/Act.md" });
    const heads = all(el, "vault-rag-int-card-title").map(h => h.textContent);
    expect(heads).toEqual(["Act", "New", "Old"]);
  });
  it("stale-Karte trägt Icon + Text + Neu-berechnen, nie nur Farbe", async () => {
    const { el, deps } = mk([prop("Notes/A.md", ["x.md"], 1, true)]);
    const warn = all(el, "vault-rag-int-stale");
    expect(warn.length).toBe(1);
    expect(warn[0].textContent).toContain("changed");
    expect(all(el, "vault-rag-int-stale-icon")[0].getAttribute("data-icon")).toBe("alert-triangle");
    all(el, "vault-rag-int-recompute")[0].click(); await flush();
    expect(deps.recompute).toHaveBeenCalledWith("Notes/A.md");
  });
  it("Kopfzeile zählt und zeigt bewegten Indikator, wenn beschäftigt", () => {
    const { el } = mk([prop("a.md", ["x.md"])], { isBusy: () => true });
    expect(all(el, "vault-rag-int-count")[0].textContent).toContain("1");
    expect(all(el, "is-checking").length).toBe(1);
  });
  it("Klick auf den Kartentitel öffnet die Notiz", () => {
    const { el, deps } = mk([prop("Notes/A.md", ["x.md"])]);
    all(el, "vault-rag-int-card-title")[0].click();
    expect(deps.openPath).toHaveBeenCalledWith("Notes/A.md");
  });
  it("jeder WriteResult-/Accept-Fehlercode hat einen i18n-Key", () => {
    for (const code of ["unlinkable", "block-scalar", "not-a-list", "frontmatter-unparseable", "write-failed", "not-found", "disabled"]) {
      expect((EN as Record<string, string>)[`integrator.reason.${code}`]).toBeTypeOf("string");
    }
  });
  it("ein zweiter Klick, bevor der erste fertig ist, verpufft", async () => {
    let release!: () => void;
    const accept = vi.fn(() => new Promise<{ kind: "written" }>(r => { release = () => r({ kind: "written" }); }));
    const { el, deps } = mk([prop("Notes/A.md", ["Notes/B.md"])], { accept });
    const btn = all(el, "vault-rag-int-accept")[0];
    btn.click(); btn.click();
    expect(deps.accept).toHaveBeenCalledTimes(1);
    release(); await flush();
  });
});
