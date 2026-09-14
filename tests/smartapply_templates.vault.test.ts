import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseTemplate, resolveTemplateForType } from "../src/template_matcher";
import type { TemplateSpec } from "../src/template_matcher";
import { buildRestructurePrompt, splitBlocks } from "../src/note_restructurer";
import "../src/i18n/strings"; // registriert die Wörterbücher: der Prompt wird über t() gebaut
import { t } from "../src/vendor/kit/i18n";

// SSOT = die echten Vault-Vorlagen. Gated auf den Vault-Ordner: lokal grün, in CI (kein Vault) sauber übersprungen.
//
// ⚠️ Das Gate ist der teuerste Teil dieser Datei, nicht die Prüfungen darunter: fehlt der Ordner,
// werden 31 Tests SAUBER übersprungen und der Gate-Lauf bleibt grün — ein Deckungsverlust, den
// keine Zahl meldet. Genau das ist am 2026-09-06 passiert, als der Vault von `10_Pallas` nach
// `Pallas` umbenannt wurde: derselbe Lauf ging von „1039 bestanden" auf „1008 bestanden, 31
// übersprungen", und nur ein Blick auf die Zahl hat es gefangen.
//
// Deshalb eine Kandidatenliste statt eines Pfades. Sie überlebt genau diese Umbenennung; jeder
// weitere Vault-Umzug braucht entweder einen Eintrag hier oder den ENV-Override.
const TPL_KANDIDATEN = [
  join(homedir(), "Documents/Pallas/50_Ressourcen/20_System/03-Vorlagen/70_SmartApply"),
];
const TPL_DIR = process.env.PALLAS_SMARTAPPLY_DIR ?? TPL_KANDIDATEN.find(existsSync) ?? TPL_KANDIDATEN[0];
const HAS_VAULT = existsSync(TPL_DIR);

interface Spec {
  file: string;
  type: string;
  guidedKeys: string[];        // FM-Keys (außer type), die einen nicht-leeren Hinweis haben müssen
  directiveDefaults: string[]; // Keys mit gesetztem Default, deren Hinweis direktiv „unverändert übernehmen" fordert
}

const SPECS: Spec[] = [
  { file: "Notiz.md", type: "📝 Notiz", guidedKeys: ["status", "bereich"], directiveDefaults: ["status"] },
  { file: "Konzept.md", type: "💡 Konzept", guidedKeys: ["status", "bereich"], directiveDefaults: ["status"] },
  { file: "Quelle.md", type: "🔎 Quelle", guidedKeys: ["status", "source", "medium", "autor", "jahr", "lesestatus", "bereich"], directiveDefaults: ["status", "lesestatus"] },
  { file: "Dokument.md", type: "📄 Dokument", guidedKeys: ["status", "dokumenttyp", "datum", "richtung", "partei", "aktenzeichen", "frist", "bereich"], directiveDefaults: ["status"] },
  { file: "Kommunikation.md", type: "📬 Kommunikation", guidedKeys: ["status", "datum", "kanal", "richtung", "partei"], directiveDefaults: ["status"] },
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

      it("Dateiname resolvt emoji/case-normalisiert zum Typ", () => {
        const path = join(TPL_DIR, s.file);
        expect(resolveTemplateForType(s.type, [path])).toBe(path);
      });

      it("alle geführten Keys haben einen nicht-leeren Hinweis (Einzeilen-Constraint)", () => {
        for (const k of s.guidedKeys) {
          expect(tpl.keys, `Key ${k} fehlt im Frontmatter`).toContain(k);
          expect((tpl.fmGuidance?.[k] ?? "").trim().length, `Key ${k} ohne Hinweis`).toBeGreaterThan(0);
          expect((tpl.fmGuidance?.[k] ?? "").trim(), `Hinweis für ${k} endet nicht mit Punkt — Zeilenumbruch verschluckt?`).toMatch(/\.$/);
        }
      });

      it("Direktive Defaults fordern unverändertes Übernehmen", () => {
        // Konvention (Ledger-Lehre): FM-Hinweise sind direktiv statt Optionsliste. Ein gesetzter
        // Default (status/lesestatus) muss von einer „unverändert übernehmen"-Anweisung begleitet
        // sein, damit das LLM ihn nicht überschreibt — nicht mehr als Enum-Option in einer Liste.
        for (const k of s.directiveDefaults) {
          const def = tpl.fmDefaults[k];
          expect(typeof def, `Default für ${k} fehlt`).toBe("string");
          expect((def as string).trim().length, `Default für ${k} ist leer`).toBeGreaterThan(0);
          expect(tpl.fmGuidance?.[k] ?? "", `Hinweis für ${k} ist nicht direktiv`).toMatch(/[Uu]nverändert übernehmen/);
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
          expect(user, `Hinweis-Zeile für ${k} fehlt`).toMatch(new RegExp(`- ${k} \\(.*${t("noteRestructurer.label.hint")}:`));
        }
        expect(user, "type-Beispielzeile fehlt im Prompt").toMatch(new RegExp(`- type \\(.*${t("noteRestructurer.label.example")}:`));
        for (const sec of tpl.sections) {
          expect(user).toContain(`${sec.heading} — ${t("noteRestructurer.label.guidance")}:`);
        }
      });
    });
  }

  it("Vorlagen tragen keinen smartapply_modus-Leak; defaultMode wohldefiniert", () => {
    for (const s of SPECS) {
      const tpl = parseTemplate(readFileSync(join(TPL_DIR, s.file), "utf8"));
      expect(tpl.keys).not.toContain("smartapply_modus");
      expect(["deterministisch", "additiv", "transformativ"]).toContain(tpl.defaultMode);
    }
  });
});
