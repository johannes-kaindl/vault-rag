import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTemplate, resolveTemplateForType } from "../src/template_matcher";
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
        expect(user, "type-Beispielzeile fehlt im Prompt").toMatch(/- type \(.*Beispiel:/);
        for (const sec of tpl.sections) {
          expect(user).toContain(`${sec.heading} — Anleitung:`);
        }
      });
    });
  }
});
