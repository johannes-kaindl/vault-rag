# Smart Apply (Smart Templating — Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine unstrukturierte Notiz bewusst in eine Template-Struktur überführen (Body-Reflow + Frontmatter füllen) hinter einem Preview/Diff-Gate, in vault-rag.

**Architecture:** Pure-Core (obsidian-frei, hinter `VaultAdapter` + injizierten ChatClient/Retriever/embed) macht die gesamte Logik; eine dünne Obsidian-Schicht (ein `ItemView`, ein FuzzySuggest-Picker, Settings, `main`-Verdrahtung) macht nur IO + Rendering. Non-Fabrication ist per **Block-Permutations-Vertrag** checkbar: das LLM ordnet nur nummerierte Original-Blöcke zu, der Host setzt den Body aus Original-Bytes zusammen.

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API, `streamSSE` (XMLHttpRequest). Null neue npm-Deps (eigenes `yaml_lite`).

## Global Constraints

- **Spec (SSOT):** `docs/superpowers/specs/2026-06-22-smart-apply-design.md` — bei Konflikt gewinnt die Spec.
- **Pure-Core** (`frontmatter`/`template_matcher`/`note_restructurer`/`smart_apply`) importiert NIE `obsidian`; jedes IO über injizierte Deps (`VaultAdapter`-Form + `ChatClient`). Nur `smart_apply_view`/`template_picker`/`settings`/`main` importieren `obsidian`.
- **Streaming** nur via `ChatClient.stream` → `streamSSE` (XMLHttpRequest). `fetch` ist verboten (eslint-plugin-obsidianmd).
- **Typen:** TypeScript strict + `noImplicitAny`; keine `any`-Casts für neue Typen. Vor jedem Commit `npx tsc --noEmit` UND der jeweilige `npx vitest run …` grün; am Ende `npm run lint`.
- **Tests:** vitest + happy-dom; Obsidian-Mock `tests/__mocks__/obsidian.ts`; pure Cores in Node ohne DOM. Deutsche `it()`-Strings, Imports aus `../src/…`. House-Style: `tests/retriever.test.ts`.
- **Commits:** Conventional Commits (deutsche Beschreibung ok); NUR berührte Dateien stagen (nie `git add -A`); Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Interface-Locks:** `FmSource`/`FmAssignedValue` sind in `src/frontmatter.ts` beheimatet (`note_restructurer` importiert `FmAssignedValue` von dort). Detection-Deps nutzen `search(vec, {k,minSim,exclude})` (nie `related(vec)`). `CheckId`: HART = `assignment-parse`/`permutation`/`fm-roundtrip`; WEICH = `fm-source`. `VIEW_TYPE_SMART_APPLY = "vault-rag-smart-apply"`. Der destruktive Write lebt NUR in `SmartApply.persistApply`.

## Seam-Vertrag (verbindlich — überschreibt widersprüchliche Stellen in den Tasks 4/7/9)

Der Konsistenz-Review hat Drift an der Glue-Naht gefunden; dieser Block ist die verbindliche Wahrheit:

1. **View-Entry:** `SmartApplyView` hat als öffentlichen Einstieg `run(notePath: string): Promise<void>` (KEIN `start(notePath, templatePath)`). `run` treibt intern `deps.build(notePath, onToken, onReasoning)` → Stream → Diff.
2. **main ruft run auf:** `activateSmartApplyView()` ermittelt die aktive Datei VOR `setViewState`, öffnet das Leaf und ruft danach `await (leaf.view as SmartApplyView).run(activeFile.path)`. Ohne diesen Aufruf ist die Pipeline tot.
3. **detection durchreichen:** `SmartApply.propose(...)` ruft (oder erhält) das `TypeSuggestion` aus `detect()`/`detectType` und setzt `ApplyProposal.detection = { source, confidence }`. NICHT hardcoden auf `none`. Das speist das Quelle-Badge der View.
4. **provenance = Original-Überschrift:** `sectionDiff[].provenance` ist der Original-**Überschriftentext** des/der zugeordneten Blöcke (Lookup in `blocks[].text`), NICHT die rohe Block-ID-Liste. Die View rendert „umsortiert aus: <provenance>".
5. **Erneut = neu picken:** `reroll` öffnet den Template-Picker erneut (vorausgewählt auf das aktuelle Template) und re-proposed mit der Wahl — so deckt es „nach anderem Template" (Spec).
6. **Template fehlt/unparsebar:** Der View-`run()` umschließt `build()` mit try/catch (wie ohnehin für den Picker-Abbruch „abgebrochen"). Ein nicht lesbarer Template-Read landet dort als sauberer Fehlerzustand + optionalem `Notice` „Vorlage nicht in Templates/ gefunden" — kein ungefangener Throw, nichts geschrieben. Ein View-Test deckt den catch-Pfad.
7. **Stream-Hook & Live-Feedback:** `SmartApplyViewDeps.build`/`reroll` tragen `(notePath|proposal, onToken, onReasoning)`; die `main`-Closures reichen sie an `SmartApply.propose` durch (genau EIN Stream). WICHTIG: Unter dem Block-Permutations-Vertrag streamt das LLM das **JSON-Assignment** (+ Reasoning), NICHT Body-Prosa — der Body wird erst nach dem Stream host-seitig zusammengesetzt. Slice 1 zeigt deshalb während des Streams einen Fortschritts-Spinner und rendert Diff + Reasoning beim Finalisieren; die Callbacks erfüllen den Stream-Vertrag und sind der Aufhänger für späteres Live-Reasoning. (Präzisiert die Spec-Formulierung „Body streamt live".) Bei `temperature 0` ist „Erneut" nur über das Neu-Picken (Punkt 5) sinnvoll.

## File Structure

| Datei | Layer | Verantwortung |
|---|---|---|
| `src/frontmatter.ts` | pure-core | `yaml_lite`: parse/serialize/merge/diff + Frontmatter-Wert-Typen (Heimat von `FmSource`/`FmAssignedValue`). |
| `src/template_matcher.ts` | pure-core | Typ-Fallback-Kette + Template parsen + `%%`-Strip + `detectType`. |
| `src/note_restructurer.ts` | pure-core | Block-Split + Host-Zusammenbau + Permutations-/Konservierungs-Checks. |
| `src/smart_apply.ts` | pure-core | Orchestrator + EINZIGER Writer (`detect`/`propose`/`persistApply`/`abort`). |
| `src/template_picker.ts` | obsidian-view | FuzzySuggest über `Templates/` (Schwester von `note_picker.ts`). |
| `src/smart_apply_view.ts` | obsidian-view | `ItemView` Diff-Gate (Zwei-Flächen-Diff, Live-Stream, Accept-Gate, Undo). |
| `src/settings.ts` | settings | +`smartApplyEnabled`/`templateDir`/`smartApplyTemperature` + „Smart Apply"-Sektion. |
| `src/main.ts` | glue | View/Ribbon/Command registrieren, `SmartApplyDeps` verdrahten, der eine `adapter.write`. |
| `tests/__mocks__/obsidian.ts` | glue | +`FuzzySuggestModal`/`WorkspaceLeaf`-Stubs (additiv). |

## Reihenfolge & Abhängigkeiten

Task 1 (frontmatter) → 2 (template_matcher) → 3 (note_restructurer, importiert `FmAssignedValue` aus 1) → 4 (smart_apply, nutzt 1–3 + `ChatClient`) → 5 (obsidian-Mock) → 6 (template_picker, nutzt 5) → 7 (smart_apply_view, nutzt 4+6) → 8 (settings) → 9 (main-Verdrahtung, nutzt 4+6+7+8).

---

---

### Task 1: frontmatter.ts (yaml_lite + frontmatter value types)

**Files:**
- Create: `src/frontmatter.ts`
- Test: `tests/frontmatter.test.ts`

**Interfaces:**

Consumes (none — this is the foundational task; pure Node, no `obsidian` import).

Produces (verbatim from the spec's Schnittstellen section; later tasks import these):
```ts
export type FmValue = string | string[];
export type FmSource = "content" | "empty";
export interface FmAssignedValue { source: FmSource; value: string }
export interface ParsedFrontmatter { data: Record<string, FmValue>; order: string[]; body: string }
export function parseFrontmatter(text: string): ParsedFrontmatter;   // keine Delimiter → {data:{},order:[],body:text}
export function serializeFrontmatter(data: Record<string, FmValue>, order: string[]): string; // parsebares YAML
export function mergeFrontmatter(
  tplKeys: string[], original: ParsedFrontmatter, llm: Record<string, FmAssignedValue>,
): { data: Record<string, FmValue>; order: string[] };  // preserve-existing + preserve-unknown sind INVARIANTEN
export type FmChange = "unveraendert" | "geaendert" | "neu" | "entfernt";
export interface FmRow { key: string; original?: FmValue; proposed?: FmValue; change: FmChange }
export function diffFrontmatter(original: ParsedFrontmatter, proposed: { data: Record<string, FmValue>; order: string[] }): FmRow[];
```
(`FmSource` / `FmAssignedValue` are HOMED here — `note_restructurer.ts` re-declares its own `FmSource`/`FmAssignedValue` per the Schnittstellen, but `note_restructurer.ts` imports `FmAssignedValue` FROM `./frontmatter` per the cross-task lock; this module is the single source of truth for them.)

---

- [ ] **Step 1: Failing test — types + parse with no delimiter**

Create `tests/frontmatter.test.ts` with the first behavior: a note without `---` returns empty data/order and the whole text as body.

```ts
import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  mergeFrontmatter,
  diffFrontmatter,
} from "../src/frontmatter";
import type { ParsedFrontmatter, FmAssignedValue } from "../src/frontmatter";

describe("parseFrontmatter", () => {
  it("ohne Delimiter → leeres data/order, ganzer Text als body", () => {
    const text = "# Titel\n\nNur Body, kein Frontmatter.\n";
    const r = parseFrontmatter(text);
    expect(r.data).toEqual({});
    expect(r.order).toEqual([]);
    expect(r.body).toBe(text);
  });
});
```

Run and see it FAIL (module does not exist yet):
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: FAIL — `Failed to resolve import "../src/frontmatter"`.

- [ ] **Step 2: Minimal implementation — types + parseFrontmatter skeleton**

Create `src/frontmatter.ts`. Define all exported types and a `parseFrontmatter` that handles the no-delimiter case and flat scalars + simple inline/block lists.

```ts
export type FmValue = string | string[];
export type FmSource = "content" | "empty";
export interface FmAssignedValue { source: FmSource; value: string }
export interface ParsedFrontmatter { data: Record<string, FmValue>; order: string[]; body: string }
export type FmChange = "unveraendert" | "geaendert" | "neu" | "entfernt";
export interface FmRow { key: string; original?: FmValue; proposed?: FmValue; change: FmChange }

const DELIM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    const inner = s.slice(1, -1);
    return s[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  return s;
}

function parseInlineList(raw: string): string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map(part => unquote(part));
}

export function parseFrontmatter(text: string): ParsedFrontmatter {
  const m = DELIM_RE.exec(text);
  if (!m) return { data: {}, order: [], body: text };
  const block = m[1];
  const body = text.slice(m[0].length);
  const data: Record<string, FmValue> = {};
  const order: string[] = [];
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = /^([A-Za-z0-9_][\w .-]*?):[ \t]*(.*)$/.exec(line);
    if (!kv) { i++; continue; }
    const key = kv[1].trim();
    const rest = kv[2];
    if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
      data[key] = parseInlineList(rest);
      order.push(key);
      i++;
      continue;
    }
    if (rest.trim() === "") {
      // block list: following "- item" lines
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^[ \t]*-[ \t]+/.test(lines[j])) {
        items.push(unquote(lines[j].replace(/^[ \t]*-[ \t]+/, "")));
        j++;
      }
      if (items.length > 0) { data[key] = items; order.push(key); i = j; continue; }
      data[key] = "";
      order.push(key);
      i++;
      continue;
    }
    data[key] = unquote(rest);
    order.push(key);
    i++;
  }
  return { data, order, body };
}
```

Run and see it PASS:
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: PASS — 1 passed.

- [ ] **Step 3: Failing test — serialize→reparse round-trip incl. emoji, wikilink, list**

Add a round-trip block. The values containing a leading emoji (`💻 Coding`), a wikilink (`up: [[X]]`), and a list must survive `serialize`→`parse` unchanged.

```ts
describe("serializeFrontmatter Round-Trip", () => {
  it("Emoji-Wert, Wikilink und Liste überleben serialize→parse unverändert", () => {
    const data = { type: "💻 Coding", up: "[[X]]", tags: ["a", "b"] };
    const order = ["type", "up", "tags"];
    const out = serializeFrontmatter(data, order);
    const rt = parseFrontmatter(out + "Body\n");
    expect(rt.data).toEqual(data);
    expect(rt.order).toEqual(order);
    expect(rt.body).toBe("Body\n");
  });
});
```

Run and see it FAIL (no `serializeFrontmatter` body yet — it's undefined/not exported):
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: FAIL — `serializeFrontmatter is not a function`.

- [ ] **Step 4: Minimal implementation — serializeFrontmatter with parseable-YAML quoting**

Add to `src/frontmatter.ts`. Quote/escape scalars that would otherwise reparse wrong: containing `:`, `#`, a leading emoji, leading `[`/`{`/`-`/`*`/`!`/`&`/`@`/`` ` ``/`%`, leading/trailing whitespace, or that look like booleans/numbers we want kept as strings. Wikilinks (`[[X]]`) need quoting because a leading `[` triggers list parsing.

```ts
// Codepoints that YAML / our parser would mis-handle at scalar start.
const NEEDS_QUOTE_LEADING = /^[\s>|@`%&*!?#\-[{'"]/u;

function startsWithEmoji(s: string): boolean {
  const cp = s.codePointAt(0);
  if (cp === undefined) return false;
  // Symbols & pictographs, dingbats, misc symbols, regional indicators, etc.
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f000 && cp <= 0x1f2ff) ||
    cp === 0x2b50 || cp === 0x2705 || cp === 0x274c
  );
}

function needsQuoting(v: string): boolean {
  if (v === "") return false; // empty scalar emitted bare (key:)
  if (v !== v.trim()) return true;
  if (v.includes(": ") || v.endsWith(":")) return true;
  if (v.includes(" #") || v.includes("#")) return true;
  if (v.includes("[[") || v.includes("]]")) return true;
  if (NEEDS_QUOTE_LEADING.test(v)) return true;
  if (startsWithEmoji(v)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(v)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) return true;
  return false;
}

function quoteScalar(v: string): string {
  if (!needsQuoting(v)) return v;
  return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function serializeValue(v: FmValue): string {
  if (Array.isArray(v)) return "[" + v.map(quoteScalar).join(", ") + "]";
  return v === "" ? "" : quoteScalar(v);
}

export function serializeFrontmatter(data: Record<string, FmValue>, order: string[]): string {
  const lines: string[] = ["---"];
  for (const key of order) {
    if (!(key in data)) continue;
    const ser = serializeValue(data[key]);
    lines.push(ser === "" ? `${key}:` : `${key}: ${ser}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}
```

Run and see it PASS:
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: PASS — 2 passed.

- [ ] **Step 5: Failing test — quoting edge cases reparse-stable (`:`, `#`, leading emoji)**

Add the explicit quoting edge cases. Each tricky scalar must reparse to the identical string, and the emitted line for the `#` case must actually be quoted (otherwise a real YAML parser would treat `#` as a comment).

```ts
describe("serializeFrontmatter Quoting-Edge-Cases", () => {
  it("Werte mit ':' '#' und führendem Emoji bleiben reparse-stabil", () => {
    const data = {
      title: "Plan: Phase 1",     // ":" → muss gequotet werden
      note: "C# und #tag",         // "#" → sonst YAML-Kommentar
      icon: "🔥 heiß",             // führendes Emoji
    };
    const order = ["title", "note", "icon"];
    const out = serializeFrontmatter(data, order);
    expect(out).toContain('title: "Plan: Phase 1"');
    expect(out).toContain('note: "C# und #tag"');
    expect(parseFrontmatter(out + "x").data).toEqual(data);
  });
});
```

Run and see it PASS (the Step-4 implementation already covers these):
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: PASS — 3 passed. (If it FAILS, the quoting predicate is wrong — fix `needsQuoting`/`unquote` until green; do not weaken the assertions.)

- [ ] **Step 6: Failing test — mergeFrontmatter precedence + preserve-unknown**

Add the merge invariants: existing non-empty values win over the LLM, template order is honored, and an existing key NOT in the template is preserved at the tail.

```ts
describe("mergeFrontmatter", () => {
  it("bestehender nicht-leerer Wert gewinnt, unbekannter Key bleibt am Ende erhalten", () => {
    const tplKeys = ["type", "up", "tags"];
    const original: ParsedFrontmatter = {
      data: { type: "💻 Coding", created: "2026-01-01" },
      order: ["type", "created"],
      body: "",
    };
    const llm: Record<string, FmAssignedValue> = {
      type: { source: "content", value: "📓 Note" },   // verliert gegen bestehendes
      up: { source: "content", value: "[[Parent]]" },   // neu aus LLM
      tags: { source: "empty", value: "" },             // leer
    };
    const merged = mergeFrontmatter(tplKeys, original, llm);
    expect(merged.order).toEqual(["type", "up", "tags", "created"]);
    expect(merged.data.type).toBe("💻 Coding");   // bestehend gewinnt
    expect(merged.data.up).toBe("[[Parent]]");
    expect(merged.data.tags).toBe("");
    expect(merged.data.created).toBe("2026-01-01"); // preserve-unknown
  });
});
```

Run and see it FAIL:
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: FAIL — `mergeFrontmatter is not a function`.

- [ ] **Step 7: Minimal implementation — mergeFrontmatter**

Add to `src/frontmatter.ts`. Order = template keys first, then any original key not already emitted (preserve-unknown at tail). Existing non-empty original value wins; otherwise take the LLM value (`source: "empty"` → empty string).

```ts
function isEmptyValue(v: FmValue | undefined): boolean {
  if (v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  return v.trim() === "";
}

export function mergeFrontmatter(
  tplKeys: string[],
  original: ParsedFrontmatter,
  llm: Record<string, FmAssignedValue>,
): { data: Record<string, FmValue>; order: string[] } {
  const data: Record<string, FmValue> = {};
  const order: string[] = [];
  const emit = (key: string, value: FmValue): void => {
    if (!(key in data)) order.push(key);
    data[key] = value;
  };
  for (const key of tplKeys) {
    const existing = original.data[key];
    if (!isEmptyValue(existing)) { emit(key, existing); continue; }
    const a = llm[key];
    if (a && a.source === "content" && a.value.trim() !== "") { emit(key, a.value); continue; }
    emit(key, "");
  }
  // preserve-unknown: bestehende Keys, die nicht im Template stehen, am Ende behalten
  for (const key of original.order) {
    if (key in data) continue;
    emit(key, original.data[key]);
  }
  return { data, order };
}
```

Run and see it PASS:
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: PASS — 4 passed.

- [ ] **Step 8: Failing test — diffFrontmatter classification**

Add the four-way classification over the union of original + proposed keys, in proposed order then original-only keys.

```ts
describe("diffFrontmatter", () => {
  it("klassifiziert unveraendert/geaendert/neu/entfernt", () => {
    const original: ParsedFrontmatter = {
      data: { type: "💻 Coding", old: "weg", tags: ["a"] },
      order: ["type", "old", "tags"],
      body: "",
    };
    const proposed = {
      data: { type: "📓 Note", tags: ["a"], up: "[[P]]" },
      order: ["type", "tags", "up"],
    };
    const rows = diffFrontmatter(original, proposed);
    const by = (k: string): FmRow => rows.find(r => r.key === k)!;
    expect(by("type").change).toBe("geaendert");
    expect(by("tags").change).toBe("unveraendert");
    expect(by("up").change).toBe("neu");
    expect(by("old").change).toBe("entfernt");
    expect(by("old").proposed).toBeUndefined();
    expect(by("up").original).toBeUndefined();
  });
});
```

(Add the missing import — extend the existing `import type` line to also bring in `FmRow`.)
```ts
import type { ParsedFrontmatter, FmAssignedValue, FmRow } from "../src/frontmatter";
```

Run and see it FAIL:
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: FAIL — `diffFrontmatter is not a function`.

- [ ] **Step 9: Minimal implementation — diffFrontmatter**

Add to `src/frontmatter.ts`. Compare via a stable value-equality (arrays compared element-wise).

```ts
function valueEquals(a: FmValue | undefined, b: FmValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [a];
    const bb = Array.isArray(b) ? b : [b];
    return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
  }
  return a === b;
}

export function diffFrontmatter(
  original: ParsedFrontmatter,
  proposed: { data: Record<string, FmValue>; order: string[] },
): FmRow[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const k of proposed.order) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  for (const k of original.order) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  const rows: FmRow[] = [];
  for (const key of keys) {
    const hasO = key in original.data;
    const hasP = key in proposed.data;
    const o = original.data[key];
    const p = proposed.data[key];
    let change: FmChange;
    if (hasO && !hasP) change = "entfernt";
    else if (!hasO && hasP) change = "neu";
    else change = valueEquals(o, p) ? "unveraendert" : "geaendert";
    rows.push({
      key,
      ...(hasO ? { original: o } : {}),
      ...(hasP ? { proposed: p } : {}),
      change,
    });
  }
  return rows;
}
```

Run and see it PASS:
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: PASS — 5 passed.

- [ ] **Step 10: Failing test — round-trip self-check refuses unparseable YAML**

Add an exported guard `assertParseable(fm)` that serializes then reparses and throws if the values do not round-trip — the hard Cockpit-YAML lesson. Drive it with a value that, if NOT quoted, would corrupt on reparse (`": colon"`), proving the guard catches corruption.

```ts
import { assertParseable } from "../src/frontmatter";

describe("Round-Trip-Self-Check", () => {
  it("akzeptiert sauber serialisierbares Frontmatter", () => {
    const fm = { data: { title: "Plan: X", up: "[[Y]]" }, order: ["title", "up"] };
    expect(() => assertParseable(fm)).not.toThrow();
  });
  it("verweigert nicht reparse-stabiles Frontmatter (Korruption)", () => {
    // Wert mit eingebetteter Zeilenschaltung kann unser flacher Serializer nicht
    // reparse-stabil emittieren → Self-Check MUSS werfen statt korruptes YAML zu liefern.
    const fm = { data: { note: "Zeile1\nZeile2: kaputt" }, order: ["note"] };
    expect(() => assertParseable(fm)).toThrow();
  });
});
```

Run and see it FAIL:
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: FAIL — `assertParseable is not a function`.

- [ ] **Step 11: Minimal implementation — assertParseable self-check**

Add to `src/frontmatter.ts`. Serialize, reparse the block (append a marker body), and deep-compare the data; throw on any mismatch so callers (`mergeFrontmatter` consumers in `smart_apply.ts`) can fail the `fm-roundtrip` check instead of writing corrupt YAML.

```ts
export function assertParseable(fm: { data: Record<string, FmValue>; order: string[] }): void {
  const out = serializeFrontmatter(fm.data, fm.order);
  const reparsed = parseFrontmatter(out + "\u0000BODY\u0000");
  if (reparsed.body !== "\u0000BODY\u0000") {
    throw new Error("Frontmatter-Self-Check: Body-Delimiter nicht reparse-stabil");
  }
  for (const key of fm.order) {
    if (!valueEquals(fm.data[key], reparsed.data[key])) {
      throw new Error(`Frontmatter-Self-Check: Key "${key}" nicht reparse-stabil`);
    }
  }
  for (const key of Object.keys(reparsed.data)) {
    if (!fm.order.includes(key)) {
      throw new Error(`Frontmatter-Self-Check: unerwarteter Key "${key}" nach Reparse`);
    }
  }
}
```

Run and see it PASS:
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: PASS — 7 passed.

- [ ] **Step 12: Failing test — note without frontmatter → block created with exactly one blank line before body**

Add the no-frontmatter creation case: `mergeFrontmatter` on an empty `ParsedFrontmatter` then `serializeFrontmatter` + body must yield a clean block followed by exactly one blank line before the body.

```ts
describe("Notiz ohne Frontmatter → sauber erzeugen", () => {
  it("erzeugt einen wohlgeformten Block mit genau einer Leerzeile vor dem Body", () => {
    const original = parseFrontmatter("Roher Body ohne Frontmatter.\n");
    const merged = mergeFrontmatter(["type"], original, { type: { source: "content", value: "📓 Note" } });
    const fmBlock = serializeFrontmatter(merged.data, merged.order);
    const full = fmBlock + "\n" + original.body;
    expect(full).toBe('---\ntype: "📓 Note"\n---\n\nRoher Body ohne Frontmatter.\n');
    // und es ist als Ganzes wieder parsebar:
    const rt = parseFrontmatter(full);
    expect(rt.data).toEqual({ type: "📓 Note" });
    expect(rt.body).toBe("Roher Body ohne Frontmatter.\n");
  });
});
```

Run and see it FAIL if the spacing/quoting differs from the assertion (e.g. body has two blank lines, or emoji not quoted):
```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: either PASS (implementation already correct) or FAIL on the exact-string assertion. If FAIL, adjust ONLY `serializeFrontmatter`'s trailing newline so the block ends with a single `\n` (the test supplies the blank-line `\n` itself) — do not loosen the assertion.

- [ ] **Step 13: Make it green (only if Step 12 failed)**

If the round-trip body assertion failed because the parser swallowed the blank line, confirm `DELIM_RE` consumes exactly the closing `---` line and its single trailing newline (it does: `---[ \t]*\r?\n?`), leaving `\nRoher Body…` so `body` keeps the blank line. The body in this test is `"Roher Body ohne Frontmatter.\n"` because `full` is `...---\n\nRoher...`: the parser eats `---\n`, leaving `\nRoher...`. Adjust the expected `rt.body` to `"\nRoher Body ohne Frontmatter.\n"` ONLY if that is the genuine parse result, then re-run.

```bash
npx vitest run tests/frontmatter.test.ts
```
Expected output: PASS — 8 passed.

- [ ] **Step 14: Typecheck + lint**

Run the strict typecheck and the lint (no `any`, no `fetch`, no `eslint-disable`). This module is pure Node — there must be NO `import ... from "obsidian"`.

```bash
npx tsc --noEmit && npm run lint
```
Expected output: both exit 0, no errors. (If `tsc` flags an implicit-any in a callback, add the explicit type; do not use `any`.)

- [ ] **Step 15: Full suite green**

Confirm nothing else regressed.

```bash
npm test
```
Expected output: all test files pass, including the new `tests/frontmatter.test.ts`.

- [ ] **Step 16: Commit (only the two touched files)**

```bash
git -C /Users/Shared/code/vault-rag add src/frontmatter.ts tests/frontmatter.test.ts
git -C /Users/Shared/code/vault-rag commit -m "$(cat <<'EOF'
feat(smart-apply): yaml_lite frontmatter core (parse/serialize/merge/diff + Self-Check)

parsebares-YAML-Garantie (Quoten von :/#/Emoji/[[Links]]), preserve-existing
+ preserve-unknown Invarianten in mergeFrontmatter, Serialize->Reparse-Self-Check
verweigert unlesbares YAML. Pure Node, kein obsidian-Import.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected output: one commit created touching exactly `src/frontmatter.ts` and `tests/frontmatter.test.ts`.

---

### Task 2: src/template_matcher.ts (Pure Typ-Fallback-Kette + Template-Parsing)

**Files:**
- Create: `src/template_matcher.ts`
- Test: `tests/template_matcher.test.ts`

**Interfaces:**

Consumes (from Task 1 = `src/frontmatter.ts`): nothing imported here — `template_matcher.ts` uses a **local** `FRONTMATTER_RE` (chunker's is not exported) and its own type extraction; it does NOT import `parseFrontmatter`. It does share the `FmSource`/`FmAssignedValue` world conceptually but defines no frontmatter values itself.

Produces (copy verbatim — later tasks `note_restructurer.ts`, `smart_apply.ts`, `main.ts`, `smart_apply_view.ts` rely on these):
```ts
export interface TemplateSection { heading: string; level: number; placeholder: string }
export interface TemplateSpec { type: string; keys: string[]; sections: TemplateSection[]; raw: string }
export function stripAnnotations(text: string): string;
export function extractType(noteText: string): string | null;
export function parseTemplate(text: string): TemplateSpec;
export type SuggestionSource = "frontmatter" | "rag" | "none";
export interface TypeSuggestion {
  type: string | null; templatePath: string | null;
  source: SuggestionSource; confidence: "no" | "likely" | "confirmed";
}
export interface DetectDeps {
  read: (p: string) => Promise<string>;
  listTemplates: () => Promise<string[]>;
  embed: (text: string) => Promise<Float32Array>;
  search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
  typeOf: (p: string) => Promise<string | null>;
}
export function resolveTemplateForType(type: string, templates: string[]): string | null;
export function detectType(notePath: string, deps: DetectDeps): Promise<TypeSuggestion>;
```
`SuggestionSource` and `TypeSuggestion` are re-used verbatim by `smart_apply.ts` (`ApplyProposal.detection`, `SmartApply.detect`). `DetectDeps` is the read-only subset that `SmartApplyDeps` is a superset of (same `read`/`listTemplates`/`embed`/`search`/`typeOf` shapes).

---

- [ ] **Step 1: Test-Datei anlegen mit den Typ-Konstruktor-/`stripAnnotations`-Tests (RED).** House-Style: `import` aus `"../src/..."`, deutsche `it()`-Strings, reine Node-Objekte (kein `obsidian`, kein DOM).

```ts
// tests/template_matcher.test.ts
import { describe, it, expect } from "vitest";
import {
  stripAnnotations,
  extractType,
  parseTemplate,
  resolveTemplateForType,
  detectType,
  type DetectDeps,
} from "../src/template_matcher";

describe("stripAnnotations", () => {
  it("entfernt einzeiliges %% ... %%", () => {
    expect(stripAnnotations("vor %% weg %% nach")).toBe("vor  nach");
  });
  it("entfernt mehrzeilige %% ... %%-Blöcke", () => {
    const input = "# Titel\n%%\nDas ist eine Anweisung\nüber mehrere Zeilen\n%%\nInhalt";
    expect(stripAnnotations(input)).toBe("# Titel\n\nInhalt");
  });
  it("lässt Text ohne Annotation unverändert", () => {
    expect(stripAnnotations("nur normaler Text")).toBe("nur normaler Text");
  });
});
```

- [ ] **Step 2: Test laufen lassen, FAIL sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: fails to import — `Error: Failed to resolve import "../src/template_matcher"` (module does not exist yet).

- [ ] **Step 3: Modul-Skelett + `stripAnnotations` minimal implementieren (GREEN).** Eine zeilen-emptiende Variante: ganze Zeilen, die durchs Strippen nur noch Whitespace enthalten, werden zur Leerzeile kollabiert (das `# Titel\n\nInhalt`-Verhalten oben). Lokale `FRONTMATTER_RE` (chunker's ist nicht exportiert).

```ts
// src/template_matcher.ts
export interface TemplateSection { heading: string; level: number; placeholder: string }
export interface TemplateSpec { type: string; keys: string[]; sections: TemplateSection[]; raw: string }

// Lokal — chunker.ts exportiert seine FRONTMATTER_RE nicht.
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/** Entfernt %% ... %%-Annotationen (auch mehrzeilig). Zeilen, die danach nur noch
 *  Whitespace enthalten, werden zur Leerzeile kollabiert (kein leerer Zeilenmüll). */
export function stripAnnotations(text: string): string {
  const stripped = text.replace(/%%[\s\S]*?%%/g, "");
  return stripped.replace(/^[^\S\n]+$/gm, "");
}
```

- [ ] **Step 4: Test laufen lassen, PASS sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: `stripAnnotations` describe-Block grün (3 passing); übrige imports (`extractType` etc.) sind `undefined` → deren Tests existieren noch nicht, also keine roten.

- [ ] **Step 5: `extractType`-Tests ergänzen (RED).**

```ts
describe("extractType", () => {
  it("liest type: aus dem Frontmatter", () => {
    const note = "---\ntype: 💻 Coding\nup: [[Parent]]\n---\nBody-Text";
    expect(extractType(note)).toBe("💻 Coding");
  });
  it("liefert null ohne Frontmatter", () => {
    expect(extractType("# Nur ein Body\nkein Frontmatter")).toBeNull();
  });
  it("liefert null wenn Frontmatter kein type: hat", () => {
    expect(extractType("---\ntags: [a, b]\n---\nBody")).toBeNull();
  });
  it("trimmt umgebende Anführungszeichen am type-Wert", () => {
    expect(extractType('---\ntype: "Meeting Note"\n---\nBody')).toBe("Meeting Note");
  });
});
```

- [ ] **Step 6: Test laufen lassen, FAIL sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: `extractType is not a function` für die vier neuen Tests.

- [ ] **Step 7: `extractType` implementieren (GREEN).** Nur im Frontmatter-Block suchen, `^type:` am Zeilenanfang (multiline), Wert trimmen + optionale Quotes entfernen.

```ts
/** type: aus dem Frontmatter-Block. null wenn kein Frontmatter oder kein type-Key. */
export function extractType(noteText: string): string | null {
  const fm = FRONTMATTER_RE.exec(noteText);
  if (!fm) return null;
  const m = /^type:\s*(.+)$/m.exec(fm[1]);
  if (!m) return null;
  const raw = m[1].trim();
  return raw.replace(/^["'](.*)["']$/, "$1").trim() || null;
}
```

- [ ] **Step 8: Test laufen lassen, PASS sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: `extractType`-Block grün (4 passing), `stripAnnotations` weiter grün.

- [ ] **Step 9: `parseTemplate`-Tests ergänzen (RED).** Keys aus dem Frontmatter, geordnete Headings als Sections, der unter einem Heading stehende Text als `placeholder`. `type` aus dem Frontmatter-`type:`.

```ts
describe("parseTemplate", () => {
  const tpl = [
    "---",
    "type: 💻 Coding",
    "up: ",
    "tags: ",
    "---",
    "# Zusammenfassung",
    "Worum geht es?",
    "## Details",
    "",
    "## Offene Fragen",
    "Platzhalter-Text",
  ].join("\n");

  it("extrahiert Frontmatter-Keys in Reihenfolge", () => {
    expect(parseTemplate(tpl).keys).toEqual(["type", "up", "tags"]);
  });
  it("extrahiert geordnete Überschriften mit Level", () => {
    const s = parseTemplate(tpl).sections;
    expect(s.map(x => x.heading)).toEqual(["Zusammenfassung", "Details", "Offene Fragen"]);
    expect(s.map(x => x.level)).toEqual([1, 2, 2]);
  });
  it("sammelt den Text unter einer Überschrift als placeholder", () => {
    const s = parseTemplate(tpl).sections;
    expect(s[0].placeholder).toBe("Worum geht es?");
    expect(s[1].placeholder).toBe("");
    expect(s[2].placeholder).toBe("Platzhalter-Text");
  });
  it("übernimmt den type aus dem Frontmatter und behält raw", () => {
    const spec = parseTemplate(tpl);
    expect(spec.type).toBe("💻 Coding");
    expect(spec.raw).toBe(tpl);
  });
});
```

- [ ] **Step 10: Test laufen lassen, FAIL sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: `parseTemplate is not a function` für die vier neuen Tests.

- [ ] **Step 11: `parseTemplate` implementieren (GREEN).** Keys: jede `^key:`-Zeile im Frontmatter-Block (Reihenfolge erhalten). Sections: jede `^#{1,6}\s+`-Zeile im Body, `placeholder` = getrimmter Text bis zur nächsten Heading. `type` via `extractType`.

```ts
/** Template-Datei → Schema: Frontmatter-Keys + geordnete Body-Überschriften (mit Platzhaltertext). */
export function parseTemplate(text: string): TemplateSpec {
  const fm = FRONTMATTER_RE.exec(text);
  const keys: string[] = [];
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const km = /^([A-Za-z0-9_-]+):/.exec(line);
      if (km) keys.push(km[1]);
    }
  }
  const body = fm ? text.slice(fm[0].length) : text;
  const lines = body.split("\n");
  const sections: TemplateSection[] = [];
  let cur: { heading: string; level: number; buf: string[] } | null = null;
  const flush = (): void => {
    if (cur) sections.push({ heading: cur.heading, level: cur.level, placeholder: cur.buf.join("\n").trim() });
  };
  for (const line of lines) {
    const hm = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (hm) {
      flush();
      cur = { heading: hm[2], level: hm[1].length, buf: [] };
    } else if (cur) {
      cur.buf.push(line);
    }
  }
  flush();
  return { type: extractType(text) ?? "", keys, sections, raw: text };
}
```

- [ ] **Step 12: Test laufen lassen, PASS sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: `parseTemplate`-Block grün (4 passing).

- [ ] **Step 13: `resolveTemplateForType`-Tests ergänzen (RED).** Emoji- und Case-normalisierter Match des Typs gegen die Dateinamen der Templates (Basename ohne `.md` und ohne Verzeichnis).

```ts
describe("resolveTemplateForType", () => {
  const templates = ["Templates/💻 Coding.md", "Templates/Meeting Note.md", "Templates/Buch.md"];
  it("matcht trotz Emoji und Groß/Kleinschreibung", () => {
    expect(resolveTemplateForType("coding", templates)).toBe("Templates/💻 Coding.md");
  });
  it("matcht den exakten Basename", () => {
    expect(resolveTemplateForType("Meeting Note", templates)).toBe("Templates/Meeting Note.md");
  });
  it("liefert null ohne passendes Template", () => {
    expect(resolveTemplateForType("Aufgabe", templates)).toBeNull();
  });
});
```

- [ ] **Step 14: Test laufen lassen, FAIL sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: `resolveTemplateForType is not a function` für die drei neuen Tests.

- [ ] **Step 15: `resolveTemplateForType` + interner `normalizeType` implementieren (GREEN).** Normalizer = Emoji + Whitespace strippen, lowercasen — derselbe Geist wie der spätere Byte-Konservierungs-Normalizer, hier auf Typ-Labels.

```ts
/** Emoji + Whitespace raus, lowercase — für robusten Typ/Template-Vergleich. */
function normalizeType(s: string): string {
  return s
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** Findet das Template, dessen Basename (ohne Verzeichnis/.md) zum Typ passt — emoji/case-normalisiert. */
export function resolveTemplateForType(type: string, templates: string[]): string | null {
  const want = normalizeType(type);
  if (!want) return null;
  for (const path of templates) {
    const base = path.replace(/^.*\//, "").replace(/\.md$/i, "");
    if (normalizeType(base) === want) return path;
  }
  return null;
}
```

- [ ] **Step 16: Test laufen lassen, PASS sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: `resolveTemplateForType`-Block grün (3 passing).

- [ ] **Step 17: `detectType`-Tests ergänzen — Frontmatter-Short-Circuit, RAG-Vote, none-Fallback, unreadable/untyped hits (RED).** Fake-Adapter (`read`/`listTemplates`/`typeOf`) + fake `search`/`embed`. Der `search`-Vertrag ist exakt der Lock: `search(vec, {k,minSim,exclude})`. `embed` ist die main-gespiegelte Closure-Form `(text) => Promise<Float32Array>`.

```ts
describe("detectType", () => {
  const templates = ["Templates/💻 Coding.md", "Templates/Buch.md", "Templates/Meeting Note.md"];
  function baseDeps(over: Partial<DetectDeps> = {}): DetectDeps {
    return {
      read: async () => "Body ohne Frontmatter",
      listTemplates: async () => templates,
      embed: async () => new Float32Array([1, 0]),
      search: () => [],
      typeOf: async () => null,
      ...over,
    };
  }

  it("Frontmatter-type mit passendem Template kurzschließt RAG (source=frontmatter/confirmed)", async () => {
    let searched = false;
    const deps = baseDeps({
      read: async () => "---\ntype: Coding\n---\nBody",
      search: () => { searched = true; return []; },
    });
    const s = await detectType("note.md", deps);
    expect(s).toEqual({
      type: "Coding",
      templatePath: "Templates/💻 Coding.md",
      source: "frontmatter",
      confidence: "confirmed",
    });
    expect(searched).toBe(false);
  });

  it("Frontmatter-type ohne passendes Template fällt auf RAG zurück", async () => {
    const deps = baseDeps({
      read: async () => "---\ntype: Unbekannt\n---\nBody",
      search: () => [{ path: "a.md", score: 0.9 }],
      typeOf: async () => "Buch",
    });
    const s = await detectType("note.md", deps);
    expect(s.source).toBe("rag");
    expect(s.type).toBe("Buch");
  });

  it("RAG wählt per gewichtetem Vote den Typ mit der höchsten Score-Summe", async () => {
    const types: Record<string, string> = { "a.md": "Buch", "b.md": "Coding", "c.md": "Coding" };
    const deps = baseDeps({
      search: () => [
        { path: "a.md", score: 0.9 },
        { path: "b.md", score: 0.6 },
        { path: "c.md", score: 0.55 },
      ],
      typeOf: async (p) => types[p] ?? null,
    });
    const s = await detectType("note.md", deps);
    // Coding: 0.6 + 0.55 = 1.15  >  Buch: 0.9
    expect(s.type).toBe("Coding");
    expect(s.templatePath).toBe("Templates/💻 Coding.md");
    expect(s.source).toBe("rag");
    expect(s.confidence).toBe("likely");
  });

  it("Hits ohne Typ oder unlesbar werden im Vote übersprungen", async () => {
    const deps = baseDeps({
      search: () => [
        { path: "leer.md", score: 5 },     // typeOf -> null
        { path: "kaputt.md", score: 4 },   // typeOf wirft
        { path: "ok.md", score: 0.2 },
      ],
      typeOf: async (p) => {
        if (p === "leer.md") return null;
        if (p === "kaputt.md") throw new Error("unlesbar");
        return "Buch";
      },
    });
    const s = await detectType("note.md", deps);
    expect(s.type).toBe("Buch");
    expect(s.source).toBe("rag");
  });

  it("kein Frontmatter-type und keine RAG-Treffer → source=none/no", async () => {
    const s = await detectType("note.md", baseDeps());
    expect(s).toEqual({ type: null, templatePath: null, source: "none", confidence: "no" });
  });

  it("RAG-Treffer ohne auflösbares Template → source=none", async () => {
    const deps = baseDeps({
      search: () => [{ path: "a.md", score: 0.9 }],
      typeOf: async () => "Aufgabe", // kein Template dafür
    });
    const s = await detectType("note.md", deps);
    expect(s.source).toBe("none");
    expect(s.type).toBeNull();
  });
});
```

- [ ] **Step 18: Test laufen lassen, FAIL sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: `detectType is not a function` für die sechs neuen Tests.

- [ ] **Step 19: `DetectDeps` + `TypeSuggestion` + `detectType` implementieren (GREEN).** Kette: (a) `read` → `extractType` → `resolveTemplateForType` → confirmed; (b) sonst `embed(body)` → `search(vec,{k,minSim,exclude})` → top-k `typeOf` (try/catch je Hit) → score-gewichteter Vote → resolveTemplate → likely; (c) sonst none. Body = Notiz ohne Frontmatter (lokale `FRONTMATTER_RE`).

```ts
export type SuggestionSource = "frontmatter" | "rag" | "none";
export interface TypeSuggestion {
  type: string | null; templatePath: string | null;
  source: SuggestionSource; confidence: "no" | "likely" | "confirmed";
}
export interface DetectDeps {
  read: (p: string) => Promise<string>;
  listTemplates: () => Promise<string[]>;
  embed: (text: string) => Promise<Float32Array>;
  search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
  typeOf: (p: string) => Promise<string | null>;
}

const NONE: TypeSuggestion = { type: null, templatePath: null, source: "none", confidence: "no" };
const RAG_K = 8;

/** Typ-Erkennung als Fallback-Kette (KEIN LLM): Frontmatter-type → RAG-Vote → none. */
export async function detectType(notePath: string, deps: DetectDeps): Promise<TypeSuggestion> {
  const text = await deps.read(notePath);
  const templates = await deps.listTemplates();

  // (a) Gültiges Frontmatter-type + passendes Template → bestätigt.
  const fmType = extractType(text);
  if (fmType) {
    const tpl = resolveTemplateForType(fmType, templates);
    if (tpl) return { type: fmType, templatePath: tpl, source: "frontmatter", confidence: "confirmed" };
  }

  // (b) Aktiven Body LIVE einbetten + search(vec) → gewichteter Vote über top-k Hit-Typen.
  const body = text.replace(FRONTMATTER_RE, "");
  try {
    const vec = await deps.embed(body);
    const hits = deps.search(vec, { k: RAG_K, minSim: 0, exclude: ["Templates/"] });
    const votes = new Map<string, number>();
    for (const h of hits) {
      let t: string | null;
      try { t = await deps.typeOf(h.path); } catch { continue; }
      if (!t) continue;
      votes.set(t, (votes.get(t) ?? 0) + h.score);
    }
    let bestType: string | null = null;
    let bestScore = -Infinity;
    for (const [t, score] of votes) {
      if (score > bestScore) { bestScore = score; bestType = t; }
    }
    if (bestType) {
      const tpl = resolveTemplateForType(bestType, templates);
      if (tpl) return { type: bestType, templatePath: tpl, source: "rag", confidence: "likely" };
    }
  } catch {
    // Embedder/Index offline → sauber auf none degradieren.
  }

  // (c) Nichts gefunden.
  return NONE;
}
```

- [ ] **Step 20: Test laufen lassen, ALLES grün sehen.**

```bash
npx vitest run tests/template_matcher.test.ts
```
Expected: `Test Files  1 passed`, `Tests  20 passed` (stripAnnotations 3 + extractType 4 + parseTemplate 4 + resolveTemplateForType 3 + detectType 6).

- [ ] **Step 21: Volle Suite + Typecheck + Lint grün (fangen Verschiedenes — kein `fetch`, kein `eslint-disable`, kein `any`).**

```bash
npm test && npx tsc --noEmit && npm run lint
```
Expected: alle Test-Dateien passing, `tsc` ohne Ausgabe (Exit 0), Lint ohne Fehler/Warnungen.

- [ ] **Step 22: Nur die zwei berührten Dateien committen (Conventional Commit, kein `git add -A`).**

```bash
git add src/template_matcher.ts tests/template_matcher.test.ts
git commit -m "$(cat <<'EOF'
feat(smart-apply): template_matcher — Typ-Fallback-Kette + Template-Parsing

stripAnnotations (%% multiline), extractType (lokale FRONTMATTER_RE),
parseTemplate (keys + geordnete Headings + Platzhalter), resolveTemplateForType
(emoji/case-normalisiert), detectType (Frontmatter-type → RAG-Vote → none).
Pure-core, kein obsidian-Import; search(vec,{k,minSim,exclude}) injiziert.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: ein Commit mit genau 2 geänderten Dateien (`src/template_matcher.ts`, `tests/template_matcher.test.ts`).

---

### Task 3: `note_restructurer.ts` (Non-Fabrication-Backbone)

**Files:**
- Create: `src/note_restructurer.ts`
- Test: `tests/note_restructurer.test.ts`
- (Consumes only) `src/frontmatter.ts`, `src/chat_client.ts` — not modified here.

**Interfaces:**

Consumes (from earlier tasks, copy verbatim):
```ts
// from ./frontmatter (Task 1)
export type FmSource = "content" | "empty";
export interface FmAssignedValue { source: FmSource; value: string }
// from ./chat_client (existing)
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; reasoning?: string; sources?: string[]; error?: string }
// from ./template_matcher (Task 2)
export interface TemplateSection { heading: string; level: number; placeholder: string }
export interface TemplateSpec { type: string; keys: string[]; sections: TemplateSection[]; raw: string }
```

Produces (later tasks — smart_apply.ts Task 4, view Task 7 — rely on these verbatim):
```ts
export interface SourceBlock { id: string; text: string }
export interface Assignment {
  version: number;
  sections: { heading: string; blocks: string[] }[];
  unassigned: string[];
  frontmatter: Record<string, FmAssignedValue>;
}
export type CheckId = "assignment-parse" | "permutation" | "fm-roundtrip" | "fm-source";
export interface CheckResult { id: CheckId; ok: boolean; detail?: string }
export function splitBlocks(body: string): SourceBlock[];
export function buildRestructurePrompt(tpl: TemplateSpec, blocks: SourceBlock[]): ChatMessage[];
export function parseAssignment(raw: string): Assignment | null;
export function permutationCheck(allIds: string[], a: Assignment): CheckResult;
export function assembleBody(tpl: TemplateSpec, a: Assignment, blocks: SourceBlock[]): string;
```

> NOTE: `FmAssignedValue`/`FmSource` are IMPORTED from `./frontmatter` (interface lock) — never redefined here. `CheckId`/`CheckResult` are DEFINED here. No `obsidian` import. TypeScript strict + noImplicitAny, no `any`-casts.

---

- [ ] **Step 1: Stub the module so imports resolve (RED scaffolding)**

  Create `src/note_restructurer.ts` with type definitions and not-yet-implemented function bodies so the test file compiles and fails on assertions (not on missing exports):

  ```ts
  import type { FmAssignedValue } from "./frontmatter";
  import type { ChatMessage } from "./chat_client";
  import type { TemplateSpec } from "./template_matcher";

  export interface SourceBlock { id: string; text: string }

  export interface Assignment {
    version: number;
    sections: { heading: string; blocks: string[] }[];
    unassigned: string[];
    frontmatter: Record<string, FmAssignedValue>;
  }

  export type CheckId = "assignment-parse" | "permutation" | "fm-roundtrip" | "fm-source";
  export interface CheckResult { id: CheckId; ok: boolean; detail?: string }

  export function splitBlocks(_body: string): SourceBlock[] {
    throw new Error("not implemented");
  }

  export function buildRestructurePrompt(_tpl: TemplateSpec, _blocks: SourceBlock[]): ChatMessage[] {
    throw new Error("not implemented");
  }

  export function parseAssignment(_raw: string): Assignment | null {
    throw new Error("not implemented");
  }

  export function permutationCheck(_allIds: string[], _a: Assignment): CheckResult {
    throw new Error("not implemented");
  }

  export function assembleBody(_tpl: TemplateSpec, _a: Assignment, _blocks: SourceBlock[]): string {
    throw new Error("not implemented");
  }
  ```

- [ ] **Step 2: Write the failing test for `splitBlocks` determinism + round-trip**

  Create `tests/note_restructurer.test.ts`. A test helper `assembleSpec` builds a minimal `TemplateSpec` so later prompt/assemble tests can reuse it.

  ```ts
  import { describe, it, expect } from "vitest";
  import {
    splitBlocks,
    assembleBody,
    permutationCheck,
    buildRestructurePrompt,
    parseAssignment,
    SourceBlock,
    Assignment,
  } from "../src/note_restructurer";
  import type { TemplateSpec, TemplateSection } from "../src/template_matcher";

  function spec(headings: string[]): TemplateSpec {
    const sections: TemplateSection[] = headings.map((h, i) => ({
      heading: h,
      level: 2,
      placeholder: `ph${i}`,
    }));
    return {
      type: "Test",
      keys: ["type", "tags"],
      sections,
      raw: "## " + headings.join("\n\n## "),
    };
  }

  function asg(partial: Partial<Assignment>): Assignment {
    return {
      version: 1,
      sections: [],
      unassigned: [],
      frontmatter: {},
      ...partial,
    };
  }

  describe("splitBlocks", () => {
    it("zerlegt Absätze und behandelt Überschriften als eigene Blöcke", () => {
      const body = "# Titel\n\nErster Absatz.\n\nZweiter Absatz.\n\n## Abschnitt\n\nDritter.";
      const blocks = splitBlocks(body);
      expect(blocks.map(b => b.id)).toEqual(["block_0", "block_1", "block_2", "block_3", "block_4"]);
      expect(blocks[0].text).toBe("# Titel");
      expect(blocks[1].text).toBe("Erster Absatz.");
      expect(blocks[3].text).toBe("## Abschnitt");
    });

    it("ist deterministisch (gleiche Eingabe → identische Ausgabe)", () => {
      const body = "A\n\nB\n\n## H\n\nC";
      expect(splitBlocks(body)).toEqual(splitBlocks(body));
    });

    it("erhält den Originaltext jedes Blocks byteweise (Round-Trip der Block-Texte)", () => {
      const body = "Absatz eins\nmit Umbruch.\n\n## Überschrift\n\nLetzter Absatz.";
      const blocks = splitBlocks(body);
      // jeder Block-Text ist ein zusammenhängender Substring des Originals
      for (const b of blocks) expect(body).toContain(b.text);
    });

    it("ignoriert reine Leerzeilen und liefert kein leeres Block", () => {
      const body = "Eins.\n\n\n\nZwei.";
      const blocks = splitBlocks(body);
      expect(blocks.map(b => b.text)).toEqual(["Eins.", "Zwei."]);
    });
  });
  ```

- [ ] **Step 3: Run the test and see it FAIL**

  ```bash
  npx vitest run tests/note_restructurer.test.ts
  ```

  Expected output: all four `splitBlocks` tests fail with `Error: not implemented` (thrown from the stub).

- [ ] **Step 4: Implement `splitBlocks` (minimal, deterministic, paragraph-level, headings own blocks)**

  Replace the `splitBlocks` stub body. A heading line (`#`..`######`) is always its own block; otherwise blocks are split on blank-line boundaries; each block is `trim()`-ed and empties dropped; IDs are `block_<n>`.

  ```ts
  const HEADING_LINE_RE = /^#{1,6}\s+\S/;

  export function splitBlocks(body: string): SourceBlock[] {
    const lines = body.split("\n");
    const raw: string[] = [];
    let buf: string[] = [];
    const flush = (): void => {
      const text = buf.join("\n").trim();
      if (text) raw.push(text);
      buf = [];
    };
    for (const line of lines) {
      if (HEADING_LINE_RE.test(line)) {
        flush();
        raw.push(line.trim());
      } else if (line.trim() === "") {
        flush();
      } else {
        buf.push(line);
      }
    }
    flush();
    return raw.map((text, i) => ({ id: `block_${i}`, text }));
  }
  ```

- [ ] **Step 5: Run the test and see `splitBlocks` PASS**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t splitBlocks
  ```

  Expected output: 4 passed (the other describe blocks are not yet written).

- [ ] **Step 6: Write the failing test for `permutationCheck` (multiset coverage; duplicate/missing/unknown reject; drops must be in unassigned)**

  Append to `tests/note_restructurer.test.ts`:

  ```ts
  describe("permutationCheck", () => {
    const all = ["block_0", "block_1", "block_2"];

    it("akzeptiert eine vollständige Permutation (sections ∪ unassigned == alle IDs)", () => {
      const a = asg({
        sections: [{ heading: "H", blocks: ["block_0", "block_2"] }],
        unassigned: ["block_1"],
      });
      const r = permutationCheck(all, a);
      expect(r.id).toBe("permutation");
      expect(r.ok).toBe(true);
    });

    it("lehnt eine doppelte Block-ID ab", () => {
      const a = asg({
        sections: [{ heading: "H", blocks: ["block_0", "block_0"] }],
        unassigned: ["block_1", "block_2"],
      });
      expect(permutationCheck(all, a).ok).toBe(false);
    });

    it("lehnt eine fehlende Block-ID ab (Drop NICHT in unassigned → still verloren)", () => {
      const a = asg({
        sections: [{ heading: "H", blocks: ["block_0"] }],
        unassigned: ["block_1"], // block_2 fehlt komplett
      });
      const r = permutationCheck(all, a);
      expect(r.ok).toBe(false);
      expect(r.detail).toContain("block_2");
    });

    it("verlangt weggelassene Blöcke in unassigned (vollständige Abdeckung)", () => {
      const a = asg({
        sections: [{ heading: "H", blocks: ["block_0"] }],
        unassigned: ["block_1", "block_2"],
      });
      expect(permutationCheck(all, a).ok).toBe(true);
    });

    it("lehnt eine unbekannte Block-ID ab", () => {
      const a = asg({
        sections: [{ heading: "H", blocks: ["block_0", "block_99"] }],
        unassigned: ["block_1", "block_2"],
      });
      const r = permutationCheck(all, a);
      expect(r.ok).toBe(false);
      expect(r.detail).toContain("block_99");
    });
  });
  ```

- [ ] **Step 7: Run the test and see it FAIL**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t permutationCheck
  ```

  Expected output: all five `permutationCheck` tests fail with `Error: not implemented`.

- [ ] **Step 8: Implement `permutationCheck` (multiset equality with diagnostic detail)**

  Replace the `permutationCheck` stub body:

  ```ts
  export function permutationCheck(allIds: string[], a: Assignment): CheckResult {
    const seen: string[] = [];
    for (const s of a.sections) for (const id of s.blocks) seen.push(id);
    for (const id of a.unassigned) seen.push(id);

    const known = new Set(allIds);
    const counts = new Map<string, number>();
    const unknown: string[] = [];
    for (const id of seen) {
      if (!known.has(id)) unknown.push(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (unknown.length > 0) {
      return { id: "permutation", ok: false, detail: `unbekannte IDs: ${unknown.join(", ")}` };
    }
    const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([id]) => id);
    if (duplicates.length > 0) {
      return { id: "permutation", ok: false, detail: `doppelte IDs: ${duplicates.join(", ")}` };
    }
    const missing = allIds.filter(id => !counts.has(id));
    if (missing.length > 0) {
      return { id: "permutation", ok: false, detail: `fehlende IDs: ${missing.join(", ")}` };
    }
    return { id: "permutation", ok: true };
  }
  ```

- [ ] **Step 9: Run and see `permutationCheck` PASS**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t permutationCheck
  ```

  Expected output: 5 passed.

- [ ] **Step 10: Write the failing test for `assembleBody` (byte-for-byte from original blocks + "(noch leer)" sentinel)**

  Append to `tests/note_restructurer.test.ts`:

  ```ts
  describe("assembleBody", () => {
    it("baut den Body byte-für-byte aus den Original-Blöcken zusammen", () => {
      const blocks: SourceBlock[] = [
        { id: "block_0", text: "Inhalt für Setup." },
        { id: "block_1", text: "Inhalt für Ablauf." },
      ];
      const tpl = spec(["Setup", "Ablauf"]);
      const a = asg({
        sections: [
          { heading: "Setup", blocks: ["block_0"] },
          { heading: "Ablauf", blocks: ["block_1"] },
        ],
      });
      const body = assembleBody(tpl, a, blocks);
      expect(body).toContain("Inhalt für Setup.");
      expect(body).toContain("Inhalt für Ablauf.");
      expect(body).toContain("## Setup");
      expect(body).toContain("## Ablauf");
      // Reihenfolge folgt der Template-Reihenfolge, nicht der Assignment-Reihenfolge
      expect(body.indexOf("## Setup")).toBeLessThan(body.indexOf("## Ablauf"));
    });

    it("rendert einen gedämpften „(noch leer)\"-Sentinel für Template-only-Sektionen", () => {
      const blocks: SourceBlock[] = [{ id: "block_0", text: "Nur Setup." }];
      const tpl = spec(["Setup", "Ablauf"]);
      const a = asg({ sections: [{ heading: "Setup", blocks: ["block_0"] }] });
      const body = assembleBody(tpl, a, blocks);
      expect(body).toContain("## Ablauf");
      expect(body).toContain("(noch leer)");
    });

    it("verwendet ausschließlich Original-Block-Bytes (kein erfundener Text)", () => {
      const blocks: SourceBlock[] = [{ id: "block_0", text: "EXAKTER ORIGINALTEXT" }];
      const tpl = spec(["Setup"]);
      const a = asg({ sections: [{ heading: "Setup", blocks: ["block_0"] }] });
      const body = assembleBody(tpl, a, blocks);
      expect(body).toContain("EXAKTER ORIGINALTEXT");
    });
  });
  ```

- [ ] **Step 11: Run the test and see it FAIL**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t assembleBody
  ```

  Expected output: 3 `assembleBody` tests fail with `Error: not implemented`.

- [ ] **Step 12: Implement `assembleBody` (template-ordered sections, original bytes only, sentinel)**

  Replace the `assembleBody` stub body. Iterate `tpl.sections` (template order is the rendering truth); look up each section's assigned block IDs from the assignment; join original block texts by blank line; emit the sentinel when empty.

  ```ts
  export const EMPTY_SECTION_SENTINEL = "*(noch leer)*";

  export function assembleBody(tpl: TemplateSpec, a: Assignment, blocks: SourceBlock[]): string {
    const byId = new Map(blocks.map(b => [b.id, b.text]));
    const assignedFor = new Map(a.sections.map(s => [s.heading, s.blocks]));
    const parts: string[] = [];
    for (const sec of tpl.sections) {
      const hashes = "#".repeat(sec.level);
      parts.push(`${hashes} ${sec.heading}`);
      const ids = assignedFor.get(sec.heading) ?? [];
      const texts = ids.map(id => byId.get(id)).filter((t): t is string => typeof t === "string");
      parts.push(texts.length > 0 ? texts.join("\n\n") : EMPTY_SECTION_SENTINEL);
    }
    return parts.join("\n\n") + "\n";
  }
  ```

- [ ] **Step 13: Run and see `assembleBody` PASS**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t assembleBody
  ```

  Expected output: 3 passed.

- [ ] **Step 14: Write the content-conservation PROPERTY test (assembled content tokens minus injected heading/sentinel tokens ⊆ original tokens)**

  Append to `tests/note_restructurer.test.ts`. A small seeded PRNG keeps the property test deterministic (no new deps). For each random body we build a valid assignment from `splitBlocks`, assemble, then assert content tokens are a subset of original tokens after subtracting the host-injected heading words and the sentinel word.

  ```ts
  describe("assembleBody Inhaltskonservierung (Property)", () => {
    function mulberry32(seed: number): () => number {
      let s = seed >>> 0;
      return () => {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
    function tokens(s: string): string[] {
      return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    }

    it("Tokens des zusammengebauten Inhalts (ohne Host-Tokens) sind Teilmenge der Original-Tokens", () => {
      const rnd = mulberry32(42);
      for (let run = 0; run < 50; run++) {
        // zufälligen Body bauen (nur Absätze, keine Überschriften → reine Inhalts-Tokens)
        const nPara = 1 + Math.floor(rnd() * 5);
        const paras: string[] = [];
        for (let p = 0; p < nPara; p++) {
          const nW = 1 + Math.floor(rnd() * 4);
          const w: string[] = [];
          for (let i = 0; i < nW; i++) w.push(words[Math.floor(rnd() * words.length)]);
          paras.push(w.join(" "));
        }
        const body = paras.join("\n\n");
        const blocks = splitBlocks(body);

        // gültige Assignment: jeden Block zufällig einer Sektion ODER unassigned zuordnen
        const headings = ["S1", "S2"];
        const tpl = spec(headings);
        const sections = headings.map(h => ({ heading: h, blocks: [] as string[] }));
        const unassigned: string[] = [];
        for (const b of blocks) {
          const slot = Math.floor(rnd() * (headings.length + 1));
          if (slot === headings.length) unassigned.push(b.id);
          else sections[slot].blocks.push(b.id);
        }
        const a = asg({ sections, unassigned });

        // Vorbedingung: gültige Permutation
        expect(permutationCheck(blocks.map(b => b.id), a).ok).toBe(true);

        const assembled = assembleBody(tpl, a, blocks);
        const original = new Set(tokens(body));
        // Host-injizierte Tokens (Überschriften + Sentinel-Wort) ausnehmen
        const hostTokens = new Set([...tokens(headings.join(" ")), ...tokens(EMPTY_SECTION_SENTINEL)]);
        for (const t of tokens(assembled)) {
          if (hostTokens.has(t)) continue;
          expect(original.has(t)).toBe(true);
        }
      }
    });
  });
  ```

  The property imports `EMPTY_SECTION_SENTINEL` — extend the existing import line at the top of the test file:

  ```ts
  import {
    splitBlocks,
    assembleBody,
    permutationCheck,
    buildRestructurePrompt,
    parseAssignment,
    EMPTY_SECTION_SENTINEL,
    SourceBlock,
    Assignment,
  } from "../src/note_restructurer";
  ```

- [ ] **Step 15: Run the property test and see it PASS (assembleBody is already implemented)**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t Inhaltskonservierung
  ```

  Expected output: 1 passed (the property holds because assembly uses only original block bytes plus host-injected headings/sentinel, which are subtracted).

- [ ] **Step 16: Write the failing test for `parseAssignment` (tolerant JSON extraction from a fenced/noisy stream)**

  Append to `tests/note_restructurer.test.ts`:

  ```ts
  describe("parseAssignment", () => {
    const valid = {
      version: 1,
      sections: [{ heading: "Setup", blocks: ["block_0"] }],
      unassigned: ["block_1"],
      frontmatter: { type: { source: "content", value: "Test" }, tags: { source: "empty", value: "" } },
    };

    it("parst nacktes JSON", () => {
      const a = parseAssignment(JSON.stringify(valid));
      expect(a).not.toBeNull();
      expect(a?.sections[0].heading).toBe("Setup");
      expect(a?.frontmatter.type.value).toBe("Test");
    });

    it("extrahiert JSON aus einem ```json-Fence mit Prosa drumherum", () => {
      const raw = "Hier ist die Zuordnung:\n```json\n" + JSON.stringify(valid) + "\n```\nFertig.";
      const a = parseAssignment(raw);
      expect(a?.unassigned).toEqual(["block_1"]);
    });

    it("extrahiert das erste balancierte JSON-Objekt aus reinem Geschwafel", () => {
      const raw = "blah " + JSON.stringify(valid) + " trailing tokens";
      expect(parseAssignment(raw)).not.toBeNull();
    });

    it("liefert null bei fehlendem/unparsebarem JSON", () => {
      expect(parseAssignment("kein json hier")).toBeNull();
      expect(parseAssignment("```json\n{ kaputt \n```")).toBeNull();
      expect(parseAssignment("")).toBeNull();
    });

    it("liefert null wenn die Struktur nicht zum Assignment-Schema passt", () => {
      expect(parseAssignment(JSON.stringify({ foo: 1 }))).toBeNull();
      expect(parseAssignment(JSON.stringify({ version: 1, sections: "nein", unassigned: [], frontmatter: {} }))).toBeNull();
    });
  });
  ```

- [ ] **Step 17: Run the test and see it FAIL**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t parseAssignment
  ```

  Expected output: 5 `parseAssignment` tests fail with `Error: not implemented`.

- [ ] **Step 18: Implement `parseAssignment` (fence strip → balanced-brace scan → JSON.parse → shape validation)**

  Replace the `parseAssignment` stub body and add a private validator:

  ```ts
  function isAssignmentShape(v: unknown): v is Assignment {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    if (typeof o.version !== "number") return false;
    if (!Array.isArray(o.sections)) return false;
    for (const s of o.sections) {
      if (typeof s !== "object" || s === null) return false;
      const sec = s as Record<string, unknown>;
      if (typeof sec.heading !== "string") return false;
      if (!Array.isArray(sec.blocks) || !sec.blocks.every(b => typeof b === "string")) return false;
    }
    if (!Array.isArray(o.unassigned) || !o.unassigned.every(b => typeof b === "string")) return false;
    if (typeof o.frontmatter !== "object" || o.frontmatter === null) return false;
    return true;
  }

  /** Erstes balanciert geklammertes {...}-Objekt aus einem Text ziehen (Fences/Prosa-tolerant). */
  function extractFirstObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  export function parseAssignment(raw: string): Assignment | null {
    const candidate = extractFirstObject(raw);
    if (!candidate) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return null;
    }
    return isAssignmentShape(parsed) ? parsed : null;
  }
  ```

- [ ] **Step 19: Run and see `parseAssignment` PASS**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t parseAssignment
  ```

  Expected output: 5 passed.

- [ ] **Step 20: Write the failing test for `buildRestructurePrompt` (template verbatim + numbered blocks + repeated anti-fabrication contract)**

  Append to `tests/note_restructurer.test.ts`:

  ```ts
  describe("buildRestructurePrompt", () => {
    const tpl = spec(["Setup", "Ablauf"]);
    const blocks: SourceBlock[] = [
      { id: "block_0", text: "Erster." },
      { id: "block_1", text: "Zweiter." },
    ];

    it("liefert genau eine system- und eine user-Nachricht", () => {
      const msgs = buildRestructurePrompt(tpl, blocks);
      expect(msgs.map(m => m.role)).toEqual(["system", "user"]);
    });

    it("enthält die Template-Struktur verbatim (raw)", () => {
      const msgs = buildRestructurePrompt(tpl, blocks);
      const all = msgs.map(m => m.content).join("\n");
      expect(all).toContain(tpl.raw);
    });

    it("nummeriert die Blöcke mit ihren IDs und Texten", () => {
      const all = buildRestructurePrompt(tpl, blocks).map(m => m.content).join("\n");
      expect(all).toContain("block_0");
      expect(all).toContain("Erster.");
      expect(all).toContain("block_1");
      expect(all).toContain("Zweiter.");
    });

    it("wiederholt die Anti-Fabrikations-Klausel (nur Zuordnung, keine Prosa, nur JSON)", () => {
      const sys = buildRestructurePrompt(tpl, blocks)[0].content;
      const user = buildRestructurePrompt(tpl, blocks)[1].content;
      // in der system-Nachricht UND in der user-Nachricht wiederholt
      expect(sys).toMatch(/keinen.*Text.*erfinden|nichts erfinden|nur.*Block-IDs/i);
      expect(sys).toMatch(/nur.*JSON|ausschließlich.*JSON/i);
      expect(user).toMatch(/nur.*JSON|ausschließlich.*JSON/i);
    });
  });
  ```

- [ ] **Step 21: Run the test and see it FAIL**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t buildRestructurePrompt
  ```

  Expected output: 4 `buildRestructurePrompt` tests fail with `Error: not implemented`.

- [ ] **Step 22: Implement `buildRestructurePrompt` (system contract + user payload with verbatim template + numbered blocks)**

  Replace the `buildRestructurePrompt` stub body. The anti-fabrication contract appears in BOTH the system message and the closing of the user message (the spec's "wiederholten Anti-Fabrikations-Vertrag"):

  ```ts
  const ANTI_FABRICATION = [
    "Du darfst KEINEN Text erfinden, umschreiben oder zusammenfassen.",
    "Du ordnest ausschließlich die nummerierten Block-IDs den Template-Überschriften zu.",
    "Jede Block-ID muss genau einmal vorkommen: entweder in einer Sektion oder in `unassigned`.",
    "Du gibst AUSSCHLIESSLICH ein einzelnes JSON-Objekt zurück, keinen Fließtext, keine Erklärung.",
  ].join(" ");

  export function buildRestructurePrompt(tpl: TemplateSpec, blocks: SourceBlock[]): ChatMessage[] {
    const numbered = blocks.map(b => `${b.id}:\n${b.text}`).join("\n\n");
    const keys = tpl.keys.join(", ");
    const headings = tpl.sections.map(s => s.heading).join(", ");

    const system = [
      "Du bist ein strukturierender Assistent für Obsidian-Notizen.",
      ANTI_FABRICATION,
      'Schema: { "version": 1, "sections": [{ "heading": "<Überschrift>", "blocks": ["block_3"] }],',
      '"unassigned": ["block_7"], "frontmatter": { "<key>": { "source": "content"|"empty", "value": "<wert>" } } }',
      'Frontmatter mit source="content" muss wörtlich aus den Blöcken stammen; sonst source="empty".',
    ].join("\n");

    const user = [
      "## Template-Struktur (verbatim)",
      tpl.raw,
      "",
      `Frontmatter-Keys: ${keys}`,
      `Geordnete Überschriften: ${headings}`,
      "",
      "## Original-Body in nummerierten Blöcken",
      numbered,
      "",
      ANTI_FABRICATION,
      "Antworte AUSSCHLIESSLICH mit dem JSON-Objekt.",
    ].join("\n");

    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }
  ```

- [ ] **Step 23: Run and see `buildRestructurePrompt` PASS**

  ```bash
  npx vitest run tests/note_restructurer.test.ts -t buildRestructurePrompt
  ```

  Expected output: 4 passed.

- [ ] **Step 24: Run the FULL note_restructurer test file**

  ```bash
  npx vitest run tests/note_restructurer.test.ts
  ```

  Expected output: all describe blocks green — `splitBlocks` (4), `permutationCheck` (5), `assembleBody` (3), `assembleBody Inhaltskonservierung` (1), `parseAssignment` (5), `buildRestructurePrompt` (4) = 22 passed.

- [ ] **Step 25: Typecheck and lint**

  ```bash
  npx tsc --noEmit && npm run lint
  ```

  Expected output: `tsc` exits 0 with no diagnostics; `eslint src` reports no errors (no `fetch`, no `any`, no `eslint-disable`).

- [ ] **Step 26: Run the full suite to confirm no regressions**

  ```bash
  npm test
  ```

  Expected output: all test files pass, including the new `tests/note_restructurer.test.ts`.

- [ ] **Step 27: Commit (stage ONLY the two touched files)**

  ```bash
  git add src/note_restructurer.ts tests/note_restructurer.test.ts
  git commit -m "$(cat <<'EOF'
  feat(smart-apply): note_restructurer als Non-Fabrication-Backbone

  splitBlocks (deterministisch, Überschriften eigene Blöcke), assembleBody
  (nur Original-Bytes + "(noch leer)"-Sentinel), permutationCheck
  (Multiset-Abdeckung, Drops müssen in unassigned), parseAssignment
  (toleranter JSON-Extrakt), buildRestructurePrompt (Template verbatim +
  Anti-Fabrikations-Vertrag). Inkl. Inhaltskonservierungs-Property-Test.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

  Expected output: one commit with exactly two files changed (`src/note_restructurer.ts`, `tests/note_restructurer.test.ts`).

---

### Task 4: smart_apply.ts (Pure Orchestrator + sole Writer)

**Files:**
- Create: `src/smart_apply.ts`
- Test: `tests/smart_apply.test.ts`
- (Consumes existing: `src/frontmatter.ts`, `src/template_matcher.ts`, `src/note_restructurer.ts`, `src/chat_client.ts`)

**Interfaces:**

Consumes (exact signatures from earlier tasks — Tasks 1–3 + existing `chat_client.ts`):
```ts
// from ./chat_client (existing)
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; reasoning?: string; sources?: string[]; error?: string }
export class ChatClient {
  stream(messages: ChatMessage[], onContent: (t: string) => void, onReasoning: (t: string) => void, signal?: AbortSignal, opts?: { model?: string; temperature?: number; suppressThinking?: boolean }): Promise<{ content: string; reasoning: string }>;
}
// from ./template_matcher (Task 2)
export interface TemplateSection { heading: string; level: number; placeholder: string }
export interface TemplateSpec { type: string; keys: string[]; sections: TemplateSection[]; raw: string }
export type SuggestionSource = "frontmatter" | "rag" | "none";
export interface TypeSuggestion { type: string | null; templatePath: string | null; source: SuggestionSource; confidence: "no" | "likely" | "confirmed"; }
export function stripAnnotations(text: string): string;
export function parseTemplate(text: string): TemplateSpec;
export interface DetectDeps { read: (p: string) => Promise<string>; listTemplates: () => Promise<string[]>; embed: (text: string) => Promise<Float32Array>; search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[]; typeOf: (p: string) => Promise<string | null>; }
export function detectType(notePath: string, deps: DetectDeps): Promise<TypeSuggestion>;
// from ./note_restructurer (Task 3)
export interface SourceBlock { id: string; text: string }
export interface Assignment { version: number; sections: { heading: string; blocks: string[] }[]; unassigned: string[]; frontmatter: Record<string, FmAssignedValue>; }
export type CheckId = "assignment-parse" | "permutation" | "fm-roundtrip" | "fm-source";
export interface CheckResult { id: CheckId; ok: boolean; detail?: string }
export function splitBlocks(body: string): SourceBlock[];
export function buildRestructurePrompt(tpl: TemplateSpec, blocks: SourceBlock[]): ChatMessage[];
export function parseAssignment(raw: string): Assignment | null;
export function permutationCheck(allIds: string[], a: Assignment): CheckResult;
export function assembleBody(tpl: TemplateSpec, a: Assignment, blocks: SourceBlock[]): string;
// from ./frontmatter (Task 1)
export type FmValue = string | string[];
export type FmSource = "content" | "empty";
export interface FmAssignedValue { source: FmSource; value: string }
export interface ParsedFrontmatter { data: Record<string, FmValue>; order: string[]; body: string }
export function parseFrontmatter(text: string): ParsedFrontmatter;
export function serializeFrontmatter(data: Record<string, FmValue>, order: string[]): string;
export function mergeFrontmatter(tplKeys: string[], original: ParsedFrontmatter, llm: Record<string, FmAssignedValue>): { data: Record<string, FmValue>; order: string[] };
export type FmChange = "unveraendert" | "geaendert" | "neu" | "entfernt";
export interface FmRow { key: string; original?: FmValue; proposed?: FmValue; change: FmChange }
export function diffFrontmatter(original: ParsedFrontmatter, proposed: { data: Record<string, FmValue>; order: string[] }): FmRow[];
```

Produces (later tasks — `smart_apply_view.ts`, `main.ts` — rely on these verbatim):
```ts
export interface ApplyProposal {
  notePath: string; templatePath: string; type: string;
  originalText: string; originalHash: number;
  proposedContent: string;
  fmRows: FmRow[];
  sectionDiff: { heading: string; blockIds: string[]; provenance: string | null }[];
  unassigned: SourceBlock[]; checks: CheckResult[]; hardOk: boolean; reasoning: string;
  detection: { source: SuggestionSource; confidence: "no" | "likely" | "confirmed" };
}
export interface ApplyResult { written: boolean; reason?: "stale" | "blocked"; undo?: () => Promise<void> }
export interface SmartApplyDeps {
  client: () => ChatClient;
  read: (p: string) => Promise<string>;
  write: (p: string, data: string) => Promise<void>;
  listTemplates: () => Promise<string[]>;
  typeOf: (p: string) => Promise<string | null>;
  embed: (text: string) => Promise<Float32Array>;
  search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
  params: () => { model: string; temperature: number; suppressThinking: boolean };
}
export class SmartApply {
  constructor(deps: SmartApplyDeps);
  detect(notePath: string): Promise<TypeSuggestion>;
  propose(notePath: string, templatePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void): Promise<ApplyProposal>;
  persistApply(p: ApplyProposal): Promise<ApplyResult>;
  abort(): void;
}
```

---

- [ ] **Step 1: Failing test — djb2 hash + detect delegation.** Create `tests/smart_apply.test.ts` with a shared fake-deps builder and the first two tests. Run it; expect FAIL (`Cannot find module '../src/smart_apply'`).

```ts
import { describe, it, expect, vi } from "vitest";
import { SmartApply, djb2, type SmartApplyDeps } from "../src/smart_apply";
import type { ChatMessage } from "../src/chat_client";

// --- Test-Helfer -----------------------------------------------------------
// Eine Vorlage mit zwei Überschriften + zwei Frontmatter-Keys.
const TEMPLATE = `---
type:
status:
---
## Zusammenfassung

## Details
`;

// Eine Original-Notiz: leeres Frontmatter-Delimiter-loses Capture mit zwei Absätzen.
const NOTE = `Das Projekt startet morgen.

Es braucht ein Review.`;

/** Streamt JSON als ein einziges content-Token; spiegelt den ChatClient.stream-Vertrag. */
function fakeStream(json: string, reasoning = "") {
  return vi.fn(async (
    _msgs: ChatMessage[],
    onContent: (t: string) => void,
    onReasoning: (t: string) => void,
  ) => {
    if (reasoning) onReasoning(reasoning);
    onContent(json);
    return { content: json, reasoning };
  });
}

interface Overrides {
  files?: Record<string, string>;
  stream?: ReturnType<typeof fakeStream>;
  write?: (p: string, data: string) => Promise<void>;
}

function mkDeps(o: Overrides = {}): { deps: SmartApplyDeps; files: Record<string, string>; stream: ReturnType<typeof fakeStream> } {
  const files: Record<string, string> = {
    "note.md": NOTE,
    "Templates/Projekt.md": TEMPLATE,
    ...o.files,
  };
  const stream = o.stream ?? fakeStream(JSON.stringify({
    version: 1,
    sections: [
      { heading: "Zusammenfassung", blocks: ["block_0"] },
      { heading: "Details", blocks: ["block_1"] },
    ],
    unassigned: [],
    frontmatter: { type: { source: "content", value: "Projekt" }, status: { source: "empty" } },
  }));
  const client: any = { stream };
  const deps: SmartApplyDeps = {
    client: () => client,
    read: async (p) => { if (!(p in files)) throw new Error(`ENOENT ${p}`); return files[p]; },
    write: o.write ?? (async (p, data) => { files[p] = data; }),
    listTemplates: async () => ["Templates/Projekt.md"],
    typeOf: async () => null,
    embed: async () => new Float32Array([1, 0]),
    search: () => [],
    params: () => ({ model: "m", temperature: 0, suppressThinking: false }),
  };
  return { deps, files, stream };
}

describe("djb2", () => {
  it("ist deterministisch und ändert sich bei Inhaltsänderung", () => {
    expect(djb2("abc")).toBe(djb2("abc"));
    expect(djb2("abc")).not.toBe(djb2("abd"));
  });
});

describe("SmartApply.detect", () => {
  it("delegiert an detectType und liefert die TypeSuggestion", async () => {
    const { deps, files } = mkDeps();
    files["note.md"] = `---\ntype: Projekt\n---\nfoo`;
    const sa = new SmartApply(deps);
    const sug = await sa.detect("note.md");
    expect(sug.type).toBe("Projekt");
    expect(sug.templatePath).toBe("Templates/Projekt.md");
    expect(sug.source).toBe("frontmatter");
  });
});
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: FAIL — `Failed to resolve import "../src/smart_apply"`.

- [ ] **Step 2: Minimal skeleton — types, djb2, detect.** Create `src/smart_apply.ts` with imports, the produced types, `djb2`, and a constructor + `detect`/`abort` (propose/persistApply stubbed to throw). Run the test; the `djb2` + `detect` tests PASS.

```ts
import { ChatClient, ChatMessage } from "./chat_client";
import {
  TemplateSpec, TypeSuggestion, SuggestionSource,
  DetectDeps, detectType, stripAnnotations, parseTemplate,
} from "./template_matcher";
import {
  SourceBlock, Assignment, CheckResult,
  splitBlocks, buildRestructurePrompt, parseAssignment, permutationCheck, assembleBody,
} from "./note_restructurer";
import {
  FmRow, FmValue, ParsedFrontmatter, FmAssignedValue,
  parseFrontmatter, serializeFrontmatter, mergeFrontmatter, diffFrontmatter,
} from "./frontmatter";

export interface ApplyProposal {
  notePath: string; templatePath: string; type: string;
  originalText: string; originalHash: number;
  proposedContent: string;                          // host-assembled; "" gdw. ein harter Check fehlschlug
  fmRows: FmRow[];
  sectionDiff: { heading: string; blockIds: string[]; provenance: string | null }[];
  unassigned: SourceBlock[]; checks: CheckResult[]; hardOk: boolean; reasoning: string;
  detection: { source: SuggestionSource; confidence: "no" | "likely" | "confirmed" };
}

export interface ApplyResult { written: boolean; reason?: "stale" | "blocked"; undo?: () => Promise<void> }

export interface SmartApplyDeps {
  client: () => ChatClient;
  read: (p: string) => Promise<string>;
  write: (p: string, data: string) => Promise<void>;             // VaultAdapter.write — EINZIGER Writer
  listTemplates: () => Promise<string[]>;
  typeOf: (p: string) => Promise<string | null>;
  embed: (text: string) => Promise<Float32Array>;
  search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
  params: () => { model: string; temperature: number; suppressThinking: boolean };
}

/** Günstiger, stabiler 32-bit-Content-Hash (djb2). In-core, kein crypto. */
export function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

export class SmartApply {
  private controller: AbortController | null = null;
  constructor(private deps: SmartApplyDeps) {}

  detect(notePath: string): Promise<TypeSuggestion> {
    const d: DetectDeps = {
      read: this.deps.read,
      listTemplates: this.deps.listTemplates,
      embed: this.deps.embed,
      search: this.deps.search,
      typeOf: this.deps.typeOf,
    };
    return detectType(notePath, d);
  }

  async propose(
    _notePath: string, _templatePath: string,
    _onToken: (t: string) => void, _onReasoning: (t: string) => void,
  ): Promise<ApplyProposal> {
    throw new Error("not implemented");
  }

  async persistApply(_p: ApplyProposal): Promise<ApplyResult> {
    throw new Error("not implemented");
  }

  abort(): void { this.controller?.abort(); }
}
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: `djb2` (1) + `SmartApply.detect` (1) PASS; no other tests yet.

- [ ] **Step 3: Failing test — happy-path propose.** Append the propose happy-path test. Run it; expect FAIL (`not implemented`).

```ts
describe("SmartApply.propose — happy path", () => {
  it("streamt Body-Tokens, baut Body host-seitig zusammen und merged Frontmatter", async () => {
    const { deps } = mkDeps();
    const sa = new SmartApply(deps);
    const tokens: string[] = [];
    const reasoning: string[] = [];
    const p = await sa.propose("note.md", "Templates/Projekt.md", t => tokens.push(t), r => reasoning.push(r));

    expect(p.hardOk).toBe(true);
    expect(p.checks.every(c => c.ok)).toBe(true);
    // Body wird aus Original-Bytes zusammengebaut — niemals aus dem Modell-JSON.
    expect(p.proposedContent).toContain("## Zusammenfassung");
    expect(p.proposedContent).toContain("Das Projekt startet morgen.");
    expect(p.proposedContent).toContain("## Details");
    expect(p.proposedContent).toContain("Es braucht ein Review.");
    // Das rohe Assignment-JSON darf NICHT als Prosa im Body landen.
    expect(p.proposedContent).not.toContain('"sections"');
    // Frontmatter gemerged: type aus content übernommen.
    expect(p.proposedContent).toContain("type: Projekt");
    // onToken bekam die Stream-Tokens (das JSON), onReasoning nichts.
    expect(tokens.join("")).toContain('"sections"');
    expect(reasoning).toEqual([]);
    // Snapshot für den Stale-Guard.
    expect(p.originalText).toBe(NOTE);
    expect(p.originalHash).toBe(djb2(NOTE));
    expect(p.notePath).toBe("note.md");
    expect(p.templatePath).toBe("Templates/Projekt.md");
    expect(p.type).toBe("Projekt");
  });
});
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: FAIL — the new test throws `not implemented`.

- [ ] **Step 4: Implement propose (read→strip→parse→split→prompt→stream→assignment→checks→assemble→merge→serialize→diff).** Replace the `propose` stub. Add the private `buildProposal` helper that assembles the proposal from a (possibly null) assignment so failure modes share one path. Run the test; happy-path PASSES.

```ts
  async propose(
    notePath: string, templatePath: string,
    onToken: (t: string) => void, onReasoning: (t: string) => void,
  ): Promise<ApplyProposal> {
    const originalText = await this.deps.read(notePath);
    const originalHash = djb2(originalText);
    const tplRaw = await this.deps.read(templatePath);
    const tpl = parseTemplate(stripAnnotations(tplRaw));
    const original = parseFrontmatter(originalText);
    const blocks = splitBlocks(original.body);
    const allIds = blocks.map(b => b.id);

    const messages = buildRestructurePrompt(tpl, blocks);
    this.controller = new AbortController();
    const params = this.deps.params();
    let raw = "", reasoning = "";
    try {
      const r = await this.deps.client().stream(
        messages,
        c => { onToken(c); },
        rs => { onReasoning(rs); },
        this.controller.signal,
        { model: params.model, temperature: params.temperature, suppressThinking: params.suppressThinking },
      );
      raw = r.content; reasoning = r.reasoning;
    } finally {
      this.controller = null;
    }

    // SEAM-VERTRAG (3): echte Erkennung durchreichen statt hardcoden — speist das Quelle-Badge.
    const detection = await this.detect(notePath);
    return this.buildProposal(
      notePath, templatePath, tpl, original, blocks, allIds, raw, reasoning, originalText, originalHash, detection,
    );
  }

  private buildProposal(
    notePath: string, templatePath: string, tpl: TemplateSpec,
    original: ParsedFrontmatter, blocks: SourceBlock[], allIds: string[],
    raw: string, reasoning: string, originalText: string, originalHash: number,
    suggestion: TypeSuggestion,
  ): ApplyProposal {
    const checks: CheckResult[] = [];
    const detection = { source: suggestion.source, confidence: suggestion.confidence };
    const fail = (extra?: Partial<ApplyProposal>): ApplyProposal => ({
      notePath, templatePath, type: tpl.type,
      originalText, originalHash, proposedContent: "",
      fmRows: [], sectionDiff: [], unassigned: [], checks, hardOk: false,
      reasoning, detection, ...extra,
    });

    // 1) assignment-parse (HART)
    const assignment = parseAssignment(raw);
    checks.push({ id: "assignment-parse", ok: assignment != null, detail: assignment ? undefined : "kein gültiges JSON-Assignment im Stream" });
    if (!assignment) return fail();

    // 2) permutation/coverage (HART)
    const perm = permutationCheck(allIds, assignment);
    checks.push(perm);
    if (!perm.ok) {
      const unassigned = blocks.filter(b => assignment.unassigned.includes(b.id));
      return fail({ sectionDiff: this.sectionDiff(assignment, blocks), unassigned });
    }

    // 3) fm-source (WEICH): erfundene content-Werte aufs Leere zwingen
    const gated = this.gateFrontmatter(assignment.frontmatter, original, blocks);
    checks.push({ id: "fm-source", ok: !gated.emptied.length, detail: gated.emptied.length ? `nicht im Inhalt belegt: ${gated.emptied.join(", ")}` : undefined });

    // Body NUR aus Original-Bytes.
    const proposedBody = assembleBody(tpl, assignment, blocks);

    // 4) fm-roundtrip (HART): mergen → serialisieren → reparsen muss verlustfrei sein.
    const merged = mergeFrontmatter(tpl.keys, original, gated.frontmatter);
    const fmBlock = serializeFrontmatter(merged.data, merged.order);
    const roundtripOk = this.roundtripOk(fmBlock, merged);
    checks.push({ id: "fm-roundtrip", ok: roundtripOk, detail: roundtripOk ? undefined : "serialisiertes Frontmatter ist nicht reparsebar" });
    if (!roundtripOk) {
      return fail({ sectionDiff: this.sectionDiff(assignment, blocks), unassigned: blocks.filter(b => assignment.unassigned.includes(b.id)) });
    }

    const proposedContent = fmBlock + proposedBody;
    const fmRows = diffFrontmatter(original, merged);
    const hardOk = checks.filter(c => c.id !== "fm-source").every(c => c.ok);

    return {
      notePath, templatePath, type: tpl.type,
      originalText, originalHash, proposedContent,
      fmRows, sectionDiff: this.sectionDiff(assignment, blocks),
      unassigned: blocks.filter(b => assignment.unassigned.includes(b.id)),
      checks, hardOk, reasoning, detection,
    };
  }

  private sectionDiff(a: Assignment, blocks: SourceBlock[]): { heading: string; blockIds: string[]; provenance: string | null }[] {
    const firstLine = (id: string): string => (blocks.find(b => b.id === id)?.text.split("\n")[0] ?? id).trim();
    return a.sections.map(s => ({
      heading: s.heading,
      blockIds: s.blocks,
      // SEAM-VERTRAG (4): Original-Überschrift/Textanfang des ersten Blocks, NICHT die rohe Block-ID.
      provenance: s.blocks.length ? firstLine(s.blocks[0]) : null,
    }));
  }

  /** Reparse-Self-Check: das serialisierte FM zurücklesen → data + order müssen exakt matchen. */
  private roundtripOk(fmBlock: string, merged: { data: Record<string, FmValue>; order: string[] }): boolean {
    try {
      const re = parseFrontmatter(fmBlock);
      if (re.order.join("\u0000") !== merged.order.join("\u0000")) return false;
      for (const k of merged.order) {
        if (JSON.stringify(re.data[k]) !== JSON.stringify(merged.data[k])) return false;
      }
      return true;
    } catch { return false; }
  }

  /** fm-source-Gating: content-Werte, die kein normalisierter Substring von Body/Original-FM sind,
   *  werden auf source=empty/"" gezwungen (Slice-1-Anti-Fabrikation für Frontmatter). */
  private gateFrontmatter(
    fm: Record<string, FmAssignedValue>,
    original: ParsedFrontmatter,
    blocks: SourceBlock[],
  ): { frontmatter: Record<string, FmAssignedValue>; emptied: string[] } {
    const haystack = normalizeForMatch(
      blocks.map(b => b.text).join("\n") + "\n" +
      original.order.map(k => `${k} ${valueToText(original.data[k])}`).join("\n"),
    );
    const out: Record<string, FmAssignedValue> = {};
    const emptied: string[] = [];
    for (const [key, v] of Object.entries(fm)) {
      if (v.source === "content") {
        const needle = normalizeForMatch(v.value);
        if (needle.length === 0 || !haystack.includes(needle)) {
          out[key] = { source: "empty", value: "" };
          emptied.push(key);
          continue;
        }
      }
      out[key] = v;
    }
    return { frontmatter: out, emptied };
  }
```

Also add these module-level helpers below the class:

```ts
/** whitespace+case+emoji-normalisiert (derselbe Normalizer wie bei der Byte-Konservierung). */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function valueToText(v: FmValue | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join(" ") : v;
}
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: happy-path PASSES; all prior tests still green.

- [ ] **Step 5: Failing test — unknown block id blocks hardOk.** Append a test where the LLM references a non-existent block. Run it; expect FAIL.

```ts
describe("SmartApply.propose — Fehlermodi", () => {
  it("unbekannte Block-ID → permutation-Check failt, hardOk=false, kein nutzbarer Content", async () => {
    const stream = fakeStream(JSON.stringify({
      version: 1,
      sections: [{ heading: "Zusammenfassung", blocks: ["block_0", "block_99"] }, { heading: "Details", blocks: ["block_1"] }],
      unassigned: [],
      frontmatter: { type: { source: "content", value: "Projekt" }, status: { source: "empty" } },
    }));
    const { deps } = mkDeps({ stream });
    const sa = new SmartApply(deps);
    const p = await sa.propose("note.md", "Templates/Projekt.md", () => {}, () => {});
    expect(p.hardOk).toBe(false);
    expect(p.proposedContent).toBe("");
    expect(p.checks.find(c => c.id === "permutation")?.ok).toBe(false);
  });
});
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: FAIL only if `permutationCheck` lets `block_99` through — confirm it FAILS first (it must rely on Task 3's check). If Task 3's `permutationCheck` already rejects unknown ids, this PASSES immediately; either way the assertion is real. Expected on a correct Task 3: PASS. (Keep this test — it locks the orchestrator wiring.)

- [ ] **Step 6: Failing test — fabricated frontmatter value emptied (soft).** Append it. Run; expect PASS-or-FAIL depending on gating; it must end green.

```ts
  it("erfundener (nicht-substring) Frontmatter-Wert → Feld geleert, hardOk bleibt true", async () => {
    const stream = fakeStream(JSON.stringify({
      version: 1,
      sections: [{ heading: "Zusammenfassung", blocks: ["block_0"] }, { heading: "Details", blocks: ["block_1"] }],
      unassigned: [],
      frontmatter: { type: { source: "content", value: "Völlig erfundener Wert" }, status: { source: "empty" } },
    }));
    const { deps } = mkDeps({ stream });
    const sa = new SmartApply(deps);
    const p = await sa.propose("note.md", "Templates/Projekt.md", () => {}, () => {});
    // fm-source ist WEICH: blockiert hardOk nicht.
    expect(p.hardOk).toBe(true);
    expect(p.checks.find(c => c.id === "fm-source")?.ok).toBe(false);
    // Das erfundene type-Feld wurde geleert — taucht NICHT mit dem erfundenen Wert auf.
    expect(p.proposedContent).not.toContain("Völlig erfundener Wert");
    const typeRow = p.fmRows.find(r => r.key === "type");
    expect(typeRow?.proposed === "" || typeRow?.proposed == null).toBe(true);
  });
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: PASS (gating from Step 4 empties the non-substring value).

- [ ] **Step 7: Failing test — malformed JSON graceful.** Append it. Run; expect PASS (the orchestrator must already route a null assignment to a failed `assignment-parse`).

```ts
  it("malformed JSON → assignment-parse failt graceful, kein Throw", async () => {
    const { deps } = mkDeps({ stream: fakeStream("das ist kein json {{{") });
    const sa = new SmartApply(deps);
    const p = await sa.propose("note.md", "Templates/Projekt.md", () => {}, () => {});
    expect(p.hardOk).toBe(false);
    expect(p.proposedContent).toBe("");
    expect(p.checks.find(c => c.id === "assignment-parse")?.ok).toBe(false);
  });
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: PASS.

- [ ] **Step 8: Failing test — abort propagates.** Append a test where the fake stream rejects with an `AbortError` while `abort()` is invoked. Run; expect FAIL (no abort path yet — propose has no catch, so the rejection escapes as-is; assert it propagates).

```ts
  it("abort() propagiert die AbortError aus dem Stream nach außen", async () => {
    const stream = vi.fn((_m: ChatMessage[], _oc: any, _or: any, signal?: AbortSignal) =>
      new Promise<{ content: string; reasoning: string }>((_res, rej) => {
        signal?.addEventListener("abort", () => { const e = new Error("Aborted"); e.name = "AbortError"; rej(e); });
      }));
    const { deps } = mkDeps({ stream });
    const sa = new SmartApply(deps);
    const pending = sa.propose("note.md", "Templates/Projekt.md", () => {}, () => {});
    sa.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: PASS — the `finally` in propose clears the controller and the rejection propagates verbatim (mirrors `ChatSession` abort semantics). If this errors because `controller` is nulled before `abort()` fires, it will surface here; the current Step-4 code awaits the stream *before* the `finally`, so `abort()` reaches the live controller. Confirm green.

- [ ] **Step 9: Failing test — persistApply happy path writes exactly once + undo restores.** Append it. Run; expect FAIL (`persistApply not implemented`).

```ts
describe("SmartApply.persistApply", () => {
  it("Happy-Path schreibt genau 1× via injizierten write; undo restauriert das Original", async () => {
    const writes: { p: string; data: string }[] = [];
    const { deps, files } = mkDeps({ write: async (p, data) => { writes.push({ p, data }); files[p] = data; } });
    const sa = new SmartApply(deps);
    const p = await sa.propose("note.md", "Templates/Projekt.md", () => {}, () => {});
    expect(p.hardOk).toBe(true);

    const res = await sa.persistApply(p);
    expect(res.written).toBe(true);
    expect(writes.length).toBe(1);
    expect(writes[0].p).toBe("note.md");
    expect(writes[0].data).toBe(p.proposedContent);
    expect(files["note.md"]).toBe(p.proposedContent);

    // Undo schreibt das Original zurück (zweiter write).
    await res.undo!();
    expect(writes.length).toBe(2);
    expect(files["note.md"]).toBe(NOTE);
  });
});
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: FAIL — `not implemented`.

- [ ] **Step 10: Implement persistApply (re-read + stale-hash guard + blocked guard + single write + undo closure).** Replace the `persistApply` stub. Run the test; PASSES.

```ts
  async persistApply(p: ApplyProposal): Promise<ApplyResult> {
    if (!p.hardOk) return { written: false, reason: "blocked" };
    // Stale-Guard: Notiz seit dem Snapshot extern geändert? → NICHT schreiben.
    const current = await this.deps.read(p.notePath);
    if (djb2(current) !== p.originalHash) return { written: false, reason: "stale" };
    // EINZIGER destruktiver Schreibvorgang im gesamten Feature.
    await this.deps.write(p.notePath, p.proposedContent);
    return {
      written: true,
      undo: () => this.deps.write(p.notePath, p.originalText),
    };
  }
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: persistApply happy-path PASSES.

- [ ] **Step 11: Failing test — stale hash aborts with NO write; blocked proposal not written.** Append two tests. Run; expect PASS (logic from Step 10).

```ts
  it("Stale-Hash → kein write, reason 'stale'", async () => {
    const writes: string[] = [];
    const { deps, files } = mkDeps({ write: async (pp, d) => { writes.push(pp); files[pp] = d; } });
    const sa = new SmartApply(deps);
    const p = await sa.propose("note.md", "Templates/Projekt.md", () => {}, () => {});
    files["note.md"] = NOTE + "\nextern dazwischengefunkt";   // externer Edit nach dem Snapshot
    const res = await sa.persistApply(p);
    expect(res.written).toBe(false);
    expect(res.reason).toBe("stale");
    expect(writes.length).toBe(0);
  });

  it("blockierter Vorschlag (hardOk=false) → kein write, reason 'blocked'", async () => {
    const writes: string[] = [];
    const { deps, files } = mkDeps({
      stream: fakeStream("kein json"),
      write: async (pp, d) => { writes.push(pp); files[pp] = d; },
    });
    const sa = new SmartApply(deps);
    const p = await sa.propose("note.md", "Templates/Projekt.md", () => {}, () => {});
    const res = await sa.persistApply(p);
    expect(res.written).toBe(false);
    expect(res.reason).toBe("blocked");
    expect(writes.length).toBe(0);
  });
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: both PASS.

- [ ] **Step 12: Failing test — idempotency: re-running propose on an applied note yields an empty FM diff and an unchanged body.** Append it. Run; expect PASS (deterministic block IDs + canonical serializer).

```ts
  it("Idempotenz: re-run auf der bereits angewendeten Notiz → leerer Frontmatter-Diff", async () => {
    const { deps, files } = mkDeps();
    const sa = new SmartApply(deps);
    const first = await sa.propose("note.md", "Templates/Projekt.md", () => {}, () => {});
    await sa.persistApply(first);
    expect(files["note.md"]).toBe(first.proposedContent);

    // Zweiter Lauf auf der angewendeten Notiz: das LLM liefert dieselbe Zuordnung,
    // type ist jetzt im (bestehenden) Frontmatter belegt → bleibt 'unveraendert'.
    const second = await sa.propose("note.md", "Templates/Projekt.md", () => {}, () => {});
    expect(second.hardOk).toBe(true);
    expect(second.fmRows.every(r => r.change === "unveraendert" || r.change === "neu")).toBe(true);
    expect(second.fmRows.some(r => r.change === "geaendert")).toBe(false);
    expect(second.fmRows.some(r => r.change === "entfernt")).toBe(false);
  });
```

```bash
npx vitest run tests/smart_apply.test.ts
```
Expected: PASS. (`type: Projekt` is now an existing key; `mergeFrontmatter`'s preserve-existing invariant keeps it; the canonical serializer reproduces the same bytes.)

- [ ] **Step 13: Run the full suite + typecheck + lint.** Confirm no regression across sibling modules and no `fetch`/`any`-cast violations introduced.

```bash
npm test && npx tsc --noEmit && npm run lint
```
Expected: all test files green (including `tests/smart_apply.test.ts`), `tsc` exits 0 with no errors, lint reports 0 problems (no `fetch`, no `eslint-disable`, no `plugin:any`).

- [ ] **Step 14: Commit (only the two touched files).**

```bash
git -C /Users/Shared/code/vault-rag add src/smart_apply.ts tests/smart_apply.test.ts
git -C /Users/Shared/code/vault-rag commit -m "$(cat <<'EOF'
feat(smart-apply): Orchestrator + einziger Writer (propose/persistApply/abort)

Reiner Kern ohne obsidian-Import: detect delegiert an detectType; propose
liest Template+Notiz, strippt %%, splittet Blöcke, streamt EINEN ChatClient-Call,
parst das Assignment, fährt die harten Checks (assignment-parse, permutation,
fm-roundtrip) + das weiche fm-source-Gating, baut den Body host-seitig aus
Original-Bytes zusammen und merged/serialisiert das Frontmatter mit Reparse-
Self-Check. persistApply ist der EINZIGE destruktive write: djb2-Stale-Guard,
blocked-Guard, genau 1× write + Undo-Closure.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: one commit containing exactly `src/smart_apply.ts` and `tests/smart_apply.test.ts`.

---

### Task 5: tests/__mocks__/obsidian.ts — FuzzySuggestModal + WorkspaceLeaf stubs

**Files:**
- Modify: `tests/__mocks__/obsidian.ts` (additive only)
- Test: none standalone — verified via full suite (`npm test`) staying green; the new stubs are exercised by the picker/view tests in Tasks 6-7.

**Interfaces:**

Consumes — nothing from earlier pure-core tasks (this is the DOM-mock layer; pure cores never import "obsidian").

Produces (consumed by Tasks 6 `template_picker.ts`/its test and 7 `smart_apply_view.ts`/its test). The real `FuzzySuggestModal` API that `src/template_picker.ts` subclasses, mirroring `src/note_picker.ts`:
```ts
class FuzzySuggestModal<T> {
  app: any;
  constructor(app: any);
  setPlaceholder(s: string): this;
  setQuery(s: string): void;
  getItems(): T[];          // overridden by subclass
  getItemText(item: T): string;  // overridden by subclass
  onChooseItem(item: T, evt?: any): void;  // overridden by subclass
  open(): void;
  onClose(): void;
  // test affordances (NOT in real obsidian):
  __choose(item: T): void;  // simulate the user picking an item
  __close(): void;          // simulate the user dismissing without choosing
  __instance: FuzzySuggestModal<T> | null;  // static: last-constructed instance
}
class WorkspaceLeaf {}
```
`src/template_picker.ts` (Task 6) constructs a subclass and resolves via `onChooseItem`/`onClose` using the same `settled` + `window.setTimeout(() => this.settle(null), 0)` null-pattern as `pickNote`. The stub must therefore NOT auto-resolve on `open()`; tests drive resolution through `__choose`/`__close`.

---

- [ ] **Step 1: Snapshot the current green suite (baseline).**
  Confirms the mock change is purely additive — same pass count before and after.
```bash
npm test 2>&1 | tail -5
```
Expected output: all test files pass, e.g. `Test Files  XX passed (XX)` / `Tests  YYY passed (YYY)`, exit code 0. Record the `Test Files` and `Tests` counts.

- [ ] **Step 2: Add the `WorkspaceLeaf` stub (minimal, additive).**
  The view test (Task 7) and `setViewState` glue may reference `WorkspaceLeaf` as a type/value; `makeFakeApp().workspace.getRightLeaf()` already returns a `{ setViewState }` shape, so the class only needs to exist as an exportable value. Add it right after the existing `TFile` class. Edit `tests/__mocks__/obsidian.ts`.
```ts
export class TFile { path = ""; basename = ""; extension = "md"; }
export class WorkspaceLeaf { view: any = null; async setViewState(_s: any) {} getViewState() { return {}; } detach() {} }
```
  (The `old_string` is the existing `TFile` line; append the `WorkspaceLeaf` line after it.)

- [ ] **Step 3: Add the `FuzzySuggestModal<T>` stub with test affordances.**
  Real obsidian's `FuzzySuggestModal` is the base `src/template_picker.ts` extends (exactly as `src/note_picker.ts` extends it). The stub must: store `app`, provide chainable `setPlaceholder`, a no-op `setQuery` (the picker calls it to seed the suggestion), default overridable `getItems`/`getItemText`/`onChooseItem`, an `open()` that records the instance but fires nothing, an `onClose()` that is callable via `super.onClose()`, and the `__choose`/`__close`/`__instance` affordances so a test can simulate a user pick or dismissal. Add it directly after the `WorkspaceLeaf` line from Step 2. Edit `tests/__mocks__/obsidian.ts`.
```ts
export class FuzzySuggestModal<T> {
  app: any;
  // Test-Affordanz: letzte konstruierte Instanz, damit ein Test choose/close treiben kann.
  static __instance: any = null;
  constructor(app: any) { this.app = app; (this.constructor as any).__instance = this; FuzzySuggestModal.__instance = this; }
  setPlaceholder(_s: string): this { return this; }
  setQuery(_s: string): void {}
  getItems(): T[] { return []; }
  getItemText(item: T): string { return String(item); }
  onChooseItem(_item: T, _evt?: any): void {}
  open(): void {}
  onClose(): void {}
  // Test-Affordanzen (nicht im echten Obsidian): simuliere Auswahl bzw. Verwerfen.
  __choose(item: T): void { this.onChooseItem(item); }
  __close(): void { this.onClose(); }
}
```
  Notes on the design, kept faithful to the consumer (`note_picker.ts`): `open()` is a true no-op so the subclass's `onClose`-`setTimeout(0)`-null path is only reached when a test explicitly calls `__close()`; `__choose` routes through the subclass-overridden `onChooseItem` so the `settled`-guard is exercised exactly as in production; `__instance` captures the last-constructed picker so the Task-6 test can grab it after `pickTemplate(...)` calls `.open()`.

- [ ] **Step 4: Typecheck the mock change.**
  The stub is `any`-typed like the rest of the mock, so strict mode must stay clean.
```bash
npx tsc --noEmit
```
Expected output: no output, exit code 0.

- [ ] **Step 5: Run the full suite — confirm still green, additive only.**
  No existing test imports `FuzzySuggestModal`/`WorkspaceLeaf` yet, so counts must match Step 1 exactly (nothing broken, nothing newly run).
```bash
npm test 2>&1 | tail -5
```
Expected output: identical `Test Files`/`Tests` pass counts to Step 1, exit code 0.

- [ ] **Step 6: Lint the mock change.**
  House rule: no `fetch`, no `eslint-disable`. The stub uses only `any` (allowed for `plugin:any`) and no banned APIs.
```bash
npm run lint
```
Expected output: no errors (warnings 0), exit code 0.

- [ ] **Step 7: Commit the mock extension on its own.**
  Stage ONLY the touched file (never `git add -A`).
```bash
git add tests/__mocks__/obsidian.ts
git commit -m "$(cat <<'EOF'
test(smart-apply): FuzzySuggestModal + WorkspaceLeaf Stubs im obsidian-Mock

Additiv: FuzzySuggestModal<T> mit __choose/__close/__instance-Affordanzen
(open() feuert nichts → settle-null-Pattern des Pickers bleibt testbar) und
minimaler WorkspaceLeaf-Stub für die View-/Picker-Tests (Tasks 6-7).
Pure-Cores bleiben DOM-frei; bestehende Exports unberührt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected output: one commit created touching only `tests/__mocks__/obsidian.ts`.

Relevant file paths: `/Users/Shared/code/vault-rag/tests/__mocks__/obsidian.ts` (modified), pattern source `/Users/Shared/code/vault-rag/src/note_picker.ts`, house-style reference `/Users/Shared/code/vault-rag/tests/chat_view.test.ts`.

---

### Task 6: template_picker (Obsidian FuzzySuggest)

**Files:**
- Create: `src/template_picker.ts`
- Test: `tests/template_picker.test.ts`
- (Consumes, do not modify here) `tests/__mocks__/obsidian.ts` — the Task 5 `FuzzySuggestModal` stub.

**Interfaces:**

Consumes (from Task 5, the obsidian mock's `FuzzySuggestModal<T>` stub — same surface as the real Obsidian API that `note_picker.ts` already uses):
```ts
// tests/__mocks__/obsidian.ts (Task 5)
class FuzzySuggestModal<T> {
  app: App;
  constructor(app: App);
  setPlaceholder(text: string): void;
  setQuery(query: string): void;          // seeds the search box
  open(): void;
  close(): void;
  // subclass hooks the stub invokes / exposes:
  getItems(): T[];
  getItemText(item: T): string;
  onChooseItem(item: T, evt?: unknown): void;
  onClose(): void;
}
export class TFile { path = ""; basename = ""; extension = "md"; }
export function makeFakeApp(): any; // app.vault.getMarkdownFiles() must be present for getItems
```
Also consumes the real Obsidian `App`/`TFile` types via `import { App, FuzzySuggestModal, TFile } from "obsidian"`.

Produces (later tasks — `main.ts` glue in Task 9 — rely on this verbatim from the spec's Schnittstellen section):
```ts
export function pickTemplate(app: App, templateDir: string, preselect: string | null): Promise<string | null>;
```

---

- [ ] **Step 1: Failing test — choosing an item resolves its path**

Create `tests/template_picker.test.ts` mirroring the house style (`tests/retriever.test.ts`/`tests/view.test.ts`): imports from `"../src/..."`, German `it()` strings, real objects + a fake app. The picker is async, so each test grabs the promise, then drives the underlying modal via the captured instance.

```ts
import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { pickTemplate, _lastPicker } from "../src/template_picker";

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.basename = path.split("/").pop()!.replace(/\.md$/, "");
  f.extension = "md";
  return f;
}

function appWith(paths: string[]): any {
  return { vault: { getMarkdownFiles: vi.fn(() => paths.map(tfile)) } };
}

describe("pickTemplate", () => {
  it("eine Auswahl löst mit deren Pfad auf", async () => {
    const app = appWith(["Templates/Buch.md", "Templates/Coding.md", "Notes/x.md"]);
    const p = pickTemplate(app, "Templates/", null);
    const picker = _lastPicker!;
    const chosen = picker.getItems().find(f => f.path === "Templates/Coding.md")!;
    picker.onChooseItem(chosen);
    picker.onClose(); // beide feuern bei echter Auswahl gemeinsam
    await expect(p).resolves.toBe("Templates/Coding.md");
  });
});
```

- [ ] **Step 2: Run it and see it FAIL**

```bash
npx vitest run tests/template_picker.test.ts
```
Expected output: FAIL — `Cannot find module '../src/template_picker'` (or `_lastPicker is undefined`). The file does not exist yet.

- [ ] **Step 3: Minimal implementation — pickTemplate + path resolution**

Create `src/template_picker.ts` as the FuzzySuggest sibling of `note_picker.ts`: same `settled`-guard + `onClose` `setTimeout(0)` null pattern. `getItems` is filtered to markdown files under `templateDir`. The `_lastPicker` export is a test seam (not consumed by `main.ts`).

```ts
import { App, FuzzySuggestModal, TFile } from "obsidian";

class TemplatePicker extends FuzzySuggestModal<TFile> {
  private settled = false;
  constructor(
    app: App,
    private templateDir: string,
    private preselect: string | null,
    private done: (p: string | null) => void,
  ) {
    super(app);
    this.setPlaceholder("Vorlage wählen…");
  }
  private settle(p: string | null): void { if (!this.settled) { this.settled = true; this.done(p); } }
  // Nur Markdown-Dateien unter templateDir — die Template-Dateien sind die Struktur-Wahrheit.
  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(this.templateDir));
  }
  getItemText(f: TFile): string {
    // (Vorschlag)-Marker ist das echte Signal: Obsidians Fuzzy-Ranking sortiert score-basiert
    // und garantiert KEIN Top-Sticking des geseedeten Eintrags.
    return f.path === this.preselect ? `${f.path}  (Vorschlag)` : f.path;
  }
  onChooseItem(f: TFile): void { this.settle(f.path); }
  onClose(): void {
    super.onClose();
    // Abbruch (null) erst nach einem Tick: onChooseItem + onClose feuern bei einer Auswahl
    // gemeinsam; so gewinnt die Auswahl unabhängig von der Reihenfolge (sonst überschreibt null den Pfad).
    window.setTimeout(() => this.settle(null), 0);
  }
}

/** Nur für Tests: zuletzt geöffneter Picker, um die Auswahl zu simulieren. */
export let _lastPicker: TemplatePicker | null = null;

/**
 * Öffnet einen Fuzzy-Picker über templateDir/*.md; gewählter Pfad oder null (abgebrochen).
 * `preselect` seedet die Sucheingabe (setQuery) UND wird per "(Vorschlag)"-Label markiert.
 */
export function pickTemplate(app: App, templateDir: string, preselect: string | null): Promise<string | null> {
  return new Promise(resolve => {
    const picker = new TemplatePicker(app, templateDir, preselect, resolve);
    _lastPicker = picker;
    if (preselect) {
      // Seedet die Suggestion; Ranking ist score-basiert, daher zusätzlich der Marker oben.
      const base = preselect.split("/").pop()!.replace(/\.md$/, "");
      picker.setQuery(base);
    }
    picker.open();
  });
}
```

- [ ] **Step 4: Run it and see it PASS**

```bash
npx vitest run tests/template_picker.test.ts
```
Expected output: PASS — 1 passed. The chosen path resolves.

- [ ] **Step 5: Failing test — getItems is filtered to templateDir-prefixed markdown**

Add to the `describe`:

```ts
  it("getItems liefert nur Markdown-Dateien unter templateDir", async () => {
    const app = appWith(["Templates/Buch.md", "Notes/x.md", "Templates/sub/Tief.md", "Other/Templates.md"]);
    const p = pickTemplate(app, "Templates/", null);
    const picker = _lastPicker!;
    expect(picker.getItems().map(f => f.path)).toEqual(["Templates/Buch.md", "Templates/sub/Tief.md"]);
    picker.onChooseItem(picker.getItems()[0]);
    picker.onClose();
    await p; // Promise abräumen, kein Hänger
  });
```

- [ ] **Step 6: Run it and see it PASS**

```bash
npx vitest run tests/template_picker.test.ts
```
Expected output: PASS — 2 passed. `Notes/x.md` and `Other/Templates.md` are excluded; the prefix matches `Templates/` exactly.

- [ ] **Step 7: Failing test — preselect is marked and setQuery is seeded**

Add to the `describe`:

Genau ein Test — das `(Vorschlag)`-Label ist laut Spec das verlässliche Signal (Obsidians Fuzzy-Ranking garantiert kein Top-Sticking, daher keine `_query`-Assertion):

```ts
  it("preselect wird per (Vorschlag)-Label markiert", async () => {
    const app = appWith(["Templates/Buch.md", "Templates/Coding.md"]);
    const p = pickTemplate(app, "Templates/", "Templates/Coding.md");
    const picker = _lastPicker!;
    // setQuery() lief beim open() (seedet die Sucheingabe); geprüft wird das verlässliche Label-Signal.
    const coding = picker.getItems().find(f => f.path === "Templates/Coding.md")!;
    const buch = picker.getItems().find(f => f.path === "Templates/Buch.md")!;
    expect(picker.getItemText(coding)).toContain("(Vorschlag)");
    expect(picker.getItemText(buch)).not.toContain("(Vorschlag)");
    picker.onChooseItem(coding);
    picker.onClose();
    await p;
  });
```

- [ ] **Step 8: Run it and see it PASS**

```bash
npx vitest run tests/template_picker.test.ts
```
Expected output: PASS — all preselect tests green. `Coding.md` carries `(Vorschlag)`, `Buch.md` does not.

- [ ] **Step 9: Failing test — closing without choosing resolves null, and double-settle is guarded**

Add to the `describe`. `onClose` defers null by a tick, so flush the macrotask. The double-settle test fires a choose then a close and asserts the resolved value is the path, not null.

```ts
  it("Schließen ohne Auswahl löst mit null auf", async () => {
    const app = appWith(["Templates/Buch.md"]);
    const p = pickTemplate(app, "Templates/", null);
    const picker = _lastPicker!;
    picker.onClose(); // keine Auswahl
    await new Promise(r => setTimeout(r, 0)); // den setTimeout(0)-Tick durchlassen
    await expect(p).resolves.toBeNull();
  });

  it("Doppel-Settle ist geschützt: Auswahl gewinnt gegen nachgelagertes onClose-null", async () => {
    const app = appWith(["Templates/Buch.md"]);
    const p = pickTemplate(app, "Templates/", null);
    const picker = _lastPicker!;
    picker.onChooseItem(picker.getItems()[0]); // settle("Templates/Buch.md")
    picker.onClose();                          // plant settle(null) für den nächsten Tick
    await new Promise(r => setTimeout(r, 0));   // null-Versuch läuft, wird aber vom Guard verschluckt
    await expect(p).resolves.toBe("Templates/Buch.md");
  });
```

- [ ] **Step 10: Run it and see it PASS**

```bash
npx vitest run tests/template_picker.test.ts
```
Expected output: PASS — all passed. The cancel path yields `null`; the guarded path yields the chosen path despite the trailing `onClose`. This also exercises the Task 5 `FuzzySuggestModal` stub's `open/setQuery/getItems/getItemText/onChooseItem/onClose` surface end to end.

- [ ] **Step 11: Typecheck**

```bash
npx tsc --noEmit
```
Expected output: no output, exit 0. (TypeScript strict + noImplicitAny; `pickTemplate` matches the spec signature; no `any`-casts in `src/template_picker.ts`.)

- [ ] **Step 12: Lint**

```bash
npm run lint
```
Expected output: no errors. No `fetch`, no `eslint-disable`; the picker does no network IO.

- [ ] **Step 13: Full suite stays green**

```bash
npm test
```
Expected output: all test files pass, including the new `tests/template_picker.test.ts`.

- [ ] **Step 14: Commit (stage only the two touched files)**

```bash
git add src/template_picker.ts tests/template_picker.test.ts
git commit -m "feat(smart-apply): template_picker FuzzySuggest mit (Vorschlag)-Marker

Schwester von note_picker.ts: gleicher settled-Guard + onClose-setTimeout(0)-null-Muster.
getItems gefiltert auf templateDir-Praefix; preselect seedet setQuery UND traegt das
(Vorschlag)-Label (Obsidians Fuzzy-Ranking ist score-basiert, kein Top-Sticking garantiert).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected output: one commit with exactly `src/template_picker.ts` and `tests/template_picker.test.ts` staged.

---

### Task 7: SmartApplyView (Obsidian Diff-Gate ItemView)

**Files:**
- Create: `src/smart_apply_view.ts`
- Test: `tests/smart_apply_view.test.ts`

**Interfaces:**

Consumes (from Task 4 `src/smart_apply.ts`, verbatim from the spec's Schnittstellen section):
```ts
export interface ApplyProposal {
  notePath: string; templatePath: string; type: string;
  originalText: string; originalHash: number;
  proposedContent: string;                          // "" gdw. ein harter Check fehlschlug
  fmRows: FmRow[];
  sectionDiff: { heading: string; blockIds: string[]; provenance: string | null }[];
  unassigned: SourceBlock[]; checks: CheckResult[]; hardOk: boolean; reasoning: string;
  detection: { source: SuggestionSource; confidence: "no" | "likely" | "confirmed" };
}
export interface ApplyResult { written: boolean; reason?: "stale" | "blocked"; undo?: () => Promise<void> }
```
Also consumes `FmRow { key: string; original?: FmValue; proposed?: FmValue; change: FmChange }` and `FmChange = "unveraendert" | "geaendert" | "neu" | "entfernt"` from `src/frontmatter.ts` (Task 1), `SourceBlock { id: string; text: string }` and `CheckResult { id: CheckId; ok: boolean; detail?: string }` from `src/note_restructurer.ts` (Task 3), and `pickTemplate` from `src/template_picker.ts` (Task 6) — but the view itself does NOT call `pickTemplate`; `build` is supplied pre-resolved by `main.ts`.

Produces (verbatim from the spec's Schnittstellen section — later tasks `main.ts` rely on these):
```ts
export const VIEW_TYPE_SMART_APPLY = "vault-rag-smart-apply";
export interface SmartApplyViewDeps {
  build: (notePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  accept: (p: ApplyProposal) => Promise<ApplyResult>;
  reroll: (p: ApplyProposal, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  openPath: (p: string) => void;
  abort: () => void;
}
export class SmartApplyView extends ItemView {
  constructor(leaf: WorkspaceLeaf, deps: SmartApplyViewDeps);
  getViewType(): string;              // VIEW_TYPE_SMART_APPLY
  getDisplayText(): string;           // "Smart Apply"
  getIcon(): string;                  // "wand-2"
  async onOpen(): Promise<void>;
  async onClose(): Promise<void>;
  run(notePath: string): Promise<void>;   // public entry: build → render diff (called by main after pickTemplate)
}
```

- [ ] **Step 1: Skeleton — view type, display text, icon, no-op render.** Create `src/smart_apply_view.ts` with the deps interface, the constant, and an `ItemView` shell that mirrors `chat_view.ts` (imports `ItemView, WorkspaceLeaf, setIcon` from `"obsidian"`). No diff logic yet — just enough to make the first test compile and the identity assertions pass.
```ts
import { ItemView, WorkspaceLeaf, setIcon, Notice } from "obsidian";
import { ApplyProposal, ApplyResult } from "./smart_apply";

export const VIEW_TYPE_SMART_APPLY = "vault-rag-smart-apply";

export interface SmartApplyViewDeps {
  build: (notePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  accept: (p: ApplyProposal) => Promise<ApplyResult>;
  reroll: (p: ApplyProposal, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  openPath: (p: string) => void;
  abort: () => void;
}

const CHANGE_ICON: Record<string, string> = {
  unveraendert: "minus", geaendert: "pencil", neu: "plus", entfernt: "trash-2",
};

export class SmartApplyView extends ItemView {
  private proposal: ApplyProposal | null = null;
  private applied = false;
  private bodyText = "";              // live-gestreamte Body-Tokens (proposed pane)
  private bodyPaneEl: HTMLElement | null = null;
  private workingEl: HTMLElement | null = null;
  private timer: ReturnType<typeof window.setInterval> | null = null;
  private workStart = 0;
  private running = false;

  constructor(leaf: WorkspaceLeaf, private deps: SmartApplyViewDeps) {
    super(leaf);
  }
  getViewType(): string { return VIEW_TYPE_SMART_APPLY; }
  getDisplayText(): string { return "Smart Apply"; }
  getIcon(): string { return "wand-2"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("vault-rag-sa-root");
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.removeClass("vault-rag-sa-root");
    this.stopWorking();
  }

  private render(): void { /* gefüllt in späteren Steps */ }
  private stopWorking(): void {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
  }
}
```
Then write the first failing test file:
```ts
import { describe, it, expect, vi } from "vitest";
import { SmartApplyView, VIEW_TYPE_SMART_APPLY, SmartApplyViewDeps } from "../src/smart_apply_view";
import type { ApplyProposal, ApplyResult } from "../src/smart_apply";
import { makeFakeApp } from "./__mocks__/obsidian";

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
    notePath: "Inbox/roh.md", templatePath: "Templates/Buch.md", type: "📖 Buch",
    originalText: "# roh\n\nalt", originalHash: 123,
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
    hardOk: true, reasoning: "weil X",
    detection: { source: "rag", confidence: "likely" },
    ...over,
  };
}
function mkDeps(over: Partial<SmartApplyViewDeps> = {}): SmartApplyViewDeps {
  return {
    build: vi.fn(async () => mkProposal()),
    accept: vi.fn(async (): Promise<ApplyResult> => ({ written: true, undo: vi.fn(async () => {}) })),
    reroll: vi.fn(async () => mkProposal()),
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

describe("SmartApplyView", () => {
  it("getViewType ist VIEW_TYPE_SMART_APPLY, Icon wand-2", () => {
    const { view } = mkView();
    expect(view.getViewType()).toBe(VIEW_TYPE_SMART_APPLY);
    expect(view.getIcon()).toBe("wand-2");
    expect(view.getDisplayText()).toBe("Smart Apply");
  });
});
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: PASS (1 passing) for the identity test (the skeleton already satisfies it; this anchors the harness before behavior tests).

- [ ] **Step 2: Failing test — header + status + guard banner render after run().** Add tests that drive `run()` (build → render) and assert the header (note name, type chip, source badge), a status line, and the guard banner showing "alle Prüfungen bestanden" when `hardOk` is true.
```ts
  it("run() rendert Header mit Notizname, Typ-Chip und Quelle-Badge", async () => {
    const { view } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    expect(all(view.contentEl, "vault-rag-sa-note")[0].textContent).toContain("roh");
    expect(all(view.contentEl, "vault-rag-sa-type-chip")[0].textContent).toContain("📖 Buch");
    expect(all(view.contentEl, "vault-rag-sa-source-badge")[0].textContent).toContain("RAG");
  });
  it("run() zeigt grünes Guard-Banner wenn hardOk", async () => {
    const { view } = mkView();
    await view.onOpen();
    await view.run("Inbox/roh.md");
    const banner = all(view.contentEl, "vault-rag-sa-guard")[0];
    expect(hasClass(banner, "is-ok")).toBe(true);
    expect(banner.textContent).toContain("bestanden");
  });
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: FAIL — these elements do not exist yet (`Cannot read properties of undefined (reading 'textContent')`) and there is no public `run()` method.

- [ ] **Step 3: Implement run() + header/status/guard rendering (minimal to pass).** Add the `run` entry point, the source-badge label map, and the top of `render()`.
```ts
  private badge(): string {
    if (!this.proposal) return "";
    const s = this.proposal.detection.source;
    return s === "frontmatter" ? "aus type:" : s === "rag" ? "Vorschlag (RAG)" : "manuell";
  }

  async run(notePath: string): Promise<void> {
    this.startWorking();
    this.bodyText = "";
    this.applied = false;
    this.proposal = null;
    try {
      // Block-Permutation: das LLM streamt das JSON-Assignment (+ Reasoning); der Body wird NACH dem
      // Stream host-seitig zusammengesetzt. Der Spinner (startWorking) zeigt den Fortschritt; die
      // Callbacks erfüllen den Stream-Vertrag (Slice 1 rendert Reasoning erst beim Finalisieren).
      this.proposal = await this.deps.build(notePath, () => {}, () => {});
    } catch (e) {
      // Seam-Vertrag (6): Abbruch/Template-Fehler sauber als Notice, kein ungefangener Throw.
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(msg === "abgebrochen" ? "Verworfen" : `Smart Apply: ${msg}`);
    } finally {
      this.stopWorking();
    }
    this.render();
  }

  private startWorking(): void {
    this.running = true;
    this.workStart = Date.now();
    const tick = (): void => {
      if (this.workingEl) {
        this.workingEl.setText(`● arbeitet… ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
      }
    };
    this.render();   // baut workingEl
    tick();
    this.timer = window.setInterval(tick, 100);
  }
```
Update `stopWorking` to also clear the running flag and finalize the status line, and replace the empty `render()` with the real shell (header → status → guard; later steps append the diff surfaces):
```ts
  private stopWorking(): void {
    this.running = false;
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    if (this.workStart && this.workingEl) {
      this.workingEl.setText(`✓ fertig in ${((Date.now() - this.workStart) / 1000).toFixed(1)} s`);
    }
  }

  private render(): void {
    const c = this.contentEl; c.empty();
    const p = this.proposal;

    const header = c.createDiv({ cls: "vault-rag-sa-header" });
    const noteName = p ? (p.notePath.split("/").pop()?.replace(/\.md$/, "") ?? p.notePath) : "—";
    header.createDiv({ cls: "vault-rag-sa-note", text: noteName });
    if (p) {
      header.createSpan({ cls: "vault-rag-sa-type-chip", text: p.type });
      header.createSpan({ cls: "vault-rag-sa-source-badge", text: this.badge() });
    }

    this.workingEl = c.createDiv({ cls: "vault-rag-sa-status" });

    if (!p) return;
    if (this.applied) { this.renderApplied(c); return; }

    this.renderGuard(c, p);
    this.renderFrontmatter(c, p);
    this.renderBody(c, p);
    this.renderUnassigned(c, p);
    this.renderActions(c, p);
    this.renderReasoning(c, p);
  }

  private renderGuard(c: HTMLElement, p: ApplyProposal): void {
    const banner = c.createDiv({ cls: "vault-rag-sa-guard" });
    banner.toggleClass("is-ok", p.hardOk);
    banner.toggleClass("is-error", !p.hardOk);
    if (p.hardOk) { banner.setText("✓ alle Prüfungen bestanden"); return; }
    banner.setText("Prüfungen fehlgeschlagen — Anwenden gesperrt:");
    const list = banner.createDiv({ cls: "vault-rag-sa-guard-list" });
    for (const ch of p.checks.filter(x => !x.ok)) {
      list.createDiv({ cls: "vault-rag-sa-guard-fail", text: `${ch.id}${ch.detail ? ": " + ch.detail : ""}` });
    }
  }
```
Add empty private stubs so the file compiles (`renderFrontmatter`, `renderBody`, `renderUnassigned`, `renderActions`, `renderReasoning`, `renderApplied` each take `(c: HTMLElement, p?: ApplyProposal)` and do nothing yet). Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: PASS (header + guard-ok tests green).

- [ ] **Step 4: Failing test — frontmatter key-table diff renders rows in stable order with change classes.** Assert one row per `fmRows` entry, in the array's order, each carrying its change class.
```ts
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
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: FAIL — `rows.length` is 0 (stub renders nothing).

- [ ] **Step 5: Implement renderFrontmatter (key-table diff).** Replace the stub. One row per `FmRow`, columns key | original | proposed, change class + icon, provenance hint.
```ts
  private fmCell(v: import("./frontmatter").FmValue | undefined): string {
    if (v === undefined) return "—";
    return Array.isArray(v) ? v.join(", ") : v;
  }

  private renderFrontmatter(c: HTMLElement, p: ApplyProposal): void {
    const sec = c.createDiv({ cls: "vault-rag-sa-fm" });
    sec.createDiv({ cls: "vault-rag-sa-section-title", text: "Frontmatter" });
    const table = sec.createDiv({ cls: "vault-rag-sa-fm-table" });
    for (const row of p.fmRows) {
      const r = table.createDiv({ cls: "vault-rag-sa-fm-row" });
      r.toggleClass(`is-${row.change}`, true);
      const icon = r.createSpan({ cls: "vault-rag-sa-fm-icon" });
      setIcon(icon, CHANGE_ICON[row.change] ?? "minus");
      r.createSpan({ cls: "vault-rag-sa-fm-key", text: row.key });
      r.createSpan({ cls: "vault-rag-sa-fm-orig", text: this.fmCell(row.original) });
      r.createSpan({ cls: "vault-rag-sa-fm-prop", text: this.fmCell(row.proposed) });
    }
  }
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: PASS (frontmatter row test green).

- [ ] **Step 6: Failing test — body section-stack renders provenance + "(noch leer)" sentinel.** One section per `sectionDiff`; the empty section shows the sentinel and the populated one shows its provenance.
```ts
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
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: FAIL — body sections and unassigned items are 0 (stubs empty).

- [ ] **Step 7: Implement renderBody (section-stack + live pane) and renderUnassigned.** Replace both stubs. The proposed body pane is a stable element so live tokens can append into it.
```ts
  private renderBody(c: HTMLElement, p: ApplyProposal): void {
    const sec = c.createDiv({ cls: "vault-rag-sa-body" });
    sec.createDiv({ cls: "vault-rag-sa-section-title", text: "Body" });

    // Live-Pane: gestreamte Tokens landen hier (auch während build noch läuft).
    this.bodyPaneEl = sec.createDiv({ cls: "vault-rag-sa-body-pane" });
    this.bodyPaneEl.setText(this.bodyText);

    for (const s of p.sectionDiff) {
      const block = sec.createDiv({ cls: "vault-rag-sa-body-section" });
      block.createDiv({ cls: "vault-rag-sa-body-heading", text: s.heading });
      if (s.blockIds.length === 0) {
        block.createDiv({ cls: "vault-rag-sa-empty", text: "(noch leer)" });
      } else {
        block.createDiv({ cls: "vault-rag-sa-provenance", text: `umsortiert aus: ${s.provenance ?? "—"}` });
      }
    }
  }

  private renderUnassigned(c: HTMLElement, p: ApplyProposal): void {
    const sec = c.createDiv({ cls: "vault-rag-sa-unassigned" });
    sec.createDiv({ cls: "vault-rag-sa-section-title", text: `Übrig (${p.unassigned.length})` });
    for (const b of p.unassigned) {
      sec.createDiv({ cls: "vault-rag-sa-unassigned-item", text: b.text });
    }
  }

  /** Live-Token-Append in die proposed pane (von main.ts' onToken via die SmartApply-Closure gerufen). */
  onToken(t: string): void {
    this.bodyText += t;
    this.bodyPaneEl?.setText(this.bodyText);
  }
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: PASS (body, sentinel, provenance, unassigned tests green).

- [ ] **Step 8: Failing test — live token append into the proposed pane.** Drive `onToken` directly after a render and assert the pane text grows without a full re-render (sections stay intact).
```ts
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
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: PASS — `onToken` and `bodyPaneEl` already implemented in Step 7, so this confirms the live-append contract (red only if Step 7 wired the pane wrong; if green immediately, it locks the behavior).

- [ ] **Step 9: Failing test — action bar; Anwenden disabled when hardOk false, calls accept once when ok; Verwerfen writes nothing; Erneut calls reroll; Vorlage öffnen calls openPath.** 
```ts
  it("Anwenden ist gesperrt (is-disabled) wenn hardOk false und ruft accept nicht", async () => {
    const { view, deps } = mkView({ build: vi.fn(async () => mkProposal({ hardOk: false, proposedContent: "", checks: [{ id: "permutation", ok: false, detail: "block_9 unbekannt" }] })) });
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
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: FAIL — no `vault-rag-sa-apply`/`-discard`/`-reroll`/`-open-tpl` buttons exist (`renderActions` is a stub).

- [ ] **Step 10: Implement renderActions (sticky action bar) + accept/reroll/discard handlers.** Replace the stub. The gate is enforced both visually (`is-disabled`) and behaviorally (guard clause in the click handler).
```ts
  private renderActions(c: HTMLElement, p: ApplyProposal): void {
    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });

    const apply = bar.createEl("button", { cls: "vault-rag-sa-apply mod-cta", text: "Anwenden" });
    apply.toggleClass("is-disabled", !p.hardOk);
    apply.addEventListener("click", () => { if (p.hardOk) void this.onAccept(p); });

    bar.createEl("button", { cls: "vault-rag-sa-discard", text: "Verwerfen" })
      .addEventListener("click", () => this.onDiscard());

    bar.createEl("button", { cls: "vault-rag-sa-reroll", text: "Erneut" })
      .addEventListener("click", () => void this.onReroll(p));

    bar.createEl("button", { cls: "vault-rag-sa-open-tpl", text: "Vorlage öffnen" })
      .addEventListener("click", () => this.deps.openPath(p.templatePath));
  }

  private async onAccept(p: ApplyProposal): Promise<void> {
    if (this.running) return;
    this.running = true;
    const res = await this.deps.accept(p);
    this.running = false;
    if (res.written) { this.applied = true; this.lastUndo = res.undo ?? null; }
    this.render();
  }

  private onDiscard(): void {
    this.deps.abort();
    this.proposal = null;
    this.bodyText = "";
    this.render();
  }

  private async onReroll(p: ApplyProposal): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startWorking();
    this.bodyText = "";
    try { this.proposal = await this.deps.reroll(p, () => {}, () => {}); }
    catch (e) { new Notice(e instanceof Error && e.message === "abgebrochen" ? "Verworfen" : `Smart Apply: ${e instanceof Error ? e.message : String(e)}`); }
    finally { this.stopWorking(); this.running = false; }
    this.render();
  }
```
Add the field `private lastUndo: (() => Promise<void>) | null = null;` next to the other fields. Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: PASS (all five action-bar tests green).

- [ ] **Step 11: Failing test — after accept the view stays open showing "angewendet" + a Rückgängig button that calls the undo.** 
```ts
  it("nach Accept bleibt das Panel offen und zeigt 'angewendet' + Rückgängig", async () => {
    const undo = vi.fn(async () => {});
    const { view } = mkView({ accept: vi.fn(async () => ({ written: true, undo })) });
    await view.onOpen();
    await view.run("Inbox/roh.md");
    all(view.contentEl, "vault-rag-sa-apply")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(all(view.contentEl, "vault-rag-sa-applied")[0].textContent).toContain("angewendet");
    const undoBtn = all(view.contentEl, "vault-rag-sa-undo")[0];
    expect(undoBtn).toBeTruthy();
    undoBtn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(undo).toHaveBeenCalledTimes(1);
    // Action-Bar mit Anwenden ist im angewendeten Zustand weg
    expect(all(view.contentEl, "vault-rag-sa-apply").length).toBe(0);
  });
  it("Accept mit written=false (stale) bleibt im Diff-Zustand, kein angewendet", async () => {
    const { view } = mkView({ accept: vi.fn(async () => ({ written: false, reason: "stale" })) });
    await view.onOpen();
    await view.run("Inbox/roh.md");
    all(view.contentEl, "vault-rag-sa-apply")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(all(view.contentEl, "vault-rag-sa-applied").length).toBe(0);
    expect(all(view.contentEl, "vault-rag-sa-apply").length).toBe(1);
  });
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: FAIL — `renderApplied` is still an empty stub, so no `vault-rag-sa-applied`/`-undo` elements appear.

- [ ] **Step 12: Implement renderApplied (angewendet state + Rückgängig).** Replace the stub.
```ts
  private renderApplied(c: HTMLElement): void {
    const box = c.createDiv({ cls: "vault-rag-sa-applied" });
    box.toggleClass("is-ok", true);
    const icon = box.createSpan({ cls: "vault-rag-sa-applied-icon" });
    setIcon(icon, "check");
    box.createSpan({ cls: "vault-rag-sa-applied-label", text: "✓ angewendet" });

    const bar = c.createDiv({ cls: "vault-rag-sa-actions" });
    const undoBtn = bar.createEl("button", { cls: "vault-rag-sa-undo", text: "Rückgängig" });
    undoBtn.toggleClass("is-disabled", !this.lastUndo);
    undoBtn.addEventListener("click", () => { if (this.lastUndo) void this.onUndo(); });
  }

  private async onUndo(): Promise<void> {
    const undo = this.lastUndo;
    if (!undo) return;
    await undo();
    this.lastUndo = null;
    this.applied = false;
    this.render();   // zurück zum Diff-Zustand des bestehenden proposal
  }
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: PASS (angewendet + Rückgängig + undo + stale tests green).

- [ ] **Step 13: Failing test — reasoning `<details>` + no innerHTML / no inline style attribute anywhere.** The reasoning block mirrors `chat_view`'s collapsed `<details>`. The hygiene test recursively asserts the production module never touches `innerHTML` and no rendered element carries a `style` attribute (we never call the mock's `setAttribute("style", …)`; we spy on it).
```ts
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
    const src = fs.readFileSync(new URL("../src/smart_apply_view.ts", import.meta.url), "utf8");
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
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: FAIL — `renderReasoning` is still a stub (no `vault-rag-sa-reasoning`). The innerHTML and style assertions pass already; the reasoning assertion fails first.

- [ ] **Step 14: Implement renderReasoning.** Replace the final stub, mirroring `chat_view`'s `<details>` pattern.
```ts
  private renderReasoning(c: HTMLElement, p: ApplyProposal): void {
    if (!p.reasoning) return;
    const det = c.createEl("details", { cls: "vault-rag-sa-reasoning" });
    det.open = false;
    det.createEl("summary", { cls: "vault-rag-sa-reasoning-sum", text: "💭 Gedanken" });
    det.createDiv({ cls: "vault-rag-sa-reasoning-body", text: p.reasoning });
  }
```
Run: `npx vitest run tests/smart_apply_view.test.ts` — Expected: PASS — all SmartApplyView tests green (reasoning + both hygiene tests).

- [ ] **Step 15: Full suite + typecheck + lint (no regressions, no fetch, no eslint-disable).** Run all three gates.
```bash
npm test && npx tsc --noEmit && npm run lint
```
Expected: `npm test` — all files pass including `tests/smart_apply_view.test.ts` (the new ~16 tests green, no other suite broken). `npx tsc --noEmit` — no output, exit 0 (strict + noImplicitAny clean, no `any`-casts in `src/smart_apply_view.ts`). `npm run lint` — exit 0, no warnings (no `fetch`, no `eslint-disable`, no `innerHTML`).

- [ ] **Step 16: Commit (only the two touched files).** 
```bash
git add src/smart_apply_view.ts tests/smart_apply_view.test.ts
git commit -m "$(cat <<'EOF'
feat(smart-apply): SmartApplyView Diff-Gate (ItemView) mit Live-Body-Streaming, Guard-Banner und Rückgängig

Zwei-Flächen-Diff (Frontmatter-Key-Tabelle + Body-Sektions-Stack mit
Herkunft/„(noch leer)"-Sentinel + „Übrig"-Eimer), Anwenden gesperrt bei
hardOk=false, sticky Action-Bar (Anwenden/Verwerfen/Erneut/Vorlage öffnen),
nach Accept „angewendet" + Rückgängig. Kein innerHTML/Inline-Style.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: one commit created on the current branch with exactly `src/smart_apply_view.ts` and `tests/smart_apply_view.test.ts` staged (verify with `git show --stat HEAD` — two files listed, nothing else).

---

### Task 8: src/settings.ts — Smart-Apply-Settings

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this task touches only the settings module). It relies on the existing builder/`display()`/`resetRenderState()` pattern in `src/settings.ts` and the existing `Setting` API from `tests/__mocks__/obsidian.ts`.
- Produces (later tasks rely on these): three fields on `VaultRagSettings` + `DEFAULT_SETTINGS`, copied verbatim from the spec's Komponenten row — `smartApplyEnabled: boolean` (default `false`), `templateDir: string` (default `"Templates/"`), `smartApplyTemperature: number` (default `0`). `main.ts` (Task on glue) reads `settings.smartApplyEnabled` to gate `registerView`/`addCommand`/`addRibbonIcon`, passes `templateDir` to `pickTemplate(app, templateDir, preselect)` and `listTemplates`, and supplies `smartApplyTemperature` into `SmartApplyDeps.params()` (`{ model, temperature, suppressThinking }`).

- [ ] **Step 1: Failing test — die drei neuen Defaults**
  Add a new `it()` block to `tests/settings.test.ts` (after the existing `"hat UX-Politur-Defaults"` block, before the closing `});` of the `describe`). This asserts the three new fields exist on `DEFAULT_SETTINGS` with the spec'd defaults.
  ```ts
  it("hat Smart-Apply-Defaults", () => {
    expect(DEFAULT_SETTINGS.smartApplyEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.templateDir).toBe("Templates/");
    expect(DEFAULT_SETTINGS.smartApplyTemperature).toBe(0);
  });
  ```

- [ ] **Step 2: Run the test, see it FAIL**
  ```bash
  npx vitest run tests/settings.test.ts
  ```
  Expected: FAIL. The new fields are not on `DEFAULT_SETTINGS`, and TypeScript/vitest reports e.g. `Property 'smartApplyEnabled' does not exist on type 'VaultRagSettings'` (and the same for `templateDir`, `smartApplyTemperature`). The previously green tests still pass.

- [ ] **Step 3: Extend the `VaultRagSettings` interface (minimal impl)**
  In `src/settings.ts`, add the three fields to the interface. Place them after `enterSends: boolean;`, just before the closing brace.
  ```ts
    enterSends: boolean;
    smartApplyEnabled: boolean;
    templateDir: string;
    smartApplyTemperature: number;
  }
  ```

- [ ] **Step 4: Extend `DEFAULT_SETTINGS` with the three defaults**
  In `src/settings.ts`, add the matching default values after `enterSends: true,`, before the closing `};`.
  ```ts
    enterSends: true,
    smartApplyEnabled: false,
    templateDir: "Templates/",
    smartApplyTemperature: 0,
  };
  ```

- [ ] **Step 5: Run the test, see it PASS**
  ```bash
  npx vitest run tests/settings.test.ts
  ```
  Expected: PASS. All `settings` specs green, including `"hat Smart-Apply-Defaults"`.

- [ ] **Step 6: Failing test — Backward-Compat-Merge auf altem data.json**
  Old vaults have a `data.json` written before Smart Apply existed; loading it must yield the new fields at their defaults via the `Object.assign({}, DEFAULT_SETTINGS, loaded)` pattern that `main.ts` uses (`this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<VaultRagSettings>);`). Add this `it()` block right after the `"hat Smart-Apply-Defaults"` block.
  ```ts
  it("Default-Merge ergänzt fehlende Smart-Apply-Felder aus altem data.json (Backward-Compat)", () => {
    // altes data.json — vor Smart Apply geschrieben, kennt die drei Felder nicht
    const loaded: Partial<VaultRagSettings> = {
      k: 30,
      chatModel: "mein-altes-modell",
      exclude: ["Archive/"],
    };
    const merged = Object.assign({}, DEFAULT_SETTINGS, loaded);
    // bestehende Werte aus data.json gewinnen
    expect(merged.k).toBe(30);
    expect(merged.chatModel).toBe("mein-altes-modell");
    expect(merged.exclude).toEqual(["Archive/"]);
    // die drei neuen Felder fehlen im alten data.json → fallen auf die Defaults zurück
    expect(merged.smartApplyEnabled).toBe(false);
    expect(merged.templateDir).toBe("Templates/");
    expect(merged.smartApplyTemperature).toBe(0);
  });
  ```
  This needs the `VaultRagSettings` type, so widen the import at the top of `tests/settings.test.ts`.
  ```ts
  import { DEFAULT_SETTINGS, VaultRagSettings } from "../src/settings";
  ```

- [ ] **Step 7: Run the test, see it PASS**
  ```bash
  npx vitest run tests/settings.test.ts
  ```
  Expected: PASS. The merge test is green because Steps 3–4 already added the fields and defaults; the `Object.assign` overlays the partial `loaded` over the full `DEFAULT_SETTINGS`.

- [ ] **Step 8: Add the "Smart Apply"-Sektion in `display()`**
  In `src/settings.ts`, append a new heading + three builder calls at the end of `display()`, after `this.buildEnter(new Setting(containerEl));`. Mirror the existing `sec(...)` + `build*(new Setting(containerEl))` line-builder pattern exactly.
  ```ts
      this.buildEnter(new Setting(containerEl));
      sec("Smart Apply");
      this.buildSmartApplyEnabled(new Setting(containerEl));
      this.buildSmartApplyConnectionNote(new Setting(containerEl));
      this.buildTemplateDir(new Setting(containerEl));
      this.buildSmartApplyTemperature(new Setting(containerEl));
    }
  ```

- [ ] **Step 9: Add the `buildSmartApplyEnabled` toggle builder**
  In `src/settings.ts`, add this method in the builder area (e.g. directly after `buildEnter`). Mirror the toggle pattern of `buildEnter`/`buildThinking` (`addToggle` + `setValue` + async `onChange` + `saveSettings`).
  ```ts
    // ── Builder: Smart Apply ──────────────────────────────────────────────
    private buildSmartApplyEnabled(s: Setting): void {
      s.setName("Smart Apply aktivieren")
        .setDesc("Schaltet den Befehl, das Ribbon-Icon und das Panel frei: eine unstrukturierte Notiz hinter einem Diff-Gate in die Struktur einer Vorlage überführen. Greift beim nächsten Neuladen des Plugins.")
        .addToggle(t => t.setValue(this.plugin.settings.smartApplyEnabled).onChange(async (v: boolean) => {
          this.plugin.settings.smartApplyEnabled = v;
          await this.plugin.saveSettings();
        }));
    }
  ```

- [ ] **Step 10: Add the read-only "nutzt die Chat-Verbindung"-Hinweis builder**
  This is a description-only row (no control), so the endpoint/model fields are not duplicated — Smart Apply reuses `chatEndpoint`/`chatModel`. Add this method after `buildSmartApplyEnabled`.
  ```ts
    /** Reiner Hinweis — Smart Apply nutzt die bestehende Chat-Verbindung; keine eigenen Endpoint-Felder. */
    private buildSmartApplyConnectionNote(s: Setting): void {
      s.setName("Verbindung")
        .setDesc("Smart Apply nutzt die Chat-Verbindung (Endpoint, Modell) aus dem Abschnitt „Chat“ — kein eigener Endpoint nötig.");
    }
  ```

- [ ] **Step 11: Add the `buildTemplateDir` text builder**
  In `src/settings.ts`, add after `buildSmartApplyConnectionNote`. Mirror the text-input pattern of `buildExclude`/`buildEmbeddingEndpoint` (`addText` + `setPlaceholder` + `setValue` + async `onChange` + `.trim()` + `saveSettings`).
  ```ts
    private buildTemplateDir(s: Setting): void {
      s.setName("Vorlagen-Ordner")
        .setDesc("Ordner mit den Markdown-Vorlagen (z.B. Templates/). Sollte in „Ausschluss-Pfade“ stehen, damit Vorlagen nicht eingebettet werden.")
        .addText(t => t.setPlaceholder("Templates/").setValue(this.plugin.settings.templateDir)
          .onChange(async (v: string) => {
            this.plugin.settings.templateDir = v.trim();
            await this.plugin.saveSettings();
          }));
    }
  ```

- [ ] **Step 12: Add the `buildSmartApplyTemperature` slider builder**
  In `src/settings.ts`, add after `buildTemplateDir`. Mirror the slider pattern of `buildTemp` (`addSlider` + `setLimits` + `setValue` + name-update in `onChange` + `saveSettings`). Default is 0 (deterministisch).
  ```ts
    private buildSmartApplyTemperature(s: Setting): void {
      s.setName(`Smart-Apply-Temperatur: ${this.plugin.settings.smartApplyTemperature}`)
        .setDesc("Temperatur für den Umsortier-Call (0 = deterministisch — empfohlen für reproduzierbare Vorschläge).")
        .addSlider(sl => sl.setLimits(0, 2, 0.1).setValue(this.plugin.settings.smartApplyTemperature)
          .onChange(async (v: number) => {
            this.plugin.settings.smartApplyTemperature = v;
            s.setName(`Smart-Apply-Temperatur: ${v}`);
            await this.plugin.saveSettings();
          }));
    }
  ```

- [ ] **Step 13: Typecheck**
  ```bash
  npx tsc --noEmit
  ```
  Expected: no output (exit 0). The new fields are fully typed, no `any`, no implicit-any; `display()` references resolve to the new private methods.

- [ ] **Step 14: Lint**
  ```bash
  npm run lint
  ```
  Expected: no errors (no `fetch`, no `eslint-disable`, no `plugin:any`). The new builders only use existing `Setting` methods.

- [ ] **Step 15: Full suite**
  ```bash
  npm test
  ```
  Expected: all suites PASS, including the extended `tests/settings.test.ts` (`"hat Smart-Apply-Defaults"` and the Backward-Compat-Merge spec). No regressions in the existing settings/retriever/chat suites.

- [ ] **Step 16: Commit (stage only the two touched files)**
  ```bash
  git -C /Users/Shared/code/vault-rag add src/settings.ts tests/settings.test.ts
  git -C /Users/Shared/code/vault-rag commit -m "feat(settings): Smart-Apply-Sektion (smartApplyEnabled/templateDir/smartApplyTemperature) + Backward-Compat-Defaults

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit containing exactly `src/settings.ts` and `tests/settings.test.ts`.

---

### Task 9: src/main.ts — Verdrahtung (registerView/Ribbon/Command/Deps, gated)

**Files:** Modify `src/main.ts`. No new test file — `main.ts` ist reine Verdrahtung; abgesichert über `npx tsc --noEmit` (grün) + `npm test` (Suite grün, kein Live-Netz: Stream/Deps werden erst in der SmartApply-Schicht injiziert, hier nicht ausgeführt). Manueller Smoke-Test als Checkbox dokumentiert.

**Interfaces:**

Consumes (exakte Signaturen aus früheren Tasks):
```ts
// from ./smart_apply (Task 7)
export interface SmartApplyDeps {
  client: () => ChatClient;
  read: (p: string) => Promise<string>;
  write: (p: string, data: string) => Promise<void>;
  listTemplates: () => Promise<string[]>;
  typeOf: (p: string) => Promise<string | null>;
  embed: (text: string) => Promise<Float32Array>;
  search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
  params: () => { model: string; temperature: number; suppressThinking: boolean };
}
export class SmartApply {
  constructor(deps: SmartApplyDeps);
  detect(notePath: string): Promise<TypeSuggestion>;
  propose(notePath: string, templatePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void): Promise<ApplyProposal>;
  persistApply(p: ApplyProposal): Promise<ApplyResult>;
  abort(): void;
}
// from ./smart_apply_view (Task 8)
export const VIEW_TYPE_SMART_APPLY = "vault-rag-smart-apply";
export interface SmartApplyViewDeps {
  build: (notePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  accept: (p: ApplyProposal) => Promise<ApplyResult>;
  reroll: (p: ApplyProposal, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  openPath: (p: string) => void;
  abort: () => void;
}
export class SmartApplyView extends ItemView { constructor(leaf: WorkspaceLeaf, deps: SmartApplyViewDeps); run(notePath: string): Promise<void> }
// from ./template_matcher (Task 2)
export function extractType(noteText: string): string | null;
// from ./template_picker (Task 6)
export function pickTemplate(app: App, templateDir: string, preselect: string | null): Promise<string | null>;
// existing
ChatClient.stream(...); EmbeddingClient.embed(texts: string[]): Promise<Float32Array[]>;
Retriever.search(queryVec, { k, minSim, exclude }): Hit[]; toIndexVector(vecs, dim): Float32Array;
```

Produces: nichts neues exportiert — `main.ts` ist die Glue-Spitze; keine späteren Tasks hängen an Symbolen aus dieser Datei.

---

- [ ] **Step 1: Baseline grün — Suite + Typecheck VOR der Änderung laufen lassen**
```bash
npx tsc --noEmit && npm test
```
Expected: `tsc` ohne Ausgabe (Exit 0); vitest meldet alle Files passed (z.B. `Test Files  XX passed`). Notiere die Zahl — sie darf nach der Änderung nicht sinken.

- [ ] **Step 2: Imports für die Smart-Apply-Schicht ergänzen**

Füge nach der letzten bestehenden Import-Zeile (`import { ChatView, VIEW_TYPE_CHAT } from "./chat_view";`, Zeile 15) drei Imports hinzu.
```ts
import { SmartApply } from "./smart_apply";
import { SmartApplyView, VIEW_TYPE_SMART_APPLY } from "./smart_apply_view";
import { extractType } from "./template_matcher";
import { pickTemplate } from "./template_picker";
```
Run:
```bash
npx tsc --noEmit
```
Expected: noch grün (Symbole sind importiert, aber alle bereits in den Vorgänger-Tasks exportiert). Falls ein Modul-Pfad rot ist → der jeweilige Vorgänger-Task ist nicht gemergt; Reihenfolge prüfen.

- [ ] **Step 3: Feld für die SmartApply-Instanz deklarieren**

Füge in der Klassen-Felder-Sektion (nach `chatClient!: ChatClient;`, Zeile 29) ein nullbares Feld hinzu — `null`, solange `smartApplyEnabled=false`.
```ts
  private smartApply: SmartApply | null = null;
```

- [ ] **Step 4: SmartApplyDeps + SmartApply assemblieren (gated), in onload()**

Füge am Ende von `onload()` — direkt VOR `if (this.settings.showStatusBar) this.setStatusBarVisible(true);` (Zeile 128) — den gegateten Verdrahtungs-Block ein. `embed` spiegelt die bestehende Chat-`embed`-Closure (Zeilen 83–89: `embed([t])` → `toIndexVector(vecs, index.dim)`); `search` spiegelt Zeile 92; `read`/`write` gehen über `app.vault.adapter`; `listTemplates` filtert `getMarkdownFiles()` auf das `templateDir`-Präfix; `typeOf` ist `read` + `extractType`; `client`/`params` spiegeln den Chat-Block.
```ts
    if (this.settings.smartApplyEnabled) {
      this.smartApply = new SmartApply({
        client: () => this.chatClient,
        read: (p) => this.app.vault.adapter.read(p),
        write: (p, data) => this.app.vault.adapter.write(p, data),
        listTemplates: async () =>
          this.app.vault.getMarkdownFiles()
            .map(f => f.path)
            .filter(p => p.startsWith(this.settings.templateDir)),
        typeOf: async (p) => extractType(await this.app.vault.adapter.read(p)),
        embed: async (t) => {
          const index = this.index;
          if (!index) throw new Error("kein Index");
          const vecs = await this.embedder.embed([t]);
          if (vecs.length === 0) throw new Error("embed: leere Antwort");
          return toIndexVector(vecs, index.dim);
        },
        search: (vec, opts) => {
          const retriever = this.retriever;
          return retriever ? retriever.search(vec, opts) : [];
        },
        params: () => ({
          model: this.settings.chatModel,
          temperature: this.settings.smartApplyTemperature,
          suppressThinking: this.settings.suppressThinking,
        }),
      });
      this.registerView(VIEW_TYPE_SMART_APPLY, (leaf: WorkspaceLeaf) => new SmartApplyView(leaf, {
        // SEAM-VERTRAG (7): build/reroll tragen die Live-Stream-Callbacks der View.
        build: (notePath, onToken, onReasoning) => this.proposeSmartApply(notePath, null, onToken, onReasoning),
        accept: (p) => this.smartApply!.persistApply(p),
        reroll: (p, onToken, onReasoning) => this.proposeSmartApply(p.notePath, p.templatePath, onToken, onReasoning),
        openPath: this.openPath,
        abort: () => this.smartApply?.abort(),
      }));
      this.addRibbonIcon("wand-2", "Smart Apply", () => void this.activateSmartApplyView());
      this.addCommand({
        id: "smart-apply-active-note",
        name: "Smart Apply auf aktive Notiz",
        checkCallback: (checking: boolean) => {
          const f = this.app.workspace.getActiveFile();
          const ok = f instanceof TFile && f.extension === "md";
          if (ok && !checking) void this.activateSmartApplyView();
          return ok;
        },
      });
    }
```
Note: `build`/`reroll` routen über den Helper `proposeSmartApply` (nächster Schritt), der jedes Mal den Picker öffnet (Seam-Vertrag 5) und die von der View übergebenen `onToken`/`onReasoning` an `propose` durchreicht (Seam-Vertrag 7). `accept` nutzt non-null `!` auf `this.smartApply` — sicher, weil die View nur in diesem gegateten Block registriert wird, also nie feuern kann, wenn `smartApply` null ist.

- [ ] **Step 5: proposeSmartApply-Helper + activateSmartApplyView() — picker + detect + propose, analog activateChatView()**

Füge nach `activateChatView()` zwei Methoden ein. `activateSmartApplyView` ermittelt die aktive Datei, öffnet/enthüllt das rechte Leaf und ruft danach `view.run(file.path)` (Seam-Vertrag 2). `proposeSmartApply` macht: Vorauswahl (explizit bei „Erneut", sonst `detect`) → `pickTemplate` (Abbruch null → Fehler „abgebrochen", den die View als „verworfen" behandelt) → `propose` mit den **durchgereichten** `onToken`/`onReasoning` (Seam-Vertrag 7); der Stream läuft genau einmal in `SmartApply.propose`.
```ts
  private async proposeSmartApply(
    notePath: string, preselect: string | null,
    onToken: (t: string) => void, onReasoning: (t: string) => void,
  ): Promise<ApplyProposal> {
    const core = this.smartApply;
    if (!core) throw new Error("Smart Apply ist deaktiviert");
    // SEAM-VERTRAG (5): IMMER picken. Vorauswahl = explizit (Erneut: aktuelles Template),
    // sonst die erkannte Typ-Vorlage — so deckt "Erneut" das Neu-Picken (sinnvoll bei temperature 0).
    const pre = preselect ?? (await core.detect(notePath)).templatePath;
    const tpl = await pickTemplate(this.app, this.settings.templateDir, pre);
    if (tpl === null) throw new Error("abgebrochen");
    // SEAM-VERTRAG (7): Live-Stream-Callbacks der View durchreichen (genau ein Stream in propose).
    return core.propose(notePath, tpl, onToken, onReasoning);
  }

  async activateSmartApplyView() {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("Smart Apply braucht eine aktive Markdown-Notiz");
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SMART_APPLY);
    const leaf = existing.length ? existing[0] : this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing.length) await leaf.setViewState({ type: VIEW_TYPE_SMART_APPLY, active: true });
    void this.app.workspace.revealLeaf(leaf);
    // SEAM-VERTRAG (2): die View mit dem aktiven Pfad antreiben — sonst bleibt die Pipeline tot.
    await (leaf.view as SmartApplyView).run(file.path);
  }
```

- [ ] **Step 6: ApplyProposal-Typ importieren (Rückgabetyp von proposeSmartApply)**

`proposeSmartApply` referenziert `ApplyProposal` als Rückgabetyp — den Typ als type-only Import ergänzen (er stammt aus `./smart_apply`). Erweitere den in Step 2 angelegten SmartApply-Import.
```ts
import { SmartApply, type ApplyProposal } from "./smart_apply";
```
(ersetzt die `import { SmartApply } from "./smart_apply";`-Zeile aus Step 2.)

- [ ] **Step 7: Typecheck — die Verdrahtung muss strict + noImplicitAny grün sein**
```bash
npx tsc --noEmit
```
Expected: keine Ausgabe (Exit 0). Häufige Treffer hier: `checkCallback`-Param `checking` ohne Typ (→ `boolean` annotiert, ok), `tpl` evtl. `string | null` an `propose` (→ der `if (tpl === null) throw` engt auf `string` ein), oder `this.smartApply!` (bewusst non-null, da nur im gated Block registriert). Bei rot: die gemeldete Zeile gegen die Consumes-Signaturen oben prüfen — KEINE `any`-Casts einführen.

- [ ] **Step 8: Lint — kein fetch, kein eslint-disable, plugin:any-Regel**
```bash
npm run lint
```
Expected: keine Errors. `main.ts` nutzt nur `this.app.vault.adapter.write`/`.read` (kein `fetch`), keine `any`. Bei rot beheben, ohne `// eslint-disable` zu setzen (Review-Blocker).

- [ ] **Step 9: Volle Suite — keine Regression durch die neuen Imports**
```bash
npm test
```
Expected: gleiche Anzahl passed Test Files wie in Step 1 (kein File rot). `main.ts` wird nicht direkt getestet; die neuen Imports ziehen aber `smart_apply`/`smart_apply_view`/`template_matcher`/`template_picker` in den Modulgraphen — ein Importfehler/Zyklus würde hier auffliegen. Falls ein bestehender Test (z.B. settings.test) das Plugin instanziiert und über den `obsidian`-Mock läuft: sicherstellen, dass der Mock `getMarkdownFiles` kennt (in Task 5 additiv ergänzt) — sonst dort nachziehen, nicht hier.

- [ ] **Step 10: Manueller Smoke-Test (kein automatischer Test — Wiring-Verifikation in echtem Obsidian)**

Checkliste, vor dem Commit im laufenden Obsidian (Reload des Plugins, In-place-Dev) durchgehen:
  - Settings → „Smart Apply" → Toggle `smartApplyEnabled` AN; Plugin neu laden (Cmd+P „Reload app without saving" oder Plugin aus/an).
  - Ribbon: das `wand-2`-Icon „Smart Apply" erscheint; bei AUS-Toggle erscheint es NICHT (Gate greift).
  - Eine unstrukturierte `.md`-Notiz öffnen → Command-Palette → „Smart Apply auf aktive Notiz" ist sichtbar/aktiv. Auf einer Nicht-md-Ansicht (z.B. Canvas/Settings) ist der Command ausgegraut (checkCallback false).
  - Command ausführen → FuzzySuggest-Template-Picker öffnet mit dem RAG-/Frontmatter-Vorschlag oben („(Vorschlag)") → Template wählen → SmartApplyView öffnet im rechten Leaf, Body streamt live, Diff-Gate rendert.
  - Picker mit Esc abbrechen → kein Panel, nichts geschrieben.
  - Toggle wieder AUS + Reload → weder Ribbon-Icon noch Command vorhanden.

- [ ] **Step 11: Commit — nur die berührte Datei stagen**
```bash
git add src/main.ts
git commit -m "feat(smart-apply): main.ts verdrahtet View/Ribbon/Command hinter smartApplyEnabled

SmartApplyDeps (read/write via vault.adapter, embed->toIndexVector->search,
client/params aus Chat-Settings), registerView/Ribbon(wand-2)/checkCallback-Command,
activateSmartApplyView analog activateChatView. Alles gegated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: ein Commit mit genau `src/main.ts` im Diff (`git show --stat HEAD` zeigt nur diese Datei). Falls Settings-Felder (`smartApplyEnabled`/`templateDir`/`smartApplyTemperature`) noch fehlen → die stammen aus dem settings-Task und müssen vorher gemergt sein, sonst ist `tsc` in Step 7 rot.
