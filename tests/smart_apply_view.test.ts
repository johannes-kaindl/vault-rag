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
function first(el: any, cls: string): any {
  return all(el, cls)[0];
}
async function flush(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function mkProposal(over: Partial<ApplyProposal> = {}): ApplyProposal {
  return {
    notePath: "Inbox/roh.md",
    templatePath: "Templates/Buch.md",
    type: "📖 Buch",
    originalText: "# roh\n\nalt",
    proposedText: "---\ntype: 📖 Buch\n---\n## Inhalt\n\nalt\n",
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
    build: vi.fn(async (_notePath: string, _templatePath: string, _onToken: (t: string) => void, _onReasoning: (t: string) => void) => mkProposal()),
    accept: vi.fn(async (): Promise<ApplyResult> => ({ written: true, undo: vi.fn(async () => {}) })),
    reroll: vi.fn(async (_p: ApplyProposal, _templatePath: string, _onToken: (t: string) => void, _onReasoning: (t: string) => void) => mkProposal()),
    openPath: vi.fn(),
    abort: vi.fn(),
    activeNotePath: vi.fn(() => "Inbox/roh.md"),
    listModels: vi.fn(async () => ["fast-model", "smart-model"]),
    getModel: vi.fn(() => "fast-model"),
    setModel: vi.fn(),
    listTemplates: vi.fn(async () => ["Templates/Buch.md", "Templates/Film.md"]),
    getSuppress: vi.fn(() => false),
    setSuppress: vi.fn(),
    ping: vi.fn(async () => true),
    ...over,
  };
}

function mkView(over: Partial<SmartApplyViewDeps> = {}) {
  const deps = mkDeps(over);
  const view = new SmartApplyView({ app: makeFakeApp() } as any, deps);
  return { view, deps };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SmartApplyView — Cockpit", () => {
  it("getViewType ist VIEW_TYPE_SMART_APPLY, Icon wand-2", () => {
    const { view } = mkView();
    expect(view.getViewType()).toBe(VIEW_TYPE_SMART_APPLY);
    expect(view.getIcon()).toBe("wand-2");
    expect(view.getDisplayText()).toBe("Smart Apply");
  });

  // Step 1 — Header immer sichtbar
  it("render() emittiert immer die Header-Elemente (Modell/Verbindung/💭/Template/Run/Stop)", async () => {
    const { view } = mkView();
    await view.onOpen();
    expect(first(view.contentEl, "vault-rag-sa-model")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-conn")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-think")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-template")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-run")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-stop")).toBeTruthy();
  });

  it("Modell-Select füllt sich aus listModels und setzt setModel bei Wechsel", async () => {
    const { view, deps } = mkView();
    await view.onOpen();
    await flush();
    const sel = first(view.contentEl, "vault-rag-sa-model");
    expect(sel.children.length).toBe(2);
    sel.value = "smart-model";
    (sel._listeners?.change ?? []).forEach((cb: any) => cb());
    expect(deps.setModel).toHaveBeenCalledWith("smart-model");
  });

  it("💭-Toggle ruft setSuppress (toggelt getSuppress)", async () => {
    const { view, deps } = mkView({ getSuppress: vi.fn(() => false) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-think").click();
    expect(deps.setSuppress).toHaveBeenCalledWith(true);
  });

  it("Verbindungspunkt spiegelt ping()=true als verbunden", async () => {
    const { view } = mkView({ ping: vi.fn(async () => true) });
    await view.onOpen();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-conn").textContent).toContain("verbunden");
  });

  it("Verbindungspunkt spiegelt ping()=false als offline", async () => {
    const { view } = mkView({ ping: vi.fn(async () => false) });
    await view.onOpen();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-conn").textContent).toContain("offline");
  });

  // Step 2 — idle body
  it("idle-Body zeigt Platzhaltertext", async () => {
    const { view } = mkView();
    await view.onOpen();
    expect(first(view.contentEl, "vault-rag-sa-idle")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-idle").textContent).toContain("Auf aktive Notiz anwenden");
  });

  // Step 3 — start() null path
  it("start() ohne aktive Notiz zeigt Notice und bleibt idle", async () => {
    const { view, deps } = mkView({ activeNotePath: vi.fn(() => null) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    expect(deps.build).not.toHaveBeenCalled();
    expect(first(view.contentEl, "vault-rag-sa-idle")).toBeTruthy();
  });

  // Step 4 — start() valid path → running
  it("start() mit aktiver Notiz geht in running und ruft build mit dem Pfad", async () => {
    let resolveBuild: (p: ApplyProposal) => void = () => {};
    const build = vi.fn((_path: string, _templatePath: string) => new Promise<ApplyProposal>((res) => { resolveBuild = res; }));
    const { view } = mkView({ build: build as unknown as SmartApplyViewDeps["build"] });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush(2);
    expect(build).toHaveBeenCalledWith("Inbox/roh.md", expect.any(String), expect.any(Function), expect.any(Function));
    expect(first(view.contentEl, "vault-rag-sa-running")).toBeTruthy();
    // Aufräumen: build auflösen, damit kein hängender Timer bleibt
    resolveBuild(mkProposal());
    await flush();
  });

  // Step 5 — onToken / onReasoning append
  it("onToken/onReasoning hängen Live-Text in Roh-Stream-pre bzw. 💭-details an", async () => {
    let tok: (t: string) => void = () => {};
    let rsn: (t: string) => void = () => {};
    const build = vi.fn((_path: string, _templatePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void) =>
      new Promise<ApplyProposal>(() => { tok = onToken; rsn = onReasoning; }));
    const { view } = mkView({ build: build as unknown as SmartApplyViewDeps["build"] });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush(2);
    tok("## Inhalt\n"); tok("alt");
    rsn("denke nach…");
    expect(first(view.contentEl, "vault-rag-sa-stream").textContent).toBe("## Inhalt\nalt");
    expect(first(view.contentEl, "vault-rag-sa-reasoning-body").textContent).toContain("denke nach");
  });

  // Step 6 — build resolve → diff
  it("build()-Resolve geht in den Diff-Zustand mit dem Proposal", async () => {
    const { view } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-diff")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-apply")).toBeTruthy();
    // Zwei-Flächen-Diff zeigt original + proposed
    expect(first(view.contentEl, "vault-rag-sa-orig")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-prop")).toBeTruthy();
  });

  it("Diff zeigt grünes Guard-Banner wenn hardOk", async () => {
    const { view } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    const banner = first(view.contentEl, "vault-rag-sa-guard");
    expect(hasClass(banner, "is-ok")).toBe(true);
  });

  // Step 7 — Anwenden disabled + guard banner
  it("Diff: Anwenden ist gesperrt (is-disabled) und Guard listet fehlgeschlagene Checks wenn !hardOk", async () => {
    const { view, deps } = mkView({
      build: vi.fn(async () => mkProposal({
        hardOk: false,
        checks: [
          { id: "permutation", ok: false, detail: "block_9 unbekannt" },
          { id: "fm-roundtrip", ok: true },
        ],
      })),
    });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    const btn = first(view.contentEl, "vault-rag-sa-apply");
    expect(hasClass(btn, "is-disabled")).toBe(true);
    btn.click();
    await flush();
    expect(deps.accept).not.toHaveBeenCalled();
    const banner = first(view.contentEl, "vault-rag-sa-guard");
    expect(hasClass(banner, "is-error")).toBe(true);
    expect(all(banner, "vault-rag-sa-guard-fail").length).toBe(1);
  });

  it("Diff: Anwenden ruft accept genau einmal wenn hardOk", async () => {
    const { view, deps } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    const btn = first(view.contentEl, "vault-rag-sa-apply");
    expect(hasClass(btn, "is-disabled")).toBe(false);
    btn.click();
    await flush();
    expect(deps.accept).toHaveBeenCalledTimes(1);
  });

  // Step 8 — accept written:true → applied
  it("accept{written:true} geht in applied mit Rückgängig-Button", async () => {
    const undo = vi.fn(async () => {});
    const { view } = mkView({ accept: vi.fn(async () => ({ written: true, undo })) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    first(view.contentEl, "vault-rag-sa-apply").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-applied")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-applied").textContent).toContain("angewendet");
    const undoBtn = first(view.contentEl, "vault-rag-sa-undo");
    expect(undoBtn).toBeTruthy();
    undoBtn.click();
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(all(view.contentEl, "vault-rag-sa-apply").length).toBe(0);
  });

  it("applied zeigt den Pfad der Notiz", async () => {
    const { view } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    first(view.contentEl, "vault-rag-sa-apply").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-applied").textContent).toContain("roh");
  });

  // Step 9 — accept written:false stale → stale state
  it("accept{written:false,reason:'stale'} geht in stale mit Rebuild-Button", async () => {
    const { view } = mkView({ accept: vi.fn(async () => ({ written: false, reason: "stale" as const })) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    first(view.contentEl, "vault-rag-sa-apply").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-stale")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-stale").textContent).toContain("geändert");
    expect(first(view.contentEl, "vault-rag-sa-rebuild")).toBeTruthy();
    // nicht mehr im applied/diff
    expect(all(view.contentEl, "vault-rag-sa-applied").length).toBe(0);
    expect(all(view.contentEl, "vault-rag-sa-apply").length).toBe(0);
  });

  it("'Neu erzeugen & anwenden' (stale) re-buildet gegen aktuellen Pfad und akzeptiert bei hardOk", async () => {
    const accept = vi.fn()
      .mockResolvedValueOnce({ written: false, reason: "stale" as const })
      .mockResolvedValueOnce({ written: true, undo: vi.fn(async () => {}) });
    const { view, deps } = mkView({ accept: accept as unknown as SmartApplyViewDeps["accept"] });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    first(view.contentEl, "vault-rag-sa-apply").click();
    await flush();
    // jetzt stale → rebuild
    first(view.contentEl, "vault-rag-sa-rebuild").click();
    await flush(10);
    // build erneut aufgerufen (1× start + 1× rebuild)
    expect((deps.build as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect((deps.build as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe("Inbox/roh.md");
    // zweites accept → written:true → applied
    expect(accept).toHaveBeenCalledTimes(2);
    expect(first(view.contentEl, "vault-rag-sa-applied")).toBeTruthy();
  });

  it("accept-Fehler: kein hängendes running-Flag, Anwenden bleibt klickbar (2. Klick erreicht accept)", async () => {
    const { view, deps } = mkView({ accept: vi.fn(async () => { throw new Error("Schreibfehler"); }) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    first(view.contentEl, "vault-rag-sa-apply").click();
    await flush();
    expect(all(view.contentEl, "vault-rag-sa-applied").length).toBe(0);
    expect(all(view.contentEl, "vault-rag-sa-apply").length).toBe(1);
    first(view.contentEl, "vault-rag-sa-apply").click();
    await flush();
    expect(deps.accept).toHaveBeenCalledTimes(2);
  });

  // Step 10 — Verwerfen → idle
  it("Verwerfen geht zurück nach idle (kein Write)", async () => {
    const { view, deps } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    first(view.contentEl, "vault-rag-sa-discard").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-idle")).toBeTruthy();
    expect(all(view.contentEl, "vault-rag-sa-diff").length).toBe(0);
    expect(deps.accept).not.toHaveBeenCalled();
  });

  // Step 11 — Reroll → new proposal, diff
  it("'Neu würfeln' ruft reroll und rendert wieder Diff", async () => {
    const { view, deps } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    first(view.contentEl, "vault-rag-sa-reroll").click();
    await flush();
    expect(deps.reroll).toHaveBeenCalledTimes(1);
    expect(first(view.contentEl, "vault-rag-sa-diff")).toBeTruthy();
  });

  // Stop / abort
  it("Stop ruft deps.abort", async () => {
    const { view, deps } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-stop").click();
    expect(deps.abort).toHaveBeenCalled();
  });

  // Error path
  it("build wirft 'abgebrochen' → error-Zustand mit 'Verworfen', kein Throw", async () => {
    const { view } = mkView({ build: vi.fn(async () => { throw new Error("abgebrochen"); }) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-error")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-error").textContent).toContain("Verworfen");
  });

  it("build wirft anderen Fehler → error-Zustand zeigt die Meldung, kein Throw", async () => {
    const { view } = mkView({ build: vi.fn(async () => { throw new Error("Netzwerk-Timeout"); }) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-error")).toBeTruthy();
    expect(first(view.contentEl, "vault-rag-sa-error").textContent).toContain("Netzwerk-Timeout");
  });

  // Reasoning details in diff
  it("Diff rendert einklappbaren Reasoning-Block aus proposal.reasoning", async () => {
    const { view } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    const body = first(view.contentEl, "vault-rag-sa-reasoning-body");
    expect(body.textContent).toContain("weil X");
  });

  // Step 12 — Dropdowns survive state transitions (regression for cache bug)
  it("model + template selects behalten Optionen nach State-Übergang (idle→running→diff)", async () => {
    const { view } = mkView();
    await view.onOpen();
    await flush(8);

    // After onOpen + flush: selects should have options
    const modelSelAfterOpen = first(view.contentEl, "vault-rag-sa-model");
    const templateSelAfterOpen = first(view.contentEl, "vault-rag-sa-template");
    expect(modelSelAfterOpen.children.length).toBeGreaterThan(0);
    // template select has at least "automatisch erkennen" + the listed templates
    expect(templateSelAfterOpen.children.length).toBeGreaterThan(1);
    expect(templateSelAfterOpen.children[0].value).toBe("");
    expect(templateSelAfterOpen.children[0].textContent).toContain("automatisch");

    // Trigger state transition: idle → running → diff
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush(8);

    // After diff state: selects must still have options
    const modelSelAfterDiff = first(view.contentEl, "vault-rag-sa-model");
    const templateSelAfterDiff = first(view.contentEl, "vault-rag-sa-template");
    expect(modelSelAfterDiff.children.length).toBeGreaterThan(0);
    expect(templateSelAfterDiff.children.length).toBeGreaterThan(1);
    expect(templateSelAfterDiff.children[0].value).toBe("");
  });

  it("selectedTemplate bleibt über State-Übergang erhalten", async () => {
    const { view } = mkView();
    await view.onOpen();
    await flush(8);

    // Select a template
    const templateSel = first(view.contentEl, "vault-rag-sa-template");
    templateSel.value = "Templates/Buch.md";
    (templateSel._listeners?.change ?? []).forEach((cb: any) => cb());

    // Trigger state transition: idle → running → diff
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush(8);

    // After diff state: template selection must still be preserved
    const templateSelAfterDiff = first(view.contentEl, "vault-rag-sa-template");
    expect(templateSelAfterDiff.value).toBe("Templates/Buch.md");
  });

  // Source-cleanliness
  it("Quelltext nutzt kein innerHTML", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../src/smart_apply_view.ts"), "utf8");
    expect(src).not.toContain("innerHTML");
  });

  it("setzt nirgends ein inline style-Attribut", async () => {
    const { view } = mkView();
    await view.onOpen();
    const offenders: string[] = [];
    const walk = (n: any) => {
      const orig = n.setAttribute;
      n.setAttribute = (k: string, v: string) => { if (k === "style") offenders.push(v); return orig?.(k, v); };
      (n.children ?? []).forEach(walk);
    };
    walk(view.contentEl);
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    expect(offenders).toEqual([]);
  });
});
