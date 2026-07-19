# Selektions-Reformatter (Slice C.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen markierten Editor-Abschnitt per Befehl umformatieren — mechanisch (Tabelle kippen, Tabelle→Liste, Callout) oder per LLM mit Vorschau (→Liste, →Fließtext, →Tabelle, →Mermaid, Freitext).

**Architecture:** Pure-core (obsidian-frei, TDD) für Transform-Logik/Registry/Prompts; dünne obsidian-Schicht (FuzzySuggestModal-Picker + Vorschau-Modal) nach `note_picker.ts`-Präzedenz; Orchestrierung als Command + Editor-Kontextmenü in `main.ts`. Mechanisch ersetzt sofort (Cmd-Z), LLM streamt in ein Vorschau-Modal, destruktiv erst nach Bestätigung.

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API, bestehender `ChatClient` (SSE-Stream).

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Alle Tests grün** nach jeder Änderung (`npm test`), `npx tsc --noEmit` und `npm run lint` sauber.
- **Commits:** Conventional Commits, deutsche Beschreibung; **nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **obsidian-Import nur an der Kante:** neue obsidian-gekoppelte Dateien (`reformat_picker.ts`, `reformat_preview_modal.ts`) folgen dem bestehenden `note_picker.ts`/`template_picker.ts`-Muster; pure Module (`reformat_mechanical.ts`, `reformat_transforms.ts`, `reformat_prompts.ts`) importieren **kein** obsidian.
- **UI-STANDARD:** obsidian-nativ, nur Theme-CSS-Variablen (`var(--…)`), keine Hexwerte.
- **Reuse:** LLM-Calls über das bestehende `this.chatClient` und `this.settings.chatModel`; keine neuen Settings.
- **LLM-Call-Parameter fix:** `temperature: 0.2`, `suppressThinking: true`, `maxTokens: REFORMAT_MAX_TOKENS`.

## File Structure

| Datei | Verantwortung | obsidian? |
|---|---|---|
| `src/reformat_mechanical.ts` (neu) | Deterministische Parser: `transposeTable`, `tableToList`, `wrapInCallout` + `parseTable`-Helper | nein |
| `src/reformat_prompts.ts` (neu) | LLM-Prompt-Builder je Format + `REFORMAT_MAX_TOKENS` | nein |
| `src/reformat_transforms.ts` (neu) | Registry `TRANSFORMS` (einzige Wahrheit für Picker + Dispatch) | nein |
| `src/reformat_picker.ts` (neu) | `pickTransform` (FuzzySuggestModal) + `promptInstruction` (Freitext-Modal) | ja |
| `src/reformat_preview_modal.ts` (neu) | `ReformatPreviewModal` (Stream-Vorschau, Anwenden/Neu/Verwerfen) | ja |
| `src/main.ts` (ändern) | Command `reformat-selection` + Editor-Kontextmenü + `reformatSelection`-Handler | ja |
| `styles.css` (ändern) | Vorschau-Modal-Styles (Theme-Variablen) | — |
| `tests/reformat_mechanical.test.ts` (neu) | Test-Gewicht: Parser inkl. Edgecases | — |
| `tests/reformat_prompts.test.ts` (neu) | Prompt-Struktur je Format | — |
| `tests/reformat_transforms.test.ts` (neu) | Registry-Konsistenz | — |

**Test-Konvention:** Tasks 1–3 (pure) sind TDD. Tasks 4–6 (obsidian-Glue) werden über `tsc --noEmit` + `lint` + `build` verifiziert und am Ende per GUI-Smoke — konsistent mit `note_picker.ts`/`template_picker.ts` (obsidian-Modals sind in diesem Repo bewusst nicht unit-getestet; das Test-Gewicht trägt der pure Kern).

---

### Task 1: Mechanische Transforms (pure)

**Files:**
- Create: `src/reformat_mechanical.ts`
- Test: `tests/reformat_mechanical.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `export function transposeTable(md: string): string | null`
  - `export function tableToList(md: string): string | null`
  - `export function wrapInCallout(md: string, type: string): string`

- [ ] **Step 1: Failing test schreiben**

`tests/reformat_mechanical.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { transposeTable, tableToList, wrapInCallout } from "../src/reformat_mechanical";

describe("transposeTable", () => {
  it("kippt Header und Zeilen (erste Spalte wird Header-Zeile)", () => {
    const input = ["| Name | Alter |", "| --- | --- |", "| Anna | 30 |", "| Ben | 25 |"].join("\n");
    expect(transposeTable(input)).toBe(
      ["| Name | Anna | Ben |", "| --- | --- | --- |", "| Alter | 30 | 25 |"].join("\n"),
    );
  });
  it("entschärft escapte Pipes in Zellen", () => {
    const input = ["| A | B |", "| --- | --- |", "| x \\| y | z |"].join("\n");
    expect(transposeTable(input)).toBe(
      ["| A | x | y | z |".replace("x | y | z", "x | y") , ""].join("\n"), // Platzhalter, s. echte Erwartung unten
    );
  });
  it("füllt ragged rows mit leeren Zellen auf", () => {
    const input = ["| A | B | C |", "| --- | --- | --- |", "| 1 | 2 |"].join("\n");
    expect(transposeTable(input)).toBe(
      ["| A | 1 |", "| --- | --- |", "| B | 2 |", "| C |  |"].join("\n"),
    );
  });
  it("gibt null bei Nicht-Tabelle zurück", () => {
    expect(transposeTable("nur ein Fließtext")).toBeNull();
    expect(transposeTable("| A | B |")).toBeNull(); // keine Delimiter-Zeile
  });
});

describe("tableToList", () => {
  it("macht aus jeder Zeile einen Listenpunkt mit Header:Wert-Paaren", () => {
    const input = ["| Name | Alter |", "| --- | --- |", "| Anna | 30 |", "| Ben | 25 |"].join("\n");
    expect(tableToList(input)).toBe(
      ["- **Name:** Anna · **Alter:** 30", "- **Name:** Ben · **Alter:** 25"].join("\n"),
    );
  });
  it("gibt null bei Nicht-Tabelle zurück", () => {
    expect(tableToList("kein Table")).toBeNull();
  });
});

describe("wrapInCallout", () => {
  it("packt mehrzeiligen Text in einen Callout", () => {
    expect(wrapInCallout("Hallo\nWelt", "note")).toBe("> [!note]\n> Hallo\n> Welt");
  });
  it("nutzt den übergebenen Typ", () => {
    expect(wrapInCallout("X", "warning")).toBe("> [!warning]\n> X");
  });
});
```

Korrigiere den `escapte Pipes`-Test auf die echte Erwartung (die Platzhalter-Zeile oben ist absichtlich falsch, um in Step 2 rot zu sein — ersetze sie in Step 3-Kontext durch):

```ts
  it("entschärft escapte Pipes in Zellen", () => {
    const input = ["| A | B |", "| --- | --- |", "| x \\| y | z |"].join("\n");
    // Zelle "x | y" bleibt EINE Zelle (escapte Pipe), z bleibt zweite.
    expect(transposeTable(input)).toBe(
      ["| A | x | y |", "| --- | --- |", "| B | z |"].join("\n"),
    );
  });
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `npx vitest run tests/reformat_mechanical.test.ts`
Expected: FAIL („Cannot find module ../src/reformat_mechanical" bzw. undefined).

- [ ] **Step 3: Implementierung schreiben**

`src/reformat_mechanical.ts`:

```ts
// Reine Markdown-Struktur-Transforms (kein obsidian, in Node testbar).

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, "|"));
}

function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every(c => /^:?-{1,}:?$/.test(c.replace(/\s/g, "")));
}

/** Parst eine Markdown-Tabelle in eine Matrix (Header + Datenzeilen, ohne Delimiter-Zeile).
 *  null, wenn der Text keine Tabelle mit Delimiter-Zeile ist. Ragged rows werden aufgefüllt. */
export function parseTable(md: string): string[][] | null {
  const lines = md.trim().split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return null;
  if (!lines.every(l => l.includes("|"))) return null;
  const rows = lines.map(splitCells);
  if (!isDelimiterRow(rows[1])) return null;
  const matrix = [rows[0], ...rows.slice(2)];
  const width = Math.max(...matrix.map(r => r.length));
  return matrix.map(r => { const c = [...r]; while (c.length < width) c.push(""); return c; });
}

function renderTable(matrix: string[][]): string {
  const header = matrix[0];
  const body = matrix.slice(1);
  const headerLine = `| ${header.join(" | ")} |`;
  const delim = `| ${header.map(() => "---").join(" | ")} |`;
  const bodyLines = body.map(r => `| ${r.join(" | ")} |`);
  return [headerLine, delim, ...bodyLines].join("\n");
}

/** Kippt eine Markdown-Tabelle (Spalten↔Zeilen). null bei Nicht-Tabelle. */
export function transposeTable(md: string): string | null {
  const m = parseTable(md);
  if (!m) return null;
  const cols = m[0].length;
  const transposed: string[][] = [];
  for (let c = 0; c < cols; c++) transposed.push(m.map(row => row[c] ?? ""));
  return renderTable(transposed);
}

/** Wandelt eine Tabelle in eine Liste: pro Datenzeile ein Punkt mit Header:Wert-Paaren. null bei Nicht-Tabelle. */
export function tableToList(md: string): string | null {
  const m = parseTable(md);
  if (!m) return null;
  const header = m[0];
  const body = m.slice(1);
  if (body.length === 0) return null;
  return body.map(row =>
    "- " + header.map((h, i) => `**${h}:** ${row[i] ?? ""}`).join(" · "),
  ).join("\n");
}

/** Packt beliebigen Text in einen Obsidian-Callout `> [!type]`. Immer erfolgreich. */
export function wrapInCallout(md: string, type: string): string {
  const body = md.split("\n").map(l => `> ${l}`).join("\n");
  return `> [!${type}]\n${body}`;
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `npx vitest run tests/reformat_mechanical.test.ts`
Expected: PASS (alle Fälle grün).

- [ ] **Step 5: Commit**

```bash
git add src/reformat_mechanical.ts tests/reformat_mechanical.test.ts
git commit -m "feat(reformat): mechanische Transforms (transpose/table-to-list/callout)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: LLM-Prompt-Builder (pure)

**Files:**
- Create: `src/reformat_prompts.ts`
- Test: `tests/reformat_prompts.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` aus `./chat_client` (`{ role: "system"|"user"|"assistant"; content: string; … }`).
- Produces:
  - `export type LlmFormat = "to-list" | "to-prose" | "to-table" | "to-mermaid" | "freetext"`
  - `export const REFORMAT_MAX_TOKENS = 4096`
  - `export function buildTransformMessages(format: LlmFormat, text: string, instruction?: string): ChatMessage[]`

- [ ] **Step 1: Failing test schreiben**

`tests/reformat_prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTransformMessages, REFORMAT_MAX_TOKENS } from "../src/reformat_prompts";

describe("buildTransformMessages", () => {
  it("liefert genau [system, user] mit dem Text als User-Content", () => {
    const msgs = buildTransformMessages("to-list", "Ein Text");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1]).toEqual({ role: "user", content: "Ein Text" });
  });
  it("System-Prompt enthält die Anti-Fabrication-Anweisung", () => {
    const sys = buildTransformMessages("to-prose", "x")[0].content;
    expect(sys).toMatch(/keine.*(Fakten|Inhalte)/i);
    expect(sys).toMatch(/AUSSCHLIESSLICH/);
  });
  it("Mermaid-Format fordert einen ```mermaid-Codeblock", () => {
    const sys = buildTransformMessages("to-mermaid", "x")[0].content;
    expect(sys).toContain("```mermaid");
  });
  it("Freitext hängt die Nutzer-Anweisung an", () => {
    const sys = buildTransformMessages("freetext", "x", "mach eine Vergleichstabelle")[0].content;
    expect(sys).toContain("mach eine Vergleichstabelle");
  });
  it("exportiert einen Token-Deckel", () => {
    expect(REFORMAT_MAX_TOKENS).toBe(4096);
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `npx vitest run tests/reformat_prompts.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implementierung schreiben**

`src/reformat_prompts.ts`:

```ts
import type { ChatMessage } from "./chat_client";

export type LlmFormat = "to-list" | "to-prose" | "to-table" | "to-mermaid" | "freetext";

/** Token-Deckel für Transform-Streams (Selektionen sind klein; 4096 ist reichlich). */
export const REFORMAT_MAX_TOKENS = 4096;

const BASE = [
  "Du bist ein Markdown-Formatierungs-Assistent.",
  "Erfinde keine Fakten, füge keine neuen Inhalte hinzu und fasse nicht zusammen — strukturiere ausschließlich den gegebenen Text um.",
  "Gib AUSSCHLIESSLICH das umformatierte Markdown zurück — keine Erklärung, kein einleitender Satz.",
].join(" ");

const FORMAT_INSTRUCTION: Record<Exclude<LlmFormat, "freetext">, string> = {
  "to-list": "Wandle den Text in eine Markdown-Aufzählungsliste um (`- ` pro Punkt), ein Listenpunkt je Kernaussage.",
  "to-prose": "Wandle die Stichpunkte bzw. die Liste in zusammenhängenden Fließtext um.",
  "to-table": "Wandle den Inhalt in eine Markdown-Tabelle um; leite sinnvolle Spalten aus der Struktur des Textes ab.",
  "to-mermaid": "Wandle den Inhalt in ein Mermaid-Diagramm um und gib es in einem ```mermaid-Codeblock zurück. Wähle den passenden Diagrammtyp (z.B. flowchart TD, sequenceDiagram).",
};

/** Baut die [system, user]-Messages für einen LLM-Transform. */
export function buildTransformMessages(format: LlmFormat, text: string, instruction?: string): ChatMessage[] {
  const system = format === "freetext"
    ? `${BASE} Befolge die Anweisung des Nutzers: ${(instruction ?? "").trim()}`.trim()
    : `${BASE} ${FORMAT_INSTRUCTION[format]}`;
  return [
    { role: "system", content: system },
    { role: "user", content: text },
  ];
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `npx vitest run tests/reformat_prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reformat_prompts.ts tests/reformat_prompts.test.ts
git commit -m "feat(reformat): LLM-Prompt-Builder je Zielformat

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Transform-Registry (pure)

**Files:**
- Create: `src/reformat_transforms.ts`
- Test: `tests/reformat_transforms.test.ts`

**Interfaces:**
- Consumes: `transposeTable`/`tableToList`/`wrapInCallout` (Task 1), `buildTransformMessages` (Task 2), `ChatMessage`.
- Produces:
  - `export interface MechanicalTransform { id: string; label: string; kind: "mechanical"; run: (text: string) => string | null }`
  - `export interface LlmTransform { id: string; label: string; kind: "llm"; freetext?: boolean; buildMessages: (text: string, instruction?: string) => ChatMessage[] }`
  - `export type TransformDef = MechanicalTransform | LlmTransform`
  - `export const TRANSFORMS: TransformDef[]`

- [ ] **Step 1: Failing test schreiben**

`tests/reformat_transforms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TRANSFORMS } from "../src/reformat_transforms";

describe("TRANSFORMS-Registry", () => {
  it("enthält die erwarteten v1-Transform-IDs", () => {
    const ids = TRANSFORMS.map(t => t.id).sort();
    expect(ids).toEqual([
      "freetext", "table-to-list", "to-list", "to-mermaid", "to-prose", "to-table", "transpose", "wrap-callout",
    ].sort());
  });
  it("hat eindeutige IDs und nicht-leere Labels", () => {
    const ids = TRANSFORMS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TRANSFORMS.every(t => t.label.length > 0)).toBe(true);
  });
  it("mechanische Transforms tragen run(), LLM-Transforms buildMessages()", () => {
    for (const t of TRANSFORMS) {
      if (t.kind === "mechanical") expect(typeof t.run).toBe("function");
      else expect(typeof t.buildMessages).toBe("function");
    }
  });
  it("der Transpose-Eintrag funktioniert end-to-end über run()", () => {
    const t = TRANSFORMS.find(x => x.id === "transpose");
    expect(t?.kind).toBe("mechanical");
    const out = t?.kind === "mechanical"
      ? t.run(["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n"))
      : null;
    expect(out).toBe(["| A | 1 |", "| --- | --- |", "| B | 2 |"].join("\n"));
  });
  it("markiert genau den Freitext-Eintrag als freetext", () => {
    const ft = TRANSFORMS.filter(t => t.kind === "llm" && t.freetext);
    expect(ft.map(t => t.id)).toEqual(["freetext"]);
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `npx vitest run tests/reformat_transforms.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implementierung schreiben**

`src/reformat_transforms.ts`:

```ts
import type { ChatMessage } from "./chat_client";
import { transposeTable, tableToList, wrapInCallout } from "./reformat_mechanical";
import { buildTransformMessages } from "./reformat_prompts";

export interface MechanicalTransform {
  id: string;
  label: string;
  kind: "mechanical";
  /** null = Auswahl passt strukturell nicht (z.B. Transpose auf Nicht-Tabelle). */
  run: (text: string) => string | null;
}

export interface LlmTransform {
  id: string;
  label: string;
  kind: "llm";
  /** true nur für "Eigene Anweisung": erfordert eine Freitext-Instruktion. */
  freetext?: boolean;
  buildMessages: (text: string, instruction?: string) => ChatMessage[];
}

export type TransformDef = MechanicalTransform | LlmTransform;

/** Einzige Wahrheit über die verfügbaren Transforms — Picker (Anzeige) und Dispatch lesen sie. */
export const TRANSFORMS: TransformDef[] = [
  { id: "transpose", label: "Tabelle kippen", kind: "mechanical", run: transposeTable },
  { id: "table-to-list", label: "Tabelle → Liste", kind: "mechanical", run: tableToList },
  { id: "wrap-callout", label: "In Callout einpacken", kind: "mechanical", run: (t) => wrapInCallout(t, "note") },
  { id: "to-list", label: "→ Liste / Stichpunkte", kind: "llm", buildMessages: (t) => buildTransformMessages("to-list", t) },
  { id: "to-prose", label: "→ Fließtext", kind: "llm", buildMessages: (t) => buildTransformMessages("to-prose", t) },
  { id: "to-table", label: "→ Tabelle", kind: "llm", buildMessages: (t) => buildTransformMessages("to-table", t) },
  { id: "to-mermaid", label: "→ Mermaid-Diagramm", kind: "llm", buildMessages: (t) => buildTransformMessages("to-mermaid", t) },
  { id: "freetext", label: "Eigene Anweisung…", kind: "llm", freetext: true, buildMessages: (t, instr) => buildTransformMessages("freetext", t, instr) },
];
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `npx vitest run tests/reformat_transforms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reformat_transforms.ts tests/reformat_transforms.test.ts
git commit -m "feat(reformat): Transform-Registry als einzige Wahrheit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Picker + Freitext-Modal (obsidian)

**Files:**
- Create: `src/reformat_picker.ts`

**Interfaces:**
- Consumes: `TRANSFORMS`, `TransformDef` (Task 3); obsidian `App`, `FuzzySuggestModal`, `Modal`, `ButtonComponent`.
- Produces:
  - `export function pickTransform(app: App): Promise<TransformDef | null>`
  - `export function promptInstruction(app: App): Promise<string | null>`

Verifikation: kein Unit-Test (obsidian-Modal-Präzedenz `note_picker.ts`). `tsc` + `lint` + `build`.

- [ ] **Step 1: Datei schreiben**

`src/reformat_picker.ts`:

```ts
import { App, FuzzySuggestModal, Modal, ButtonComponent } from "obsidian";
import { TRANSFORMS, TransformDef } from "./reformat_transforms";

class TransformPicker extends FuzzySuggestModal<TransformDef> {
  private settled = false;
  constructor(app: App, private done: (d: TransformDef | null) => void) {
    super(app);
    this.setPlaceholder("Umformatieren als…");
  }
  private settle(d: TransformDef | null): void { if (!this.settled) { this.settled = true; this.done(d); } }
  getItems(): TransformDef[] { return TRANSFORMS; }
  getItemText(d: TransformDef): string { return d.label; }
  onChooseItem(d: TransformDef): void { this.settle(d); }
  onClose(): void {
    super.onClose();
    // Abbruch (null) erst nach einem Tick: onChooseItem + onClose feuern bei einer Auswahl
    // gemeinsam; so gewinnt die Auswahl unabhängig von der Reihenfolge (Muster aus note_picker.ts).
    window.setTimeout(() => this.settle(null), 0);
  }
}

/** Öffnet den Fuzzy-Picker über die Transform-Registry; gewählter TransformDef oder null. */
export function pickTransform(app: App): Promise<TransformDef | null> {
  return new Promise(resolve => new TransformPicker(app, resolve).open());
}

class InstructionModal extends Modal {
  private settled = false;
  private value = "";
  constructor(app: App, private done: (v: string | null) => void) { super(app); }
  private settle(v: string | null): void { if (!this.settled) { this.settled = true; this.done(v); } }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Eigene Anweisung" });
    const ta = contentEl.createEl("textarea", { cls: "vault-rag-reformat-instruction" });
    ta.setAttr("rows", "3");
    ta.setAttr("placeholder", "z.B. mach eine Vergleichstabelle mit Pro/Contra");
    ta.addEventListener("input", () => { this.value = ta.value; });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(row).setButtonText("Abbrechen").onClick(() => this.close());
    new ButtonComponent(row).setButtonText("Umformatieren").setCta()
      .onClick(() => { const v = this.value.trim(); if (v) { this.settle(v); this.close(); } });
    window.setTimeout(() => ta.focus(), 0);
  }
  onClose(): void {
    this.contentEl.empty();
    window.setTimeout(() => this.settle(null), 0);
  }
}

/** Öffnet ein kleines Textfeld für die Freitext-Anweisung; getrimmter Text oder null (abgebrochen/leer). */
export function promptInstruction(app: App): Promise<string | null> {
  return new Promise(resolve => new InstructionModal(app, resolve).open());
}
```

- [ ] **Step 2: Typecheck + Lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 Fehler.

- [ ] **Step 3: Commit**

```bash
git add src/reformat_picker.ts
git commit -m "feat(reformat): Transform-Picker + Freitext-Modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Vorschau-Modal (obsidian) + Styles

**Files:**
- Create: `src/reformat_preview_modal.ts`
- Modify: `styles.css` (Block am Ende anhängen)

**Interfaces:**
- Consumes: obsidian `App`, `Modal`, `ButtonComponent`.
- Produces:
  - `export interface ReformatPreviewOpts { original: string; stream: (onToken: (t: string) => void, signal: AbortSignal) => Promise<string>; onApply: (result: string) => void }`
  - `export class ReformatPreviewModal extends Modal { constructor(app: App, opts: ReformatPreviewOpts) }`

Verifikation: kein Unit-Test (obsidian-Modal). `tsc` + `lint` + `build`.

- [ ] **Step 1: Modal schreiben**

`src/reformat_preview_modal.ts`:

```ts
import { App, Modal, ButtonComponent } from "obsidian";

export interface ReformatPreviewOpts {
  /** Der markierte Ur-Text (nur Anzeige). */
  original: string;
  /** Startet einen Stream: ruft onToken je Token, resolved mit dem Volltext, bricht bei signal ab. */
  stream: (onToken: (t: string) => void, signal: AbortSignal) => Promise<string>;
  /** Wird bei „Anwenden" mit dem finalen Ergebnis aufgerufen. */
  onApply: (result: string) => void;
}

/** Zeigt Ur-Text vs. gestreamtes Ergebnis; Anwenden/Neu generieren/Verwerfen. Destruktiv erst bei Anwenden. */
export class ReformatPreviewModal extends Modal {
  private controller: AbortController | null = null;
  private result = "";
  private resultEl: HTMLElement | null = null;
  private applyBtn: ButtonComponent | null = null;

  constructor(app: App, private opts: ReformatPreviewOpts) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Umformatieren – Vorschau" });
    contentEl.createEl("p", { cls: "vault-rag-reformat-label", text: "Original" });
    contentEl.createEl("pre", { cls: "vault-rag-reformat-original", text: this.opts.original });
    contentEl.createEl("p", { cls: "vault-rag-reformat-label", text: "Ergebnis" });
    this.resultEl = contentEl.createEl("pre", { cls: "vault-rag-reformat-result" });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(row).setButtonText("Verwerfen").onClick(() => this.close());
    new ButtonComponent(row).setButtonText("Neu generieren").onClick(() => void this.run());
    this.applyBtn = new ButtonComponent(row).setButtonText("Anwenden").setCta()
      .setDisabled(true)
      .onClick(() => { this.opts.onApply(this.result); this.close(); });
    void this.run();
  }

  private async run(): Promise<void> {
    this.controller?.abort();
    const ctrl = new AbortController();
    this.controller = ctrl;
    this.result = "";
    this.resultEl?.setText("");
    this.applyBtn?.setDisabled(true);
    try {
      const out = await this.opts.stream((t) => {
        if (this.controller !== ctrl) return;
        this.result += t;
        this.resultEl?.setText(this.result);
      }, ctrl.signal);
      if (this.controller !== ctrl) return;
      this.result = out;
      this.resultEl?.setText(out);
      this.applyBtn?.setDisabled(out.trim().length === 0);
    } catch (e) {
      if (this.controller !== ctrl) return;
      this.resultEl?.setText(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
      this.applyBtn?.setDisabled(true);
    }
  }

  onClose(): void {
    this.controller?.abort();
    this.contentEl.empty();
  }
}
```

- [ ] **Step 2: Styles anhängen**

Am Ende von `styles.css` anhängen (nur Theme-Variablen, UI-STANDARD):

```css
.vault-rag-reformat-original,
.vault-rag-reformat-result {
  max-height: 40vh;
  overflow: auto;
  white-space: pre-wrap;
  background: var(--background-secondary);
  padding: var(--size-4-2);
  border-radius: var(--radius-s);
}
.vault-rag-reformat-label {
  font-weight: var(--font-semibold);
  margin-bottom: var(--size-2-1);
}
.vault-rag-reformat-instruction {
  width: 100%;
}
```

- [ ] **Step 3: Typecheck + Lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 Fehler.

- [ ] **Step 4: Commit**

```bash
git add src/reformat_preview_modal.ts styles.css
git commit -m "feat(reformat): Vorschau-Modal mit Stream + Anwenden/Neu/Verwerfen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Verdrahtung in main.ts (Command + Kontextmenü)

**Files:**
- Modify: `src/main.ts` (obsidian-Import um `Editor` ergänzen; Command + Editor-Menü in `onload` registrieren; `reformatSelection`-Methode hinzufügen)

**Interfaces:**
- Consumes: `pickTransform`, `promptInstruction` (Task 4); `ReformatPreviewModal` (Task 5); `REFORMAT_MAX_TOKENS` (Task 2); bestehendes `this.chatClient` (`stream(messages, onContent, onReasoning, signal, opts) → Promise<{content, reasoning}>`), `this.settings.chatModel`; obsidian `Editor`, `Notice`.
- Produces: nichts (Endpunkt-Task).

**WICHTIG (LESSONS 2026-07-19):** `main.ts` liegt im Repo-Root. Wird dieser Task von einem Subagenten ausgeführt, MUSS dessen erster Schritt `cd <worktree-pfad> && pwd && git branch --show-current` sein und bei Abweichung sofort BLOCKED melden — Subagent-CWD folgt nicht automatisch der Worktree-Session.

- [ ] **Step 1: obsidian-Import prüfen/ergänzen**

Öffne `src/main.ts`, finde die `import { … } from "obsidian";`-Zeile. Stelle sicher, dass `Editor` und `Notice` enthalten sind (beide ggf. hinzufügen). Beispiel:

```ts
import { /* … bestehende … */ Editor, Notice, TFile, WorkspaceLeaf } from "obsidian";
```

- [ ] **Step 2: Neue Modul-Imports ergänzen**

Bei den übrigen `./`-Imports oben in `main.ts` hinzufügen:

```ts
import { pickTransform, promptInstruction } from "./reformat_picker";
import { ReformatPreviewModal } from "./reformat_preview_modal";
import { REFORMAT_MAX_TOKENS } from "./reformat_prompts";
```

- [ ] **Step 3: Command + Kontextmenü registrieren**

In `onload()`, direkt nach dem `smart-apply-active-note`-`addCommand`-Block (um `src/main.ts:246`) einfügen:

```ts
    this.addCommand({
      id: "reformat-selection",
      name: "Abschnitt umformatieren",
      editorCallback: (editor: Editor) => void this.reformatSelection(editor),
    });

    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      if (!editor.getSelection().trim()) return;
      menu.addItem(item => item
        .setTitle("Abschnitt umformatieren")
        .setIcon("wand")
        .onClick(() => void this.reformatSelection(editor)));
    }));
```

- [ ] **Step 4: Handler-Methode hinzufügen**

Als neue private Methode der Plugin-Klasse hinzufügen (z.B. nach `healVault`/`restoreBackup`):

```ts
  /** Umformatieren-Flow: Selektion → Picker → mechanisch anwenden ODER LLM-Vorschau. */
  private async reformatSelection(editor: Editor): Promise<void> {
    const text = editor.getSelection();
    if (!text.trim()) { new Notice("Bitte einen Abschnitt markieren."); return; }
    // Range beim Auslösen festhalten — Picker/Modal ziehen den Editor-Fokus ab.
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");

    const def = await pickTransform(this.app);
    if (!def) return;

    if (def.kind === "mechanical") {
      const result = def.run(text);
      if (result == null) { new Notice("Auswahl passt nicht für diesen Transform (keine Markdown-Tabelle?)."); return; }
      editor.replaceRange(result, from, to);
      return;
    }

    let instruction: string | undefined;
    if (def.freetext) {
      const instr = await promptInstruction(this.app);
      if (instr == null) return;
      instruction = instr;
    }
    const messages = def.buildMessages(text, instruction);

    new ReformatPreviewModal(this.app, {
      original: text,
      stream: (onToken, signal) => this.chatClient
        .stream(messages, onToken, () => {}, signal, {
          model: this.settings.chatModel,
          temperature: 0.2,
          suppressThinking: true,
          maxTokens: REFORMAT_MAX_TOKENS,
        })
        .then(r => r.content),
      onApply: (result) => editor.replaceRange(result, from, to),
    }).open();
  }
```

- [ ] **Step 5: Typecheck, Lint, alle Tests, Build**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: tsc 0 Fehler; lint 0; alle Tests grün (Task-1–3-Tests inklusive); `main.js` baut.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(reformat): Command + Editor-Kontextmenü + Orchestrierung

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: GUI-Smoke (manuell, Jay)**

Plugin bauen/deployen, in Obsidian:
1. Text markieren → Command „Abschnitt umformatieren" (Palette) → Picker erscheint.
2. **Mechanisch:** eine Markdown-Tabelle markieren → „Tabelle kippen" → sofort gekippt; Cmd-Z macht rückgängig. Nicht-Tabelle → „In Callout einpacken" klappt; „Tabelle kippen" → Notice.
3. **LLM:** Fließtext markieren → „→ Liste" → Vorschau-Modal streamt → „Anwenden" ersetzt die Selektion; „Verwerfen" ändert nichts.
4. **Freitext:** „Eigene Anweisung…" → Textfeld → Vorschau.
5. **Kontextmenü:** Rechtsklick auf Selektion → „Abschnitt umformatieren".
6. **Offline-Fall:** Endpoint aus → LLM-Transform → Fehler im Modal, keine Änderung an der Notiz.

---

## Self-Review (durchgeführt)

**Spec-Coverage:**
- v1-Transforms (3 mechanisch + 5 LLM) → Task 1 (mechanisch), Task 2/3 (LLM-Prompts + Registry). ✓
- Hybrid-Engine (mechanisch offline / LLM) → Registry-`kind` + Dispatch in Task 6. ✓
- Vorschau nur bei LLM, mechanisch direkt → Task 6 `reformatSelection`-Verzweigung. ✓
- Drei Eingänge (Command/Kontextmenü/Freitext) → Task 6 (Command+Menü), Task 4 (`promptInstruction`), Registry-`freetext`-Eintrag. ✓
- Eigenes leichtes Vorschau-Modal → Task 5. ✓
- Selektion-Range festhalten + `replaceRange` → Task 6. ✓
- Fehlerbehandlung (leere Selektion, Parser-null→Notice, LLM-Fehler im Modal) → Task 6 + Task 5 `catch`. ✓
- Reuse Chat-Endpoint/Modell, keine neuen Settings, temp 0.2 / suppressThinking → Task 6. ✓
- Tests auf pure Kern → Task 1–3; Glue via tsc/lint/build/smoke → Task 4–6. ✓

**Platzhalter-Scan:** kein TBD/TODO; einziger absichtlicher Platzhalter ist der bewusst falsche `escapte Pipes`-Test in Task 1 Step 1 (rot in Step 2), direkt darunter durch die echte Erwartung ersetzt. ✓

**Typ-Konsistenz:** `TransformDef`/`MechanicalTransform.run`/`LlmTransform.buildMessages`, `buildTransformMessages(format, text, instruction?)`, `REFORMAT_MAX_TOKENS`, `ChatClient.stream(messages, onContent, onReasoning, signal, opts) → {content, reasoning}` durchgängig gleich benannt. ✓

## Offen für einen späteren Slice (bewusst NICHT hier)

- Outline-Composer (Sidebar-Gliederungspunkt → Abschnitt ersetzen/ergänzen).
- Range-Staleness-Schutz (Ur-Text vor `replaceRange` verifizieren).
- Callout-Typ-Auswahl im Picker (v1: fester Default `note`).
- Mechanisches Liste→Tabelle (v1: über LLM-`→ Tabelle`).
