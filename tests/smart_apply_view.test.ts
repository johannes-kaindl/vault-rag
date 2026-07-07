import { describe, it, expect, vi } from "vitest";
import { SmartApplyPanel, VIEW_TYPE_SMART_APPLY, SmartApplyViewDeps } from "../src/smart_apply_view";
import type { ApplyProposal, ApplyResult } from "../src/smart_apply_view";
import type { AssemblyContext } from "../src/smart_apply";
import { assembleProposedText, defaultSelection } from "../src/smart_apply";
import type { TemplateRank } from "../src/template_ranker";
import type { ApplyMode } from "../src/note_restructurer";
import { makeFakeEl } from "./__mocks__/obsidian";

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
// Höherer Default als früher: onOpen() awaitete früher die komplette initAsync-Kette
// (refreshModels→refreshConn→recomputeRanking) synchron durch. mount() feuert diese Kette
// jetzt nur noch fire-and-forget (void initAsync()) — Tests, die auf das settled Ergebnis
// prüfen, müssen ihr per flush() genug Mikrotask-Ticks geben, um durchzulaufen.
async function flush(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** Minimaler, aber gültiger AssemblyContext — reicht für defaultSelection()/assembleProposedText()
 *  ohne echtes Template/Blocks. Tests, die konkrete inferred-Werte/additions prüfen wollen,
 *  überschreiben `assignment`/`additions` gezielt via `over`. */
function mkAssembly(over: Partial<AssemblyContext> = {}): AssemblyContext {
  return {
    tpl: { type: "📖 Buch", keys: [], fmDefaults: {}, sections: [], defaultMode: "deterministisch", raw: "" },
    original: { data: {}, order: [], body: "" },
    assignment: { version: 1, sections: [], unassigned: [], frontmatter: {} },
    blocks: [],
    additions: [],
    ...over,
  };
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
    mode: "deterministisch",
    additions: [],
    assembly: mkAssembly(),
    selection: { inferredKeys: new Set(), additionIds: new Set() },
    ...over,
  };
}

function mkDeps(over: Partial<SmartApplyViewDeps> = {}): SmartApplyViewDeps {
  return {
    build: vi.fn(async (_notePath: string, _templatePath: string, _mode: ApplyMode, _onToken: (t: string) => void, _onReasoning: (t: string) => void) => mkProposal()),
    accept: vi.fn(async (): Promise<ApplyResult> => ({ written: true, undo: vi.fn(async () => {}) })),
    reroll: vi.fn(async (_p: ApplyProposal, _templatePath: string, _mode: ApplyMode, _onToken: (t: string) => void, _onReasoning: (t: string) => void) => mkProposal()),
    openPath: vi.fn(),
    abort: vi.fn(),
    activeNotePath: vi.fn(() => "Inbox/roh.md"),
    listModels: vi.fn(async () => ["fast-model", "smart-model"]),
    getModel: vi.fn(() => "fast-model"),
    setModel: vi.fn(),
    rankTemplates: vi.fn(async (_notePath: string): Promise<TemplateRank[]> => ranksFixture()),
    getSuppress: vi.fn(() => false),
    setSuppress: vi.fn(),
    ping: vi.fn(async () => true),
    templateDefaultMode: vi.fn(async (_templatePath: string): Promise<ApplyMode> => "deterministisch"),
    ...over,
  };
}

/** Konstruiert + mountet ein SmartApplyPanel in einen frischen makeFakeEl()-Container. */
function mkPanel(over: Partial<SmartApplyViewDeps> = {}) {
  const deps = mkDeps(over);
  const container = makeFakeEl();
  const panel = new SmartApplyPanel(deps);
  panel.mount(container);
  return { panel, container, deps };
}

function ranksFixture(): TemplateRank[] {
  return [
    { templatePath: "Templates/Besprechung.md", type: "Besprechung", score: 0.9, source: "match" },
    { templatePath: "Templates/Buch.md", type: "Buch", score: 0.4, source: "match" },
  ];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SmartApplyPanel — Cockpit", () => {
  it("id/label/icon: smart-apply / Smart Apply / wand-2; VIEW_TYPE_SMART_APPLY bleibt exportiert", () => {
    const { panel } = mkPanel();
    expect(panel.id).toBe("smart-apply");
    expect(panel.icon).toBe("wand-2");
    expect(panel.label).toBe("Smart Apply");
    expect(VIEW_TYPE_SMART_APPLY).toBe("vault-rag-smart-apply");
  });

  // Step 1 — Header immer sichtbar
  it("mount() rendert immer die Header-Elemente (Modell/Verbindung/💭/Rangliste/Run/Stop)", () => {
    const { container } = mkPanel();
    expect(first(container, "vault-rag-sa-model")).toBeTruthy();
    expect(first(container, "vault-rag-sa-conn")).toBeTruthy();
    expect(first(container, "vault-rag-sa-think")).toBeTruthy();
    expect(first(container, "vault-rag-sa-ranklist")).toBeTruthy();
    expect(first(container, "vault-rag-sa-run")).toBeTruthy();
    expect(first(container, "vault-rag-sa-stop")).toBeTruthy();
  });

  it("Modell-Select füllt sich aus listModels und setzt setModel bei Wechsel", async () => {
    const { container, deps } = mkPanel();
    await flush();
    const sel = first(container, "vault-rag-sa-model");
    expect(sel.children.length).toBe(2);
    sel.value = "smart-model";
    (sel._listeners?.change ?? []).forEach((cb: any) => cb());
    expect(deps.setModel).toHaveBeenCalledWith("smart-model");
  });

  it("💭-Toggle ruft setSuppress (toggelt getSuppress)", () => {
    const { container, deps } = mkPanel({ getSuppress: vi.fn(() => false) });
    first(container, "vault-rag-sa-think").click();
    expect(deps.setSuppress).toHaveBeenCalledWith(true);
  });

  it("Verbindungspunkt spiegelt ping()=true als verbunden", async () => {
    const { container } = mkPanel({ ping: vi.fn(async () => true) });
    await flush();
    expect(first(container, "vault-rag-sa-conn").textContent).toContain("verbunden");
  });

  it("Verbindungspunkt spiegelt ping()=false als offline", async () => {
    const { container } = mkPanel({ ping: vi.fn(async () => false) });
    await flush();
    expect(first(container, "vault-rag-sa-conn").textContent).toContain("offline");
  });

  it("Verbindungs-Icon unterscheidet sich je Zustand per Form (nicht nur Farbe)", async () => {
    const ok = mkPanel({ ping: vi.fn(async () => true) });
    await flush();
    const okIcon = first(ok.container, "vault-rag-conn-dot").getAttribute("data-icon");

    const off = mkPanel({ ping: vi.fn(async () => false) });
    await flush();
    const offIcon = first(off.container, "vault-rag-conn-dot").getAttribute("data-icon");

    expect(okIcon).toBeTruthy();
    expect(offIcon).toBeTruthy();
    expect(okIcon).not.toBe(offIcon);   // verbunden vs. offline: distinkte Icon-Form, farbunabhängig lesbar
  });

  it("Verbindungszeile trägt ein barrierefreies aria-label zum erneuten Prüfen", async () => {
    const { container } = mkPanel({ ping: vi.fn(async () => true) });
    await flush();
    expect(first(container, "vault-rag-sa-conn").getAttribute("aria-label")).toBeTruthy();
  });

  it("Verbindungszeile hat einen Refresh-Button, der ping erneut auslöst", async () => {
    const ping = vi.fn(async () => true);
    const { container } = mkPanel({ ping });
    await flush();
    ping.mockClear();
    first(container, "vault-rag-sa-conn-refresh").click();
    await flush();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  // Step 2 — idle body
  it("idle-Body zeigt Platzhaltertext", () => {
    const { container } = mkPanel();
    expect(first(container, "vault-rag-sa-idle")).toBeTruthy();
    expect(first(container, "vault-rag-sa-idle").textContent).toContain("Auf aktive Notiz anwenden");
  });

  // Step 3 — start() null path
  it("start() ohne aktive Notiz zeigt Notice und bleibt idle", async () => {
    const { container, deps } = mkPanel({ activeNotePath: vi.fn(() => null) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(deps.build).not.toHaveBeenCalled();
    expect(first(container, "vault-rag-sa-idle")).toBeTruthy();
  });

  // Step 4 — start() valid path → running
  it("start() mit aktiver Notiz geht in running und ruft build mit dem Pfad", async () => {
    let resolveBuild: (p: ApplyProposal) => void = () => {};
    const build = vi.fn((_path: string, _templatePath: string) => new Promise<ApplyProposal>((res) => { resolveBuild = res; }));
    const { container } = mkPanel({ build: build as unknown as SmartApplyViewDeps["build"] });
    first(container, "vault-rag-sa-run").click();
    await flush(2);
    expect(build).toHaveBeenCalledWith("Inbox/roh.md", expect.any(String), expect.any(String), expect.any(Function), expect.any(Function));
    expect(first(container, "vault-rag-sa-running")).toBeTruthy();
    // Aufräumen: build auflösen, damit kein hängender Timer bleibt
    resolveBuild(mkProposal());
    await flush();
  });

  // Step 5 — onToken / onReasoning append
  it("onToken/onReasoning hängen Live-Text in Roh-Stream-pre bzw. 💭-details an", async () => {
    let tok: (t: string) => void = () => {};
    let rsn: (t: string) => void = () => {};
    const build = vi.fn((_path: string, _templatePath: string, _mode: string, onToken: (t: string) => void, onReasoning: (t: string) => void) =>
      new Promise<ApplyProposal>(() => { tok = onToken; rsn = onReasoning; }));
    const { container } = mkPanel({ build: build as unknown as SmartApplyViewDeps["build"] });
    first(container, "vault-rag-sa-run").click();
    await flush(2);
    tok("## Inhalt\n"); tok("alt");
    rsn("denke nach…");
    expect(first(container, "vault-rag-sa-stream").textContent).toBe("## Inhalt\nalt");
    expect(first(container, "vault-rag-sa-reasoning-body").textContent).toContain("denke nach");
  });

  // Step 6 — build resolve → diff
  it("build()-Resolve geht in den Diff-Zustand mit dem Proposal", async () => {
    const { container } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(first(container, "vault-rag-sa-diff")).toBeTruthy();
    expect(first(container, "vault-rag-sa-apply")).toBeTruthy();
    // Zwei-Flächen-Diff zeigt original + proposed
    expect(first(container, "vault-rag-sa-orig")).toBeTruthy();
    expect(first(container, "vault-rag-sa-prop")).toBeTruthy();
  });

  it("Diff zeigt grünes Guard-Banner wenn hardOk", async () => {
    const { container } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    const banner = first(container, "vault-rag-sa-guard");
    expect(hasClass(banner, "is-ok")).toBe(true);
  });

  // Step 7 — Anwenden disabled + guard banner
  it("Diff: Anwenden ist gesperrt (is-disabled) und Guard listet fehlgeschlagene Checks wenn !hardOk", async () => {
    const { container, deps } = mkPanel({
      build: vi.fn(async () => mkProposal({
        hardOk: false,
        checks: [
          { id: "permutation", ok: false, detail: "block_9 unbekannt" },
          { id: "fm-roundtrip", ok: true },
        ],
      })),
    });
    first(container, "vault-rag-sa-run").click();
    await flush();
    const btn = first(container, "vault-rag-sa-apply");
    expect(hasClass(btn, "is-disabled")).toBe(true);
    btn.click();
    await flush();
    expect(deps.accept).not.toHaveBeenCalled();
    const banner = first(container, "vault-rag-sa-guard");
    expect(hasClass(banner, "is-error")).toBe(true);
    expect(all(banner, "vault-rag-sa-guard-fail").length).toBe(1);
  });

  it("Diff: Anwenden ruft accept genau einmal wenn hardOk", async () => {
    const { container, deps } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    const btn = first(container, "vault-rag-sa-apply");
    expect(hasClass(btn, "is-disabled")).toBe(false);
    btn.click();
    await flush();
    expect(deps.accept).toHaveBeenCalledTimes(1);
  });

  // Step 8 — accept written:true → applied
  it("accept{written:true} geht in applied mit Rückgängig-Button", async () => {
    const undo = vi.fn(async () => {});
    const { container } = mkPanel({ accept: vi.fn(async () => ({ written: true, undo })) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    first(container, "vault-rag-sa-apply").click();
    await flush();
    expect(first(container, "vault-rag-sa-applied")).toBeTruthy();
    expect(first(container, "vault-rag-sa-applied").textContent).toContain("angewendet");
    const undoBtn = first(container, "vault-rag-sa-undo");
    expect(undoBtn).toBeTruthy();
    undoBtn.click();
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(all(container, "vault-rag-sa-apply").length).toBe(0);
  });

  it("applied zeigt den Pfad der Notiz", async () => {
    const { container } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    first(container, "vault-rag-sa-apply").click();
    await flush();
    expect(first(container, "vault-rag-sa-applied").textContent).toContain("roh");
  });

  // Step 9 — accept written:false stale → stale state
  it("accept{written:false,reason:'stale'} geht in stale mit Rebuild-Button", async () => {
    const { container } = mkPanel({ accept: vi.fn(async () => ({ written: false, reason: "stale" as const })) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    first(container, "vault-rag-sa-apply").click();
    await flush();
    expect(first(container, "vault-rag-sa-stale")).toBeTruthy();
    expect(first(container, "vault-rag-sa-stale").textContent).toContain("geändert");
    expect(first(container, "vault-rag-sa-rebuild")).toBeTruthy();
    // nicht mehr im applied/diff
    expect(all(container, "vault-rag-sa-applied").length).toBe(0);
    expect(all(container, "vault-rag-sa-apply").length).toBe(0);
  });

  it("'Neu erzeugen & anwenden' (stale) re-buildet gegen aktuellen Pfad und akzeptiert bei hardOk", async () => {
    const accept = vi.fn()
      .mockResolvedValueOnce({ written: false, reason: "stale" as const })
      .mockResolvedValueOnce({ written: true, undo: vi.fn(async () => {}) });
    const { container, deps } = mkPanel({ accept: accept as unknown as SmartApplyViewDeps["accept"] });
    first(container, "vault-rag-sa-run").click();
    await flush();
    first(container, "vault-rag-sa-apply").click();
    await flush();
    // jetzt stale → rebuild
    first(container, "vault-rag-sa-rebuild").click();
    await flush(10);
    // build erneut aufgerufen (1× start + 1× rebuild)
    expect((deps.build as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect((deps.build as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe("Inbox/roh.md");
    // zweites accept → written:true → applied
    expect(accept).toHaveBeenCalledTimes(2);
    expect(first(container, "vault-rag-sa-applied")).toBeTruthy();
  });

  it("accept-Fehler: kein hängendes running-Flag, Anwenden bleibt klickbar (2. Klick erreicht accept)", async () => {
    const { container, deps } = mkPanel({ accept: vi.fn(async () => { throw new Error("Schreibfehler"); }) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    first(container, "vault-rag-sa-apply").click();
    await flush();
    expect(all(container, "vault-rag-sa-applied").length).toBe(0);
    expect(all(container, "vault-rag-sa-apply").length).toBe(1);
    first(container, "vault-rag-sa-apply").click();
    await flush();
    expect(deps.accept).toHaveBeenCalledTimes(2);
  });

  // Step 10 — Verwerfen → idle
  it("Verwerfen geht zurück nach idle (kein Write)", async () => {
    const { container, deps } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    first(container, "vault-rag-sa-discard").click();
    await flush();
    expect(first(container, "vault-rag-sa-idle")).toBeTruthy();
    expect(all(container, "vault-rag-sa-diff").length).toBe(0);
    expect(deps.accept).not.toHaveBeenCalled();
  });

  // Step 11 — Reroll → new proposal, diff
  it("'Neu generieren' ruft reroll und rendert wieder Diff", async () => {
    const { container, deps } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    first(container, "vault-rag-sa-reroll").click();
    await flush();
    expect(deps.reroll).toHaveBeenCalledTimes(1);
    expect(first(container, "vault-rag-sa-diff")).toBeTruthy();
  });

  // Stop / abort
  it("Stop ruft deps.abort", () => {
    const { container, deps } = mkPanel();
    first(container, "vault-rag-sa-stop").click();
    expect(deps.abort).toHaveBeenCalled();
  });

  // Error path
  it("build wirft 'abgebrochen' → error-Zustand mit 'Verworfen', kein Throw", async () => {
    const { container } = mkPanel({ build: vi.fn(async () => { throw new Error("abgebrochen"); }) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(first(container, "vault-rag-sa-error")).toBeTruthy();
    expect(first(container, "vault-rag-sa-error").textContent).toContain("Verworfen");
  });

  it("build wirft anderen Fehler → error-Zustand zeigt die Meldung, kein Throw", async () => {
    const { container } = mkPanel({ build: vi.fn(async () => { throw new Error("Netzwerk-Timeout"); }) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(first(container, "vault-rag-sa-error")).toBeTruthy();
    expect(first(container, "vault-rag-sa-error").textContent).toContain("Netzwerk-Timeout");
  });

  it('build() wirft vorlage-waehlen → Zustand idle + Hinweis, kein Fehler-Panel, accept nicht aufgerufen', async () => {
    const build = vi.fn(async () => { throw new Error('vorlage-waehlen'); });
    const { container, deps } = mkPanel({ build: build as unknown as SmartApplyViewDeps['build'] });
    first(container, 'vault-rag-sa-run').click();
    await flush();
    expect(first(container, 'vault-rag-sa-idle')).toBeTruthy();
    expect(first(container, 'vault-rag-sa-error')).toBeFalsy();
    expect(first(container, 'vault-rag-sa-template-hint')).toBeTruthy();
    expect(deps.accept).not.toHaveBeenCalled();
  });

  // Reasoning details in diff
  it("Diff rendert einklappbaren Reasoning-Block aus proposal.reasoning", async () => {
    const { container } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    const body = first(container, "vault-rag-sa-reasoning-body");
    expect(body.textContent).toContain("weil X");
  });

  // Step 12 — Dropdowns / ranklist survive state transitions (regression for cache bug)
  it("model-select + Rangliste bleiben nach State-Übergang (idle→running→diff) sichtbar", async () => {
    const { container } = mkPanel();
    await flush(8);

    // After mount + flush: model select and ranklist should be present
    const modelSelAfterOpen = first(container, "vault-rag-sa-model");
    const ranklistAfterOpen = first(container, "vault-rag-sa-ranklist");
    expect(modelSelAfterOpen.children.length).toBeGreaterThan(0);
    expect(ranklistAfterOpen).toBeTruthy();

    // Trigger state transition: idle → running → diff
    first(container, "vault-rag-sa-run").click();
    await flush(8);

    // After diff state: model select and ranklist must still be present
    const modelSelAfterDiff = first(container, "vault-rag-sa-model");
    const ranklistAfterDiff = first(container, "vault-rag-sa-ranklist");
    expect(modelSelAfterDiff.children.length).toBeGreaterThan(0);
    expect(ranklistAfterDiff).toBeTruthy();
  });

  it("selectedTemplate bleibt über State-Übergang erhalten (via selectTemplate + userOverride)", async () => {
    const { panel, container } = mkPanel();
    await flush(8);

    // Select a non-top template via selectTemplate (simulates user click in ranklist)
    (panel as any).selectTemplate("Templates/Buch.md");
    expect((panel as any).selectedTemplate).toBe("Templates/Buch.md");

    // Trigger state transition: idle → running → diff
    first(container, "vault-rag-sa-run").click();
    await flush(8);

    // After diff state: template selection must still be preserved (userOverride active)
    expect((panel as any).selectedTemplate).toBe("Templates/Buch.md");
  });

  // Task 1 — Body-Reflow
  it("Reflow: pro sectionDiff Heading, Block-Zahl und Provenance; leere Sektion gedimmt", async () => {
    const { container } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    const reflow = first(container, "vault-rag-sa-reflow");
    expect(reflow.textContent).toContain("Inhalt");
    expect(reflow.textContent).toContain("1 Block");
    expect(reflow.textContent).toContain("# roh");   // provenance
    expect(reflow.textContent).toContain("Notizen");
    expect(reflow.textContent).toContain("—");        // leere Notizen-Sektion
  });

  it("Übrig nicht leer → Warn-Form (alert-triangle) + gelistete Block-Texte", async () => {
    const { container } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    const icon = first(container, "vault-rag-sa-leftover-icon").getAttribute("data-icon");
    expect(icon).toBe("alert-triangle");
    expect(all(container, "vault-rag-sa-leftover-item")[0].textContent).toContain("übriger Absatz");
  });

  it("Übrig leer → Success-Form (circle-check) ohne Liste", async () => {
    const { container } = mkPanel({ build: vi.fn(async () => mkProposal({ unassigned: [] })) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(first(container, "vault-rag-sa-leftover-icon").getAttribute("data-icon")).toBe("circle-check");
    expect(all(container, "vault-rag-sa-leftover-item").length).toBe(0);
  });

  it("kein Routing (assignment-parse-Fehler) → kein Reflow, kein irreführendes 'nichts verloren'", async () => {
    const { container } = mkPanel({ build: vi.fn(async () => mkProposal({
      hardOk: false, sectionDiff: [], unassigned: [],
      checks: [{ id: "assignment-parse", ok: false, detail: "kein gültiges JSON" }],
    })) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(all(container, "vault-rag-sa-reflow").length).toBe(0);
    expect(all(container, "vault-rag-sa-leftover").length).toBe(0);
    // Scan-Kopf zeigt den Fehler weiterhin
    expect(hasClass(first(container, "vault-rag-sa-guard"), "is-error")).toBe(true);
  });

  // Source-cleanliness
  it("Quelltext nutzt kein innerHTML", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../src/smart_apply_view.ts"), "utf8");
    expect(src).not.toContain("innerHTML");
  });

  it("setzt nirgends ein inline style-Attribut", async () => {
    const { container } = mkPanel();
    const offenders: string[] = [];
    const walk = (n: any) => {
      const orig = n.setAttribute;
      n.setAttribute = (k: string, v: string) => { if (k === "style") offenders.push(v); return orig?.(k, v); };
      (n.children ?? []).forEach(walk);
    };
    walk(container);
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(offenders).toEqual([]);
  });
});

describe("SmartApplyPanel Rangliste", () => {
  it("rendert die Rangliste sortiert und wählt die oberste vor", async () => {
    const { panel, container } = mkPanel();
    await flush();
    const rows = all(container, "vault-rag-sa-rank-row");
    expect(rows.length).toBe(2);
    expect((panel as any).selectedTemplate).toBe("Templates/Besprechung.md");
    expect(hasClass(rows[0], "is-selected")).toBe(true);
  });

  it("selectTemplate setzt Auswahl + userOverride und übersteht Recompute ohne Notizwechsel", async () => {
    const { panel } = mkPanel();
    await flush();
    (panel as any).selectTemplate("Templates/Buch.md");
    expect((panel as any).selectedTemplate).toBe("Templates/Buch.md");
    await (panel as any).recomputeRanking(false);
    expect((panel as any).selectedTemplate).toBe("Templates/Buch.md");
  });

  it("Notizwechsel-Recompute setzt Override zurück und wählt die neue Top-Vorlage", async () => {
    const { panel } = mkPanel();
    await flush();
    (panel as any).selectTemplate("Templates/Buch.md");
    await (panel as any).recomputeRanking(true);
    expect((panel as any).selectedTemplate).toBe("Templates/Besprechung.md");
  });

  it("offline (alle source=fallback) zeigt einen Offline-Hinweis", async () => {
    const fb: TemplateRank[] = [{ templatePath: "Templates/A.md", type: "A", score: 0, source: "fallback" }];
    const { container } = mkPanel({ rankTemplates: vi.fn(async () => fb) });
    await flush();
    expect(first(container, "vault-rag-sa-rank-note")).toBeTruthy();
  });

  // Die Self-Events (active-leaf-change/file-open) sind ersatzlos aus dem Panel entfernt —
  // der Hub soll sie zentral verdrahten und stattdessen onFileOpen() rufen. Die folgenden Tests
  // treiben genau diese neue Schnittstelle (onShow/onHide/onFileOpen), statt app.workspace.on
  // zu inspizieren.
  it("onFileOpen löst (debounced) einen Recompute aus, wenn das Panel sichtbar ist", async () => {
    const rank = vi.fn(async () => ranksFixture());
    const { panel } = mkPanel({ rankTemplates: rank });
    await flush();
    panel.onShow();                                // Hub zeigt den Tab als aktiv an
    rank.mockClear();
    panel.onFileOpen("Inbox/neu.md");
    await new Promise((r) => setTimeout(r, 450));   // Debounce (400ms) ablaufen lassen
    await flush();
    expect(rank).toHaveBeenCalled();
  });

  it("onFileOpen bleibt lazy während das Panel versteckt ist (dirty) — onShow holt nach", async () => {
    const rank = vi.fn(async () => ranksFixture());
    const { panel } = mkPanel({ rankTemplates: rank });
    await flush();
    rank.mockClear();
    // Panel ist initial nicht sichtbar (Hub hat den Tab noch nicht aktiviert)
    panel.onFileOpen("Inbox/neu.md");
    await new Promise((r) => setTimeout(r, 450));
    await flush();
    expect(rank).not.toHaveBeenCalled();            // versteckt → kein Recompute
    panel.onShow();
    await new Promise((r) => setTimeout(r, 450));
    await flush();
    expect(rank).toHaveBeenCalled();                // sichtbar geworden → Nachholen
  });

  it("refreshRanking() rankt sofort neu (z.B. nach Vorlagenpfad-Änderung in den Settings)", async () => {
    const rank = vi.fn(async () => ranksFixture());
    const { panel } = mkPanel({ rankTemplates: rank });
    await flush();
    rank.mockClear();
    panel.refreshRanking();
    await flush();
    expect(rank).toHaveBeenCalled();
  });

  // main.refresh() ruft notifyFileOpen(activePath) bei JEDEM Index-Reload (nicht nur bei echtem
  // Notizwechsel) — onFileOpen muss pfad-bewusst sein, sonst resettet ein Reload am selben Note
  // die manuelle Vorlagenwahl (userOverrodeTemplate) und klappt die Rangliste wieder ein.
  it("onFileOpen(gleicher Pfad wie zuletzt gerankt) — Index-Reload löst KEINEN Recompute aus", async () => {
    const rank = vi.fn(async () => ranksFixture());
    const { panel } = mkPanel({ rankTemplates: rank });   // activeNotePath() liefert "Inbox/roh.md"
    await flush();                                        // Mount-Recompute rankt bereits für "Inbox/roh.md"
    panel.onShow();
    rank.mockClear();
    panel.onFileOpen("Inbox/roh.md");                      // derselbe Pfad → Index-Reload-Fall
    await new Promise((r) => setTimeout(r, 450));
    await flush();
    expect(rank).not.toHaveBeenCalled();
  });

  it("onFileOpen(anderer Pfad) — echter Notizwechsel löst weiterhin einen Recompute aus", async () => {
    const rank = vi.fn(async () => ranksFixture());
    const { panel } = mkPanel({ rankTemplates: rank });
    await flush();
    panel.onShow();
    rank.mockClear();
    panel.onFileOpen("Inbox/neu.md");                      // anderer Pfad → echter Notizwechsel
    await new Promise((r) => setTimeout(r, 450));
    await flush();
    expect(rank).toHaveBeenCalled();
  });
});

describe("SmartApplyPanel Scan-Kopf", () => {
  it("Scan-Kopf: Status mit Form (circle-check) + Text, Vorlage+Detection, Stat-Chips", async () => {
    const { container } = mkPanel();   // mkProposal: hardOk, type=📖 Buch, detection=likely, 1 zugeordnet, 1 übrig
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(first(container, "vault-rag-sa-scan-status-icon").getAttribute("data-icon")).toBe("circle-check");
    const scan = first(container, "vault-rag-sa-guard");
    expect(scan.textContent).toContain("Bereit zum Anwenden");
    expect(scan.textContent).toContain("📖 Buch");
    expect(scan.textContent).toContain("automatisch erkannt");  // detection likely
    const stats = first(container, "vault-rag-sa-scan-stats");
    expect(stats.textContent).toContain("1/2");   // 1 von 2 Blöcken zugeordnet
    expect(stats.textContent).toContain("1 übrig");
    expect(stats.textContent).toContain("2 Felder gesetzt");  // type + tags(entfernt) prominent
  });

  it("Scan-Kopf bei !hardOk: Form circle-x + gesperrt-Text + Fehl-Checks", async () => {
    const { container } = mkPanel({ build: vi.fn(async () => mkProposal({
      hardOk: false,
      checks: [{ id: "permutation", ok: false, detail: "block_9 unbekannt" }],
    })) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(first(container, "vault-rag-sa-scan-status-icon").getAttribute("data-icon")).toBe("circle-x");
    const scan = first(container, "vault-rag-sa-guard");
    expect(hasClass(scan, "is-error")).toBe(true);
    expect(all(scan, "vault-rag-sa-guard-fail").length).toBe(1);
  });
});

describe("SmartApplyPanel Task 4 — Rohtext on-demand & Diff-Reihenfolge", () => {
  it("Rohtext liegt in einem ausklappbaren <details>, FM steht vor Reflow vor Rohtext", async () => {
    const { container } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    const raw = first(container, "vault-rag-sa-raw");
    expect(raw.tagName.toLowerCase()).toBe("details");
    expect(first(raw, "vault-rag-sa-orig")).toBeTruthy();
    expect(first(raw, "vault-rag-sa-prop")).toBeTruthy();
    // Reihenfolge im Diff: Frontmatter < Reflow < Rohtext — direkte Kinder des diff-Wrappers
    const diff = first(container, "vault-rag-sa-diff");
    const order = (diff.children as any[]).map((c: any) => String(c.className ?? ""));
    const idx = (cls: string) => order.findIndex((c: string) => c.includes(cls));
    expect(idx("vault-rag-sa-fm")).toBeGreaterThanOrEqual(0);
    expect(idx("vault-rag-sa-fm")).toBeLessThan(idx("vault-rag-sa-reflow"));
    expect(idx("vault-rag-sa-reflow")).toBeLessThan(idx("vault-rag-sa-raw"));
  });
});

describe("SmartApplyPanel Frontmatter-Entrauschung", () => {
  it("Frontmatter: gesetzte/geänderte/entfernte Felder prominent, leere+unveränderte im Detail", async () => {
    const { container } = mkPanel();   // mkProposal: type=neu(gefüllt), up=unveraendert, tags=entfernt
    first(container, "vault-rag-sa-run").click();
    await flush();
    const prominent = first(container, "vault-rag-sa-fm-set");
    expect(prominent.textContent).toContain("type");      // neu + Wert
    expect(prominent.textContent).toContain("tags");      // entfernt
    expect(prominent.textContent).not.toContain("up");    // unveraendert → nicht prominent
    const muted = first(container, "vault-rag-sa-fm-muted");
    expect(muted.textContent).toContain("up");            // unveraendert → Detail
  });

  it("Frontmatter: neues aber leeres Feld landet im Detail, nicht prominent", async () => {
    const { container } = mkPanel({ build: vi.fn(async () => mkProposal({
      fmRows: [
        { key: "type", original: undefined, proposed: "📖 Buch", change: "neu" },
        { key: "datum", original: undefined, proposed: "", change: "neu" },
      ],
    })) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(first(container, "vault-rag-sa-fm-set").textContent).toContain("type");
    expect(first(container, "vault-rag-sa-fm-set").textContent).not.toContain("datum");
    expect(first(container, "vault-rag-sa-fm-muted").textContent).toContain("datum");
  });

  it("alle Felder unverändert → kein leeres vault-rag-sa-fm-set", async () => {
    const { container } = mkPanel({ build: vi.fn(async () => mkProposal({
      fmRows: [{ key: "up", original: "[[A]]", proposed: "[[A]]", change: "unveraendert" }],
    })) });
    first(container, "vault-rag-sa-run").click();
    await flush();
    expect(all(container, "vault-rag-sa-fm-set").length).toBe(0);
  });

  it("Spalten-Header Original/Vorschlag über den gesetzten Feldern", async () => {
    const { container } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    const head = first(container, "vault-rag-sa-fm-head");
    expect(head.textContent).toContain("Original");
    expect(head.textContent).toContain("Vorschlag");
  });
});

// ── Task 10 — Modus-Control, Konfidenz-Badges, granulare Checkboxen, Audit-Toggle ───────────────

describe("SmartApplyPanel Task 10 — Non-deterministic Smart Apply UI", () => {
  it("rendert ein Modus-Segmented-Control; transformativ ist disabled", () => {
    const { container } = mkPanel();
    const btns = all(container, "vault-rag-sa-mode-btn");
    expect(btns.length).toBe(3);
    expect(btns.map((b) => b.textContent)).toEqual(["Deterministisch", "Additiv", "Transformativ"]);
    const transformativ = btns.find((b) => b.textContent === "Transformativ");
    expect(hasClass(transformativ, "is-disabled")).toBe(true);
    // WCAG 1.4.1: aktiver Modus über Text+Klasse, nicht nur Farbe — Default ist "deterministisch".
    const det = btns.find((b) => b.textContent === "Deterministisch");
    expect(hasClass(det, "is-active")).toBe(true);
  });

  it("additiv-Proposal zeigt Konfidenz-Badge + Checkbox pro inferred-FM und pro addition", async () => {
    const { container } = mkPanel({
      build: vi.fn(async () => mkProposal({
        mode: "additiv",
        fmRows: [
          { key: "genre", original: undefined, proposed: "", change: "neu", source: "inferred", confidence: "hoch" },
        ],
        assembly: mkAssembly({
          tpl: { type: "📖 Buch", keys: ["genre"], fmDefaults: {}, sections: [], defaultMode: "additiv", raw: "" },
          assignment: {
            version: 2, sections: [], unassigned: [],
            frontmatter: { genre: { source: "inferred", value: "Sachbuch", confidence: "hoch" } },
          },
        }),
        additions: [{ id: "add_0", targetHeading: "## Notizen", text: "Ergänzter Text zur Einordnung", confidence: "mittel" }],
      })),
    });
    first(container, "vault-rag-sa-run").click();
    await flush();

    // Konfidenz-Badges: eine für das inferred-FM-Feld, eine für die addition.
    const badges = all(container, "vault-rag-sa-conf");
    expect(badges.length).toBe(2);
    expect(badges.some((b) => b.textContent === "● hoch")).toBe(true);
    expect(badges.some((b) => b.textContent === "◐ mittel")).toBe(true);

    // Checkboxen: eine pro inferred-FM-Row + eine pro addition.
    const checks = all(container, "vault-rag-sa-conf-check");
    expect(checks.length).toBe(2);
    expect(checks.every((c) => c.getAttribute("type") === "checkbox")).toBe(true);

    // Der angezeigte erschlossene Wert kommt aus assembly.assignment.frontmatter[key].value,
    // NICHT aus fmRow.proposed (das ist "").
    const fmSection = first(container, "vault-rag-sa-fm");
    expect(fmSection.textContent).toContain("Sachbuch");

    // Addition unter ihrer Ziel-Heading, mit ＋-ergänzt-Marker.
    const reflow = first(container, "vault-rag-sa-reflow");
    expect(reflow.textContent).toContain("＋ ergänzt");
    expect(reflow.textContent).toContain("Ergänzter Text zur Einordnung");
  });

  it("niedrig-Konfidenz-Item ist per Default nicht angehakt", async () => {
    const { container } = mkPanel({
      build: vi.fn(async () => mkProposal({
        mode: "additiv",
        fmRows: [
          { key: "ort", original: undefined, proposed: "", change: "neu", source: "inferred", confidence: "niedrig" },
        ],
        assembly: mkAssembly({
          tpl: { type: "📖 Buch", keys: ["ort"], fmDefaults: {}, sections: [], defaultMode: "additiv", raw: "" },
          assignment: {
            version: 2, sections: [], unassigned: [],
            frontmatter: { ort: { source: "inferred", value: "Berlin", confidence: "niedrig" } },
          },
        }),
      })),
    });
    first(container, "vault-rag-sa-run").click();
    await flush();
    const checkbox = first(container, "vault-rag-sa-conf-check");
    expect(checkbox.checked).toBe(false);
  });

  it("Checkbox-Toggle baut proposedText neu (Re-Assembly, kein build-Aufruf)", async () => {
    // proposedText spiegelt (wie im echten propose()) den Text unter der Default-Auswahl —
    // Fixture baut ihn über dieselben pure-core-Funktionen wie die Produktion.
    const assembly = mkAssembly({
      tpl: { type: "📖 Buch", keys: ["genre"], fmDefaults: {}, sections: [], defaultMode: "additiv", raw: "" },
      assignment: {
        version: 2, sections: [], unassigned: [],
        frontmatter: { genre: { source: "inferred", value: "Sachbuch", confidence: "hoch" } },
      },
    });
    const defaultSel = defaultSelection(assembly);
    const build = vi.fn(async () => mkProposal({
      mode: "additiv",
      fmRows: [
        { key: "genre", original: undefined, proposed: "", change: "neu", source: "inferred", confidence: "hoch" },
      ],
      assembly,
      selection: defaultSel,
      proposedText: assembleProposedText(assembly, defaultSel, false),
    }));
    const { container } = mkPanel({ build: build as unknown as SmartApplyViewDeps["build"] });
    first(container, "vault-rag-sa-run").click();
    await flush();

    const before = first(container, "vault-rag-sa-prop").textContent;
    expect(before).toContain("Sachbuch");

    const checkbox = first(container, "vault-rag-sa-conf-check");
    expect(checkbox.checked).toBe(true);   // hoch → per Default angehakt
    checkbox.checked = false;
    (checkbox._listeners?.change ?? []).forEach((cb: any) => cb());
    await flush();

    expect(build).toHaveBeenCalledTimes(1);   // kein erneuter Stream — reine Re-Assembly
    const after = first(container, "vault-rag-sa-prop").textContent;
    expect(after).not.toBe(before);
    expect(after).not.toContain("Sachbuch");
  });

  it("Modus-Wechsel ruft build mit neuem Modus (Re-Stream)", async () => {
    const { container, deps } = mkPanel();
    first(container, "vault-rag-sa-run").click();
    await flush();
    (deps.build as unknown as ReturnType<typeof vi.fn>).mockClear();

    const additivBtn = all(container, "vault-rag-sa-mode-btn").find((b) => b.textContent === "Additiv");
    additivBtn.click();
    await flush();

    expect(deps.build).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), "additiv", expect.any(Function), expect.any(Function),
    );
  });
});
