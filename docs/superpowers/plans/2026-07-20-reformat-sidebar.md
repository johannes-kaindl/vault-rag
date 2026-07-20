# Reformat-Sidebar + Erreichbarkeit (Slice C.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Reformat-Command im Lesemodus auffindbar machen, die Transforms als 5. Sidebar-Tab launchbar machen (mit erklärtem Disabled-Zustand) und Ersetzungen gegen veraltete Positionen absichern.

**Architecture:** Bereitschafts-/Vorschau-/Staleness-Logik als pure, getestetes Modul; `main.ts` schreibt die Auswahl proaktiv mit (entprellter `selectionchange`-Listener), weil `workspace.activeEditor` null sein kann sobald der Fokus im Panel liegt; ein gemeinsamer `runTransform` bedient Command, Kontextmenü und Panel.

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API, bestehender `ChatClient`.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Alle Tests grün** (`npm test`), `npx tsc --noEmit` und `npm run lint` sauber, `npm run build` erzeugt `main.js`.
- **Commits:** Conventional Commits, deutsche Beschreibung; **nur berührte Dateien stagen — nie `git add -A`**, nie `package-lock.json` stagen. Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Pure/obsidian-Trennung:** `reformat_selection_state.ts` importiert **kein** obsidian (nur Typen aus `./reformat_transforms`). Obsidian nur in `reformat_panel.ts`, `main.ts`, `settings.ts`.
- **Registry bleibt einzige Wahrheit:** Panel-Buttons werden aus `TRANSFORMS` gerendert, nie hartkodiert.
- **UI-STANDARD:** obsidian-nativ, **nur Theme-CSS-Variablen** (`var(--…)`), keine Hexwerte.
- **DOM-Globals:** `activeDocument`/`activeWindow` statt `document`/`window` (Obsidian-Globals, Repo-Präzedenz `main.ts:398`) — die `eslint-plugin-obsidianmd`-Regeln verlangen das.
- **Keine neuen Settings.** LLM-Parameter bleiben fix: `temperature: 0.2`, `suppressThinking: true`, `maxTokens: REFORMAT_MAX_TOKENS`.
- **Meldungstexte kommen aus `readinessMessage`** — kein zweiter Ort mit denselben Strings.

## File Structure

| Datei | Verantwortung | obsidian? |
|---|---|---|
| `src/reformat_selection_state.ts` (neu) | Bereitschaft + Meldung + Auswahl-Vorschau + Staleness + Registry-Gruppierung | nein |
| `src/reformat_panel.ts` (neu) | `HubPanel`-Implementierung: rendert Gruppen aus der Registry, schaltet Zustände | ja |
| `src/hub_panel.ts` (ändern) | `TabId` um `"reformat"` erweitern | nein |
| `src/main.ts` (ändern) | Command auf `callback`, Auswahl-Mitschrift, `runTransform` + Staleness-Guard, Panel-Verdrahtung | ja |
| `src/settings.ts` (ändern) | Smart-Apply-Modell-Dropdown | ja |
| `styles.css` (ändern) | Panel-Styles (Theme-Variablen) | — |
| `CHANGELOG.md` / `README.md` (ändern) | Release-Doku, v1-Einschränkung entfernen | — |
| `tests/reformat_selection_state.test.ts` (neu) | Test-Gewicht des Slices | — |

**Test-Konvention:** Task 1 ist TDD. Tasks 2–5 sind obsidian-Glue bzw. Doku und werden über `tsc` + `lint` + bestehende Suite + `build` verifiziert, plus GUI-Smoke am Ende — konsistent mit `note_picker.ts`/`hub_view.ts`/`settings.ts` (obsidian-Views sind in diesem Repo bewusst nicht unit-getestet).

---

### Task 1: Bereitschafts-/Vorschau-/Staleness-Modul (pure)

**Files:**
- Create: `src/reformat_selection_state.ts`
- Test: `tests/reformat_selection_state.test.ts`

**Interfaces:**
- Consumes: Typen `TransformDef`, `MechanicalTransform`, `LlmTransform` aus `./reformat_transforms` (existieren bereits: `TransformDef` ist eine diskriminierte Union über `kind: "mechanical" | "llm"`).
- Produces:
  - `export type ReformatReadiness = { kind: "ready"; text: string } | { kind: "reading-mode" } | { kind: "no-selection" } | { kind: "no-editor" }`
  - `export function readinessMessage(r: ReformatReadiness): string`
  - `export function canRun(r: ReformatReadiness): boolean`
  - `export interface SelectionPreview { snippet: string; lines: number }`
  - `export function selectionPreview(text: string, maxLen?: number): SelectionPreview`
  - `export function isRangeStale(currentText: string, capturedText: string): boolean`
  - `export interface TransformGroups { mechanical: MechanicalTransform[]; llm: LlmTransform[] }`
  - `export function groupTransforms(defs: TransformDef[]): TransformGroups`

- [ ] **Step 1: Failing test schreiben**

`tests/reformat_selection_state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  readinessMessage, canRun, selectionPreview, isRangeStale, groupTransforms,
} from "../src/reformat_selection_state";
import { TRANSFORMS } from "../src/reformat_transforms";

describe("readinessMessage", () => {
  it("nennt für jeden blockierten Zustand einen Klartext-Grund", () => {
    expect(readinessMessage({ kind: "reading-mode" }))
      .toBe("Formatierung im Lese-Modus nicht möglich — wechsle in den Bearbeiten-Modus.");
    expect(readinessMessage({ kind: "no-selection" })).toBe("Nichts markiert.");
    expect(readinessMessage({ kind: "no-editor" })).toBe("Keine Notiz im Bearbeiten-Modus geöffnet.");
  });
  it("ist bei ready leer (dort zeigt das Panel die Auswahl-Vorschau)", () => {
    expect(readinessMessage({ kind: "ready", text: "x" })).toBe("");
  });
});

describe("canRun", () => {
  it("ist nur bei ready true", () => {
    expect(canRun({ kind: "ready", text: "x" })).toBe(true);
    expect(canRun({ kind: "reading-mode" })).toBe(false);
    expect(canRun({ kind: "no-selection" })).toBe(false);
    expect(canRun({ kind: "no-editor" })).toBe(false);
  });
});

describe("selectionPreview", () => {
  it("nimmt die erste Zeile und zählt die Zeilen", () => {
    expect(selectionPreview("Zeile eins\nZeile zwei\nZeile drei"))
      .toEqual({ snippet: "Zeile eins", lines: 3 });
  });
  it("kürzt zu lange erste Zeilen mit Auslassungszeichen", () => {
    expect(selectionPreview("abcdefghij", 4)).toEqual({ snippet: "abcd…", lines: 1 });
  });
  it("kürzt nicht, wenn die Zeile genau maxLen lang ist", () => {
    expect(selectionPreview("abcd", 4)).toEqual({ snippet: "abcd", lines: 1 });
  });
  it("ignoriert umgebenden Whitespace bei Vorschau und Zeilenzahl", () => {
    expect(selectionPreview("\n\n  Text  \n\n")).toEqual({ snippet: "Text", lines: 1 });
  });
  it("liefert für leere/reine Whitespace-Auswahl einen leeren Zustand", () => {
    expect(selectionPreview("")).toEqual({ snippet: "", lines: 0 });
    expect(selectionPreview("   \n  ")).toEqual({ snippet: "", lines: 0 });
  });
});

describe("isRangeStale", () => {
  it("ist false, wenn an der Stelle noch derselbe Text steht", () => {
    expect(isRangeStale("| A |", "| A |")).toBe(false);
  });
  it("ist true, sobald der Text abweicht", () => {
    expect(isRangeStale("| B |", "| A |")).toBe(true);
    expect(isRangeStale("", "| A |")).toBe(true);
  });
});

describe("groupTransforms", () => {
  it("teilt die Registry nach kind und behält die Reihenfolge", () => {
    const g = groupTransforms(TRANSFORMS);
    expect(g.mechanical.map(t => t.id)).toEqual(["transpose", "table-to-list", "wrap-callout"]);
    expect(g.llm.map(t => t.id)).toEqual(["to-list", "to-prose", "to-table", "to-mermaid", "freetext"]);
  });
  it("lässt keinen Registry-Eintrag aus dem Panel fallen", () => {
    const g = groupTransforms(TRANSFORMS);
    expect(g.mechanical.length + g.llm.length).toBe(TRANSFORMS.length);
  });
  it("kommt mit einer leeren Liste klar", () => {
    expect(groupTransforms([])).toEqual({ mechanical: [], llm: [] });
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `npx vitest run tests/reformat_selection_state.test.ts`
Expected: FAIL („Cannot find module ../src/reformat_selection_state").

- [ ] **Step 3: Implementierung schreiben**

`src/reformat_selection_state.ts`:

```ts
import type { TransformDef, MechanicalTransform, LlmTransform } from "./reformat_transforms";

/** Ob ein Transform gerade laufen kann — und wenn nein, warum nicht. */
export type ReformatReadiness =
  | { kind: "ready"; text: string }
  | { kind: "reading-mode" }
  | { kind: "no-selection" }
  | { kind: "no-editor" };

/** Klartext-Grund für den blockierten Zustand — EINE Wahrheit für die Notice (Command)
 *  und die Panel-Kopfzeile. Bei "ready" leer: dort zeigt das Panel die Auswahl-Vorschau. */
export function readinessMessage(r: ReformatReadiness): string {
  switch (r.kind) {
    case "ready": return "";
    case "reading-mode": return "Formatierung im Lese-Modus nicht möglich — wechsle in den Bearbeiten-Modus.";
    case "no-selection": return "Nichts markiert.";
    case "no-editor": return "Keine Notiz im Bearbeiten-Modus geöffnet.";
  }
}

export function canRun(r: ReformatReadiness): boolean {
  return r.kind === "ready";
}

export interface SelectionPreview { snippet: string; lines: number }

/** Ein-Zeilen-Vorschau der Auswahl + Zeilenzahl für die Panel-Kopfzeile. */
export function selectionPreview(text: string, maxLen = 60): SelectionPreview {
  const t = text.trim();
  if (t === "") return { snippet: "", lines: 0 };
  const lines = t.split("\n");
  const first = lines[0];
  const snippet = first.length > maxLen ? `${first.slice(0, maxLen)}…` : first;
  return { snippet, lines: lines.length };
}

/** Steht an der gemerkten Stelle noch der gemerkte Text? Schutz davor, an einer
 *  verschobenen Position zu ersetzen, wenn zwischen Markieren und Klicken editiert wurde. */
export function isRangeStale(currentText: string, capturedText: string): boolean {
  return currentText !== capturedText;
}

export interface TransformGroups { mechanical: MechanicalTransform[]; llm: LlmTransform[] }

/** Teilt die Registry in die zwei Panel-Gruppen. Jeder Eintrag landet in genau einer —
 *  dadurch kann kein Transform aus dem Panel fallen. */
export function groupTransforms(defs: TransformDef[]): TransformGroups {
  const mechanical: MechanicalTransform[] = [];
  const llm: LlmTransform[] = [];
  for (const d of defs) {
    if (d.kind === "mechanical") mechanical.push(d);
    else llm.push(d);
  }
  return { mechanical, llm };
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `npx vitest run tests/reformat_selection_state.test.ts`
Expected: PASS (alle Fälle).

- [ ] **Step 5: Volle Suite + Gates**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: alle Tests grün, 0 Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/reformat_selection_state.ts tests/reformat_selection_state.test.ts
git commit -m "feat(reformat): Bereitschafts-, Vorschau- und Staleness-Logik (pure)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Erreichbarkeits-Fix + Auswahl-Mitschrift + Staleness-Guard

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `ReformatReadiness`, `readinessMessage`, `canRun`, `isRangeStale` (Task 1); bestehende `pickTransform`/`promptInstruction`, `ReformatPreviewModal`, `REFORMAT_MAX_TOKENS`, `splitSelectionAffix`, `this.chatClient`, `this.settings.chatModel`.
- Produces (von Task 3 genutzt):
  - `public runTransform(def: TransformDef, instruction?: string): Promise<void>` — führt einen Transform auf der gemerkten Auswahl aus.
  - `public reformatReadiness(): ReformatReadiness` — aktueller gemerkter Bereitschaftszustand.
  - Feld `private reformatPanel: ReformatPanel | null` wird in Task 3 gesetzt.

**WICHTIG (LESSONS 2026-07-19):** `main.ts` liegt im Repo-Root. Ein Subagent MUSS als allerersten Schritt `cd <arbeitsverzeichnis> && pwd && git branch --show-current` ausführen und bei Abweichung sofort BLOCKED melden.

- [ ] **Step 1: Imports ergänzen**

In `src/main.ts` den obsidian-Import um `MarkdownView` und `EditorPosition` erweitern (falls nicht vorhanden), z.B.:

```ts
import { /* … bestehende … */ Editor, EditorPosition, MarkdownView, Notice, TFile, WorkspaceLeaf } from "obsidian";
```

Und bei den `./`-Imports ergänzen:

```ts
import { ReformatReadiness, readinessMessage, canRun, isRangeStale } from "./reformat_selection_state";
```

- [ ] **Step 2: Felder + Konstante ergänzen**

Oberhalb der Plugin-Klasse:

```ts
/** Entprellung des selectionchange-Listeners: hoch genug gegen Tipp-Rauschen,
 *  niedrig genug, dass das Panel dem Markieren unmittelbar folgt. */
const SELECTION_DEBOUNCE_MS = 150;
```

Als Felder der Plugin-Klasse (zu den bestehenden `private`-Feldern):

```ts
  private lastCapture: { editor: Editor; from: EditorPosition; to: EditorPosition; text: string } | null = null;
  private lastReadiness: ReformatReadiness = { kind: "no-editor" };
  private selectionDebounce: number | null = null;
```

- [ ] **Step 3: Auswahl-Mitschrift implementieren**

Als neue Methoden der Plugin-Klasse:

```ts
  /** Liest den Editor-Zustand und schreibt Auswahl + Bereitschaft mit.
   *  Wichtig: liegt gerade KEIN Markdown-View vorn (z.B. weil der Fokus im Sidebar-Panel
   *  ist), bleibt der zuletzt gemerkte Stand stehen — genau dafür existiert die Mitschrift.
   *  `workspace.activeEditor` ist laut API in diesem Moment null. */
  private captureSelection(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    if (view.getMode() !== "source") {
      this.lastReadiness = { kind: "reading-mode" };
      this.lastCapture = null;
      return;
    }
    const editor = view.editor;
    const text = editor.getSelection();
    if (!text.trim()) {
      this.lastReadiness = { kind: "no-selection" };
      this.lastCapture = null;
      return;
    }
    this.lastCapture = { editor, from: editor.getCursor("from"), to: editor.getCursor("to"), text };
    this.lastReadiness = { kind: "ready", text };
  }

  /** Gehört der gemerkte Editor noch zu einer offenen Markdown-Ansicht? Schützt davor,
   *  in einen abgehängten Editor zu schreiben, nachdem die Notiz geschlossen wurde. */
  private captureIsLive(editor: Editor): boolean {
    return this.app.workspace.getLeavesOfType("markdown")
      .some(leaf => leaf.view instanceof MarkdownView && leaf.view.editor === editor);
  }

  /** Aktueller Bereitschaftszustand — vom Sidebar-Panel gelesen. */
  reformatReadiness(): ReformatReadiness {
    return this.lastReadiness;
  }
```

- [ ] **Step 4: Listener registrieren**

In `onload()`, direkt nach der bestehenden `editor-menu`-Registrierung einfügen:

```ts
    this.registerDomEvent(activeDocument, "selectionchange", () => {
      if (this.selectionDebounce !== null) activeWindow.clearTimeout(this.selectionDebounce);
      this.selectionDebounce = activeWindow.setTimeout(() => {
        this.selectionDebounce = null;
        this.captureSelection();
        this.reformatPanel?.refresh();
      }, SELECTION_DEBOUNCE_MS);
    });
    this.register(() => {
      if (this.selectionDebounce !== null) activeWindow.clearTimeout(this.selectionDebounce);
    });
```

- [ ] **Step 5: Command auf `callback` umstellen**

Den bestehenden `reformat-selection`-Block ersetzen durch:

```ts
    this.addCommand({
      id: "reformat-selection",
      name: "Abschnitt umformatieren",
      // Bewusst `callback` statt `editorCallback`: editorCallback blendet den Command
      // aus der Palette aus, sobald kein Editor aktiv ist (Lesemodus, Fokus in der
      // Sidebar) — er verschwand dadurch kommentarlos. Jetzt immer sichtbar und
      // selbsterklärend über readinessMessage().
      callback: () => void this.reformatFromCommand(),
    });
```

Und den Kontextmenü-`onClick` auf denselben Weg umbiegen (ersetzt `void this.reformatSelection(editor)`):

```ts
        .onClick(() => void this.reformatFromCommand()));
```

- [ ] **Step 6: `reformatSelection` durch `reformatFromCommand` + `runTransform` ersetzen**

Die bestehende Methode `private async reformatSelection(editor: Editor): Promise<void> { … }` **vollständig** durch diese beiden Methoden ersetzen:

```ts
  /** Command-/Kontextmenü-Weg: Zustand frisch erfassen, Picker zeigen, ausführen. */
  private async reformatFromCommand(): Promise<void> {
    this.captureSelection();
    if (!canRun(this.lastReadiness)) { new Notice(readinessMessage(this.lastReadiness)); return; }
    const def = await pickTransform(this.app);
    if (!def) return;
    await this.runTransform(def);
  }

  /** Führt einen Transform auf der gemerkten Auswahl aus — gemeinsamer Weg für Command,
   *  Kontextmenü und Sidebar-Panel (eine Ausführungs-Wahrheit). */
  async runTransform(def: TransformDef, instruction?: string): Promise<void> {
    const cap = this.lastCapture;
    if (!cap || !canRun(this.lastReadiness)) { new Notice(readinessMessage(this.lastReadiness)); return; }
    if (!this.captureIsLive(cap.editor)) { new Notice("Die Notiz ist nicht mehr offen — bitte neu markieren."); return; }
    if (isRangeStale(cap.editor.getRange(cap.from, cap.to), cap.text)) {
      new Notice("Die Auswahl hat sich geändert — bitte neu markieren."); return;
    }

    // Umgebende Leerzeichen nicht in den Transform geben, beim Zurückschreiben wieder anfügen.
    const { lead, core, trail } = splitSelectionAffix(cap.text);

    if (def.kind === "mechanical") {
      const result = def.run(core);
      if (result == null) { new Notice(`„${def.label}" passt nicht zur Auswahl.`); return; }
      cap.editor.replaceRange(lead + result + trail, cap.from, cap.to);
      return;
    }

    let instr = instruction;
    if (def.freetext && instr === undefined) {
      const typed = await promptInstruction(this.app);
      if (typed == null) return;
      instr = typed;
    }
    const messages = def.buildMessages(core, instr);

    new ReformatPreviewModal(this.app, {
      original: core,
      stream: (onToken, signal) => this.chatClient
        .stream(messages, onToken, () => {}, signal, {
          model: this.settings.chatModel,
          temperature: 0.2,
          suppressThinking: true,
          maxTokens: REFORMAT_MAX_TOKENS,
        })
        .then(r => r.content),
      onApply: (result) => {
        // Erneut prüfen: zwischen Öffnen des Modals und „Anwenden" kann editiert worden sein.
        if (!this.captureIsLive(cap.editor) || isRangeStale(cap.editor.getRange(cap.from, cap.to), cap.text)) {
          new Notice("Die Auswahl hat sich geändert — nichts eingefügt.");
          return;
        }
        cap.editor.replaceRange(lead + result + trail, cap.from, cap.to);
      },
    }).open();
  }
```

- [ ] **Step 7: Gates**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: 0 Fehler, 671 Tests grün (665 + 6 aus Task 1), `main.js` gebaut.

Hinweis: `this.reformatPanel` wird erst in Task 3 eingeführt. Damit `tsc` hier schon grün ist, in Step 2 zusätzlich das Feld anlegen:

```ts
  private reformatPanel: { refresh(): void } | null = null;
```

(Task 3 ersetzt den strukturellen Typ durch `ReformatPanel | null`.)

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "fix(reformat): Command im Lesemodus sichtbar + Staleness-Guard

editorCallback blendete den Command aus, sobald kein Editor aktiv war
(Lesemodus, Fokus in der Sidebar) — jetzt callback mit Klartext-Notice.
Auswahl wird proaktiv mitgeschrieben, weil activeEditor null sein kann.
Vor jedem Ersetzen wird geprueft, ob an der gemerkten Stelle noch der
gemerkte Text steht.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Reformat-Panel + Hub-Verdrahtung

**Files:**
- Create: `src/reformat_panel.ts`
- Modify: `src/hub_panel.ts`, `src/main.ts`, `styles.css`

**Interfaces:**
- Consumes: `HubPanel` (`{ id, label, icon, mount, onShow?, onHide?, onFileOpen?, destroy }`), `TRANSFORMS`/`TransformDef`, `ReformatReadiness`/`canRun`/`readinessMessage`/`selectionPreview`/`groupTransforms` (Task 1), `runTransform`/`reformatReadiness` (Task 2).
- Produces: `export class ReformatPanel implements HubPanel` mit `public refresh(): void`; `export interface ReformatPanelDeps { getReadiness: () => ReformatReadiness; run: (def: TransformDef, instruction?: string) => void }`.

**WICHTIG:** Auch dieser Task fasst `main.ts` an — CWD/Branch-Verifikation als erster Schritt.

- [ ] **Step 1: `TabId` erweitern**

In `src/hub_panel.ts` Zeile 1 ersetzen:

```ts
export type TabId = "related" | "search" | "chat" | "smart-apply" | "reformat";
```

- [ ] **Step 2: Panel schreiben**

`src/reformat_panel.ts`:

```ts
import { HubPanel } from "./hub_panel";
import { TRANSFORMS, TransformDef } from "./reformat_transforms";
import {
  ReformatReadiness, canRun, readinessMessage, selectionPreview, groupTransforms,
} from "./reformat_selection_state";

export interface ReformatPanelDeps {
  /** Aktueller Bereitschaftszustand (vom Plugin mitgeschrieben). */
  getReadiness: () => ReformatReadiness;
  /** Führt den Transform auf der gemerkten Auswahl aus. */
  run: (def: TransformDef, instruction?: string) => void;
}

/** Sidebar-Tab: launcht die Transforms aus der Registry. Buttons sind deaktiviert,
 *  solange keine brauchbare Auswahl existiert — der Grund steht in der Kopfzeile. */
export class ReformatPanel implements HubPanel {
  readonly id = "reformat" as const;
  readonly label = "Umformatieren";
  readonly icon = "wand";

  private statusEl: HTMLElement | null = null;
  private buttons: HTMLButtonElement[] = [];
  private instructionEl: HTMLTextAreaElement | null = null;

  constructor(private deps: ReformatPanelDeps) {}

  mount(container: HTMLElement): void {
    container.addClass("vault-rag-reformat-panel");
    this.statusEl = container.createDiv({ cls: "vault-rag-reformat-status" });

    const groups = groupTransforms(TRANSFORMS);
    const freetext = groups.llm.filter(d => d.freetext);
    const plainLlm = groups.llm.filter(d => !d.freetext);

    this.renderGroup(container, "Sofort · offline", groups.mechanical);
    this.renderGroup(container, "Mit Vorschau · lokales LLM", plainLlm);

    const ft = freetext[0];
    if (ft) {
      container.createDiv({ cls: "vault-rag-reformat-group-title", text: "Eigene Anweisung" });
      const row = container.createDiv({ cls: "vault-rag-reformat-freetext" });
      const ta = row.createEl("textarea", { cls: "vault-rag-reformat-instruction" });
      ta.setAttr("rows", "2");
      ta.setAttr("placeholder", "z.B. mach eine Vergleichstabelle mit Pro/Contra");
      this.instructionEl = ta;
      const btn = row.createEl("button", { cls: "vault-rag-reformat-btn", text: "Umformatieren" });
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
      const btn = container.createEl("button", { cls: "vault-rag-reformat-btn", text: def.label });
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
        this.statusEl.createDiv({ cls: "vault-rag-reformat-sel", text: `Markiert: „${snippet}“` });
        this.statusEl.createDiv({
          cls: "vault-rag-reformat-meta",
          text: lines === 1 ? "1 Zeile" : `${lines} Zeilen`,
        });
      } else {
        this.statusEl.createDiv({ cls: "vault-rag-reformat-blocked", text: readinessMessage(r) });
      }
    }

    for (const b of this.buttons) b.disabled = !enabled;
    if (this.instructionEl) this.instructionEl.disabled = !enabled;
  }

  onShow(): void { this.refresh(); }

  destroy(): void {
    this.buttons = [];
    this.statusEl = null;
    this.instructionEl = null;
  }
}
```

- [ ] **Step 3: In `main.ts` verdrahten**

Import ergänzen:

```ts
import { ReformatPanel } from "./reformat_panel";
```

Das in Task 2 angelegte Feld auf den echten Typ ziehen:

```ts
  private reformatPanel: ReformatPanel | null = null;
```

In `buildPanels()` als letztes Panel anhängen (nach dem Smart-Apply-Panel, vor dem `return`):

```ts
    const reformat = new ReformatPanel({
      getReadiness: () => this.reformatReadiness(),
      run: (def, instruction) => void this.runTransform(def, instruction),
    });
    this.reformatPanel = reformat;
    panels.push(reformat);
```

Und einen Öffnen-Command bei den anderen `open-*`-Commands ergänzen:

```ts
    this.addCommand({ id: "open-reformat", name: "Umformatieren-Panel öffnen", callback: () => void this.openHub("reformat") });
```

- [ ] **Step 4: Styles anhängen**

Am Ende von `styles.css` (nur Theme-Variablen):

```css
.vault-rag-reformat-panel {
  padding: var(--size-4-2);
}
.vault-rag-reformat-status {
  margin-bottom: var(--size-4-3);
  padding: var(--size-4-2);
  background: var(--background-secondary);
  border-radius: var(--radius-s);
}
.vault-rag-reformat-sel {
  font-style: italic;
  overflow-wrap: anywhere;
}
.vault-rag-reformat-meta,
.vault-rag-reformat-blocked {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.vault-rag-reformat-group-title {
  margin: var(--size-4-3) 0 var(--size-2-2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  text-transform: uppercase;
}
.vault-rag-reformat-btn {
  display: block;
  width: 100%;
  margin-bottom: var(--size-2-2);
  text-align: left;
}
.vault-rag-reformat-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.vault-rag-reformat-instruction {
  width: 100%;
  margin-bottom: var(--size-2-2);
}
```

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: 0 Fehler, alle Tests grün, `main.js` gebaut.

- [ ] **Step 6: Commit**

```bash
git add src/reformat_panel.ts src/hub_panel.ts src/main.ts styles.css
git commit -m "feat(reformat): Sidebar-Panel als fuenfter Hub-Tab

Buttons werden aus der TRANSFORMS-Registry gerendert und nach Wirkung
gruppiert (sofort/offline vs. Vorschau/LLM). Ohne brauchbare Auswahl
sind sie deaktiviert und die Kopfzeile nennt den Grund.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Smart-Apply-Modell-Dropdown

**Files:**
- Modify: `src/settings.ts:678-686` (Methode `buildSmartApplyModel`)

**Interfaces:**
- Consumes: `this.plugin.chatClient?.listModels(): Promise<string[]>`, `this.plugin.settings.smartApplyModel: string`, `this.rerender()`.
- Produces: nichts.

**Kontext:** Das Muster wird 1:1 von `buildChatModel` (`src/settings.ts:482-511`) übernommen. **Kritischer Unterschied:** bei Smart Apply ist der **leere Wert bedeutungstragend** („leer = Chat-Modell aus dem Abschnitt Chat verwenden"). Das Dropdown MUSS daher eine explizite Leer-Option anbieten, sonst geht diese Fähigkeit verloren.

- [ ] **Step 1: Methode ersetzen**

`buildSmartApplyModel` in `src/settings.ts` vollständig ersetzen:

```ts
  private buildSmartApplyModel(s: Setting): void {
    s.setName("Smart-Apply-Modell")
      .setDesc('Modell fuer den Umsortier-Call. Leer = Chat-Modell aus dem Abschnitt "Chat" verwenden.');
    void this.plugin.chatClient?.listModels().then((models: string[]) => {
      const cur = this.plugin.settings.smartApplyModel;
      if (models.length) {
        // Leer-Option zuerst: der leere Wert ist bedeutungstragend (= Chat-Modell erben).
        const list = cur && !models.includes(cur) ? [cur, ...models] : models;
        s.addDropdown(d => {
          d.addOption("", "Chat-Modell verwenden");
          list.forEach((m: string) => { d.addOption(m, m); });
          d.setValue(cur).onChange(async (v: string) => {
            this.plugin.settings.smartApplyModel = v;
            await this.plugin.saveSettings();
          });
        });
      } else {
        s.setDesc('Server offline — Modellname eintippen (leer = Chat-Modell), dann „Modelle laden“');
        s.addText(t => t.setPlaceholder("leer = Chat-Modell").setValue(cur)
          .onChange(async (v: string) => {
            this.plugin.settings.smartApplyModel = v.trim();
            await this.plugin.saveSettings();
          }));
        s.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.rerender()));
      }
    });
  }
```

- [ ] **Step 2: Gates**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 0 Fehler, alle Tests grün.

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): Modell-Dropdown fuer Smart Apply

Paritaet zum Chat-Modell. Die Leer-Option bleibt erhalten, weil ein
leerer Wert bedeutet: Chat-Modell erben.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md`, `README.md`

**Interfaces:**
- Consumes: nichts. Produces: nichts.

**Kontext:** Der `[Unreleased]`-Block enthält bereits den C.1-Eintrag („Reformat a selection"). Dieser Task **ergänzt** ihn, statt ihn zu ersetzen. Sprache und Format an die bestehenden Einträge angleichen (die jüngsten sind englisch).

- [ ] **Step 1: CHANGELOG ergänzen**

Unter `## [Unreleased]` → `### Added` einen Punkt anhängen und einen `### Fixed`-Abschnitt ergänzen (falls noch nicht vorhanden):

```markdown
### Added
- **Reformat sidebar tab.** The transforms are now launchable from a "Umformatieren" tab in the
  Vault Retrieval sidebar, grouped by effect (instant/offline vs. preview/LLM). Buttons are
  disabled with a plain-language reason when there is nothing to act on.
- **Model dropdown for Smart Apply.** The Smart Apply model is picked from the endpoint's model
  list instead of typed by hand, with an explicit "use chat model" option.

### Fixed
- **"Abschnitt umformatieren" no longer disappears from the command palette.** It used
  `editorCallback`, which Obsidian hides whenever no editor is focused — reading mode, or focus in
  the sidebar. It is now always listed and explains why it cannot run.
- **Replacements are guarded against a stale selection.** If the text at the captured position
  changed between selecting and applying, nothing is written and a notice explains why.
```

- [ ] **Step 2: README ergänzen**

In der Features-Liste den bestehenden „Reformat a selection"-Punkt um den Sidebar-Satz erweitern (am Ende des Absatzes anfügen):

```markdown
 You can also launch every transform from the **Umformatieren** tab in the sidebar, which shows what is currently selected and greys the buttons out (with the reason) when it cannot run.
```

In der Usage-Liste den bestehenden Schritt 5 ersetzen — **die bisherige v1-Einschränkung entfällt**, weil der Staleness-Guard sie behebt:

```markdown
5. Select a block of text, then run **Abschnitt umformatieren** from the command palette or the editor right-click menu — or open the **Umformatieren** tab in the sidebar and click a transform. Mechanical ones apply immediately; LLM ones open a streamed preview to review before applying. Reformatting needs editing mode: in reading mode Obsidian exposes no editor selection, so the buttons stay disabled and say so. If you edit the note while a preview is open, the replacement is refused rather than applied at the wrong spot.
```

- [ ] **Step 3: Prüfen, dass die alte Einschränkung wirklich weg ist**

Run: `grep -n "go stale\|veraltet" README.md`
Expected: kein Treffer mehr, der eine unbehandelte Staleness-Einschränkung behauptet.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs(reformat): Sidebar-Tab, Erreichbarkeits-Fix und Staleness-Guard dokumentiert

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (durchgeführt)

**Spec-Coverage:**
- A Erreichbarkeits-Fix (`callback` + Klartext-Notice) → Task 2 Steps 5–6. ✓
- A Kontextmenü bleibt unverändert, nur auf denselben Weg umgebogen → Task 2 Step 5. ✓
- B Panel als 5. Hub-Tab, aus Registry gerendert, gruppiert → Task 3. ✓
- B Auswahl-Mitschrift (`selectionchange`, entprellt) → Task 2 Steps 2–4. ✓
- B Zustände (deaktiviert + Grund) → Task 1 (`readinessMessage`/`canRun`) + Task 3 (`refresh`). ✓
- C Staleness-Guard an beiden Schreibstellen (mechanisch + `onApply`) → Task 2 Step 6. ✓
- D Smart-Apply-Dropdown inkl. Leer-Option → Task 4. ✓
- Tests auf dem pure Kern inkl. Registry-Abdeckung → Task 1. ✓
- Doku/v1-Einschränkung entfernen → Task 5. ✓

**Offene Detail-Entscheidungen der Spec — jetzt entschieden:** Debounce = 150 ms (Task 2 Step 2); Vorschau-Länge = 60 Zeichen (Task 1 `selectionPreview` Default); Freitext-Feld wird nach dem Lauf geleert (Task 3 Step 2, `ta.value = ""`).

**Platzhalter-Scan:** kein TBD/TODO; jeder Code-Schritt enthält den vollständigen Code. ✓

**Typ-Konsistenz:** `ReformatReadiness`/`readinessMessage`/`canRun`/`selectionPreview`/`isRangeStale`/`groupTransforms` durchgängig gleich benannt; `runTransform(def, instruction?)` und `reformatReadiness()` stimmen zwischen Task 2 (Produces) und Task 3 (Consumes) überein; `ReformatPanel.refresh()` passt zum in Task 2 Step 7 angelegten strukturellen Feldtyp `{ refresh(): void }`. ✓

## Nach allen Tasks

GUI-Smoke durch Jay (Panel-Zustände: Lesemodus / nichts markiert / bereit · Buttons · Freitext · Staleness · Smart-Apply-Dropdown), danach Release **0.16.0**.

## Weiterhin offen (bewusst nicht in diesem Slice)

- Auto-Auswahl des Absatzes unter dem Cursor (auf Wunsch später).
- Endpunkt-Neuauflösung vor LLM-Transforms; Enter-zum-Absenden im Freitext-Modal;
  ```-Fence-Stripping bei LLM-Output.
- Outline-Composer (eigener Slice).
