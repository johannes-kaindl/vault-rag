# Batch der Kern-Capture-Vorlagen (Smart-Apply) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fünf neue Smart-Apply-Capture-Vorlagen (Notiz, Konzept, Quelle, Dokument, Kommunikation) im Pallas-Vault anlegen, abgesichert durch einen vault-gated Parse-Guard und vorbereitetes GUI-Smoke-Material.

**Architecture:** Reine Vault-Inhalte (Vorlagen `.md` + Testnotizen) — die Smart-Apply-Engine bleibt unverändert. Ein vault-gated Vitest validiert die echten Vorlagen über das produktive `parseTemplate`/`buildRestructurePrompt` (SSOT = Vault, keine Datei-Duplikate). Vorlagen-Inhalt ist in der committeten Spec §4 verbatim definiert.

**Tech Stack:** TypeScript · Vitest · Obsidian-Vorlagen (Markdown mit FM-`#`-Hinweisen + Sektions-`%%`-Anleitungen).

**Spec:** `docs/superpowers/specs/2026-06-28-smartapply-capture-templates-design.md` (verbatim Vorlagen in §4, Validierung in §5).

## Global Constraints

- **Vault ≠ Repo.** Vorlagen + Testnotizen werden in den Obsidian-Vault geschrieben:
  `/Users/Shared/10_ObsidianVaults/10_Pallas/50_Ressourcen/20_System/03-Vorlagen/70_SmartApply/` (Vorlagen)
  und `/Users/Shared/10_ObsidianVaults/10_Pallas/_SmartApplyTest/` (Testnotizen). **NICHT ins vault-rag-Repo
  committen** — Vault-Dateien folgen der clean-shutdown-Commit-Cadence (gebündelt am Session-Ende). Ins Repo
  committet wird **ausschließlich der Test** (`tests/smartapply_templates.vault.test.ts`).
- **Frontmatter-`#`-Hinweise sind EINZEILIG** (Parser verschluckt Fortsetzungszeilen). `%%`-Sektions-Anleitungen dürfen umbrechen.
- **Enum-Werte emoji-exakt + wörtlich** (kanonisch aus `20_Typ`). Dateinamen ohne Emoji (`Notiz.md` etc.).
- **Vorlagen-Inhalt = Spec §4 verbatim.** Bei Abweichung gewinnt die Spec; Plan dupliziert den Inhalt bewusst nicht (DRY, Drift-Schutz).
- **Engine unberührt:** kein `src/`-Eingriff außer dem neuen Test. Bestehende Suite muss grün bleiben (`npm test`).
- Commits: Conventional Commits, deutsche Beschreibung erlaubt, **nur berührte Dateien stagen** (nie `git add -A`), Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Parse-Guard-Test + die 5 Vorlagen (TDD)

**Files:**
- Create (Repo): `tests/smartapply_templates.vault.test.ts`
- Create (Vault): `…/70_SmartApply/Notiz.md`, `Konzept.md`, `Quelle.md`, `Dokument.md`, `Kommunikation.md`
- Reference: `src/template_matcher.ts` (`parseTemplate`, `TemplateSpec`), `src/note_restructurer.ts` (`buildRestructurePrompt`, `splitBlocks`)

**Interfaces:**
- Consumes: `parseTemplate(text): TemplateSpec` mit `{ type, keys, fmDefaults, fmGuidance?, sections:[{heading,guidance,...}] }`; `buildRestructurePrompt(tpl, blocks): {role,content}[]`; `splitBlocks(body): SourceBlock[]`.
- Produces: 5 valide Vorlagen am Ablageort; grüner vault-gated Test.

- [ ] **Step 1: Failing test schreiben** — `tests/smartapply_templates.vault.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTemplate } from "../src/template_matcher";
import type { TemplateSpec } from "../src/template_matcher";
import { buildRestructurePrompt, splitBlocks } from "../src/note_restructurer";

// SSOT = die echten Vault-Vorlagen. Gated auf den Vault-Ordner: lokal grün, in CI (kein Vault) sauber übersprungen.
const TPL_DIR =
  process.env.PALLAS_SMARTAPPLY_DIR ??
  "/Users/Shared/10_ObsidianVaults/10_Pallas/50_Ressourcen/20_System/03-Vorlagen/70_SmartApply";
const HAS_VAULT = existsSync(TPL_DIR);

interface Spec {
  file: string;
  type: string;
  guidedKeys: string[];   // FM-Keys (außer type), die einen nicht-leeren Hinweis haben müssen
  enumDefaults: string[]; // Keys, deren Default-Wert in seiner eigenen Hinweisliste vorkommen muss
}

const SPECS: Spec[] = [
  { file: "Notiz.md", type: "📝 Notiz", guidedKeys: ["status", "bereich"], enumDefaults: ["status"] },
  { file: "Konzept.md", type: "💡 Konzept", guidedKeys: ["status", "bereich"], enumDefaults: ["status"] },
  { file: "Quelle.md", type: "🔎 Quelle", guidedKeys: ["status", "source", "medium", "autor", "jahr", "lesestatus", "bereich"], enumDefaults: ["status", "lesestatus"] },
  { file: "Dokument.md", type: "📄 Dokument", guidedKeys: ["status", "dokumenttyp", "datum", "richtung", "partei", "aktenzeichen", "frist", "bereich"], enumDefaults: ["status"] },
  { file: "Kommunikation.md", type: "📬 Kommunikation", guidedKeys: ["status", "datum", "kanal", "richtung", "partei"], enumDefaults: ["status"] },
];

const INTRO_RE = /einleitend|Kontextsatz|worum/i;
const CATCHALL_RE = /Auffang|Übrige/i;

describe.skipIf(!HAS_VAULT)("Smart-Apply Capture-Vorlagen (Vault)", () => {
  for (const s of SPECS) {
    describe(s.file, () => {
      let tpl: TemplateSpec;
      beforeAll(() => {
        // I/O bewusst in beforeAll (nicht im describe-Body): geskippte Suites führen Hooks nicht aus → CI-sicher.
        tpl = parseTemplate(readFileSync(join(TPL_DIR, s.file), "utf8"));
      });

      it("type ist emoji-exakt", () => {
        expect(tpl.type).toBe(s.type);
      });

      it("alle geführten Keys haben einen nicht-leeren Hinweis (Einzeilen-Constraint)", () => {
        for (const k of s.guidedKeys) {
          expect(tpl.keys, `Key ${k} fehlt im Frontmatter`).toContain(k);
          expect((tpl.fmGuidance?.[k] ?? "").trim().length, `Key ${k} ohne Hinweis`).toBeGreaterThan(0);
        }
      });

      it("Enum-Defaults liegen in ihrer eigenen Hinweisliste", () => {
        for (const k of s.enumDefaults) {
          const def = tpl.fmDefaults[k];
          expect(typeof def, `Default für ${k} fehlt`).toBe("string");
          expect(tpl.fmGuidance?.[k] ?? "").toContain(def as string);
        }
      });

      it("≥2 Sektionen mit Anleitung; Lead beansprucht Intro, letzte ist Auffang", () => {
        expect(tpl.sections.length).toBeGreaterThanOrEqual(2);
        for (const sec of tpl.sections) {
          expect(sec.guidance.trim().length, `Sektion „${sec.heading}" ohne %%-Anleitung`).toBeGreaterThan(0);
        }
        expect(tpl.sections[0].guidance).toMatch(INTRO_RE);
        expect(tpl.sections[tpl.sections.length - 1].guidance).toMatch(CATCHALL_RE);
      });

      it("buildRestructurePrompt rendert Hinweise + Anleitungen sauber", () => {
        const msgs = buildRestructurePrompt(tpl, splitBlocks("Block eins.\n\nBlock zwei."));
        const user = msgs.find(m => m.role === "user")?.content ?? "";
        expect(user).not.toContain("undefined");
        for (const k of s.guidedKeys) {
          expect(user, `Hinweis-Zeile für ${k} fehlt`).toMatch(new RegExp(`- ${k} \\(.*Hinweis:`));
        }
        for (const sec of tpl.sections) {
          expect(user).toContain(`${sec.heading} — Anleitung:`);
        }
      });
    });
  }
});
```

- [ ] **Step 2: Test laufen lassen — muss ROT sein**

Run: `npx vitest run tests/smartapply_templates.vault.test.ts`
Expected: Der Vault-Ordner existiert lokal → Suite läuft, aber **rot** (die 5 `…/70_SmartApply/*.md` fehlen → `beforeAll` wirft `ENOENT`). Genau das ist die TDD-Rot-Phase.

- [ ] **Step 3: Die 5 Vorlagen schreiben** — exakt der Inhalt aus **Spec §4.1–§4.5** (verbatim), je eine Datei nach `…/70_SmartApply/`:
  - `Notiz.md` ← Spec §4.1
  - `Konzept.md` ← Spec §4.2
  - `Quelle.md` ← Spec §4.3
  - `Dokument.md` ← Spec §4.4
  - `Kommunikation.md` ← Spec §4.5

  **Kritisch:** Jeder FM-`#`-Hinweis ist **eine physische Zeile** (im Spec-Codeblock evtl. optisch umgebrochen — beim Schreiben NICHT umbrechen). Emoji exakt übernehmen.

- [ ] **Step 4: Test laufen lassen — muss GRÜN sein**

Run: `npx vitest run tests/smartapply_templates.vault.test.ts`
Expected: PASS — 5 Suites, alle Asserts grün. Bei Rot: meist verschluckter Mehrzeilen-Hinweis (Step 3 Zeile zusammenführen) oder Intro/Auffang-Regex verfehlt (Lead-/Schluss-`%%` nachschärfen, ohne von der Spec-Semantik abzuweichen).

- [ ] **Step 5: Gesamte Suite + Typecheck grün halten**

Run: `npm test && npm run typecheck`
Expected: Bestehende Tests unverändert grün; Typecheck sauber.

- [ ] **Step 6: Commit (nur der Test ins Repo)**

```bash
git add tests/smartapply_templates.vault.test.ts
git commit -m "$(printf '%s\n' 'test(smart-apply): vault-gated Parse-Guard für die 5 Capture-Vorlagen' '' 'Validiert type-Emoji-Exaktheit, nicht-leere FM-Hinweise (Einzeilen-Constraint),' 'Enum-Defaults in ihrer Hinweisliste, Lead-Intro + benannten Auffang, sowie' 'sauberes buildRestructurePrompt-Rendering. Gated auf den Vault-Ordner (CI: skip).' '' 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

> Die 5 Vorlagen-Dateien bleiben **ungestaged** (liegen im Vault, nicht im Repo) — sie werden beim Vault-clean-shutdown gebündelt committet.

---

### Task 2: GUI-Smoke-Material (Testnotizen + Checkliste)

**Files:**
- Create (Vault): `…/_SmartApplyTest/Notiz — Rohcapture.md`, `Konzept — Rohcapture.md`, `Quelle — Rohcapture.md`, `Dokument — Rohcapture.md`, `Kommunikation — Rohcapture.md`
- Create (Vault): `…/_SmartApplyTest/00_Smoke-Checkliste.md`

**Interfaces:**
- Consumes: nichts (reines Vault-Material).
- Produces: pro Typ eine realistische, **unstrukturierte** Rohnotiz zum Anwenden der Vorlage + eine Abhak-Checkliste.

- [ ] **Step 1: Fünf Rohnotizen schreiben** — je `_SmartApplyTest/<Typ> — Rohcapture.md`. Jede Datei: **minimales/kein Frontmatter** (damit der Default-/Extraktionspfad greift; insbesondere KEIN `type`, sonst gewinnt der bestehende Wert), und ein Fließtext-Body, der bewusst enthält:
  1. einen **Einleitungs-/Kontextsatz** zuerst (Intro-Routing-Test),
  2. Material für **jede** Sektion der Zielvorlage,
  3. **verbatim-extrahierbare** Signale passend zu den geführten Keys (z. B. Datum `2026-05-14`, Name, URL, Aktenzeichen, ein Enum-Stichwort),
  4. ein, zwei thematisch lose **Rest-Blöcke** (Auffang-Test).

  Inhaltsrichtlinie pro Typ (frei, realistisch, deutsch):
  - **Notiz:** Brain-Dump zu einem Systemthema (Bereich 🧠 System ableitbar) + eine Nebenbemerkung als Rest.
  - **Konzept:** eine These + Begründung + eine Implikation + eine offene Frage als Rest.
  - **Quelle:** Notiz über einen Artikel/ein Video mit URL, Autor, Jahr, einem Zitat + eigenem Gedanken als Rest.
  - **Dokument:** Beschreibung eines Bescheids/Schreibens mit Datum, Absender ([[Name]]-fähig), Aktenzeichen, Frist + Randnotiz als Rest.
  - **Kommunikation:** Mitschrift einer E-Mail/eines Telefonats mit Partei, Datum, Richtung + To-do + Verweis als Rest.

- [ ] **Step 2: Smoke-Checkliste schreiben** — `_SmartApplyTest/00_Smoke-Checkliste.md`, abhakbar, pro Vorlage dieselben Prüfpunkte:

```markdown
# Smart-Apply Capture-Vorlagen — Smoke-Checkliste

Pro Typ: Rohnotiz öffnen → Smart-Apply-Panel → Vorlage `<Typ>` wählen → anwenden → prüfen.

## <Typ>  (für Notiz · Konzept · Quelle · Dokument · Kommunikation)
- [ ] Vorlage erscheint in der Auswahl/Rangliste.
- [ ] Routing plausibel — jeder Absatz in der richtigen Sektion.
- [ ] Einleitungssatz landet in der **Lead-Sektion** (nicht im Auffang).
- [ ] Rest-Blöcke landen im **benannten Auffang** (📝 …), nicht in `## Übrig`.
- [ ] Frontmatter `type` ist emoji-exakt (z. B. `📝 Notiz`).
- [ ] Verbatim-Felder korrekt extrahiert (Datum/Name/URL/Aktenzeichen, wo vorhanden).
- [ ] Enum-Felder: entweder sinnvoll klassifiziert oder sauber auf Default/leer.
- [ ] Kein Datenverlust (jeder Original-Block taucht irgendwo auf).
```

- [ ] **Step 3: Verifizieren, dass Testnotizen NICHT als Vorlagen gelistet werden**

`_SmartApplyTest/` liegt außerhalb des `templateDir` (`70_SmartApply/`) → erscheint nicht im Vorlagen-Picker. Sichtprüfung im Panel beim Smoke (Task 3 / Handover).

> Kein Repo-Commit — alles Vault-Material (clean-shutdown-Cadence).

---

### Task 3: Verifikation, adversariales Review, Finishing

**Files:** keine neuen; ggf. Nachschärfungen an den Vorlagen (Vault) oder am Test (Repo).

- [ ] **Step 1: Adversariales Review der Vorlagen** — die 5 Vorlagen gegen Spec + Engine prüfen (eigene Sichtung oder Subagent/Workflow). Leitfragen: Routing-Eindeutigkeit (überlappen Sektions-`%%`?); ist jeder Hinweis genau eine Zeile; sind alle Enum-Werte emoji-exakt und vollständig; verlangt versehentlich eine Sektion Synthese (verbotene Fabrikation); ist der Auffang in jeder Vorlage eindeutig die letzte Sektion. Befunde einarbeiten.

- [ ] **Step 2: Voll-Suite final**

Run: `npm test && npm run typecheck && npm run lint`
Expected: alles grün/sauber (die `sentence-case`-Lint-Regel ist bewusst aus).

- [ ] **Step 3: Verifikation dokumentieren** — kurze Evidenz (Testlauf-Ergebnis) festhalten; Smoke an Johannes übergeben (Handover-Note ist `00_Smoke-Checkliste.md`).

- [ ] **Step 4: Finishing** — REQUIRED SUB-SKILL `superpowers:finishing-a-development-branch`: Branch `feat/smartapply-capture-templates` (Spec + Plan + Test) — Optionen (Merge nach `main` `--no-ff` / PR / offen lassen) Johannes vorlegen. Vault-Dateien separat via clean-shutdown.

---

## Self-Review (gegen die Spec)

**Spec-Coverage:**
- §1 Scope (5 Typen, Ablageort, Dateinamen) → Task 1 Step 3. ✓
- §2 Engine-Grenzen (keine Fabrikation, Merge, Verbatim/Enum, Auffang, kein statischer Body) → in Vorlagen-Design (Spec §4) verbaut; Test prüft Auffang/Intro/Enum-Default. ✓
- §2.1 Constraints (einzeilige Hinweise, mehrzeilige `%%`, emoji-exakt) → Global Constraints + Task 1 Step 3/Step 4; Test-Assert „nicht-leerer Hinweis" + „type emoji-exakt". ✓
- §3 Pattern (imperativ, Lead-Intro, benannter Auffang) → Spec §4-Inhalt; Test INTRO_RE/CATCHALL_RE. ✓
- §4 die 5 Vorlagen → Task 1 Step 3 (verbatim aus Spec). ✓
- §5.1 Parse-Guard → Task 1 (alle 7 Asserts der Spec abgedeckt: type, Hinweis-nonempty, ≥2 Sektionen+guidance, Auffang, Intro, Prompt-Render, Enum-Default-in-Liste). ✓
- §5.2 Render-Check-Script → **bewusst entfallen (YAGNI):** Assert „buildRestructurePrompt rendert sauber" (Task 1) deckt es ab. Dokumentierte Scope-Reduktion. ✓
- §5.3 GUI-Smoke (Rohnotizen in `_SmartApplyTest/` + Checkliste) → Task 2. ✓
- §6 Deliverables/DoD → Tasks 1–3; DoD-Punkte als finale Runs. ✓
- §7 Folgeentscheidungen (Gespräch/Besprechung, Strukturtypen) → außerhalb Scope, nicht eingeplant (korrekt). ✓
- §8 Lessons → in Vorlagen-Inhalt + Test-Asserts gespiegelt. ✓

**Placeholder-Scan:** Vorlagen-Inhalt per Spec-§4-Verweis (committetes, stabiles SSOT — kein „TBD"). Test-Code vollständig. Rohnotizen-Inhalt per Richtlinie (realistischer Freitext, bewusst nicht wortwörtlich vordefiniert — sie sind Wegwerf-Testmaterial, keine API). Keine „handle edge cases"-Floskeln. ✓

**Typ-Konsistenz:** `parseTemplate`/`TemplateSpec`/`fmGuidance`/`fmDefaults`/`sections[].guidance`/`buildRestructurePrompt`/`splitBlocks` — Signaturen gegen `src/template_matcher.ts` + `src/note_restructurer.ts` geprüft. Sektion-`heading` ist ohne `##` (wie von parseTemplate gespeichert) → Test-Assert nutzt `sec.heading` ohne `##`. ✓
