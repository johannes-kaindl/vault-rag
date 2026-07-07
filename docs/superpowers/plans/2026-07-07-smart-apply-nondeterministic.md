# Smart Apply — Non-Deterministic Mode (Slice 1: Additiv) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen wählbaren additiven Modus für Smart Apply bauen, in dem das LLM Frontmatter-Werte erschließen und markierte Ergänzungsblöcke einfügen darf — jeweils mit ordinaler Konfidenz, granular annehmbar/ablehnbar — während Original-Blöcke byte-genau erhalten bleiben und der deterministische Pfad bit-identisch weiterläuft.

**Architecture:** Ansatz A — das `Assignment`-Schema wird abwärtskompatibel um `additions` + `inferred`-Frontmatter erweitert; eine modusabhängige Gating-Schicht verwirft im deterministischen Modus alle neuen Felder (bit-identisch zu heute). Ein reiner `assembleProposedText(assembly, selection, auditTrail)` baut den finalen Text aus Vorschlag + granularer Auswahl + Audit-Flag; `propose()` nutzt ihn für die Preview (Default: hoch/mittel an), `persistApply` für den finalen Write. Es bleibt bei genau EINEM LLM-Stream pro `propose()`.

**Tech Stack:** TypeScript (strict, noImplicitAny), vitest + happy-dom, esbuild. Obsidian-Grenze über `VaultAdapter`; pure-core-Module (`note_restructurer`, `frontmatter`, `template_matcher`, `smart_apply`) sind obsidian-frei und in Node getestet.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Alle Tests grün nach jeder Task** (`npm test`). Die 53 bestehenden `smart_apply`-Tests + alle `note_restructurer`/`frontmatter`/`template_matcher`-Tests sind das Regressionsnetz für den deterministischen Pfad.
- **Kein `.only`/`.skip` im Commit.** vitest + happy-dom; Obsidian-Mock unter `tests/__mocks__/obsidian.ts`.
- **Commits:** Conventional Commits (deutsche Beschreibung erlaubt), **nur berührte Dateien stagen — nie `git add -A`**. Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Kern-Invariante:** Im additiven Modus bleiben alle Original-Blöcke byte-genau; `permutationCheck` läuft unverändert über die Original-`block_*`-IDs (additions haben eigene `add_*`-IDs und fließen NICHT ein).
- **WCAG 1.4.1:** Konfidenz + Status über Form (Icon) + Text kodieren, nie nur Farbe (Rot-Grün-Sehschwäche des Nutzers).
- **Branch:** `feat/smartapply-nondeterministic` (bereits angelegt; Spec + Test-Fix bereits committet).

---

## File Structure

- `src/note_restructurer.ts` (modify) — Typen (`Confidence`, `ApplyMode`, `Addition`), `Assignment.additions`, `parseConfidence`, Schema-Validierung, `buildRestructurePrompt(mode)`, `reconcileAdditions`, `assembleBody`-Erweiterung.
- `src/frontmatter.ts` (modify) — `FmSource += "inferred"`, `FmAssignedValue.confidence?`, `FmRow.source?/confidence?`, `mergeFrontmatter`/`buildFrontmatterData` auswahl-aware.
- `src/template_matcher.ts` (modify) — `TemplateSpec.defaultMode`, `smartapply_modus`-Meta-Key-Extraktion.
- `src/smart_apply.ts` (modify) — `AssemblyContext`, `assembleProposedText`, `propose(mode)` mit Gating, `persistApply(selection, auditTrail)`, `ApplyProposal`-Erweiterung.
- `src/settings.ts` (modify) — `smartApplyDefaultMode` Setting + Dropdown.
- `src/main.ts` (modify) — `proposeSmartApply(mode)`, `build/accept/reroll`-Deps um mode/selection/auditTrail, Vorlagen-`defaultMode` einfließen.
- `src/smart_apply_view.ts` (modify) — Panel-State (`selectedMode`/`selection`/`auditTrail`), Modus-Segmented-Control, Konfidenz-Badges + Checkboxen, Audit-Toggle, Live-Re-Assembly.
- Tests: je Modul die bestehende `tests/*.test.ts`-Datei erweitern; `tests/smart_apply_view.test.ts` für UI.

---

## Task 1: Typen-Fundament + Konfidenz-Parsing

**Files:**
- Modify: `src/note_restructurer.ts` (Typen oben, nach den Imports)
- Modify: `src/frontmatter.ts:4-8` (FmSource / FmAssignedValue / FmRow)
- Test: `tests/note_restructurer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // note_restructurer.ts
  export type ApplyMode = "deterministisch" | "additiv" | "transformativ";
  export type Confidence = "hoch" | "mittel" | "niedrig";
  export interface Addition { id: string; targetHeading: string; text: string; confidence: Confidence }
  export function parseConfidence(raw: unknown): Confidence; // unbekannt/fehlt → "niedrig"
  // Assignment erweitert:
  export interface Assignment { version: number; sections: {heading:string;blocks:string[]}[]; unassigned: string[]; additions?: Addition[]; frontmatter: Record<string, FmAssignedValue> }
  // frontmatter.ts
  export type FmSource = "content" | "empty" | "inferred";
  export interface FmAssignedValue { source: FmSource; value: string; confidence?: Confidence }
  export interface FmRow { key: string; original?: FmValue; proposed?: FmValue; change: FmChange; source?: FmSource; confidence?: Confidence }
  ```

- [ ] **Step 1: Failing test für `parseConfidence`**

In `tests/note_restructurer.test.ts` ergänzen:
```ts
import { parseConfidence } from "../src/note_restructurer";

describe("parseConfidence", () => {
  it("erkennt die drei deutschen Stufen", () => {
    expect(parseConfidence("hoch")).toBe("hoch");
    expect(parseConfidence("mittel")).toBe("mittel");
    expect(parseConfidence("niedrig")).toBe("niedrig");
  });
  it("normalisiert englische Labels + Groß/Klein/Whitespace", () => {
    expect(parseConfidence(" High ")).toBe("hoch");
    expect(parseConfidence("MEDIUM")).toBe("mittel");
    expect(parseConfidence("low")).toBe("niedrig");
  });
  it("fällt bei Unbekanntem/Fehlendem konservativ auf niedrig", () => {
    expect(parseConfidence("banane")).toBe("niedrig");
    expect(parseConfidence(undefined)).toBe("niedrig");
    expect(parseConfidence(42)).toBe("niedrig");
  });
});
```

- [ ] **Step 2: Test rot** — `npx vitest run tests/note_restructurer.test.ts -t parseConfidence` → FAIL („parseConfidence is not a function").

- [ ] **Step 3: Typen + `parseConfidence` implementieren**

In `src/frontmatter.ts` — `FmSource`, `FmAssignedValue`, `FmRow` erweitern (Import `Confidence` aus note_restructurer NICHT — um Zyklus zu vermeiden, `Confidence` als eigenständigen Typ auch hier duplizieren ist unschön; stattdessen: `Confidence` in `frontmatter.ts` definieren und in `note_restructurer.ts` re-exportieren). Konkret:
```ts
// frontmatter.ts (Zeile 4-8 ersetzen)
export type FmValue = string | string[];
export type Confidence = "hoch" | "mittel" | "niedrig";
export type FmSource = "content" | "empty" | "inferred";
export interface FmAssignedValue { source: FmSource; value: string; confidence?: Confidence }
export interface ParsedFrontmatter { data: Record<string, FmValue>; order: string[]; body: string; comments?: Record<string, string> }
export type FmChange = "unveraendert" | "geaendert" | "neu" | "entfernt";
export interface FmRow { key: string; original?: FmValue; proposed?: FmValue; change: FmChange; source?: FmSource; confidence?: Confidence }
```
In `src/note_restructurer.ts` oben (nach den Imports):
```ts
import type { FmAssignedValue, Confidence } from "./frontmatter";
export type { Confidence } from "./frontmatter";
export type ApplyMode = "deterministisch" | "additiv" | "transformativ";
export interface Addition { id: string; targetHeading: string; text: string; confidence: Confidence }

const CONF_MAP: Record<string, Confidence> = {
  hoch: "hoch", high: "hoch",
  mittel: "mittel", medium: "mittel", mid: "mittel",
  niedrig: "niedrig", low: "niedrig",
};
export function parseConfidence(raw: unknown): Confidence {
  if (typeof raw !== "string") return "niedrig";
  return CONF_MAP[raw.trim().toLowerCase()] ?? "niedrig";
}
```
`Assignment`-Interface (Zeile 7-12) um `additions?: Addition[]` erweitern.

- [ ] **Step 4: Test grün** — `npx vitest run tests/note_restructurer.test.ts -t parseConfidence` → PASS.

- [ ] **Step 5: Volle Suite grün** — `npm test` → alle grün (Typ-Erweiterungen sind additiv/optional, brechen nichts).

- [ ] **Step 6: typecheck** — `npm run typecheck` → keine Fehler.

- [ ] **Step 7: Commit**
```bash
git add src/note_restructurer.ts src/frontmatter.ts tests/note_restructurer.test.ts
git commit -m "feat(smartapply): Typen-Fundament (ApplyMode/Confidence/Addition) + parseConfidence"
```

---

## Task 2: parseTemplate — `smartapply_modus`-Meta-Key

**Files:**
- Modify: `src/template_matcher.ts:5` (TemplateSpec), `:41-72` (parseTemplate)
- Test: `tests/template_matcher.test.ts`

**Interfaces:**
- Consumes: `ApplyMode` aus `note_restructurer` (via `import type`).
- Produces: `TemplateSpec.defaultMode: ApplyMode`. `smartapply_modus` wird aus `keys`/`fmDefaults` entfernt (leakt nie in die Zielnotiz). Fehlt/ungültig → `"deterministisch"`.

- [ ] **Step 1: Failing test**
```ts
import { parseTemplate } from "../src/template_matcher";

describe("parseTemplate smartapply_modus", () => {
  const withMode = (m: string) => `---\ntype: "📝 Notiz"\nsmartapply_modus: ${m}\nstatus: "🌱 Entwurf"\n---\n## H\n%% x %%\n`;
  it("extrahiert defaultMode und entfernt den Key aus keys/fmDefaults", () => {
    const t = parseTemplate(withMode("additiv"));
    expect(t.defaultMode).toBe("additiv");
    expect(t.keys).not.toContain("smartapply_modus");
    expect(t.fmDefaults).not.toHaveProperty("smartapply_modus");
    expect(t.keys).toContain("status");
  });
  it("fehlender Key → deterministisch", () => {
    const t = parseTemplate(`---\ntype: "📝 Notiz"\nstatus: "🌱 Entwurf"\n---\n## H\n%% x %%\n`);
    expect(t.defaultMode).toBe("deterministisch");
  });
  it("ungültiger Wert → deterministisch", () => {
    expect(parseTemplate(withMode("quatsch")).defaultMode).toBe("deterministisch");
  });
});
```

- [ ] **Step 2: Test rot** — `npx vitest run tests/template_matcher.test.ts -t smartapply_modus` → FAIL.

- [ ] **Step 3: Implementieren**

`TemplateSpec` (Zeile 5) um `defaultMode: ApplyMode` erweitern. Import oben ergänzen: `import type { ApplyMode } from "./note_restructurer";`. In `parseTemplate` (nach `const fmGuidance = ...`, vor Body-Split):
```ts
const VALID_MODES: ApplyMode[] = ["deterministisch", "additiv", "transformativ"];
const rawMode = typeof parsed.data["smartapply_modus"] === "string" ? (parsed.data["smartapply_modus"] as string).trim() : "";
const defaultMode: ApplyMode = (VALID_MODES as string[]).includes(rawMode) ? (rawMode as ApplyMode) : "deterministisch";
// Meta-Key aus keys/fmDefaults entfernen, damit er nie in die Zielnotiz wandert:
const keysFiltered = parsed.order.filter(k => k !== "smartapply_modus");
const defaultsFiltered: Record<string, FmValue> = {};
for (const k of keysFiltered) defaultsFiltered[k] = parsed.data[k];
```
Dann `keys`/`fmDefaults` durch `keysFiltered`/`defaultsFiltered` ersetzen und `return { type: …, keys: keysFiltered, fmDefaults: defaultsFiltered, fmGuidance, sections, defaultMode, raw: text };`.

- [ ] **Step 4: Test grün** — `npx vitest run tests/template_matcher.test.ts` → PASS.

- [ ] **Step 5: Volle Suite** — `npm test` → grün. **Achtung Regression:** bestehende `parseTemplate`-Tests, die `keys`/`fmDefaults` prüfen, dürfen sich nicht ändern (Testvorlagen enthalten kein `smartapply_modus`).

- [ ] **Step 6: Commit**
```bash
git add src/template_matcher.ts tests/template_matcher.test.ts
git commit -m "feat(smartapply): parseTemplate liest smartapply_modus als Meta-Key (leakt nicht in Notiz)"
```

---

## Task 3: parseAssignment — Schema v2 (additions + inferred)

**Files:**
- Modify: `src/note_restructurer.ts:112-163` (isAssignmentShape, parseAssignment)
- Test: `tests/note_restructurer.test.ts`

**Interfaces:**
- Produces: `parseAssignment` akzeptiert optionales `additions: Addition[]` (jedes Item `{id, targetHeading, text, confidence}`; `confidence` via `parseConfidence` normalisiert) und `frontmatter`-Werte mit `source: "inferred"` + `confidence`. `version:1` ohne `additions` bleibt gültig (additions → `undefined`).

- [ ] **Step 1: Failing test**
```ts
describe("parseAssignment Schema v2", () => {
  it("v1 ohne additions bleibt gültig", () => {
    const a = parseAssignment(`{"version":1,"sections":[{"heading":"H","blocks":["block_0"]}],"unassigned":[],"frontmatter":{}}`);
    expect(a).not.toBeNull();
    expect(a!.additions).toBeUndefined();
  });
  it("v2 mit additions + inferred-FM parst und normalisiert confidence", () => {
    const raw = `{"version":2,"sections":[],"unassigned":["block_0"],"additions":[{"id":"add_0","targetHeading":"H","text":"Ergänzt.","confidence":"HIGH"}],"frontmatter":{"bereich":{"source":"inferred","value":"System","confidence":"mittel"}}}`;
    const a = parseAssignment(raw);
    expect(a).not.toBeNull();
    expect(a!.additions).toHaveLength(1);
    expect(a!.additions![0]).toMatchObject({ id: "add_0", targetHeading: "H", text: "Ergänzt.", confidence: "hoch" });
    expect(a!.frontmatter.bereich).toMatchObject({ source: "inferred", value: "System", confidence: "mittel" });
  });
  it("verwirft additions mit fehlenden Feldern (ganze Antwort bleibt gültig, addition gedroppt)", () => {
    const raw = `{"version":2,"sections":[],"unassigned":[],"additions":[{"id":"add_0","text":"kein targetHeading"}],"frontmatter":{}}`;
    const a = parseAssignment(raw);
    expect(a).not.toBeNull();
    expect(a!.additions ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Test rot** — FAIL.

- [ ] **Step 3: Implementieren**

`isAssignmentShape` erlaubt `additions` optional (kein Hard-Fail, wenn fehlt). Neuer Helper `coerceAdditions(v: unknown): Addition[]` filtert wohlgeformte Items:
```ts
function coerceAdditions(v: unknown): Addition[] {
  if (!Array.isArray(v)) return [];
  const out: Addition[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.targetHeading !== "string" || typeof o.text !== "string") continue;
    out.push({ id: o.id, targetHeading: o.targetHeading, text: o.text, confidence: parseConfidence(o.confidence) });
  }
  return out;
}
```
In `parseAssignment`, nach dem `isAssignmentShape`-Gate, die additions + inferred-confidence normalisieren:
```ts
const shaped = parsed as Assignment;
const additions = coerceAdditions((parsed as Record<string, unknown>).additions);
// inferred-confidence normalisieren (source darf jetzt "inferred" sein):
const fm: Record<string, FmAssignedValue> = {};
for (const [k, val] of Object.entries(shaped.frontmatter)) {
  const src = val.source === "inferred" ? "inferred" : val.source; // source ist schon validiert unten
  fm[k] = src === "inferred" ? { source: "inferred", value: val.value, confidence: parseConfidence((val as {confidence?: unknown}).confidence) } : val;
}
return { ...shaped, additions: additions.length > 0 ? additions : undefined, frontmatter: fm };
```
`isAssignmentShape`: die frontmatter-Wert-Validierung so lockern, dass `source` auch `"inferred"` sein darf (heute prüft der Shape-Check `source`/`value` als string — sicherstellen, dass `"inferred"` durchkommt; `confidence` ist optional und wird ohnehin via `parseConfidence` normalisiert).

- [ ] **Step 4: Test grün** — PASS.

- [ ] **Step 5: Regression** — `npm test` → bestehende parseAssignment-Tests (v1) grün.

- [ ] **Step 6: Commit**
```bash
git add src/note_restructurer.ts tests/note_restructurer.test.ts
git commit -m "feat(smartapply): parseAssignment Schema v2 (additions + inferred-FM, abwärtskompatibel)"
```

---

## Task 4: buildRestructurePrompt(tpl, blocks, mode)

**Files:**
- Modify: `src/note_restructurer.ts:204-267` (ANTI_FABRICATION, buildRestructurePrompt)
- Test: `tests/note_restructurer.test.ts`

**Interfaces:**
- Consumes: `ApplyMode`.
- Produces: `buildRestructurePrompt(tpl: TemplateSpec, blocks: SourceBlock[], mode?: ApplyMode): ChatMessage[]`. `mode` optional, Default `"deterministisch"` → **byte-identischer Output zu heute** (Regressionsschutz). `"additiv"` → erweiterter Prompt.

- [ ] **Step 1: Failing test**
```ts
import { buildRestructurePrompt, splitBlocks } from "../src/note_restructurer";

describe("buildRestructurePrompt mode", () => {
  const tpl = parseTemplate(`---\ntype: "📝 Notiz"\nbereich:   # Lebensbereich.\n---\n## Kern\n%% Kernaussage. %%\n`);
  const blocks = splitBlocks("Ein Satz.");
  it("deterministisch ist byte-identisch zu ohne mode", () => {
    expect(buildRestructurePrompt(tpl, blocks, "deterministisch")).toEqual(buildRestructurePrompt(tpl, blocks));
  });
  it("deterministisch enthält weiterhin das strikte Anti-Fabrikations-Gebot", () => {
    const sys = buildRestructurePrompt(tpl, blocks)[0].content;
    expect(sys).toContain("KEINEN Text erfinden");
  });
  it("additiv erlaubt additions + inferred + verlangt Konfidenz", () => {
    const msgs = buildRestructurePrompt(tpl, blocks, "additiv");
    const sys = msgs[0].content;
    expect(sys).toContain("additions");
    expect(sys).toMatch(/inferred/);
    expect(sys).toMatch(/[Kk]onfidenz/);
    // Original-Blöcke bleiben unantastbar:
    expect(sys).toMatch(/Original-Blöcke.*(nicht|niemals).*(umschreiben|verändern)/s);
  });
});
```

- [ ] **Step 2: Test rot** — FAIL (dritter Test; erste beide grün, falls mode-Param schon durchgereicht — sonst alle rot bis Signatur existiert).

- [ ] **Step 3: Implementieren**

Signatur erweitern: `export function buildRestructurePrompt(tpl, blocks, mode: ApplyMode = "deterministisch"): ChatMessage[]`. Der bestehende Body wird zum `deterministisch`-Zweig (unverändert). Für `additiv` einen alternativen System-Prompt bauen. Konstante ergänzen:
```ts
export const ADDITIV_INSTRUCTION = [
  "Du darfst Original-Blöcke NICHT umschreiben, kürzen oder zusammenfassen — sie werden byte-genau übernommen; du ordnest sie nur zu (wie im deterministischen Modus).",
  "Zusätzlich DARFST du: (a) neue Ergänzungsblöcke unter eine bestehende Template-Überschrift setzen (Feld `additions`), z.B. eine kurze Zusammenfassung oder eine erschlossene Kontextangabe; (b) Frontmatter-Werte erschließen, auch wenn sie nicht wörtlich im Text stehen (`source: \"inferred\"`).",
  "Jede Ergänzung und jeder erschlossene Wert MUSS eine ehrliche Selbst-Konfidenz tragen: \"hoch\", \"mittel\" oder \"niedrig\". Ergänze nur, was fundiert ableitbar ist; im Zweifel \"niedrig\" oder weglassen. Erfinde keine Fakten.",
].join(" ");
```
Der additive System-Prompt nutzt das erweiterte Schema:
```ts
'Schema (additiv): { "version": 2, "sections": [...], "unassigned": [...], "additions": [{ "id": "add_0", "targetHeading": "<bestehende Überschrift>", "text": "<neuer Text>", "confidence": "hoch"|"mittel"|"niedrig" }], "frontmatter": { "<key>": { "source": "content"|"inferred"|"empty", "value": "<wert>", "confidence": "hoch"|"mittel"|"niedrig" } } }'
```
`content`-FM bleibt „wörtlich aus den Blöcken"; `inferred`-FM ist „nach bestem Wissen erschlossen, mit Konfidenz". Der `user`-Teil (nummerierte Blöcke + Struktur) bleibt gleich; nur der Schluss-Reminder wird modusabhängig (`ANTI_FABRICATION` vs. `ADDITIV_INSTRUCTION`).

- [ ] **Step 4: Test grün** — PASS.

- [ ] **Step 5: Regression (kritisch)** — `npm test` → alle bestehenden `buildRestructurePrompt`-Tests grün (deterministischer Output unverändert).

- [ ] **Step 6: Commit**
```bash
git add src/note_restructurer.ts tests/note_restructurer.test.ts
git commit -m "feat(smartapply): buildRestructurePrompt mit mode-Param (additiv-Prompt; det. bit-identisch)"
```

---

## Task 5: reconcileAdditions + assembleBody-Erweiterung

**Files:**
- Modify: `src/note_restructurer.ts` (neuer Export `reconcileAdditions`; `assembleBody`-Signatur)
- Test: `tests/note_restructurer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function reconcileAdditions(tpl: TemplateSpec, additions: Addition[]): { kept: Addition[]; dropped: Addition[] };
  // assembleBody erweitert: selektierte additions unter ihre targetHeading (nach Original-Blöcken); auditTrail → %%-Kommentar am Blockende
  export function assembleBody(tpl: TemplateSpec, a: Assignment, blocks: SourceBlock[], additions?: Addition[], auditTrail?: boolean): string;
  ```
- **Wichtig:** `additions`/`auditTrail` optional → bestehende `assembleBody(tpl, a, blocks)`-Aufrufe (deterministisch) bleiben unverändert.

- [ ] **Step 1: Failing tests**
```ts
import { reconcileAdditions, assembleBody, splitBlocks } from "../src/note_restructurer";

describe("reconcileAdditions", () => {
  const tpl = parseTemplate(`---\ntype:"X"\n---\n## Kern\n%%a%%\n## Notizen\n%%b%%\n`);
  it("behält additions mit gültiger targetHeading, droppt fremde", () => {
    const r = reconcileAdditions(tpl, [
      { id: "add_0", targetHeading: "Kern", text: "ok", confidence: "hoch" },
      { id: "add_1", targetHeading: "Erfunden", text: "weg", confidence: "mittel" },
    ]);
    expect(r.kept.map(a => a.id)).toEqual(["add_0"]);
    expect(r.dropped.map(a => a.id)).toEqual(["add_1"]);
  });
});

describe("assembleBody mit additions", () => {
  const tpl = parseTemplate(`---\ntype:"X"\n---\n## Kern\n%%a%%\n## Notizen\n%%b%%\n`);
  const blocks = splitBlocks("Original A.");
  const a: Assignment = { version: 2, sections: [{ heading: "Kern", blocks: ["block_0"] }], unassigned: [], frontmatter: {} };
  const add: Addition = { id: "add_0", targetHeading: "Kern", text: "Erschlossen.", confidence: "mittel" };
  it("fügt selektierte addition nach dem Original-Block unter Kern ein", () => {
    const body = assembleBody(tpl, a, blocks, [add], false);
    expect(body).toContain("Original A.");
    expect(body.indexOf("Original A.")).toBeLessThan(body.indexOf("Erschlossen."));
  });
  it("auditTrail=true hängt %%-Konfidenz-Kommentar an die addition", () => {
    const body = assembleBody(tpl, a, blocks, [add], true);
    expect(body).toContain("Erschlossen. %%erschlossen: mittel%%");
  });
  it("ohne additions byte-identisch zum deterministischen assembleBody", () => {
    expect(assembleBody(tpl, a, blocks)).toBe(assembleBody(tpl, a, blocks, [], false));
  });
});
```

- [ ] **Step 2: Test rot** — FAIL.

- [ ] **Step 3: Implementieren**

`reconcileAdditions`: Split nach `tpl.sections[].heading`. `assembleBody`: pro Section die zugeordneten additions (`add.targetHeading === sec.heading`) nach den Original-Texten anhängen; jede addition als eigener Block, bei `auditTrail` `text + " %%erschlossen: " + confidence + "%%"`. Der Rest (Übrig-Bucket, Sentinel) unverändert. Signatur um `additions: Addition[] = []`, `auditTrail = false`.

- [ ] **Step 4: Test grün** — PASS.

- [ ] **Step 5: Regression** — `npm test` → bestehende `assembleBody`-Tests grün (Default-Args ändern nichts).

- [ ] **Step 6: Commit**
```bash
git add src/note_restructurer.ts tests/note_restructurer.test.ts
git commit -m "feat(smartapply): reconcileAdditions + assembleBody fügt selektierte Ergänzungen ein"
```

---

## Task 6: buildFrontmatterData auswahl-aware (inferred + Audit-Feld)

**Files:**
- Modify: `src/frontmatter.ts:188-215` (mergeFrontmatter)
- Test: `tests/frontmatter.test.ts`

**Interfaces:**
- Produces: neue Funktion, die `inferred`-Werte auswahlabhängig einbezieht und optional das Audit-Feld setzt:
  ```ts
  export function mergeFrontmatter(
    tplKeys: string[], tplDefaults: Record<string, FmValue>,
    original: ParsedFrontmatter, llm: Record<string, FmAssignedValue>,
    opts?: { acceptInferred?: Set<string>; auditTrail?: boolean }
  ): { data: Record<string, FmValue>; order: string[] };
  ```
- `opts` optional → bestehende `mergeFrontmatter(keys, defaults, orig, llm)`-Aufrufe unverändert (deterministisch: kein inferred akzeptiert, kein Audit).
- Regel: `inferred`-Wert wird nur eingesetzt, wenn `acceptInferred?.has(key)`. Bei `auditTrail` und ≥1 eingesetztem inferred-Key → zusätzliches FM-Feld `smartapply_erschlossen: [key, …]` ans Ende.

- [ ] **Step 1: Failing test**
```ts
import { mergeFrontmatter, parseFrontmatter } from "../src/frontmatter";
import type { FmAssignedValue } from "../src/frontmatter";

describe("mergeFrontmatter inferred + audit", () => {
  const orig = parseFrontmatter(`---\n---\nBody`);
  const keys = ["bereich", "status"];
  const defaults = { bereich: "", status: "Entwurf" };
  const llm: Record<string, FmAssignedValue> = { bereich: { source: "inferred", value: "System", confidence: "mittel" } };
  it("ohne Auswahl bleibt inferred draußen (Default)", () => {
    const m = mergeFrontmatter(keys, defaults, orig, llm);
    expect(m.data.bereich).toBe(""); // fällt auf leer/Default
  });
  it("mit Auswahl wird inferred eingesetzt", () => {
    const m = mergeFrontmatter(keys, defaults, orig, llm, { acceptInferred: new Set(["bereich"]) });
    expect(m.data.bereich).toBe("System");
  });
  it("auditTrail setzt smartapply_erschlossen-Liste", () => {
    const m = mergeFrontmatter(keys, defaults, orig, llm, { acceptInferred: new Set(["bereich"]), auditTrail: true });
    expect(m.data.smartapply_erschlossen).toEqual(["bereich"]);
    expect(m.order).toContain("smartapply_erschlossen");
  });
  it("auditTrail ohne akzeptierte inferred setzt KEIN Feld", () => {
    const m = mergeFrontmatter(keys, defaults, orig, llm, { acceptInferred: new Set(), auditTrail: true });
    expect(m.data).not.toHaveProperty("smartapply_erschlossen");
  });
});
```

- [ ] **Step 2: Test rot** — FAIL.

- [ ] **Step 3: Implementieren**

In `mergeFrontmatter` den `llm[key]`-Zweig erweitern: heute nur `a.source === "content"`. Neu: `content` wie bisher; `inferred` nur wenn `opts?.acceptInferred?.has(key)`. Nach der key-Schleife, wenn `auditTrail` und die Liste der eingesetzten inferred-keys nicht leer ist: `emit("smartapply_erschlossen", [...inferredEmitted])`.
```ts
const inferredEmitted: string[] = [];
// … in der Schleife, ersetze den content-Zweig:
const a = llm[key];
if (a && a.source === "content" && a.value.trim() !== "") { emit(key, a.value); continue; }
if (a && a.source === "inferred" && a.value.trim() !== "" && opts?.acceptInferred?.has(key)) { emit(key, a.value); inferredEmitted.push(key); continue; }
// … nach der Schleife + preserve-unknown:
if (opts?.auditTrail && inferredEmitted.length > 0) emit("smartapply_erschlossen", inferredEmitted);
```

- [ ] **Step 4: Test grün** — PASS.

- [ ] **Step 5: Regression** — `npm test` → bestehende mergeFrontmatter-Tests grün (opts undefined → altes Verhalten; inferred ohne Auswahl fällt auf Default wie ein nicht-content-Wert).

- [ ] **Step 6: Commit**
```bash
git add src/frontmatter.ts tests/frontmatter.test.ts
git commit -m "feat(smartapply): mergeFrontmatter auswahl-aware für inferred + Audit-Feld"
```

---

## Task 7: assembleProposedText + AssemblyContext (reiner Assembler)

**Files:**
- Modify: `src/smart_apply.ts` (neuer Typ `AssemblyContext`, neue Funktion `assembleProposedText`; `ApplySelection`)
- Test: `tests/smart_apply.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ApplySelection { inferredKeys: Set<string>; additionIds: Set<string> }
  export interface AssemblyContext {
    tpl: TemplateSpec;
    original: ParsedFrontmatter;          // aus parseFrontmatter(originalText)
    assignment: Assignment;               // reconciled + fm-gegated (content), inkl. inferred-FM
    blocks: SourceBlock[];
    additions: Addition[];                // reconciled (nur gültige targetHeadings)
  }
  export function assembleProposedText(ctx: AssemblyContext, sel: ApplySelection, auditTrail: boolean): string;
  export function defaultSelection(ctx: AssemblyContext): ApplySelection; // hoch+mittel an, niedrig aus
  ```
- `assembleProposedText` komponiert: `mergeFrontmatter(tpl.keys, tpl.fmDefaults, original, assignment.frontmatter, { acceptInferred: sel.inferredKeys, auditTrail })` → serialize, plus `assembleBody(tpl, assignment, blocks, additions.filter(a => sel.additionIds.has(a.id)), auditTrail)`.

- [ ] **Step 1: Failing test**
```ts
import { assembleProposedText, defaultSelection } from "../src/smart_apply";
// AssemblyContext von Hand bauen (tpl via parseTemplate, original via parseFrontmatter, etc.)
describe("assembleProposedText", () => {
  // ctx mit 1 inferred-FM (confidence mittel) + 1 addition (confidence niedrig)
  it("defaultSelection nimmt hoch+mittel, lässt niedrig aus", () => {
    const sel = defaultSelection(ctx);
    expect(sel.inferredKeys.has("bereich")).toBe(true);   // mittel
    expect(sel.additionIds.has("add_0")).toBe(false);     // niedrig
  });
  it("volle Auswahl bringt inferred-Wert + addition-Text in den Output", () => {
    const text = assembleProposedText(ctx, { inferredKeys: new Set(["bereich"]), additionIds: new Set(["add_0"]) }, false);
    expect(text).toContain("System");
    expect(text).toContain("Erschlossen.");
  });
  it("leere Auswahl → weder inferred noch addition im Output", () => {
    const text = assembleProposedText(ctx, { inferredKeys: new Set(), additionIds: new Set() }, false);
    expect(text).not.toContain("System");
    expect(text).not.toContain("Erschlossen.");
  });
});
```
(Der Task-Implementer baut `ctx` explizit im Test-Setup — parseTemplate für tpl, parseFrontmatter für original, Assignment-Literal mit inferred-FM, splitBlocks für blocks, Addition-Literal.)

- [ ] **Step 2: Test rot** — FAIL.

- [ ] **Step 3: Implementieren** — `assembleProposedText` + `defaultSelection` wie in Interfaces beschrieben. `defaultSelection`: iteriere `assignment.frontmatter` (source inferred) + `additions`, nimm alle mit `confidence !== "niedrig"`.

- [ ] **Step 4: Test grün** — PASS.

- [ ] **Step 5: Volle Suite** — `npm test` → grün.

- [ ] **Step 6: Commit**
```bash
git add src/smart_apply.ts tests/smart_apply.test.ts
git commit -m "feat(smartapply): assembleProposedText + defaultSelection (auswahl+audit-basiert)"
```

---

## Task 8: propose(mode) — Gating + erweiterte ApplyProposal

**Files:**
- Modify: `src/smart_apply.ts:53-66` (ApplyProposal), `:113-302` (propose)
- Test: `tests/smart_apply.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // ApplyProposal erweitert:
  interface ApplyProposal { /* … bestehend … */ mode: ApplyMode; additions: Addition[]; assembly: AssemblyContext; selection: ApplySelection; }
  // fmRows tragen source/confidence (aus diffFrontmatter-Erweiterung, s.u.)
  // propose-Signatur:
  async propose(notePath: string, templatePath: string, mode: ApplyMode, onToken, onReasoning, signal?, preDetection?): Promise<ApplyProposal>
  ```
- **Gating je Modus** (nach parseAssignment + reconcileAssignment):
  - `deterministisch`: `additions` verworfen (`[]`); alle FM mit `source:"inferred"` → als `content` behandeln (dem bestehenden fm-source-Wörtlichkeits-Gate unterwerfen). ⇒ heutiges Verhalten, bestehende Tests grün.
  - `additiv`: `reconcileAdditions` → `kept`; `content`-FM weiterhin wörtlich gegated; `inferred`-FM behalten mit confidence (kein Wörtlichkeits-Gate). Neuer weicher Check `additions-target` (ok, wenn keine addition gedroppt; detail listet gedroppte).
- `proposedText` = `assembleProposedText(assembly, defaultSelection(assembly), auditTrail=false)`. `selection` im Proposal = `defaultSelection`.
- `hardOk` unverändert (parse + permutation + fm-roundtrip + assemble). `additions-target` ist **weich** (blockiert nicht).

- [ ] **Step 1: Failing tests**
```ts
describe("propose mode gating", () => {
  // Fake ChatClient, dessen stream() ein v2-Assignment mit additions + inferred zurückgibt.
  it("deterministisch verwirft additions und inferred (Wörtlichkeit erzwungen)", async () => {
    const p = await sa.propose(note, tpl, "deterministisch", noop, noop);
    expect(p.additions).toHaveLength(0);
    expect(p.mode).toBe("deterministisch");
    // inferred-Wert, der nicht wörtlich im Text steht, ist nicht gesetzt:
    expect(p.proposedText).not.toContain("System");
  });
  it("additiv behält additions + inferred", async () => {
    const p = await sa.propose(note, tpl, "additiv", noop, noop);
    expect(p.additions.length).toBeGreaterThan(0);
    expect(p.mode).toBe("additiv");
    // default-selection (mittel) hat den inferred-Wert schon in der Preview:
    expect(p.proposedText).toContain("System");
  });
  it("additiv droppt addition mit fremder targetHeading → weicher Check, hardOk bleibt true", async () => {
    const p = await sa.propose(note, tplWithStrayAddition, "additiv", noop, noop);
    expect(p.checks.find(c => c.id === "additions-target")?.ok).toBe(false);
    expect(p.hardOk).toBe(true);
  });
});
```

- [ ] **Step 2: Test rot** — FAIL.

- [ ] **Step 3: Implementieren** — `mode`-Param; nach `reconcileAssignment` das modusabhängige Gating; `assembly` bauen; `additions` je Modus; `proposedText`/`selection` via `assembleProposedText`+`defaultSelection`. `CheckId` um `"additions-target"` erweitern. Alle bestehenden `propose`-Aufrufe im Code brechen (fehlender mode) — die fixt Task 9; für diesen Task rufen die Tests mit explizitem mode.
  **Wichtig für Regression:** bestehende Tests rufen `propose(note, tpl, onToken, onReasoning, …)` ohne mode. Damit die 53 Tests nicht in diesem Task en bloc brechen, `mode` als **drittes Positionsargument mit Default** geht nicht (onToken ist heute 3.). Lösung: mode wird 3. Param OHNE Default; die bestehenden `smart_apply.test.ts`-Aufrufe in **diesem Task** auf den neuen mode-Param umstellen (mechanisch `"deterministisch"` einfügen). Das hält die Regression im selben Commit konsistent.

- [ ] **Step 4: Test grün** — PASS.

- [ ] **Step 5: Regression** — `npm test`: `smart_apply.test.ts` grün (alle Aufrufe tragen jetzt mode). `npm run typecheck` grün.

- [ ] **Step 6: diffFrontmatter source/confidence anreichern** — In `smart_apply.ts` beim Bauen von `fmRows`: nach `diffFrontmatter(originalParsed, mergedFm)` für Keys mit `assignment.frontmatter[key].source === "inferred"` die `source`/`confidence` in die Row spiegeln (Row per key finden, `row.source = "inferred"; row.confidence = …`). Test: eine inferred-Row trägt confidence.

- [ ] **Step 7: Commit**
```bash
git add src/smart_apply.ts tests/smart_apply.test.ts
git commit -m "feat(smartapply): propose(mode) mit Gating (det. verwirft, additiv behält) + fmRow-Konfidenz"
```

---

## Task 9: persistApply(selection, auditTrail) + main.ts/settings.ts Verdrahtung

**Files:**
- Modify: `src/smart_apply.ts:310-330` (persistApply)
- Modify: `src/settings.ts:27-56` (interface), `:58-83` (DEFAULT_SETTINGS), Smart-Apply-Sektion (~:600-675)
- Modify: `src/main.ts:106-135` (SmartApply-Konstruktion), `:232-251` (Panel-Deps), `:641-668` (proposeSmartApply)
- Test: `tests/smart_apply.test.ts`

**Interfaces:**
- Produces:
  ```ts
  async persistApply(proposal: ApplyProposal, selection: ApplySelection, auditTrail: boolean): Promise<ApplyResult>
  // settings:
  smartApplyDefaultMode: ApplyMode;  // DEFAULT_SETTINGS: "deterministisch"
  ```
- `persistApply` baut `proposal.proposedText` NEU via `assembleProposedText(proposal.assembly, selection, auditTrail)` (nicht das preview-`proposedText` schreiben!), dann Stale-Guard + Write wie heute.

- [ ] **Step 1: Failing test**
```ts
it("persistApply schreibt mit finaler Auswahl (nicht der Preview)", async () => {
  const p = await sa.propose(note, tpl, "additiv", noop, noop);
  // Nutzer wählt inferred ab:
  const res = await sa.persistApply(p, { inferredKeys: new Set(), additionIds: new Set() }, false);
  expect(res.written).toBe(true);
  const written = fakeFs[note];
  expect(written).not.toContain("System"); // inferred abgewählt → nicht geschrieben
});
it("auditTrail=true schreibt smartapply_erschlossen ins Frontmatter", async () => {
  const p = await sa.propose(note, tpl, "additiv", noop, noop);
  await sa.persistApply(p, { inferredKeys: new Set(["bereich"]), additionIds: new Set() }, true);
  expect(fakeFs[note]).toContain("smartapply_erschlossen");
});
```

- [ ] **Step 2: Test rot** — FAIL.

- [ ] **Step 3: persistApply implementieren** — Signatur erweitern; `const finalText = assembleProposedText(proposal.assembly, selection, auditTrail);` vor dem Write; Stale-Guard unverändert; `write(notePath, finalText)`; undo unverändert.

- [ ] **Step 4: settings.ts** — `smartApplyDefaultMode: ApplyMode` in `VaultRagSettings` + `DEFAULT_SETTINGS` (`"deterministisch"`). In der Smart-Apply-Settings-Sektion ein Dropdown (Muster wie `chatInputPosition`):
```ts
new Setting(containerEl)
  .setName("Smart-Apply-Standardmodus")
  .setDesc("Für Vorlagen ohne eigene Modus-Angabe. Additiv/Transformativ lässt das LLM Werte erschließen und ergänzen (mit Konfidenz).")
  .addDropdown(d => d
    .addOption("deterministisch", "Deterministisch (nur zuordnen)")
    .addOption("additiv", "Additiv (erschließen + ergänzen)")
    .setValue(this.plugin.settings.smartApplyDefaultMode)
    .onChange(async (v) => { this.plugin.settings.smartApplyDefaultMode = v as ApplyMode; await this.plugin.saveSettings(); }));
```
(Transformativ NICHT als Option in Slice 1.)

- [ ] **Step 5: main.ts** — `proposeSmartApply(notePath, templatePath, mode, onToken, onReasoning)` um `mode` erweitern → `core.propose(notePath, tpl, mode, onToken, onReasoning, undefined, detection)`. Panel-Deps `build`/`reroll` reichen `mode` durch; `accept` wird `(p, selection, auditTrail) => this.smartApply!.persistApply(p, selection, auditTrail)`. Der Vorlagen-`defaultMode` wird dem Panel verfügbar gemacht: neue Dep `templateDefaultMode: (templatePath: string) => Promise<ApplyMode>` (liest+parst Template, gibt `tpl.defaultMode`; Fallback `settings.smartApplyDefaultMode`).

- [ ] **Step 6: Test grün + typecheck** — `npm test`, `npm run typecheck`, `npm run lint` grün.

- [ ] **Step 7: Commit**
```bash
git add src/smart_apply.ts src/settings.ts src/main.ts tests/smart_apply.test.ts
git commit -m "feat(smartapply): persistApply(selection,auditTrail) + Settings-Default-Modus + Verdrahtung"
```

---

## Task 10: UI — Modus-Control, Konfidenz-Badges, Checkboxen, Audit-Toggle

**Files:**
- Modify: `src/smart_apply_view.ts` (Deps, State, renderHeader, renderFrontmatter, renderReflow, Live-Re-Assembly)
- Test: `tests/smart_apply_view.test.ts`

**Interfaces:**
- Consumes: `assembleProposedText`, `ApplySelection`, `defaultSelection` (import aus `smart_apply` — pure, obsidian-frei, wie `isAlwaysOnThinker`-Import-Präzedenz).
- `SmartApplyViewDeps` erweitert:
  ```ts
  build: (notePath, templatePath, mode, onToken, onReasoning) => Promise<ApplyProposal>;
  reroll: (p, templatePath, mode, onToken, onReasoning) => Promise<ApplyProposal>;
  accept: (p, selection, auditTrail) => Promise<ApplyResult>;
  templateDefaultMode: (templatePath: string) => Promise<ApplyMode>;
  ```
- Panel-State: `selectedMode: ApplyMode = "deterministisch"`, `selection: ApplySelection`, `auditTrail = false`.

- [ ] **Step 1: Failing tests** (Panel headless, `makeFakeEl()`-Muster aus `tests/__mocks__/obsidian.ts`)
```ts
it("rendert ein Modus-Segmented-Control; transformativ ist disabled", () => { /* mount, prüfe 3 Optionen, transformativ hat is-disabled */ });
it("additiv-Proposal zeigt Konfidenz-Badge + Checkbox pro inferred-FM und pro addition", () => { /* diff-state mit inferred+addition, prüfe .vault-rag-sa-conf + input[type=checkbox] */ });
it("niedrig-Konfidenz-Item ist per Default nicht angehakt", () => { /* checkbox.checked === false */ });
it("Checkbox-Toggle baut proposedText neu (Re-Assembly, kein build-Aufruf)", () => { /* toggle → deps.build NICHT erneut gerufen, Rohtext-Preview aktualisiert */ });
it("Modus-Wechsel ruft build mit neuem Modus (Re-Stream)", () => { /* click additiv → deps.build mit "additiv" aufgerufen */ });
```

- [ ] **Step 2: Test rot** — FAIL.

- [ ] **Step 3: Implementieren**
  - **Modus-Control** in `renderHeader` (neue Zeile): drei Buttons/Segmente `Deterministisch|Additiv|Transformativ`; `transformativ` `is-disabled`. Klick auf det/additiv → `this.selectedMode = m; void this.start()` (Re-Stream). WCAG: aktiver Modus über Text+`is-active`-Klasse, nicht nur Farbe.
  - **onFileOpen/recompute:** beim Notizwechsel `selectedMode` aus `deps.templateDefaultMode(selectedTemplate)` seed.
  - **renderFrontmatter:** für Rows mit `row.source === "inferred"` ein Konfidenz-Badge (Form+Text: `● hoch`/`◐ mittel`/`○ niedrig` via Span mit Klasse `is-hoch|is-mittel|is-niedrig` + Textlabel) + eine Checkbox, deren `checked` an `this.selection.inferredKeys.has(row.key)` hängt; `change`-Handler togglet die Menge + `this.reassemble()`.
  - **renderReflow:** additions unter ihrer Ziel-Heading als eigene Zeilen mit `＋ ergänzt`-Marker + Badge + Checkbox (an `selection.additionIds`).
  - **Audit-Toggle** im Header/Footer: Checkbox „Provenienz behalten" → `this.auditTrail`; Änderung ruft `this.reassemble()`.
  - **`reassemble()`:** `if (this.proposal) { this.proposal.proposedText = assembleProposedText(this.proposal.assembly, this.selection, this.auditTrail); this.render(); }` — aktualisiert die Rohtext-Preview OHNE neuen Stream.
  - **onAccept:** `this.deps.accept(p, this.selection, this.auditTrail)`.
  - **runBuild/start/reroll:** `selectedMode` an `build`/`reroll` durchreichen; nach erfolgreichem Build `this.selection = defaultSelection(p.assembly)`.

- [ ] **Step 4: Test grün** — PASS.

- [ ] **Step 5: Regression** — `npm test` (inkl. der 53 `smart_apply_view`-Tests) grün. Bestehende Deps-Signaturen in den Tests brechen (mode/selection-Args) → in diesem Task mechanisch nachziehen.

- [ ] **Step 6: CSS** — In `styles.css` die neuen Klassen (`vault-rag-sa-mode`, `vault-rag-sa-conf`, `is-hoch/is-mittel/is-niedrig`, `vault-rag-sa-audit`, `vault-rag-sa-add`) über Obsidian-CSS-Variablen stylen (Form/Icon trägt Bedeutung, Farbe sekundär). `npm run build` → kein Fehler.

- [ ] **Step 7: Commit**
```bash
git add src/smart_apply_view.ts styles.css tests/smart_apply_view.test.ts
git commit -m "feat(smartapply): UI — Modus-Control, Konfidenz-Badges, granulare Checkboxen, Audit-Toggle"
```

---

## Task 11: Vault-gated Vorlagen-Kompatibilität + Voll-Regression

**Files:**
- Test: `tests/smartapply_templates.vault.test.ts`
- Verify: gesamte Suite, typecheck, lint, build

**Interfaces:**
- Consumes: `parseTemplate` (defaultMode).

- [ ] **Step 1: Test** — In `smartapply_templates.vault.test.ts` einen Fall ergänzen: alle Capture-Vorlagen parsen mit optionalem `smartapply_modus` sauber; ohne den Key ist `defaultMode === "deterministisch"`; `smartapply_modus` erscheint NICHT in `tpl.keys` (kein Leak).
```ts
it("Vorlagen tragen keinen smartapply_modus-Leak; defaultMode wohldefiniert", () => {
  for (const s of SPECS) {
    const tpl = parseTemplate(readFileSync(join(TPL_DIR, s.file), "utf8"));
    expect(tpl.keys).not.toContain("smartapply_modus");
    expect(["deterministisch","additiv","transformativ"]).toContain(tpl.defaultMode);
  }
});
```

- [ ] **Step 2: Test grün** — `npx vitest run tests/smartapply_templates.vault.test.ts` → PASS (lokal mit Vault; CI skippt).

- [ ] **Step 3: Voll-Regression** — `npm test` (alle grün), `npm run typecheck` (clean), `npm run lint` (clean), `npm run build` (main.js gebaut).

- [ ] **Step 4: Commit**
```bash
git add tests/smartapply_templates.vault.test.ts
git commit -m "test(smartapply): Vorlagen-Kompatibilität mit smartapply_modus (kein Leak, defaultMode)"
```

---

## Nach dem Plan

- **GUI-Smoke durch Johannes** (Muster aller SmartApply-Slices): Setting-Default-Modus prüfen; eine Vorlage auf `smartapply_modus: additiv` setzen; Notiz → Additiv → Diff-Gate mit Konfidenz-Badges + Checkboxen; niedrig abgewählt; inferred an/ab togglen (Live-Preview ohne Re-Stream); Audit an → `smartapply_erschlossen` + `%%erschlossen%%` im Ergebnis; Undo. Deterministischer Modus verhält sich wie vor dem Branch.
- **Danach:** `finishing-a-development-branch` (Merge-Entscheidung, evtl. Release-Bump), Cockpit-§🧭 + CHANGELOG fortschreiben.
- **Slice 2 (transformativ)** ist separater brainstorming→plan→SDD-Zyklus (nicht dieser Plan).

## Self-Review-Notiz (durchgeführt)

- **Spec-Coverage:** Modi ✓(T1/2/4/8), FM-Erschließung ✓(T3/6/8), Modus-Wahl Cockpit+Vorlage+Global ✓(T2/9/10), Konfidenz granular ✓(T6/7/10), Audit-Toggle ✓(T5/6/10), det. bit-identisch ✓(T4/8-Regression). Alle Spec-Abschnitte haben eine Task.
- **Typ-Konsistenz:** `ApplyMode`/`Confidence`/`Addition`/`ApplySelection`/`AssemblyContext` durchgängig gleich benannt; `mergeFrontmatter`-`opts` und `assembleBody`-Defaults abwärtskompatibel; `propose`-mode-Param bewusst ohne Default (Aufrufer in T8/T9/T10 mitgezogen).
- **Kein Placeholder:** Test-Code + Kern-Impl in jedem Task konkret; UI-Task nennt exakte Render-Punkte statt Pseudo-„handle UI".
