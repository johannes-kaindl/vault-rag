# Smart-Apply-Vorlagen + FM-#-Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smart-Apply-taugliche Vorlagen für die Pallas-Notiz-Typen bauen (Pilot: Gespräch), plus eine kleine Parser-Erweiterung, damit `#`-Kommentare im Frontmatter als LLM-Guidance wirken — der Code-Teil ist Smoke-first durch einen echten MLX-Call gerechtfertigt.

**Architecture:** Neuer Ordner `03-Vorlagen/70_SmartApply/` mit flachen, selbsterklärenden Vorlagen (`%%`-Anleitung pro Body-Sektion, `#`-Hinweise pro Frontmatter-Key), abgeleitet aus den bestehenden Templater-`(FM)`/`(body)`-Splits. Drei eng begrenzte Code-Änderungen reichen die `#`-Kommentare von `parseFrontmatter` über `parseTemplate` (`TemplateSpec.fmGuidance`) bis in `buildRestructurePrompt`. Validierungsreihenfolge: erst echter MLX-Smoke (Wizard-of-Oz mit/ohne Hints), dann — nur bei Nutzen — der getestete Parser-Code.

**Tech Stack:** TypeScript (strict, `noImplicitAny`) · esbuild (Bundling + Smoke-Runner) · vitest + happy-dom · Obsidian Plugin API (nur indirekt). Pure-core-Module (`frontmatter.ts`, `template_matcher.ts`, `note_restructurer.ts`) ohne Obsidian-Import.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen (Smoke-Throwaway-Script ausgenommen).
- **Tests:** vitest + happy-dom; `import { describe, it, expect } from "vitest"`; deutsche `it`-Beschreibungen; kein `.only`/`.skip` im Commit. **Nach jeder Änderung müssen ALLE Tests grün bleiben** (`npm test`).
- **Lint/Typecheck grün:** `npm run lint` (eslint src) + `npm run typecheck` (tsc --noEmit) nach Code-Tasks.
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Rückwärtskompatibilität:** Neue Felder `ParsedFrontmatter.comments` und `TemplateSpec.fmGuidance` sind **optional** (`?:`) — bestehende Objekt-Literale in Tests bleiben gültig, `mergeFrontmatter`/`diffFrontmatter`-Signaturen unverändert.
- **Vault-Pfad:** `/Users/Shared/10_ObsidianVaults/10_Pallas` (NICHT `/Users/Shared/code/10_Pallas`). Vorlagen-Wurzel: `…/50_Ressourcen/20_System/03-Vorlagen/`.
- **Scratchpad:** `/private/tmp/claude-502/-Users-Shared-code-vault-rag/e41b9c95-a038-4ba2-8752-d608d0e414f0/scratchpad` — alle Smoke-Artefakte hierher, nie ins Repo.
- **data.json ist gitignored** (vault-spezifisch) — nie committen. `DEFAULT_SETTINGS.templateDir` **nicht** auf einen Pallas-spezifischen Pfad setzen (OSS-Plugin bleibt generisch).
- **Non-Fabrication unangetastet:** `assembleBody` und der `source="content"`-Vertrag werden NICHT geändert. FM-Guidance verbessert nur das Prompt-Signal, nicht die Fülllogik.

---

## Phase A — Smoke-Validierung (kein Parser-Commit)

### Task 1: Pilot-Vorlage, Fixture & MLX-Smoke-Harness

Validiert empirisch, ob `#`-FM-Hinweise das Routing verbessern, **bevor** Parser-Code geschrieben wird. Liefert eine Entscheidung (Hints helfen ja/nein), die Phase B konditioniert.

**Files:**
- Create: `/Users/Shared/10_ObsidianVaults/10_Pallas/50_Ressourcen/20_System/03-Vorlagen/70_SmartApply/Gespräch.md` (Vault-Daten, kein Repo-Commit)
- Create: `<scratchpad>/gespraech-fixture.md`
- Create: `<scratchpad>/smoke.ts`
- Build-Artefakt: `<scratchpad>/smoke.cjs`

**Interfaces:**
- Consumes: `parseTemplate(text): TemplateSpec` und `splitBlocks(body): SourceBlock[]`, `buildRestructurePrompt(tpl, blocks): ChatMessage[]` — alle pure-core, bestehend, unverändert.
- Produces: nichts für spätere Tasks (Throwaway). Erkenntnis-Output: Smoke-Konsolenausgabe + Entscheidung.

- [ ] **Step 1: Pilot-Vorlage anlegen**

Schreibe `…/03-Vorlagen/70_SmartApply/Gespräch.md`:

```markdown
---
type: "🗣️ Gespräch"
status: "✅ Abgeschlossen"   # Geplant | Abgeschlossen | Archiv
datum:          # YYYY-MM-DD, falls im Text genannt
art:            # Meeting | Telefonat | E-Mail | Videocall | Gespräch | Konsultation
teilnehmer:     # beteiligte Personen als [[Wikilinks]], falls genannt
projekt:        # zugehöriges Projekt als [[Wikilink]], falls genannt
bereich:        # Arbeit | Finanzen | Gesundheit | Hobbys | Privat | System
follow_up_bis:  # YYYY-MM-DD Deadline für offene Punkte, falls genannt
---

## 🎯 Themen & Agenda
%% Anlass des Gesprächs und was besprochen werden sollte — Zielsetzung, Tagesordnung. %%

## 📋 Ergebnisse & Beschlüsse
%% Was entschieden, vereinbart oder festgestellt wurde — konkrete Beschlüsse und Resultate. %%

## ✅ Nächste Schritte
%% Konkrete Aufgaben mit Verantwortlichkeit und ggf. Frist — alles To-do-artige. %%

## 💬 Gesprächsnotizen
%% Stichpunkte/Details aus dem Verlauf, die weder Ergebnis noch Aufgabe sind — der Rest. %%
```

- [ ] **Step 2: Synthetische Fixture anlegen**

Schreibe `<scratchpad>/gespraech-fixture.md` (unstrukturierte Roh-Notiz, reproduzierbar, mit wörtlich extrahierbaren FM-Werten + klar routbaren Body-Blöcken):

```markdown
Telefonat mit Dr. Berger von den Stadtwerken heute. Ging um den Netzanschluss fürs Projekt Solarpark Nord.

Er meinte, der Anschluss kann frühestens Q3 erfolgen — vorher keine Kapazität. Müssen wir so einplanen.

Ich soll bis 2026-07-15 die finalen Lastprofile schicken. Berger schickt dann das Angebot.

Außerdem kurz über die Förderung gesprochen — er kennt jemanden bei der KfW und will den Kontakt herstellen.
```

- [ ] **Step 3: Smoke-Harness schreiben**

Schreibe `<scratchpad>/smoke.ts`. Importiert die echten pure-core-Funktionen über absolute Pfade (esbuild löst `.ts` auf), baut Lauf A (ohne FM-Hints = aktueller `buildRestructurePrompt`-Output) und Lauf B (mit injizierten Hints — Prototyp von Phase B), ruft MLX über Node-`fetch` (non-streaming):

```ts
import { readFileSync } from "node:fs";
import { parseTemplate } from "/Users/Shared/code/vault-rag/src/template_matcher";
import { splitBlocks, buildRestructurePrompt } from "/Users/Shared/code/vault-rag/src/note_restructurer";

const REPO = "/Users/Shared/code/vault-rag";
const VAULT = "/Users/Shared/10_ObsidianVaults/10_Pallas";
const SCRATCH = "/private/tmp/claude-502/-Users-Shared-code-vault-rag/e41b9c95-a038-4ba2-8752-d608d0e414f0/scratchpad";
const tplPath = `${VAULT}/50_Ressourcen/20_System/03-Vorlagen/70_SmartApply/Gespräch.md`;

// Throwaway-Prototyp der #-Extraktion (der getestete Parser in Phase B ist robuster/quote-aware).
function extractFmComments(tplText: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(tplText);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_][\w .-]*?):(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    const rest = kv[2];
    const sp = rest.indexOf(" #");
    if (sp >= 0 && !rest.slice(0, sp).includes('"')) { out[key] = rest.slice(sp + 2).trim(); continue; }
    const bare = /^\s*#\s*(.+)$/.exec(rest);
    if (bare) out[key] = bare[1].trim();
  }
  return out;
}

function injectHints(userContent: string, comments: Record<string, string>): string {
  let out = userContent;
  for (const [k, c] of Object.entries(comments)) {
    const re = new RegExp("^- " + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( \\(Beispiel: [^)]*\\))?$", "m");
    out = out.replace(re, (_full, ex: string | undefined) => {
      const inner = ex ? `${ex.slice(2, -1)}; Hinweis: ${c}` : `Hinweis: ${c}`;
      return `- ${k} (${inner})`;
    });
  }
  return out;
}

async function callMLX(messages: { role: string; content: string }[]): Promise<string> {
  const data = JSON.parse(readFileSync(`${REPO}/data.json`, "utf8"));
  const ep = String(data.chatEndpoint).replace(/\/+$/, "");
  const url = /\/v1$/.test(ep) ? `${ep}/chat/completions` : `${ep}/v1/chat/completions`;
  const model = data.smartApplyModel || data.chatModel;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 2048, stream: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}

async function main(): Promise<void> {
  const tplText = readFileSync(tplPath, "utf8");
  const fixture = readFileSync(`${SCRATCH}/gespraech-fixture.md`, "utf8");
  const tpl = parseTemplate(tplText);
  const blocks = splitBlocks(fixture.replace(/^---[\s\S]*?---\r?\n/, ""));
  const [sys, user] = buildRestructurePrompt(tpl, blocks);
  const comments = extractFmComments(tplText);

  console.log("=== Erkannte FM-Kommentare ===");
  console.log(comments);
  console.log("\n=== Blöcke ===");
  console.log(blocks.map(b => `${b.id}: ${b.text.replace(/\n/g, " ")}`).join("\n"));

  console.log("\n=== LAUF A: OHNE FM-Hints ===");
  console.log(await callMLX([{ role: "system", content: sys.content }, { role: "user", content: user.content }]));

  console.log("\n=== LAUF B: MIT FM-Hints ===");
  console.log(await callMLX([{ role: "system", content: sys.content }, { role: "user", content: injectHints(user.content, comments) }]));
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Smoke bundeln**

Run:
```bash
cd /Users/Shared/code/vault-rag
npx esbuild "<scratchpad>/smoke.ts" --bundle --platform=node --format=cjs --outfile="<scratchpad>/smoke.cjs"
```
Expected: `smoke.cjs` wird geschrieben, keine Resolve-Fehler. (Schlägt der `.ts`-Import fehl, liegt es an Pfad-Tippfehlern — absolute Pfade prüfen.)

- [ ] **Step 5: ⛔ GATE — auf User-OK für MLX warten**

**MLX ist laut User zeitweise belegt. NICHT autonom callen.** Den User explizit fragen: „MLX frei für den Smoke?" und auf Bestätigung warten. Erst danach Step 6.

- [ ] **Step 6: Smoke ausführen**

Run (ggf. mit Netzwerkfreigabe der Sandbox, Ziel ist LAN-Host `192.168.178.27`):
```bash
node "<scratchpad>/smoke.cjs"
```
Expected: zwei JSON-Objekte (Lauf A/B) im `{ "version": 1, "sections": […], "unassigned": […], "frontmatter": {…} }`-Schema.

- [ ] **Step 7: Auswerten & Entscheidung dokumentieren**

Vergleiche Lauf A vs. B auf zwei Achsen:
1. **Body-Routing** (beide Läufe): Landen `block_*` unter den semantisch richtigen Überschriften? (Anschluss-Q3 → Ergebnisse; Lastprofile-2026-07-15 → Nächste Schritte; Förderung/KfW → Notizen oder Themen.) Sollte in beiden Läufen ähnlich gut sein.
2. **FM-Extraktion** (A vs. B): Füllt B mehr/präzisere `frontmatter`-Felder mit `source="content"` (art=Telefonat, teilnehmer=Dr. Berger, projekt=Solarpark Nord, follow_up_bis=2026-07-15, bereich=Arbeit)?

**Entscheidungs-Gate:**
- **Hints helfen** (B sichtbar besser bei FM, Body stabil) → Phase B bauen.
- **Hints helfen nicht** → Phase B überspringen; nur die Vorlage (ohne `#`-Code-Nutzung) + `templateDir`-Umstellung behalten, mit dem User abstimmen. `#`-Kommentare in der Vorlage bleiben harmlos (würden ohne Parser-Code als Wert geparst → also dann aus der Vorlage entfernen).

Ergebnis (3-4 Zeilen) als Kommentar in die Spec-Datei `docs/superpowers/specs/2026-06-25-smart-apply-templates-design.md` unter einen neuen Abschnitt „## Smoke-Ergebnis (2026-06-25)" schreiben und committen:
```bash
git add docs/superpowers/specs/2026-06-25-smart-apply-templates-design.md
git commit -m "docs(smart-apply): MLX-Smoke-Ergebnis — FM-#-Hints <helfen|helfen nicht>"
```

---

## Phase B — Parser-Erweiterung (NUR bei positivem Gate aus Task 1)

### Task 2: `parseFrontmatter` — `#`-Kommentare vom Wert trennen

**Files:**
- Modify: `src/frontmatter.ts` (Interface `ParsedFrontmatter` ~Zeile 6; neue Hilfsfunktion; `parseFrontmatter` ~Zeile 67-107)
- Test: `tests/frontmatter.test.ts`

**Interfaces:**
- Consumes: nichts Neues.
- Produces: `ParsedFrontmatter.comments?: Record<string, string>` — Map `key → Kommentartext` (ohne `#`, getrimmt). Wert-Felder (`data`) sind kommentarfrei.

- [ ] **Step 1: Failing-Tests schreiben**

In `tests/frontmatter.test.ts` anfügen:

```ts
describe("parseFrontmatter #-Kommentare", () => {
  it("trennt nachgestellten #-Kommentar vom Wert und sammelt ihn in comments", () => {
    const r = parseFrontmatter("---\nart: Gespräch  # Meeting | Telefonat\n---\nBody\n");
    expect(r.data.art).toBe("Gespräch");
    expect(r.comments?.art).toBe("Meeting | Telefonat");
  });
  it("leerer Wert mit Kommentar → Wert leer, Kommentar gesammelt", () => {
    const r = parseFrontmatter("---\nbereich:  # Arbeit | Privat\n---\n");
    expect(r.data.bereich).toBe("");
    expect(r.comments?.bereich).toBe("Arbeit | Privat");
  });
  it("gequotetes # bleibt Teil des Werts (kein Kommentar)", () => {
    const r = parseFrontmatter('---\nnote: "C# und #tag"\n---\n');
    expect(r.data.note).toBe("C# und #tag");
    expect(r.comments?.note ?? "").toBe("");
  });
  it("# ohne führenden Whitespace ist kein Kommentar", () => {
    const r = parseFrontmatter("---\nslug: foo#bar\n---\n");
    expect(r.data.slug).toBe("foo#bar");
    expect(r.comments?.slug ?? "").toBe("");
  });
  it("gequoteter Wert mit nachgestelltem Kommentar wird sauber getrennt", () => {
    const r = parseFrontmatter('---\nstatus: "✅ Abgeschlossen"   # Geplant | Archiv\n---\n');
    expect(r.data.status).toBe("✅ Abgeschlossen");
    expect(r.comments?.status).toBe("Geplant | Archiv");
  });
});
```

- [ ] **Step 2: Tests laufen lassen → FAIL**

Run: `npx vitest run tests/frontmatter.test.ts`
Expected: FAIL (`r.comments` ist `undefined`; bei `art` steckt der Kommentar noch im Wert).

- [ ] **Step 3: Interface + Hilfsfunktion + Integration**

In `src/frontmatter.ts`:

(a) Interface erweitern (Zeile 6):
```ts
export interface ParsedFrontmatter { data: Record<string, FmValue>; order: string[]; body: string; comments?: Record<string, string> }
```

(b) Hilfsfunktion oberhalb von `parseFrontmatter` einfügen:
```ts
/** Trennt einen YAML-Zeilenkommentar (` #…`, außerhalb von Quotes) vom Skalar/Listen-Rest.
 *  `#` zählt nur als Kommentar mit Whitespace davor ODER am rest-Anfang (Wert leer). */
function splitComment(rest: string): { value: string; comment: string } {
  let inS = false, inD = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '"' && !inS) inD = !inD;
    else if (c === "'" && !inD) inS = !inS;
    else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(rest[i - 1]))) {
      return { value: rest.slice(0, i).trimEnd(), comment: rest.slice(i + 1).trim() };
    }
  }
  return { value: rest, comment: "" };
}
```

(c) In `parseFrontmatter`: `comments`-Objekt anlegen und `splitComment` VOR den Listen-/Skalar-Checks anwenden. Ersetze den Block ab `const rest = kv[2];` (Zeile 81) durch:
```ts
    const { value: rest, comment } = splitComment(kv[2]);
    if (comment) comments[key] = comment;
```
und deklariere oben bei `const data … = {};` zusätzlich:
```ts
  const comments: Record<string, string> = {};
```
und ergänze den Return (Zeile 106):
```ts
  return { data, order, body, comments };
```

- [ ] **Step 4: Tests laufen lassen → PASS (alle)**

Run: `npx vitest run tests/frontmatter.test.ts`
Expected: PASS. Dann die volle Suite: `npm test` → alle grün (besonders der bestehende `note: "C# und #tag"`-Round-Trip-Test).

- [ ] **Step 5: Lint + Typecheck**

Run: `npm run typecheck && npm run lint`
Expected: 0 Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/frontmatter.ts tests/frontmatter.test.ts
git commit -m "feat(frontmatter): #-Kommentare vom Wert trennen → comments-Map

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3: `parseTemplate` — FM-Kommentare als `fmGuidance` durchreichen

**Files:**
- Modify: `src/template_matcher.ts` (Interface `TemplateSpec` Zeile 5; `parseTemplate` Zeile 41-71)
- Test: `tests/template_matcher.test.ts`

**Interfaces:**
- Consumes: `ParsedFrontmatter.comments` (aus Task 2).
- Produces: `TemplateSpec.fmGuidance?: Record<string, string>` — die FM-Kommentare der Vorlage, key-indiziert.

- [ ] **Step 1: Failing-Tests schreiben**

In `tests/template_matcher.test.ts` anfügen:

```ts
describe("parseTemplate FM-guidance (#-Kommentare)", () => {
  it("übernimmt #-Kommentare der Frontmatter-Keys als fmGuidance", () => {
    const tpl = parseTemplate('---\ntype: "🗣️ Gespräch"\nart:  # Meeting | Telefonat\n---\n## A\n');
    expect(tpl.fmGuidance?.art).toBe("Meeting | Telefonat");
  });
  it("Key ohne Kommentar → kein fmGuidance-Eintrag", () => {
    const tpl = parseTemplate("---\ntype: X\n---\n## A\n");
    expect(tpl.fmGuidance?.type ?? "").toBe("");
  });
});
```

- [ ] **Step 2: Tests laufen lassen → FAIL**

Run: `npx vitest run tests/template_matcher.test.ts`
Expected: FAIL (`tpl.fmGuidance` ist `undefined`).

- [ ] **Step 3: Implementierung**

In `src/template_matcher.ts`:

(a) Interface erweitern (Zeile 5) — `fmGuidance?` **optional**, damit die handgeschriebenen `TemplateSpec`-Literale in `tests/note_restructurer.test.ts` (`tplWith(...)`) ohne das Feld weiter typen; `parseTemplate` setzt es trotzdem immer:
```ts
export interface TemplateSpec { type: string; keys: string[]; fmDefaults: Record<string, FmValue>; fmGuidance?: Record<string, string>; sections: TemplateSection[]; raw: string }
```
(b) In `parseTemplate` nach `const fmDefaults = parsed.data;` (Zeile 45) einfügen:
```ts
  const fmGuidance = parsed.comments ?? {};
```
(c) Return (Zeile 70) ergänzen:
```ts
  return { type: extractType(text) ?? "", keys, fmDefaults, fmGuidance, sections, raw: text };
```

- [ ] **Step 4: Tests laufen lassen → PASS (alle)**

Run: `npx vitest run tests/template_matcher.test.ts` → PASS.
Dann `npm test` → alle grün.

- [ ] **Step 5: Lint + Typecheck**

Run: `npm run typecheck && npm run lint`
Expected: 0 Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/template_matcher.ts tests/template_matcher.test.ts
git commit -m "feat(template): FM-#-Kommentare als TemplateSpec.fmGuidance durchreichen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4: `buildRestructurePrompt` — FM-Hinweise ins Prompt rendern

**Files:**
- Modify: `src/note_restructurer.ts` (`buildRestructurePrompt`, `keyLines` Zeile 226-228)
- Test: `tests/note_restructurer.test.ts`

**Interfaces:**
- Consumes: `TemplateSpec.fmGuidance` (aus Task 3).
- Produces: nichts Neues — verändertes Prompt-Rendering. Pro FM-Key: `- <key> (Beispiel: <default>; Hinweis: <guidance>)`, einzelne Teile entfallen wenn leer.

- [ ] **Step 1: Failing-Tests schreiben**

In `tests/note_restructurer.test.ts` anfügen (spiegelt den bestehenden `buildRestructurePrompt %%-guidance`-Block):

```ts
describe("buildRestructurePrompt FM-#-guidance", () => {
  function tplWith(fmGuidance: Record<string, string>): TemplateSpec {
    return {
      type: "Gespräch",
      keys: ["type", "art"],
      fmDefaults: { type: "🗣️ Gespräch", art: "" },
      fmGuidance,
      sections: [{ heading: "Themen", level: 2, placeholder: "", guidance: "" }],
      raw: "egal",
    };
  }
  const blocks: SourceBlock[] = [{ id: "block_0", text: "- x" }];

  it("rendert Hinweis pro FM-Key mit Kommentar", () => {
    const [, userMsg] = buildRestructurePrompt(tplWith({ art: "Meeting | Telefonat" }), blocks);
    expect(userMsg.content).toContain("art (Hinweis: Meeting | Telefonat)");
  });
  it("kombiniert Beispiel + Hinweis bei Key mit Default und Kommentar", () => {
    const [, userMsg] = buildRestructurePrompt(tplWith({ type: "Gesprächstyp mit Emoji" }), blocks);
    expect(userMsg.content).toContain("type (Beispiel: 🗣️ Gespräch; Hinweis: Gesprächstyp mit Emoji)");
  });
  it("ohne fmGuidance bleibt rückwärtskompatibel (nackter Key, kein Hinweis)", () => {
    const [, userMsg] = buildRestructurePrompt(tplWith({}), blocks);
    expect(userMsg.content).toContain("- art");
    expect(userMsg.content).not.toContain("Hinweis:");
  });
});
```

- [ ] **Step 2: Tests laufen lassen → FAIL**

Run: `npx vitest run tests/note_restructurer.test.ts`
Expected: FAIL (kein „Hinweis:" im Output).

- [ ] **Step 3: Implementierung**

In `src/note_restructurer.ts`, ersetze den `keyLines`-Block (Zeile 226-228):
```ts
  const fmG = tpl.fmGuidance ?? {};
  const keyLines = tpl.keys
    .map(k => {
      const ex = fmExample(tpl.fmDefaults[k]);
      const hint = (fmG[k] ?? "").trim();
      const parts: string[] = [];
      if (ex) parts.push(`Beispiel: ${ex}`);
      if (hint) parts.push(`Hinweis: ${hint}`);
      return parts.length ? `- ${k} (${parts.join("; ")})` : `- ${k}`;
    })
    .join("\n");
```

- [ ] **Step 4: Tests laufen lassen → PASS (alle)**

Run: `npx vitest run tests/note_restructurer.test.ts` → PASS.
Dann `npm test` → alle grün (besonders der bestehende `status (Beispiel: offen)`-Test bleibt gültig).

- [ ] **Step 5: Lint + Typecheck + Build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 Fehler, `main.js` gebaut.

- [ ] **Step 6: Commit**

```bash
git add src/note_restructurer.ts tests/note_restructurer.test.ts
git commit -m "feat(smart-apply): FM-#-Hinweise ins Restructure-Prompt rendern

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — Integration & Rollout

### Task 5: Re-Smoke über echten Code-Pfad + Aktivierung + GUI-Smoke

**Files:**
- Modify: `<scratchpad>/smoke.ts` (Hint-Variante auf echten Code umstellen)
- Daten: `data.json` (lokal, `templateDir` — NICHT committen) **oder** GUI-Settings durch User

**Interfaces:**
- Consumes: Phase-B-Code (echtes `fmGuidance` im Prompt).
- Produces: bestätigtes Pilot-Format + aktivierter `templateDir`.

- [ ] **Step 1: Smoke auf echten Code umstellen**

In `<scratchpad>/smoke.ts` Lauf B ersetzen: statt `injectHints(...)` jetzt der echte Pfad — `buildRestructurePrompt` liefert die Hints nun selbst (Phase B aktiv). Lauf A (ohne) als Kontrolle entfällt; ein einzelner Lauf über den echten `buildRestructurePrompt(tpl, blocks)` genügt. Neu bundeln (`npx esbuild …`).

- [ ] **Step 2: ⛔ GATE — User-OK für MLX, dann Re-Smoke**

Wieder fragen, ob MLX frei ist. Dann `node "<scratchpad>/smoke.cjs"`. Bestätigen, dass der echte Code denselben (oder besseren) Output wie Lauf B aus Task 1 liefert.

- [ ] **Step 3: `templateDir` umstellen (durch User, GUI)**

`templateDir` auf `50_Ressourcen/20_System/03-Vorlagen/70_SmartApply/` setzen — **in den Plugin-Settings (GUI)**, nicht per Hand in `data.json` (Obsidian überschreibt offene Settings). Behebt das 107-Dateien-Rauschen. **`DEFAULT_SETTINGS` NICHT ändern.**

- [ ] **Step 4: Index aktualisieren**

Nach dem Anlegen von `70_SmartApply/Gespräch.md`: Vault reindizieren lassen (Live-Indexer erfasst die neue Datei beim `file:create`/Reindex), damit `index.vectorFor()` für die Vorlage einen Vektor hat (Echtzeit-Ranking statt Fallback-embed).

- [ ] **Step 5: GUI-Smoke durch User**

In-place reload (harter Reload — Soft-Reload zieht alten Code). Eine echte unstrukturierte Gesprächsnotiz öffnen → Smart-Apply-Cockpit → Template-Ranking zeigt „Gespräch" oben → „Auf aktive Notiz anwenden" → Diff-Gate prüfen: Body-Routing korrekt, FM-Felder wörtlich gefüllt/leer (kein Müll), `%%`/`#` nicht in der Zielnotiz. Anwenden/Verwerfen/Rückgängig testen.

- [ ] **Step 6: Format nachschärfen → User-Abnahme**

Falls der GUI-Smoke Schwächen zeigt (Routing-Fehlrouten, FM-Müll), `%%`/`#`-Texte in `Gespräch.md` nachschärfen und Step 5 wiederholen. Sonst: **User-Abnahme des Pilots** einholen.

### Task 6: Batch-Ableitung der Kern-Capture-Typen

**Vorbedingung:** Pilot (Task 5) abgenommen. Nur dann starten.

**Files:**
- Create: je `…/03-Vorlagen/70_SmartApply/<Typ>.md` für: Quelle, Person, Konzept, Notiz, Kommunikation, Dokument, Organisation, Autoren-Steckbrief, LLM-Steckbrief (+ ggf. Projekt)

**Interfaces:**
- Consumes: bewährtes Pilot-Format (Gespräch.md) als Schablone.
- Produces: vollständiger Kern-Vorlagensatz.

- [ ] **Step 1: Pro Typ die Splits lesen**

Für jeden Typ die Quell-Splits lesen: `…/20_Typ/<Typ> (FM).md` (Feldnamen + YAML-Kommentar-Optionslisten) und `…/20_Typ/<Typ> (body).md` (Überschriften). Dies kann pro Typ an einen Subagenten delegiert werden (eine Ableitung pro Typ, identisches Format).

- [ ] **Step 2: Pro Typ eine Smart-Apply-Vorlage ableiten**

Nach dem `Gespräch.md`-Muster: `type` als Routing-Anker (exakt der `type:`-Wert des `(FM)`-Splits, damit `resolveTemplateForType` matcht), `status`/tragbare Defaults behalten, übrige Content-Keys leer mit `#`-Hinweis (Optionsliste/Format/„falls genannt"); Templater-Ausdrücke + Auto-Felder (created/updated/title) entfernen; Synthese-Felder (summary) weglassen. Body: `##`-Überschriften mit knapper `%%`-Anleitung.

- [ ] **Step 3: Index + Stichproben-Smoke**

Reindizieren. Für 2-3 Typen je eine echte/synthetische Notiz durch das Cockpit jagen (GUI), Routing-Qualität stichprobenhaft bestätigen.

- [ ] **Step 4: Branch finishen**

`npm test && npm run typecheck && npm run lint && npm run build` → alle grün. Dann `superpowers:finishing-a-development-branch` aufrufen (Merge-Entscheidung, ggf. Release-Bump, Cockpit + `.remember` fortschreiben). Vault-Vorlagen committet die Vault-Cadence (clean-shutdown), nicht dieser Branch.

---

## Self-Review

**Spec-Coverage:**
- Eigener `70_SmartApply/`-Ordner → Task 1 Step 1, Task 6. ✓
- Flache Vorlagen aus `(FM)`/`(body)` abgeleitet → Task 1, Task 6. ✓
- `%%`-Body-Anleitung → Task 1 Step 1 (genutzt durch bestehenden `parseTemplate`/`buildRestructurePrompt`-Pfad). ✓
- `#`-FM-Guidance Parser-Erweiterung (3 Schichten) → Task 2/3/4. ✓
- Smoke-first vor Code-Commit → Task 1 (Gate Step 5/7), Phase B konditioniert. ✓
- `templateDir`-Umstellung, kein DEFAULT_SETTINGS-Eingriff → Task 5 Step 3 + Global Constraints. ✓
- Ehrliche Grenze (FM nur `source=content`) → kein Code-Eingriff in `assembleBody`/Fülllogik (Global Constraints). ✓
- Pilot-first dann Batch → Phase-Struktur + Task 6 Vorbedingung. ✓
- Scope-Schnitte (Layout-Typen, Drift-Automatik, Synthese) → nicht eingeplant. ✓

**Placeholder-Scan:** Kein TBD/TODO; jeder Code-Step zeigt vollständigen Code; jeder Test ist ausformuliert. ✓

**Typ-Konsistenz:** `comments?` (Task 2) → `parsed.comments ?? {}` (Task 3) → `fmGuidance?` (Task 3) → `tpl.fmGuidance ?? {}` (Task 4). `splitComment`/`injectHints`/`extractFmComments`/`callMLX` konsistent benannt. `ParsedFrontmatter`/`TemplateSpec`-Felder additiv-optional → bestehende Literale + `mergeFrontmatter`/`diffFrontmatter` unberührt. ✓
