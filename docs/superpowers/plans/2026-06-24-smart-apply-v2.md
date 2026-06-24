# Smart Apply v2 — Relevanz-Rangliste + selbsterklärende Vorlagen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vorlagen im Smart-Apply-Cockpit als relevanz-sortierte Rangliste zeigen (oberste vorausgewählt, eager beim Öffnen + Notiz-Wechsel) und Vorlagen sich in `%%`-Kommentaren selbst erklären lassen, damit das LLM auch ohne Thinking gut routet — alles im bestehenden Non-Fabrication-Vertrag.

**Architecture:** Zwei Module hinter dem bestehenden Pure-Core/Obsidian-View-Schnitt. (1) Neue `template_ranker.ts` (pure-core) rankt Vorlagen per direktem Cosinus (aktive Notiz ↔ Vorlagen-Text), mtime-gecacht, Frontmatter-`type` pinnt nach oben, Offline-Fallback. (2) `parseTemplate` extrahiert `%%`-Guidance strukturiert, `buildRestructurePrompt` rahmt sie explizit als „Anleitung, kein Inhalt". Die View ersetzt das `<select>` durch eine Radio-Rangliste mit eager Recompute über `active-leaf-change`.

**Tech Stack:** TypeScript (strict) · esbuild · vitest + happy-dom · Obsidian Plugin API · vorhandener `EmbeddingClient`/`Retriever`/`toIndexVector`.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Produktionstypen (Test-`as any` für private Zugriffe erlaubt, vgl. bestehende View-Tests).
- **Nach jeder Task müssen ALLE Tests grün sein** (`npm test` = `vitest run`), `npm run typecheck` (`tsc --noEmit`) und `npm run lint` sauber, `npm run build` grün.
- **Non-Fabrication-Vertrag unverändert:** Das LLM emittiert NUR das JSON-Assignment; `assembleBody` baut den Body aus Original-Blöcken; Guidance-/`%%`-Text landet NIE im Output. `assembleBody` wird NICHT verändert.
- **Vektorraum-Konsistenz:** Query- UND Vorlagen-Vektoren entstehen über die im Wiring injizierte `embed`-Closure (`toIndexVector(await embedder.embed([t]), index.dim)`) — beide unit-norm, daher ist das Skalarprodukt = Cosinus. dim NIE hart `256` annehmen; `index.dim` durchreichen (bereits im Wiring so).
- **Commits:** Conventional Commits (deutsche Beschreibung ok). **Nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** `feat/smart-apply-v2` (existiert bereits, Spec-Commit `c559969`).
- **Tests liegen unter `tests/`** (vitest `exclude: ['.claude/**']`); Obsidian wird via `vitest.config.ts`-Alias auf `tests/__mocks__/obsidian.ts` gezogen — kein `vi.mock("obsidian")` nötig.
- **Plan-Entscheidungen zu den offenen Spec-Punkten:** `%%`-Guidance steht im Section-Body (zwischen den Überschriften); FM-Hinweise = die Beispielwerte aus dem Vorlagen-Frontmatter (`tpl.fmDefaults`), NICHT `%%` im YAML; sichtbare Top-Einträge `N=5`; Vorlagen-Embedding-Cache **in-memory** (rebaut sich pro Plugin-Session, keine `data.json`-Persistenz in dieser Slice).

---

### Task 1: `%%`-Guidance pro Section parsen (`template_matcher.ts`)

**Files:**
- Modify: `src/template_matcher.ts` (Interface `TemplateSection`, `parseTemplate`; neue `extractAnnotations`)
- Test: `tests/template_matcher.test.ts`
- Modify (Fixture-Fix): `tests/note_restructurer.test.ts` (`spec()`-Helper bekommt `guidance`)

**Interfaces:**
- Consumes: vorhandene `stripAnnotations(text: string): string`, `parseFrontmatter`.
- Produces: `interface TemplateSection { heading: string; level: number; placeholder: string; guidance: string }` · `export function extractAnnotations(text: string): string`. `parseTemplate` füllt `guidance` (alle `%%…%%`-Inhalte einer Section, Marker entfernt, mit `" "` verbunden) und hält `placeholder` `%%`-frei.

- [ ] **Step 1: Failing-Test schreiben** — in `tests/template_matcher.test.ts` ans Dateiende (vor der letzten `});` der Top-`describe`-Ebene; `extractAnnotations` zum bestehenden Import aus `../src/template_matcher` hinzufügen):

```ts
describe("parseTemplate %%-guidance", () => {
  it("extrahiert %%-Annotation als guidance und hält placeholder sauber", () => {
    const tpl = parseTemplate("## Tagesordnung\n%% Stichpunkte zur Agenda hierher %%\n- Beispiel\n");
    const sec = tpl.sections[0];
    expect(sec.heading).toBe("Tagesordnung");
    expect(sec.guidance).toBe("Stichpunkte zur Agenda hierher");
    expect(sec.placeholder).not.toContain("%%");
    expect(sec.placeholder).toContain("- Beispiel");
  });

  it("Section ohne %% → guidance leer", () => {
    const tpl = parseTemplate("## Notizen\n- frei\n");
    expect(tpl.sections[0].guidance).toBe("");
  });

  it("mehrere %%-Blöcke einer Section werden zusammengefügt", () => {
    const tpl = parseTemplate("## A\n%% eins %%\nText\n%% zwei %%\n");
    expect(tpl.sections[0].guidance).toBe("eins zwei");
  });

  it("unbalanciertes %% crasht nicht und liefert guidance leer", () => {
    const tpl = parseTemplate("## X\n%% offen ohne Ende\n- y\n");
    expect(tpl.sections[0].guidance).toBe("");
    expect(tpl.sections[0].heading).toBe("X");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/template_matcher.test.ts -t "%%-guidance"`
Expected: FAIL (`extractAnnotations` nicht exportiert / `sec.guidance` ist `undefined`).

- [ ] **Step 3: Implementieren** — in `src/template_matcher.ts`:

(a) `TemplateSection` um `guidance` erweitern:

```ts
export interface TemplateSection { heading: string; level: number; placeholder: string; guidance: string }
```

(b) direkt unter `stripAnnotations` die Extraktion ergänzen:

```ts
/** Sammelt den Inhalt aller %% … %%-Annotationen (Marker entfernt), zu einem Hinweis verbunden.
 *  Unbalancierte/halboffene %% werden ignoriert (kein Match). */
export function extractAnnotations(text: string): string {
  const out: string[] = [];
  const re = /%%([\s\S]*?)%%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim();
    if (inner) out.push(inner);
  }
  return out.join(" ");
}
```

(c) den `flush`-Closure in `parseTemplate` ersetzen:

```ts
  const flush = (): void => {
    if (cur) {
      const buf = cur.buf.join("\n");
      sections.push({
        heading: cur.heading,
        level: cur.level,
        placeholder: stripAnnotations(buf).trim(),
        guidance: extractAnnotations(buf),
      });
    }
  };
```

- [ ] **Step 4: tsc findet alle TemplateSection-Literale** — das neue Pflichtfeld bricht Fixtures. In `tests/note_restructurer.test.ts` den `spec()`-Helper anpassen (Section-Map):

```ts
  const sections: TemplateSection[] = headings.map((h, i) => ({
    heading: h,
    level: 2,
    placeholder: `ph${i}`,
    guidance: "",
  }));
```

Run: `npx tsc --noEmit`
Expected: PASS (keine weiteren `TemplateSection`-Literale offen; falls doch, jeweils `guidance: ""` ergänzen).

- [ ] **Step 5: Tests grün**

Run: `npx vitest run tests/template_matcher.test.ts tests/note_restructurer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/template_matcher.ts tests/template_matcher.test.ts tests/note_restructurer.test.ts
git commit -m "$(printf 'feat(smart-apply): parseTemplate extrahiert %%%%-Guidance pro Section\n\nTemplateSection.guidance haelt den %%%%-Hinweistext (Marker entfernt); placeholder\nbleibt %%%%-frei. Grundlage fuer selbsterklaerende Vorlagen.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Strukturierte Guidance im Prompt (`note_restructurer.ts`)

**Files:**
- Modify: `src/note_restructurer.ts` (`buildRestructurePrompt`; neue `fmExample`)
- Test: `tests/note_restructurer.test.ts`

**Interfaces:**
- Consumes: `TemplateSpec.sections[].guidance` (Task 1), `TemplateSpec.fmDefaults`, `TemplateSpec.keys`, `ANTI_FABRICATION`, `SourceBlock`, `ChatMessage`.
- Produces: `buildRestructurePrompt(tpl: TemplateSpec, blocks: SourceBlock[]): ChatMessage[]` — Signatur unverändert, Inhalt strukturiert (kein `tpl.raw`-Dump mehr). `assembleBody` bleibt unangetastet.

- [ ] **Step 1: Failing-Tests schreiben** — in `tests/note_restructurer.test.ts` neuen Block anhängen (Imports `assembleBody`, `buildRestructurePrompt`, `SourceBlock` sind vorhanden; `asg`-Helper vorhanden):

```ts
describe("buildRestructurePrompt %%-guidance", () => {
  function tplWith(guidance: string): TemplateSpec {
    return {
      type: "Besprechung",
      keys: ["type", "status"],
      fmDefaults: { type: "Besprechung", status: "offen" },
      sections: [
        { heading: "Tagesordnung", level: 2, placeholder: "", guidance },
        { heading: "Notizen", level: 2, placeholder: "", guidance: "" },
      ],
      raw: "egal",
    };
  }
  const blocks: SourceBlock[] = [{ id: "block_0", text: "- Punkt A" }];

  it("rendert Anleitung pro Überschrift, Beispiel pro Key und die kein-Inhalt-Instruktion", () => {
    const [system, userMsg] = buildRestructurePrompt(tplWith("Stichpunkte zur Agenda hierher"), blocks);
    expect(userMsg.content).toContain("Tagesordnung — Anleitung: Stichpunkte zur Agenda hierher");
    expect(userMsg.content).toContain("- Notizen");
    expect(userMsg.content).not.toContain("Notizen — Anleitung:");
    expect(userMsg.content).toContain("status (Beispiel: offen)");
    expect(userMsg.content).toContain("Geordnete Überschriften: Tagesordnung, Notizen");
    expect(system.content).toContain("KEIN zuzuordnender Inhalt");
  });

  it("Vorlage ohne %% bleibt rückwärtskompatibel (Überschriften + Keys, keine Anleitung-Zeile)", () => {
    const [, userMsg] = buildRestructurePrompt(tplWith(""), blocks);
    expect(userMsg.content).not.toContain("Anleitung:");
    expect(userMsg.content).toContain("- Tagesordnung");
    expect(userMsg.content).toContain("## Original-Body in nummerierten Blöcken");
  });

  it("Guidance-Text landet nie im assembleBody-Output", () => {
    const tpl: TemplateSpec = {
      type: "X", keys: [], fmDefaults: {},
      sections: [{ heading: "A", level: 2, placeholder: "", guidance: "GEHEIM" }], raw: "egal",
    };
    const out = assembleBody(tpl, asg({ sections: [{ heading: "A", blocks: ["block_0"] }] }), [{ id: "block_0", text: "echter inhalt" }]);
    expect(out).not.toContain("GEHEIM");
    expect(out).toContain("echter inhalt");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/note_restructurer.test.ts -t "%%-guidance"`
Expected: FAIL (alter Prompt enthält `## Template-Struktur (verbatim)`, keine `Anleitung:`/`Beispiel:`-Zeilen).

- [ ] **Step 3: Implementieren** — in `src/note_restructurer.ts` `buildRestructurePrompt` vollständig ersetzen und `fmExample` direkt davor einfügen:

```ts
/** Vorlagen-Beispielwert als String (Selbst-Dokumentation, nie Inhalt). Leer → "". */
function fmExample(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.length ? v.map(x => String(x)).join(", ") : "";
  return String(v).trim();
}

export function buildRestructurePrompt(tpl: TemplateSpec, blocks: SourceBlock[]): ChatMessage[] {
  const numbered = blocks.map(b => `${b.id}:\n${b.text}`).join("\n\n");
  const headings = tpl.sections.map(s => s.heading).join(", ");

  const sectionLines = tpl.sections
    .map(s => (s.guidance ? `- ${s.heading} — Anleitung: ${s.guidance}` : `- ${s.heading}`))
    .join("\n");
  const keyLines = tpl.keys
    .map(k => { const ex = fmExample(tpl.fmDefaults[k]); return ex ? `- ${k} (Beispiel: ${ex})` : `- ${k}`; })
    .join("\n");

  const system = [
    "Du bist ein strukturierender Assistent für Obsidian-Notizen.",
    ANTI_FABRICATION,
    "Die `Anleitung:`-Zeilen und `(Beispiel: …)`-Angaben der Vorlage sind VORGABEN — sie sagen dir, welche Original-Blöcke unter welche Überschrift gehören und was in ein Frontmatter-Feld passt. Sie sind KEIN zuzuordnender Inhalt; übernimm ihren Text niemals in den Output.",
    'Schema: { "version": 1, "sections": [{ "heading": "<Überschrift>", "blocks": ["block_3"] }],',
    '"unassigned": ["block_7"], "frontmatter": { "<key>": { "source": "content"|"empty", "value": "<wert>" } } }',
    'Frontmatter mit source="content" muss wörtlich aus den Blöcken stammen; sonst source="empty".',
  ].join("\n");

  const user = [
    "## Vorlagen-Struktur (Überschriften + Anleitung)",
    sectionLines,
    "",
    "## Frontmatter-Keys",
    keyLines,
    "",
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

- [ ] **Step 4: Alte Prompt-Assertions anpassen** — in `tests/note_restructurer.test.ts` nach Vorkommen von `"Template-Struktur"`, `"verbatim"` und `tpl.raw`-Erwartungen im bestehenden `buildRestructurePrompt`-`describe` suchen und auf die neue Struktur umstellen (z.B. eine Assertion auf `"## Template-Struktur (verbatim)"` ersetzen durch `expect(userMsg.content).toContain("## Vorlagen-Struktur")`). Headings-/Keys-Assertions bleiben gültig.

Run: `npx vitest run tests/note_restructurer.test.ts`
Expected: PASS (neue + angepasste alte Tests grün).

- [ ] **Step 5: Volltest + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/note_restructurer.ts tests/note_restructurer.test.ts
git commit -m "$(printf 'feat(smart-apply): strukturierte %%%%-Guidance im Restructure-Prompt\n\nStatt tpl.raw-Dump: pro Ueberschrift optionale Anleitung, pro Key der\nVorlagen-Beispielwert, plus explizite Instruktion dass Anleitung KEIN Inhalt ist.\nRueckwaertskompatibel; Non-Fabrication unveraendert.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: `TemplateRanker` (neues Pure-Core-Modul)

**Files:**
- Create: `src/template_ranker.ts`
- Test: `tests/template_ranker.test.ts`

**Interfaces:**
- Consumes: `extractType`, `resolveTemplateForType` aus `./template_matcher`; `parseFrontmatter` aus `./frontmatter`. Injizierte `RankDeps` (read/stat/listTemplates/embed).
- Produces:
  - `interface TemplateRank { templatePath: string; type: string; score: number; source: "confirmed" | "match" | "fallback" }`
  - `interface RankDeps { read: (path: string) => Promise<string>; stat: (path: string) => Promise<{ mtime: number }>; listTemplates: () => Promise<string[]>; embed: (text: string) => Promise<Float32Array> }`
  - `class TemplateRanker { constructor(deps: RankDeps); rank(notePath: string): Promise<TemplateRank[]> }`

- [ ] **Step 1: Failing-Tests schreiben** — neue Datei `tests/template_ranker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TemplateRanker, RankDeps, TemplateRank } from "../src/template_ranker";

function deps(over: Partial<RankDeps> = {}): RankDeps {
  return {
    read: async (p) => (p.startsWith("Templates/") ? p : "Body"),
    stat: async () => ({ mtime: 1 }),
    listTemplates: async () => ["Templates/Besprechung.md", "Templates/Buch.md"],
    embed: async () => new Float32Array([1, 0]),
    ...over,
  };
}

describe("TemplateRanker", () => {
  it("sortiert Vorlagen nach Cosinus absteigend", async () => {
    const vecs: Record<string, Float32Array> = {
      "Body": new Float32Array([1, 0]),
      "Templates/Besprechung.md": new Float32Array([0.9, 0.436]),
      "Templates/Buch.md": new Float32Array([0.1, 0.995]),
    };
    const r = new TemplateRanker(deps({ embed: async (t) => vecs[t] ?? vecs["Body"] }));
    const out = await r.rank("note.md");
    expect(out.map(x => x.templatePath)).toEqual(["Templates/Besprechung.md", "Templates/Buch.md"]);
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[0].source).toBe("match");
  });

  it("Frontmatter-type pinnt die passende Vorlage als confirmed nach oben — trotz niedrigerem Score", async () => {
    const r = new TemplateRanker(deps({
      read: async (p) => (p.startsWith("Templates/") ? p : "---\ntype: Buch\n---\nBody"),
      embed: async (t) => {
        if (!t.startsWith("Templates/")) return new Float32Array([1, 0]);      // query
        return t.includes("Besprechung") ? new Float32Array([1, 0]) : new Float32Array([0.5, 0.866]);
      },
    }));
    const out = await r.rank("note.md");
    expect(out[0].templatePath).toBe("Templates/Buch.md");
    expect(out[0].source).toBe("confirmed");
  });

  it("Embedder offline → kein Throw, alphabetischer Fallback (score 0, source fallback)", async () => {
    const r = new TemplateRanker(deps({ embed: async () => { throw new Error("offline"); } }));
    const out = await r.rank("note.md");
    expect(out.every(x => x.score === 0 && x.source === "fallback")).toBe(true);
    expect(out.map(x => x.templatePath)).toEqual(["Templates/Besprechung.md", "Templates/Buch.md"]);
  });

  it("Offline mit Frontmatter-type → passende Vorlage bleibt confirmed", async () => {
    const r = new TemplateRanker(deps({
      read: async (p) => (p.startsWith("Templates/") ? p : "---\ntype: Buch\n---\nBody"),
      embed: async () => { throw new Error("offline"); },
    }));
    const out = await r.rank("note.md");
    expect(out[0].templatePath).toBe("Templates/Buch.md");
    expect(out[0].source).toBe("confirmed");
  });

  it("cached das Vorlagen-Embedding per mtime; re-embed erst bei mtime-Änderung", async () => {
    let embedCalls = 0;
    let mtime = 1;
    const r = new TemplateRanker(deps({
      listTemplates: async () => ["Templates/Besprechung.md"],
      stat: async () => ({ mtime }),
      embed: async () => { embedCalls++; return new Float32Array([1, 0]); },
    }));
    await r.rank("note.md");                       // query(1) + tpl(1)
    await r.rank("note.md");                       // query(1) + cache-hit(0)
    expect(embedCalls).toBe(3);
    mtime = 2;
    await r.rank("note.md");                        // query(1) + re-embed(1)
    expect(embedCalls).toBe(5);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/template_ranker.test.ts`
Expected: FAIL (`../src/template_ranker` existiert nicht).

- [ ] **Step 3: Implementieren** — neue Datei `src/template_ranker.ts`:

```ts
import { parseFrontmatter } from "./frontmatter";
import { extractType, resolveTemplateForType } from "./template_matcher";

export interface TemplateRank {
  templatePath: string;
  type: string;
  /** Rohe Cosinus-Ähnlichkeit 0..1 (0 = nicht eingebettet / Embedder offline). */
  score: number;
  source: "confirmed" | "match" | "fallback";
}

export interface RankDeps {
  read: (path: string) => Promise<string>;
  stat: (path: string) => Promise<{ mtime: number }>;
  listTemplates: () => Promise<string[]>;
  /** text → unit-norm reduzierter Vektor (im Wiring: toIndexVector(embedder.embed([t]), index.dim)). */
  embed: (text: string) => Promise<Float32Array>;
}

/** Skalarprodukt zweier unit-norm Vektoren = Cosinus. Defensiv gegen Längen-Mismatch/Leere. */
function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function basename(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.md$/i, "");
}

/** Rankt Vorlagen nach direkter Cosinus-Ähnlichkeit der aktiven Notiz zum Vorlagen-Text.
 *  Frontmatter-`type` pinnt die passende Vorlage als "confirmed" nach oben.
 *  Embedder offline → kein Throw: alphabetischer Fallback (score 0). Cache per mtime. */
export class TemplateRanker {
  private cache = new Map<string, { mtime: number; vec: Float32Array }>();
  constructor(private deps: RankDeps) {}

  async rank(notePath: string): Promise<TemplateRank[]> {
    const templates = await this.deps.listTemplates();
    const noteText = await this.deps.read(notePath);
    const fmType = extractType(noteText);
    const pinnedPath = fmType ? resolveTemplateForType(fmType, templates) : null;

    let queryVec: Float32Array | null = null;
    try {
      const vec = await this.deps.embed(parseFrontmatter(noteText).body);
      queryVec = vec.length > 0 ? vec : null;
    } catch {
      queryVec = null; // Embedder/Index offline → sauber degradieren.
    }

    const ranks: TemplateRank[] = [];
    for (const path of templates) {
      const type = basename(path);
      const confirmed = path === pinnedPath;
      if (queryVec === null) {
        ranks.push({ templatePath: path, type, score: 0, source: confirmed ? "confirmed" : "fallback" });
        continue;
      }
      let score = 0;
      try {
        score = dot(queryVec, await this.templateVec(path));
      } catch {
        score = 0; // einzelne Vorlage nicht einbettbar → score 0, bleibt gelistet.
      }
      ranks.push({ templatePath: path, type, score, source: confirmed ? "confirmed" : "match" });
    }

    ranks.sort((a, b) => {
      const ca = a.source === "confirmed" ? 1 : 0;
      const cb = b.source === "confirmed" ? 1 : 0;
      if (ca !== cb) return cb - ca;
      if (b.score !== a.score) return b.score - a.score;
      return a.templatePath < b.templatePath ? -1 : a.templatePath > b.templatePath ? 1 : 0;
    });
    return ranks;
  }

  private async templateVec(path: string): Promise<Float32Array> {
    const { mtime } = await this.deps.stat(path);
    const cached = this.cache.get(path);
    if (cached && cached.mtime === mtime) return cached.vec;
    const vec = await this.deps.embed(await this.deps.read(path)); // ganze Vorlage inkl. %%-Anleitung
    this.cache.set(path, { mtime, vec });
    return vec;
  }
}
```

- [ ] **Step 4: Tests grün**

Run: `npx vitest run tests/template_ranker.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/template_ranker.ts tests/template_ranker.test.ts
git commit -m "$(printf 'feat(smart-apply): TemplateRanker — Vorlagen nach direktem Cosinus ranken\n\nAktive Notiz vs. Vorlagen-Text (inkl. %%%%-Anleitung), mtime-gecacht,\nFrontmatter-type pinnt nach oben, Offline-Fallback ohne Throw.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Ranker verdrahten (`main.ts`)

**Files:**
- Modify: `src/main.ts` (Import + Feld + Instanziierung im `smartApplyEnabled`-Block + `rankTemplates`-Closure in den View-Deps)

**Interfaces:**
- Consumes: `TemplateRanker`/`RankDeps` (Task 3), vorhandene `this.embedder`, `this.index`, `toIndexVector`, `templateFilesUnder`, `this.app.vault.adapter`.
- Produces: `this.templateRanker?: TemplateRanker`; neuer View-Dep `rankTemplates: (notePath: string) => Promise<TemplateRank[]>` (von Task 5 konsumiert).

- [ ] **Step 1: Import + Feld** — in `src/main.ts` zu den Imports hinzufügen:

```ts
import { TemplateRanker } from "./template_ranker";
import type { TemplateRank } from "./template_ranker";
```

Bei den Plugin-Feldern (neben `smartApply`) deklarieren:

```ts
  private templateRanker?: TemplateRanker;
```

- [ ] **Step 2: Instanziieren** — im `if (this.settings.smartApplyEnabled) { … }`-Block, direkt nach `this.smartApply = new SmartApply(…)`, einfügen:

```ts
      this.templateRanker = new TemplateRanker({
        read: (p) => this.app.vault.adapter.read(p),
        stat: async (p) => { const s = await this.app.vault.adapter.stat(p); return { mtime: s?.mtime ?? 0 }; },
        listTemplates: async () =>
          templateFilesUnder(this.app.vault.getMarkdownFiles().map(f => f.path), this.settings.templateDir),
        embed: async (t) => {
          const index = this.index;
          if (!index) throw new Error("kein Index");
          const vecs = await this.embedder.embed([t]);
          if (vecs.length === 0) throw new Error("embed: leere Antwort");
          return toIndexVector(vecs, index.dim);
        },
      });
```

- [ ] **Step 3: View-Dep ergänzen** — im `this.registerView(VIEW_TYPE_SMART_APPLY, (leaf) => new SmartApplyView(leaf, { … }))`-Objekt eine Zeile hinzufügen (z.B. direkt nach `listTemplates:`):

```ts
        rankTemplates: (notePath: string): Promise<TemplateRank[]> => this.templateRanker!.rank(notePath),
```

> Hinweis: Die View-Dep `listTemplates` wird in Task 5 entfernt; in diesem Schritt bleibt sie noch stehen (Task 5 nimmt sie hier UND in der View raus).

- [ ] **Step 4: Verifizieren** (main.ts hat keine Unit-Tests)

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: PASS (tsc + esbuild grün, bestehende Tests unberührt grün).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "$(printf 'feat(smart-apply): TemplateRanker verdrahten + rankTemplates View-Dep\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Rangliste in der View (`smart_apply_view.ts`) + eager Recompute

**Files:**
- Modify: `tests/__mocks__/obsidian.ts` (ItemView-Mock bekommt `registerEvent`)
- Modify: `src/smart_apply_view.ts` (Deps, State, `recomputeRanking`/`scheduleRecompute`/`selectTemplate`, `renderRankList`, `<select>` entfernen, `onOpen`/`onClose`)
- Modify: `src/main.ts` (View-Dep `listTemplates` entfernen)
- Modify: `styles.css` (Rangliste-CSS)
- Test: `tests/smart_apply_view.test.ts`

**Interfaces:**
- Consumes: `TemplateRank` (Task 3), neuer Dep `rankTemplates` (Task 4).
- Produces: `SmartApplyViewDeps` ohne `listTemplates`, mit `rankTemplates: (notePath: string) => Promise<TemplateRank[]>`. Private testbare Seams: `recomputeRanking(noteChanged?: boolean): Promise<void>`, `selectTemplate(path: string): void`.

- [ ] **Step 1: Mock erweitern** — in `tests/__mocks__/obsidian.ts` die `ItemView`-Klasse um eine No-op-`registerEvent` ergänzen (die echte `ItemView` erbt sie von `Component`; der Mock hat sie nicht):

```ts
export class ItemView { app: any; contentEl: any; constructor(public leaf: any) { this.app = leaf?.app || {}; this.contentEl = makeFakeEl(); } getViewType() { return "unknown"; } getDisplayText() { return ""; } async onOpen() {} async onClose() {} registerEvent(_: any) {} }
```

- [ ] **Step 2: Failing-Tests schreiben** — in `tests/smart_apply_view.test.ts`. Zuerst `mkDeps` anpassen: `listTemplates` entfernen, `rankTemplates` ergänzen; `TemplateRank` importieren. Dann die Tests anhängen:

```ts
// am Import-Block ergänzen:
import type { TemplateRank } from "../src/template_ranker";

// in mkDeps(): die Zeile `listTemplates: vi.fn(...)` ERSETZEN durch:
    rankTemplates: vi.fn(async (_notePath: string): Promise<TemplateRank[]> => ranksFixture()),

// Helper oberhalb der Tests:
function ranksFixture(): TemplateRank[] {
  return [
    { templatePath: "Templates/Besprechung.md", type: "Besprechung", score: 0.9, source: "match" },
    { templatePath: "Templates/Buch.md", type: "Buch", score: 0.4, source: "match" },
  ];
}

describe("SmartApplyView Rangliste", () => {
  it("rendert die Rangliste sortiert und wählt die oberste vor", async () => {
    const { view } = mkView();
    await view.onOpen();
    await flush();
    const rows = all(view.contentEl, "vault-rag-sa-rank-row");
    expect(rows.length).toBe(2);
    expect((view as any).selectedTemplate).toBe("Templates/Besprechung.md");
    expect(hasClass(rows[0], "is-selected")).toBe(true);
  });

  it("selectTemplate setzt Auswahl + userOverride und übersteht Recompute ohne Notizwechsel", async () => {
    const { view } = mkView();
    await view.onOpen(); await flush();
    (view as any).selectTemplate("Templates/Buch.md");
    expect((view as any).selectedTemplate).toBe("Templates/Buch.md");
    await (view as any).recomputeRanking(false);
    expect((view as any).selectedTemplate).toBe("Templates/Buch.md");
  });

  it("Notizwechsel-Recompute setzt Override zurück und wählt die neue Top-Vorlage", async () => {
    const { view } = mkView();
    await view.onOpen(); await flush();
    (view as any).selectTemplate("Templates/Buch.md");
    await (view as any).recomputeRanking(true);
    expect((view as any).selectedTemplate).toBe("Templates/Besprechung.md");
  });

  it("offline (alle source=fallback) zeigt einen Offline-Hinweis", async () => {
    const fb: TemplateRank[] = [{ templatePath: "Templates/A.md", type: "A", score: 0, source: "fallback" }];
    const { view } = mkView({ rankTemplates: vi.fn(async () => fb) });
    await view.onOpen(); await flush();
    expect(first(view.contentEl, "vault-rag-sa-rank-note")).toBeTruthy();
  });

  it("registriert active-leaf-change beim Öffnen", async () => {
    const app = makeFakeApp();
    const view = new SmartApplyView({ app } as any, mkDeps());
    await view.onOpen(); await flush();
    expect(app.workspace.on).toHaveBeenCalledWith("active-leaf-change", expect.any(Function));
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/smart_apply_view.test.ts -t "Rangliste"`
Expected: FAIL (kein `vault-rag-sa-rank-row`, `recomputeRanking`/`selectTemplate` fehlen, `rankTemplates`-Dep unbekannt).

- [ ] **Step 4: View implementieren** — in `src/smart_apply_view.ts`:

(a) Import ergänzen:

```ts
import type { TemplateRank } from "./template_ranker";
```

(b) In `SmartApplyViewDeps` die Zeile `listTemplates: () => Promise<string[]>;` ersetzen durch:

```ts
  rankTemplates: (notePath: string) => Promise<TemplateRank[]>;
```

(c) State-Felder: `private templates: string[] = [];` ersetzen durch:

```ts
  private ranking: TemplateRank[] = [];
  private expandedRanks = false;
  private userOverrodeTemplate = false;
  private rankGen = 0;
  private rankTimer: ReturnType<typeof window.setTimeout> | null = null;
```

(d) `onOpen` ersetzen (statt `refreshTemplates` → `recomputeRanking` + Event-Registrierung):

```ts
  async onOpen(): Promise<void> {
    this.contentEl.addClass("vault-rag-sa-root");
    this.render();
    await this.refreshModels();
    await this.refreshConn();
    await this.recomputeRanking();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRecompute()));
  }
```

(e) `onClose` um Timer-Cleanup ergänzen (vorhandenen Body erweitern):

```ts
  async onClose(): Promise<void> {
    this.contentEl.removeClass("vault-rag-sa-root");
    this.stopTimer();
    if (this.rankTimer !== null) { window.clearTimeout(this.rankTimer); this.rankTimer = null; }
  }
```

(f) `refreshTemplates()` löschen und durch die neuen Methoden ersetzen:

```ts
  private scheduleRecompute(): void {
    if (this.rankTimer !== null) window.clearTimeout(this.rankTimer);
    this.rankTimer = window.setTimeout(() => { this.rankTimer = null; void this.recomputeRanking(true); }, 400);
  }

  /** Rankt für die aktive Notiz neu. noteChanged=true (Notizwechsel) verwirft eine manuelle Auswahl. */
  private async recomputeRanking(noteChanged = false): Promise<void> {
    if (noteChanged) { this.userOverrodeTemplate = false; this.expandedRanks = false; }
    const path = this.deps.activeNotePath();
    if (path === null) { this.ranking = []; this.render(); return; }
    const gen = ++this.rankGen;
    let ranks: TemplateRank[] = [];
    try { ranks = await this.deps.rankTemplates(path); } catch { ranks = []; }
    if (gen !== this.rankGen) return; // veraltet — neuerer Lauf gewinnt
    this.ranking = ranks;
    if (!this.userOverrodeTemplate) this.selectedTemplate = ranks[0]?.templatePath ?? "";
    this.render();
  }

  private selectTemplate(path: string): void {
    this.selectedTemplate = path;
    this.userOverrodeTemplate = true;
    this.render();
  }
```

(g) In `renderHeader` den `<select>`-Block (vom `this.templateSel = row2.createEl("select" …)` bis inkl. des `change`-Listeners) **entfernen** — `runBtn`/`stopBtn` in `row2` bleiben. Das Feld `private templateSel: HTMLSelectElement | null = null;` löschen. Am Ende von `renderHeader` (nach den Rows) die Rangliste rendern:

```ts
    this.renderRankList(header);
```

(h) Neue Methode `renderRankList` (z.B. direkt unter `renderHeader`):

```ts
  private renderRankList(header: HTMLElement): void {
    const wrap = header.createDiv({ cls: "vault-rag-sa-ranklist" });
    if (this.ranking.length === 0) {
      wrap.createDiv({ cls: "vault-rag-sa-rank-empty", text: "Keine Vorlage erkannt — Vorlagen-Ordner in den Einstellungen prüfen." });
      return;
    }
    if (this.ranking.every(r => r.source === "fallback")) {
      wrap.createDiv({ cls: "vault-rag-sa-rank-note", text: "offline — Ranking nicht verfügbar, Vorlage manuell wählen" });
    }
    const maxScore = Math.max(0, ...this.ranking.map(r => r.score));
    const TOP_N = 5;
    const visible = this.expandedRanks ? this.ranking : this.ranking.slice(0, TOP_N);
    for (const r of visible) {
      const row = wrap.createDiv({ cls: "vault-rag-sa-rank-row" });
      const selected = r.templatePath === this.selectedTemplate;
      if (selected) row.addClass("is-selected");
      row.addEventListener("click", () => this.selectTemplate(r.templatePath));
      row.createSpan({ cls: "vault-rag-sa-rank-radio", text: selected ? "◉" : "○" });
      row.createSpan({ cls: "vault-rag-sa-rank-name", text: r.type });
      const pct = r.source === "confirmed" ? 100 : (maxScore > 0 ? Math.round((r.score / maxScore) * 100) : 0);
      const bar = row.createDiv({ cls: "vault-rag-sa-rank-bar" });
      bar.style.setProperty("--vault-rag-sa-rank-pct", `${pct}%`);
      row.createSpan({ cls: "vault-rag-sa-rank-pct", text: r.source === "confirmed" ? "Frontmatter-Typ" : `${pct}%` });
    }
    if (this.ranking.length > TOP_N && !this.expandedRanks) {
      const more = wrap.createDiv({ cls: "vault-rag-sa-rank-more", text: `weitere ${this.ranking.length - TOP_N} ▾` });
      more.addEventListener("click", () => { this.expandedRanks = true; this.render(); });
    }
  }
```

- [ ] **Step 5: View-Dep `listTemplates` in main.ts entfernen** — in `src/main.ts` im `registerView`-Deps-Objekt die Zeile `listTemplates: () => Promise.resolve(templateFilesUnder(...))` löschen (die Core-`SmartApplyDeps.listTemplates` in der `new SmartApply(...)`-Verdrahtung BLEIBT — nur die View-Dep geht).

- [ ] **Step 6: CSS ergänzen** — ans Ende von `styles.css` anhängen:

```css
/* Smart Apply v2 — Relevanz-Rangliste */
.vault-rag-sa-ranklist { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
.vault-rag-sa-rank-row { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
.vault-rag-sa-rank-row:hover { background: var(--background-modifier-hover); }
.vault-rag-sa-rank-row.is-selected { background: var(--background-modifier-active-hover); }
.vault-rag-sa-rank-radio { color: var(--text-accent); }
.vault-rag-sa-rank-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-rag-sa-rank-bar { flex: 0 0 80px; height: 6px; border-radius: 3px; background: var(--background-modifier-border); position: relative; overflow: hidden; }
.vault-rag-sa-rank-bar::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--vault-rag-sa-rank-pct, 0%); background: var(--text-accent); }
.vault-rag-sa-rank-pct { flex: 0 0 auto; font-size: var(--font-smallest); color: var(--text-muted); min-width: 3.5em; text-align: right; }
.vault-rag-sa-rank-note, .vault-rag-sa-rank-empty { font-size: var(--font-smallest); color: var(--text-muted); padding: 2px 6px; }
.vault-rag-sa-rank-more { font-size: var(--font-smallest); color: var(--text-accent); cursor: pointer; padding: 2px 6px; }
```

- [ ] **Step 7: Tests grün + tsc + lint + build**

Run: `npx vitest run tests/smart_apply_view.test.ts && npx vitest run && npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. (Falls `npm run lint` `bar.style.setProperty` für die Custom-Property beanstandet — das Setzen einer CSS-`--var` ist der erlaubte Weg; nur direkte `style.width=`-Zuweisungen sind verboten. Sollte dennoch eine Regel greifen, die Breite ausschließlich über die `::after`-Regel + `--vault-rag-sa-rank-pct` lösen, was hier bereits der Fall ist.)

- [ ] **Step 8: Commit**

```bash
git add src/smart_apply_view.ts src/main.ts tests/smart_apply_view.test.ts tests/__mocks__/obsidian.ts styles.css
git commit -m "$(printf 'feat(smart-apply): Vorlagen-Rangliste statt <select> + eager Recompute\n\nRadio-Rangliste (Top-5 + weitere), oberste vorausgewaehlt, Score-Balken,\nConfirmed-Badge; recompute beim Oeffnen + active-leaf-change (debounced),\nuserOverride bleibt bis Notizwechsel. Mock: ItemView.registerEvent.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: End-to-End-Smoke gegen ein reales schwaches Modell (manuell — PFLICHT)

**Files:** keine Code-Änderung. Verifikation in echtem Obsidian (in-place: `npm run build` → Plugin hart neu laden).

> **Warum Pflicht:** Spec, Plan und mehrstufiger Review prüfen nur Logik, nicht die reale Last. Der echte Call fängt, was sie systematisch verpassen (Lesson llm-benchmark-harness / image-to-markdown).

- [ ] **Step 1: Build + Reload** — `npm run build`; in Obsidian das Plugin **hart** neu laden (nicht Soft-Reload — der zieht mehrfach alten Code).
- [ ] **Step 2: Selbsterklärende Test-Vorlage anlegen** unter `_SmartApplyTest/Vorlagen/` mit `%%`-Anleitung pro Überschrift, z.B.:

```markdown
---
type: Besprechung
status: offen
---

## Tagesordnung
%% Alle Aufzählungs-/Stichpunktblöcke zur Agenda hierher. %%

## Beschlüsse
%% Konkrete Entscheidungen, je eine pro Block. %%

## Offene Punkte
%% Fragen/To-dos, die offen bleiben. %%
```

- [ ] **Step 3: Schwaches/non-thinking Modell** im Cockpit-Header wählen (`suppressThinking` an), eine unstrukturierte Roh-Notiz öffnen.
- [ ] **Step 4: Rangliste prüfen** — Cockpit öffnen: Erscheint die Rangliste? Ist die plausibelste Vorlage oben + vorausgewählt? Notiz wechseln → rankt es neu + wählt neue Top? Manuell eine andere wählen → bleibt sie bis zum Notizwechsel?
- [ ] **Step 5: Anwenden** — „Auf aktive Notiz anwenden": Routet das Modell die Blöcke **ohne Thinking** korrekt unter die Überschriften (dank `%%`-Anleitung)? Diff-Gate zeigt Body aus Original-Bytes, `%%`-Text erscheint **nicht** im Ergebnis. Anwenden/Rückgängig funktioniert.
- [ ] **Step 6: Offline-Pfad** — Embedder kurz stoppen, Cockpit öffnen: Erscheint der Offline-Hinweis + (falls Frontmatter-`type` gesetzt) die passende Vorlage als „Frontmatter-Typ"?
- [ ] **Step 7: Ergebnis festhalten** — Beobachtungen an den Auftraggeber zurückmelden; bei Bug → `superpowers:systematic-debugging`. Bei OK → Branch-Abschluss via `superpowers:finishing-a-development-branch` (Merge nach `main`), danach offen: Push + Release 0.4.0 (separater, vom User getriggerter Schritt).

---

## Self-Review (gegen die Spec)

**Spec-Abdeckung:** Modul 1 Relevanz-Ranking → Task 3 (Ranker) + Task 4 (Wiring) + Task 5 (UI). Modul 2 `%%`-Guidance → Task 1 (parse) + Task 2 (Prompt). Modul 3 View/UX (Rangliste, eager, Apply unverändert) → Task 5. Offline-Fallback → Task 3 (Ranker) + Task 5 (UI-Hinweis). Tests je Baustein → Tasks 1–3, 5. Pflicht-E2E → Task 6. Out-of-scope (Reverse Synthesis, Form-/Stil-Regeln, Hybrid, Few-Shot) → nicht eingeplant (korrekt).

**Offene Spec-Punkte aufgelöst:** `%%`-Platzierung = Section-Body (Task 1); N=5 (Task 5); Cache in-memory (Task 3); FM-Hinweise = Vorlagen-Beispielwerte statt `%%`-in-YAML (Task 2, bewusste Verfeinerung — YAML-sicher).

**Typ-Konsistenz:** `TemplateRank{templatePath,type,score,source}` identisch in Task 3 (Definition), Task 4 (Wiring-Return), Task 5 (View-Dep + Render). `RankDeps` Felder identisch Task 3 ↔ Task 4. `TemplateSection.guidance` Task 1 ↔ konsumiert Task 2. `rankTemplates`-Signatur identisch Task 4 (main) ↔ Task 5 (Deps + Test-Fixture). `recomputeRanking(noteChanged?)`/`selectTemplate(path)` identisch Implementierung Task 5 ↔ Test Task 5.

**Platzhalter-Scan:** keine TBD/„handle errors"/leere Codeblöcke — jede Code-Step enthält vollständigen Code; jede Run-Step einen Befehl + erwartetes Ergebnis.
