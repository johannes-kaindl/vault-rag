# Smart-Apply Diff-Gate UI-Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den `diff`-Zustand des Smart-Apply-Cockpits von zwei rohen Text-Panes zu einer semantischen 3-Ebenen-Ansicht umbauen (Scan-Kopf → entrauschtes Frontmatter → Body-Reflow → Rohtext on-demand), rein View-seitig.

**Architecture:** Nur `src/smart_apply_view.ts` (`renderDiff` + dessen `render*`-Helfer) und `styles.css` (`vault-rag-sa-*`). Alle Daten liegen bereits im `ApplyProposal` (`sectionDiff`, `unassigned`, `fmRows`, `checks`, `hardOk`, `type`, `detection`, `originalText`, `proposedText`). Keine Core-/Pipeline-Änderung, keine neuen Proposal-Felder. Inkrementell: jeder Task fügt einen Render-Helfer hinzu und verdrahtet ihn in `renderDiff`; der letzte Task setzt die finale Reihenfolge und verschiebt die Rohtext-Panes in ein `<details>`.

**Tech Stack:** TypeScript (strict) · Obsidian ItemView API · vitest + happy-dom · esbuild.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Tests:** vitest + happy-dom; `import { describe, it, expect, vi } from "vitest"`; deutsche `it`-Beschreibungen; kein `.only`/`.skip`. **Nach jeder Änderung `npm test` komplett grün.**
- **View-Test-Muster** (`tests/smart_apply_view.test.ts`): Obsidian-Mock; `setIcon` setzt im Mock ein `data-icon`-Attribut (auf Form asserten, nicht auf Farbe); Helfer `first(el, cls)`, `all(el, cls)`, `hasClass(el, cls)`, `flush()`; Factory `mkProposal(over?)` / `mkView(over?)`. **Diff-Zustand triggern:** `await view.onOpen(); first(view.contentEl, "vault-rag-sa-run").click(); await flush();`.
- **Nur `src/smart_apply_view.ts` (diff-Pfad) + `styles.css`.** KEINE Änderung an `smart_apply.ts`/Core, keine neuen `ApplyProposal`-Felder.
- **WCAG 1.4.1 (Nutzer hat Rot-Grün-Sehschwäche):** jeder Status redundant über **Form/Icon + Text**; Farbe nur sekundär. Im Test auf `data-icon`-Form + Text-Label asserten.
- **Styling:** Obsidian-CSS-Variablen (keine Hex-Farben), lesbare Schrift (≥ `var(--font-ui-small)`, nicht 11 px), niedrige Spezifität (`:where()` wo sinnvoll).
- **`npm run typecheck && npm run lint && npm run build`** → 0 Fehler nach Code-Tasks.
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Bestehende diff-Verhaltens-Tests bleiben grün** — wo Selektoren sich verschieben (Rohtext-Panes `vault-rag-sa-orig`/`-prop` wandern in Task 4 ins `<details>`, bleiben aber existent), in genau dem Task anpassen, der sie verschiebt.

---

## Task 1: Body-Reflow (`renderReflow`)

**Files:**
- Modify: `src/smart_apply_view.ts` (neue Methode `renderReflow` + Helfer `truncate`; in `renderDiff` einhängen)
- Test: `tests/smart_apply_view.test.ts`

**Interfaces:**
- Consumes: `ApplyProposal.sectionDiff: SectionDiff[]` (`{heading: string; blockIds: string[]; provenance: string | null}`), `ApplyProposal.unassigned: SourceBlock[]` (`{id, text}`). `setIcon` (bereits importiert).
- Produces: `private renderReflow(c: HTMLElement, p: ApplyProposal): void` und `private truncate(s: string, max: number): string` — Task 3 nutzt dieselben `sectionDiff`/`unassigned`-Zählungen.

- [ ] **Step 1: Failing-Tests schreiben**

In `tests/smart_apply_view.test.ts` im `describe("SmartApplyView — Cockpit", …)` anfügen:

```ts
  it("Reflow: pro sectionDiff Heading, Block-Zahl und Provenance; leere Sektion gedimmt", async () => {
    const { view } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    const reflow = first(view.contentEl, "vault-rag-sa-reflow");
    expect(reflow.textContent).toContain("Inhalt");
    expect(reflow.textContent).toContain("1 Block");
    expect(reflow.textContent).toContain("# roh");   // provenance
    expect(reflow.textContent).toContain("Notizen");
    expect(reflow.textContent).toContain("—");        // leere Notizen-Sektion
  });

  it("Übrig nicht leer → Warn-Form (alert-triangle) + gelistete Block-Texte", async () => {
    const { view } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    const icon = first(view.contentEl, "vault-rag-sa-leftover-icon").getAttribute("data-icon");
    expect(icon).toBe("alert-triangle");
    expect(all(view.contentEl, "vault-rag-sa-leftover-item")[0].textContent).toContain("übriger Absatz");
  });

  it("Übrig leer → Success-Form (circle-check) ohne Liste", async () => {
    const { view } = mkView({ build: vi.fn(async () => mkProposal({ unassigned: [] })) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-leftover-icon").getAttribute("data-icon")).toBe("circle-check");
    expect(all(view.contentEl, "vault-rag-sa-leftover-item").length).toBe(0);
  });
```

- [ ] **Step 2: Tests laufen → FAIL**

Run: `npx vitest run tests/smart_apply_view.test.ts`
Expected: FAIL (`vault-rag-sa-reflow` existiert nicht).

- [ ] **Step 3: `renderReflow` + `truncate` implementieren + einhängen**

In `src/smart_apply_view.ts`, neue Methoden in der Klasse (z.B. direkt nach `renderTwoSurface`):

```ts
  private truncate(s: string, max: number): string {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }

  private renderReflow(c: HTMLElement, p: ApplyProposal): void {
    const sec = c.createDiv({ cls: "vault-rag-sa-reflow" });
    sec.createDiv({ cls: "vault-rag-sa-section-title", text: "Body-Reflow" });
    for (const sd of p.sectionDiff) {
      const row = sec.createDiv({ cls: "vault-rag-sa-reflow-row" });
      row.toggleClass("is-empty", sd.blockIds.length === 0);
      const head = row.createDiv({ cls: "vault-rag-sa-reflow-head" });
      head.createSpan({ cls: "vault-rag-sa-reflow-heading", text: sd.heading.replace(/^#+\s*/, "") });
      const n = sd.blockIds.length;
      head.createSpan({
        cls: "vault-rag-sa-reflow-count",
        text: n === 0 ? "—" : `${n} ${n === 1 ? "Block" : "Blöcke"}`,
      });
      if (sd.provenance) {
        row.createDiv({ cls: "vault-rag-sa-reflow-prov", text: this.truncate(sd.provenance, 80) });
      }
    }
    const left = sec.createDiv({ cls: "vault-rag-sa-leftover" });
    const icon = left.createSpan({ cls: "vault-rag-sa-leftover-icon" });
    if (p.unassigned.length === 0) {
      left.toggleClass("is-ok", true);
      setIcon(icon, "circle-check");
      left.createSpan({ cls: "vault-rag-sa-leftover-label", text: "Übrig: nichts verloren" });
    } else {
      left.toggleClass("is-warn", true);
      setIcon(icon, "alert-triangle");
      const n = p.unassigned.length;
      left.createSpan({
        cls: "vault-rag-sa-leftover-label",
        text: `${n} ${n === 1 ? "Block" : "Blöcke"} nicht zugeordnet`,
      });
      const list = sec.createDiv({ cls: "vault-rag-sa-leftover-list" });
      for (const b of p.unassigned) {
        list.createDiv({ cls: "vault-rag-sa-leftover-item", text: this.truncate(b.text, 80) });
      }
    }
  }
```

In `renderDiff` (aktuell `renderGuard → renderTwoSurface → renderFrontmatter → renderActions → renderReasoning`) den Aufruf **nach** `renderFrontmatter` einhängen:
```ts
    this.renderGuard(wrap, p);
    this.renderTwoSurface(wrap, p);
    this.renderFrontmatter(wrap, p);
    this.renderReflow(wrap, p);
    this.renderActions(wrap, p);
    this.renderReasoning(wrap, p.reasoning);
```

- [ ] **Step 4: Tests laufen → PASS**

Run: `npx vitest run tests/smart_apply_view.test.ts` → PASS, dann `npm test` → alle grün.

- [ ] **Step 5: Commit**

```bash
git add src/smart_apply_view.ts tests/smart_apply_view.test.ts
git commit -m "feat(smart-apply-ui): Body-Reflow-Ansicht (sectionDiff + Übrig-Indikator)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Frontmatter entrauscht (`renderFrontmatter` umbauen)

**Files:**
- Modify: `src/smart_apply_view.ts` (`renderFrontmatter` Zeile ~381-395; Helfer `hasValue`, `isMutedRow`)
- Test: `tests/smart_apply_view.test.ts`

**Interfaces:**
- Consumes: `ApplyProposal.fmRows: FmRow[]` (`{key: string; original?: FmValue; proposed?: FmValue; change: FmChange}`, `FmChange = "unveraendert"|"geaendert"|"neu"|"entfernt"`), bestehender `CHANGE_ICON`, `this.fmCell`.
- Produces: `private isMutedRow(row: FmRow): boolean` — Task 3 nutzt es für die „N Felder gesetzt"-Zählung.

- [ ] **Step 1: Failing-Tests schreiben**

Anfügen:

```ts
  it("Frontmatter: gesetzte/geänderte/entfernte Felder prominent, leere+unveränderte im Detail", async () => {
    const { view } = mkView();   // mkProposal: type=neu(gefüllt), up=unveraendert, tags=entfernt
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    const prominent = first(view.contentEl, "vault-rag-sa-fm-set");
    expect(prominent.textContent).toContain("type");      // neu + Wert
    expect(prominent.textContent).toContain("tags");      // entfernt
    expect(prominent.textContent).not.toContain("up");    // unveraendert → nicht prominent
    const muted = first(view.contentEl, "vault-rag-sa-fm-muted");
    expect(muted.textContent).toContain("up");            // unveraendert → Detail
  });

  it("Frontmatter: neues aber leeres Feld landet im Detail, nicht prominent", async () => {
    const { view } = mkView({ build: vi.fn(async () => mkProposal({
      fmRows: [
        { key: "type", original: undefined, proposed: "📖 Buch", change: "neu" },
        { key: "datum", original: undefined, proposed: "", change: "neu" },
      ],
    })) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-fm-set").textContent).toContain("type");
    expect(first(view.contentEl, "vault-rag-sa-fm-set").textContent).not.toContain("datum");
    expect(first(view.contentEl, "vault-rag-sa-fm-muted").textContent).toContain("datum");
  });
```

- [ ] **Step 2: Tests laufen → FAIL**

Run: `npx vitest run tests/smart_apply_view.test.ts`
Expected: FAIL (`vault-rag-sa-fm-set` / `-fm-muted` existieren nicht).

- [ ] **Step 3: `renderFrontmatter` umbauen**

Ersetze die bestehende `renderFrontmatter` und ergänze die Helfer:

```ts
  private hasValue(v: FmValue | undefined): boolean {
    if (v === undefined) return false;
    return Array.isArray(v) ? v.length > 0 : v.trim() !== "";
  }

  /** Zurückhaltend (ausklappbar): unverändert ODER neu-aber-leer. Alles andere ist „gesetzt". */
  private isMutedRow(row: FmRow): boolean {
    return row.change === "unveraendert" || (row.change === "neu" && !this.hasValue(row.proposed));
  }

  private renderFmRow(parent: HTMLElement, row: FmRow): void {
    const r = parent.createDiv({ cls: "vault-rag-sa-fm-row" });
    r.toggleClass(`is-${row.change}`, true);
    const icon = r.createSpan({ cls: "vault-rag-sa-fm-icon" });
    setIcon(icon, CHANGE_ICON[row.change] ?? "minus");
    r.createSpan({ cls: "vault-rag-sa-fm-key", text: row.key });
    r.createSpan({ cls: "vault-rag-sa-fm-orig", text: this.fmCell(row.original) });
    r.createSpan({ cls: "vault-rag-sa-fm-prop", text: this.fmCell(row.proposed) });
  }

  private renderFrontmatter(c: HTMLElement, p: ApplyProposal): void {
    if (p.fmRows.length === 0) return;
    const sec = c.createDiv({ cls: "vault-rag-sa-fm" });
    sec.createDiv({ cls: "vault-rag-sa-section-title", text: "Frontmatter" });

    const setRows = p.fmRows.filter((row) => !this.isMutedRow(row));
    const mutedRows = p.fmRows.filter((row) => this.isMutedRow(row));

    const setBox = sec.createDiv({ cls: "vault-rag-sa-fm-set" });
    for (const row of setRows) this.renderFmRow(setBox, row);

    if (mutedRows.length > 0) {
      const empty = mutedRows.filter((row) => row.change === "neu").length;
      const unchanged = mutedRows.length - empty;
      const det = sec.createEl("details", { cls: "vault-rag-sa-fm-muted" });
      const parts: string[] = [];
      if (empty > 0) parts.push(`${empty} leere`);
      if (unchanged > 0) parts.push(`${unchanged} unveränderte`);
      det.createEl("summary", { cls: "vault-rag-sa-fm-muted-sum", text: `${parts.join(" · ")} Felder` });
      for (const row of mutedRows) this.renderFmRow(det, row);
    }
  }
```

- [ ] **Step 4: Tests laufen → PASS**

Run: `npx vitest run tests/smart_apply_view.test.ts` → PASS, dann `npm test` → alle grün.

- [ ] **Step 5: Commit**

```bash
git add src/smart_apply_view.ts tests/smart_apply_view.test.ts
git commit -m "feat(smart-apply-ui): Frontmatter entrauscht — gesetzt prominent, leer/unverändert ausklappbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Scan-Kopf (`renderGuardScan`)

**Files:**
- Modify: `src/smart_apply_view.ts` (`renderGuard` → `renderGuardScan`; Aufruf in `renderDiff`)
- Test: `tests/smart_apply_view.test.ts`

**Interfaces:**
- Consumes: `ApplyProposal.{type, detection:{source,confidence}, sectionDiff, unassigned, fmRows, checks, hardOk}`; `this.isMutedRow` (Task 2); `setIcon`.
- Produces: `private renderGuardScan(c, p): void` — ersetzt `renderGuard`. Behält die Klasse `vault-rag-sa-guard` + `is-ok`/`is-error` + `vault-rag-sa-guard-fail` (bestehende Tests hängen daran).

- [ ] **Step 1: Failing-Tests schreiben**

Anfügen:

```ts
  it("Scan-Kopf: Status mit Form (circle-check) + Text, Vorlage+Detection, Stat-Chips", async () => {
    const { view } = mkView();   // mkProposal: hardOk, type=📖 Buch, detection=likely, 1 zugeordnet, 1 übrig
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-scan-status-icon").getAttribute("data-icon")).toBe("circle-check");
    const scan = first(view.contentEl, "vault-rag-sa-guard");
    expect(scan.textContent).toContain("Bereit zum Anwenden");
    expect(scan.textContent).toContain("📖 Buch");
    expect(scan.textContent).toContain("automatisch erkannt");  // detection likely
    const stats = first(view.contentEl, "vault-rag-sa-scan-stats");
    expect(stats.textContent).toContain("1/2");   // 1 von 2 Blöcken zugeordnet
    expect(stats.textContent).toContain("1 übrig");
    expect(stats.textContent).toContain("2 Felder gesetzt");  // type + tags(entfernt) prominent
  });

  it("Scan-Kopf bei !hardOk: Form circle-x + gesperrt-Text + Fehl-Checks", async () => {
    const { view } = mkView({ build: vi.fn(async () => mkProposal({
      hardOk: false,
      checks: [{ id: "permutation", ok: false, detail: "block_9 unbekannt" }],
    })) });
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    expect(first(view.contentEl, "vault-rag-sa-scan-status-icon").getAttribute("data-icon")).toBe("circle-x");
    const scan = first(view.contentEl, "vault-rag-sa-guard");
    expect(hasClass(scan, "is-error")).toBe(true);
    expect(all(scan, "vault-rag-sa-guard-fail").length).toBe(1);
  });
```

- [ ] **Step 2: Tests laufen → FAIL**

Run: `npx vitest run tests/smart_apply_view.test.ts`
Expected: FAIL (`vault-rag-sa-scan-status-icon` / `-scan-stats` existieren nicht).

- [ ] **Step 3: `renderGuard` → `renderGuardScan`**

Ersetze `renderGuard` durch `renderGuardScan` und passe den Aufruf in `renderDiff` an (`this.renderGuard(wrap, p)` → `this.renderGuardScan(wrap, p)`):

```ts
  private detectionLabel(d: ApplyProposal["detection"]): string {
    if (d.confidence === "confirmed") return "Typ aus Frontmatter";
    if (d.source === "rag") return "automatisch erkannt";
    return "manuell gewählt";
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
      text: p.hardOk ? "Bereit zum Anwenden" : "Anwenden gesperrt",
    });

    banner.createDiv({
      cls: "vault-rag-sa-scan-tpl",
      text: `Vorlage: ${p.type} · ${this.detectionLabel(p.detection)}`,
    });

    const assigned = p.sectionDiff.reduce((sum, sd) => sum + sd.blockIds.length, 0);
    const total = assigned + p.unassigned.length;
    const setCount = p.fmRows.filter((row) => !this.isMutedRow(row)).length;
    banner.createDiv({
      cls: "vault-rag-sa-scan-stats",
      text: `${assigned}/${total} Blöcke zugeordnet · ${p.unassigned.length} übrig · ${setCount} Felder gesetzt`,
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
```

- [ ] **Step 4: Tests laufen → PASS**

Run: `npx vitest run tests/smart_apply_view.test.ts` → PASS. Dann `npm test`. Der bestehende Test „Diff zeigt grünes Guard-Banner wenn hardOk" (prüft `vault-rag-sa-guard` + `is-ok`) **bleibt grün** (Klasse erhalten). Der bestehende !hardOk-Test (guard-fail) bleibt grün.

- [ ] **Step 5: Commit**

```bash
git add src/smart_apply_view.ts tests/smart_apply_view.test.ts
git commit -m "feat(smart-apply-ui): Scan-Kopf — Prüf-Status (Form+Text), Vorlage/Detection, Stat-Chips

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rohtext on-demand, finale Reihenfolge & CSS-Polish

**Files:**
- Modify: `src/smart_apply_view.ts` (`renderTwoSurface` → `renderRawDetails`; `renderDiff`-Reihenfolge)
- Modify: `styles.css` (`vault-rag-sa-*`-Diff-Block)
- Test: `tests/smart_apply_view.test.ts` (bestehende orig/prop-Test anpassen)

**Interfaces:**
- Consumes: `ApplyProposal.{originalText, proposedText}`.
- Produces: finale `renderDiff`-Reihenfolge `renderGuardScan → renderFrontmatter → renderReflow → renderRawDetails → renderActions → renderReasoning`. `vault-rag-sa-orig`/`-prop` bleiben existent, jetzt innerhalb `<details class="vault-rag-sa-raw">`.

- [ ] **Step 1: Tests anpassen + neuen Test schreiben**

Der bestehende Test „build()-Resolve geht in den Diff-Zustand…" (≈ Zeile 216-226) prüft `vault-rag-sa-orig`/`-prop` direkt unter `contentEl`. Da sie ins `<details>` wandern, bleibt `first(view.contentEl, "vault-rag-sa-orig")` weiterhin truthy (querySelector ist tief). Belasse diese Assertions; ergänze einen Test, der das `<details>` und die Reihenfolge prüft:

```ts
  it("Rohtext liegt in einem ausklappbaren <details>, FM steht vor Reflow vor Rohtext", async () => {
    const { view } = mkView();
    await view.onOpen();
    first(view.contentEl, "vault-rag-sa-run").click();
    await flush();
    const raw = first(view.contentEl, "vault-rag-sa-raw");
    expect(raw.tagName.toLowerCase()).toBe("details");
    expect(first(raw, "vault-rag-sa-orig")).toBeTruthy();
    expect(first(raw, "vault-rag-sa-prop")).toBeTruthy();
    // Reihenfolge im Diff: Frontmatter < Reflow < Rohtext
    const html = first(view.contentEl, "vault-rag-sa-diff").innerHTML;
    expect(html.indexOf("vault-rag-sa-fm")).toBeLessThan(html.indexOf("vault-rag-sa-reflow"));
    expect(html.indexOf("vault-rag-sa-reflow")).toBeLessThan(html.indexOf("vault-rag-sa-raw"));
  });
```

- [ ] **Step 2: Tests laufen → FAIL**

Run: `npx vitest run tests/smart_apply_view.test.ts`
Expected: FAIL (`vault-rag-sa-raw` existiert nicht).

- [ ] **Step 3: `renderRawDetails` + finale `renderDiff`-Reihenfolge**

Ersetze `renderTwoSurface` durch `renderRawDetails` (Panes in ein zu-by-default `<details>`):

```ts
  private renderRawDetails(c: HTMLElement, p: ApplyProposal): void {
    const det = c.createEl("details", { cls: "vault-rag-sa-raw" });
    det.createEl("summary", { cls: "vault-rag-sa-raw-sum", text: "Rohtext anzeigen (Original / Vorschlag)" });
    const surfaces = det.createDiv({ cls: "vault-rag-sa-surfaces" });

    const origCol = surfaces.createDiv({ cls: "vault-rag-sa-surface" });
    origCol.createDiv({ cls: "vault-rag-sa-surface-title", text: "Original" });
    origCol.createEl("pre", { cls: "vault-rag-sa-orig", text: p.originalText });

    const propCol = surfaces.createDiv({ cls: "vault-rag-sa-surface" });
    propCol.createDiv({ cls: "vault-rag-sa-surface-title", text: "Vorschlag" });
    propCol.createEl("pre", { cls: "vault-rag-sa-prop", text: p.proposedText });
  }
```

`renderDiff` final:
```ts
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
```

- [ ] **Step 4: Tests laufen → PASS**

Run: `npx vitest run tests/smart_apply_view.test.ts` → PASS, dann `npm test` → alle grün.

- [ ] **Step 5: CSS-Polish**

In `styles.css` den Diff-Block ersetzen/ergänzen (Zeile ~82-97 Bereich). Lesbare Schrift, Spacing, Sektions-Trenner, Status-Farbe nur sekundär:

```css
/* Smart Apply v2 — Diff-Gate (semantische 3-Ebenen-Ansicht) */
.vault-rag-sa-diff { display: flex; flex-direction: column; gap: 12px; font-size: var(--font-ui-small); }
.vault-rag-sa-section-title { font-size: var(--font-ui-smaller); text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); margin-bottom: 4px; }

/* Scan-Kopf */
.vault-rag-sa-guard { display: flex; flex-direction: column; gap: 2px; padding: 8px; border-radius: 6px; background: var(--background-secondary); border-left: 3px solid var(--background-modifier-border); }
.vault-rag-sa-guard.is-ok { border-left-color: var(--text-success); }
.vault-rag-sa-guard.is-error { border-left-color: var(--text-error); }
.vault-rag-sa-scan-status { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.vault-rag-sa-guard.is-ok .vault-rag-sa-scan-status { color: var(--text-success); }
.vault-rag-sa-guard.is-error .vault-rag-sa-scan-status { color: var(--text-error); }
.vault-rag-sa-scan-tpl, .vault-rag-sa-scan-stats { color: var(--text-muted); font-size: var(--font-ui-smaller); }
.vault-rag-sa-guard-list { margin-top: 4px; }
.vault-rag-sa-guard-fail { color: var(--text-error); font-size: var(--font-ui-smaller); }

/* Frontmatter */
.vault-rag-sa-fm-set { display: flex; flex-direction: column; gap: 3px; }
.vault-rag-sa-fm-row { display: flex; align-items: center; gap: 6px; }
.vault-rag-sa-fm-icon { display: inline-flex; color: var(--text-muted); }
.vault-rag-sa-fm-row.is-neu .vault-rag-sa-fm-icon { color: var(--text-success); }
.vault-rag-sa-fm-row.is-entfernt .vault-rag-sa-fm-icon { color: var(--text-error); }
.vault-rag-sa-fm-key { font-weight: 600; min-width: 96px; }
.vault-rag-sa-fm-orig { color: var(--text-muted); flex: 1; }
.vault-rag-sa-fm-prop { color: var(--text-normal); flex: 1; }
.vault-rag-sa-fm-muted { margin-top: 4px; color: var(--text-muted); }
.vault-rag-sa-fm-muted-sum { cursor: pointer; font-size: var(--font-ui-smaller); }
.vault-rag-sa-fm-muted .vault-rag-sa-fm-row { opacity: .75; }

/* Body-Reflow */
.vault-rag-sa-reflow-row { padding: 4px 0; border-bottom: 1px solid var(--background-modifier-border); }
.vault-rag-sa-reflow-row.is-empty { opacity: .55; }
.vault-rag-sa-reflow-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.vault-rag-sa-reflow-heading { font-weight: 600; }
.vault-rag-sa-reflow-count { color: var(--text-muted); font-size: var(--font-ui-smaller); white-space: nowrap; }
.vault-rag-sa-reflow-prov { color: var(--text-muted); font-size: var(--font-ui-smaller); margin-top: 2px; padding-left: 8px; border-left: 2px solid var(--background-modifier-border); }
.vault-rag-sa-leftover { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-weight: 600; }
.vault-rag-sa-leftover.is-ok { color: var(--text-success); }
.vault-rag-sa-leftover.is-warn { color: var(--text-warning); }
.vault-rag-sa-leftover-list { margin-top: 2px; }
.vault-rag-sa-leftover-item { color: var(--text-warning); font-size: var(--font-ui-smaller); padding-left: 8px; }

/* Rohtext on-demand */
.vault-rag-sa-raw-sum { cursor: pointer; color: var(--text-muted); font-size: var(--font-ui-smaller); }
.vault-rag-sa-surfaces { display: flex; gap: 8px; margin-top: 6px; }
.vault-rag-sa-surface { flex: 1; min-width: 0; }
.vault-rag-sa-surface-title { font-size: var(--font-ui-smaller); color: var(--text-muted); margin-bottom: 2px; }
.vault-rag-sa-orig, .vault-rag-sa-prop { font-size: var(--font-ui-smaller); white-space: pre-wrap; background: var(--background-secondary); border-radius: 4px; padding: 6px; margin: 0; max-height: 320px; overflow-y: auto; }
```

Entferne die nun ersetzten alten Regeln (alte `.vault-rag-sa-surfaces`/`-surface`/`-orig`/`-prop`/`-fm-*`-Zeilen ~82-93), damit keine Duplikate bleiben.

- [ ] **Step 6: Typecheck + Lint + Build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 Fehler, `main.js` gebaut.

- [ ] **Step 7: Commit**

```bash
git add src/smart_apply_view.ts tests/smart_apply_view.test.ts styles.css
git commit -m "feat(smart-apply-ui): Rohtext on-demand + finale Diff-Reihenfolge + CSS-Polish

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec-Coverage:**
- Scan-Kopf (Status Form+Text, Vorlage/Detection, Stats) → Task 3. ✓
- Frontmatter entrauscht (prominent vs. ausklappbar, leere/unveränderte gruppiert) → Task 2. ✓
- Body-Reflow (sectionDiff sichtbar, Heading+Zahl+Provenance, leere gedimmt) + Übrig-Indikator (redundant kodiert) → Task 1. ✓
- Reihenfolge Scan→FM→Reflow→Rohtext→Aktionen → Task 4 (`renderDiff` final). ✓
- Rohtext on-demand (`<details>`) → Task 4. ✓
- WCAG (Form/Icon + Text, Farbe sekundär) → Task 1/3 (`data-icon`-Asserts), CSS (Farbe nur als zusätzlicher Layer). ✓
- Rein View, keine Core-Änderung, keine neuen Proposal-Felder → alle Tasks nur `smart_apply_view.ts` + `styles.css`. ✓
- Provenance/Übrig-Kürzung ~80 Zeichen → Task 1 `truncate`. ✓ (offener Punkt der Spec gelöst)
- FM-Zeilen-Reihenfolge = `fmRows`-Order → `filter` erhält Reihenfolge. ✓ (offener Punkt gelöst)

**Placeholder-Scan:** Kein TBD/TODO; jeder Code-Step zeigt vollständigen Code; Tests ausformuliert. ✓

**Typ-Konsistenz:** `renderReflow`/`truncate` (T1) → `isMutedRow`/`hasValue`/`renderFmRow` (T2) → `renderGuardScan`/`detectionLabel` (T3, nutzt `isMutedRow`) → `renderRawDetails`/`renderDiff` (T4). Klassen-Namen durchgängig: `vault-rag-sa-{reflow,leftover-icon/-item,fm-set,fm-muted,scan-status-icon,scan-stats,guard,raw}`. `setIcon`→`data-icon` in allen Form-Asserts. ✓
