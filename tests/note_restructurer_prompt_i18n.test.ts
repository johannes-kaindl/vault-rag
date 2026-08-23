import { describe, it, expect, afterEach } from "vitest";
import { setLang } from "../src/vendor/kit/i18n";
import "../src/i18n/strings";
import { buildRestructurePrompt, parseConfidence, SourceBlock } from "../src/note_restructurer";
import type { TemplateSpec } from "../src/template_matcher";

afterEach(() => setLang("en"));

/**
 * Dritte Ausprägung derselben i18n-Wurzel wie `system_prompt.test.ts`: ein Text, der nicht
 * in die OBERFLÄCHE geht, sondern ins MODELL. Beide Guards sind dagegen blind, und zwar zu
 * Recht — `sink_guard.ts` erkennt Text-Senken (ein Prompt ist keine), der Modul-Ebenen-Check
 * sucht `t()`-Aufrufe, und hier stand gar keiner.
 *
 * Der Smart-Apply-Prompt war bis dahin fest deutsch gebaut (`## Vorlagen-Struktur`,
 * `— Anleitung:`, `Du bist ein strukturierender Assistent`), unabhängig von der
 * eingestellten Sprache.
 *
 * Bewusste Grenze: der Prompt folgt der OBERFLÄCHENsprache, nicht der Notizsprache. Wer
 * Obsidian auf Deutsch fährt und eine englische Notiz aufräumt, hat den Mismatch weiterhin.
 */

const MARK_GUIDANCE = "ZZGUIDANCEZZ";
const MARK_HINT = "ZZHINTZZ";

function tpl(): TemplateSpec {
  return {
    type: "X",
    keys: ["status"],
    fmDefaults: { status: "ZZEXAMPLEZZ" },
    fmGuidance: { status: MARK_HINT },
    sections: [
      { heading: "Alpha", level: 2, placeholder: "", guidance: MARK_GUIDANCE },
      { heading: "Beta", level: 2, placeholder: "", guidance: "" },
    ],
    defaultMode: "deterministisch",
    raw: "egal",
  };
}
const blocks: SourceBlock[] = [{ id: "block_0", text: "Ein Satz." }];

/** Deutsche Prompt-Prosa — Marker, die in einer englischen Oberfläche nichts zu suchen haben. */
const GERMAN_PROSE = [
  "Du bist",
  "Vorlagen-Struktur",
  "Geordnete Überschriften",
  "Original-Body",
  "Antworte AUSSCHLIESSLICH",
  "Anleitung:",
  "Beispiel:",
  "Hinweis:",
  "zuzuordnender Inhalt",
];

describe("buildRestructurePrompt — Sprache", () => {
  for (const mode of ["deterministisch", "additiv"] as const) {
    it(`EN: der ${mode}e Prompt trägt keine deutsche Prosa`, () => {
      setLang("en");
      const all = buildRestructurePrompt(tpl(), blocks, mode).map(m => m.content).join("\n");
      for (const marker of GERMAN_PROSE) expect(all, `deutscher Rest: ${marker}`).not.toContain(marker);
    });

    it(`DE: der ${mode}e Prompt ist deutsch`, () => {
      setLang("de");
      const all = buildRestructurePrompt(tpl(), blocks, mode).map(m => m.content).join("\n");
      expect(all).toContain("Du bist");
      expect(all).toContain("Anleitung:");
    });
  }

  it("EN: die Struktur bleibt dieselbe — Überschriften, Blöcke, Vorlagen-Inhalt", () => {
    setLang("en");
    const all = buildRestructurePrompt(tpl(), blocks).map(m => m.content).join("\n");
    // Nutzerinhalt wird NIE übersetzt: Vorlagen-Überschriften, Anleitungstexte, Blocktexte.
    expect(all).toContain("- Alpha");
    expect(all).toContain(MARK_GUIDANCE);
    expect(all).toContain(MARK_HINT);
    expect(all).toContain("ZZEXAMPLEZZ");
    expect(all).toContain("block_0");
    expect(all).toContain("Ein Satz.");
  });
});

/**
 * Der Prompt nennt die erlaubten Konfidenz-Werte wörtlich, und `parseConfidence` liest sie
 * zurück. Übersetzt man die Prosa, ohne diese beiden Seiten aneinander zu halten, verlangt
 * ein englischer Prompt weiter deutsche Wörter — oder schlimmer: er verlangt englische, die
 * der Parser nicht kennt, und JEDE Ergänzung fällt still auf "niedrig".
 */
describe("buildRestructurePrompt — Konfidenz-Werte sind Protokoll, nicht Prosa", () => {
  for (const lang of ["en", "de"] as const) {
    it(`${lang}: die drei genannten Werte bildet der Parser auf drei verschiedene Stufen ab`, () => {
      setLang(lang);
      const all = buildRestructurePrompt(tpl(), blocks, "additiv").map(m => m.content).join("\n");
      const m = /"confidence":\s*"([^"]+)"\|"([^"]+)"\|"([^"]+)"/.exec(all);
      expect(m, "Der additive Prompt nennt keine drei Konfidenz-Werte mehr").not.toBeNull();
      const stufen = [m![1], m![2], m![3]].map(w => parseConfidence(w));
      expect(new Set(stufen).size, `unbekannte Werte fallen auf "niedrig": ${stufen.join(",")}`).toBe(3);
    });
  }
});

/**
 * Drift-Guard: die Zeile `- <Überschrift> — <Label>: <Text>` und der Satz, der dieses Label
 * erklärt ("die `<Label>:`-Zeilen sind VORGABEN"), sind zwei Strings, die dasselbe Wort
 * tragen müssen. Getrennt übersetzt laufen sie auseinander, und das Modell bekommt eine
 * Erklärung für eine Zeile, die es nicht gibt.
 */
describe("buildRestructurePrompt — Label und seine Erklärung bleiben gekoppelt", () => {
  for (const lang of ["en", "de"] as const) {
    it(`${lang}: das Anleitungs-Label der erzeugten Zeile kommt in der system-Erklärung vor`, () => {
      setLang(lang);
      const [system, user] = buildRestructurePrompt(tpl(), blocks);
      const m = new RegExp(`- Alpha — (.+?): ${MARK_GUIDANCE}`).exec(user.content);
      expect(m, "Die Anleitungs-Zeile hat ihre Form verloren").not.toBeNull();
      expect(system.content).toContain(`${m![1]}:`);
    });
  }
});

/** JSON-Feldnamen und source-Werte sind Protokoll — sie werden in KEINER Sprache übersetzt. */
describe("buildRestructurePrompt — Protokoll-Literale bleiben unangetastet", () => {
  for (const lang of ["en", "de"] as const) {
    it(`${lang}: Schema-Felder und source-Werte stehen wörtlich im Prompt`, () => {
      setLang(lang);
      const all = buildRestructurePrompt(tpl(), blocks, "additiv").map(m => m.content).join("\n");
      for (const lit of ['"sections"', '"unassigned"', '"frontmatter"', '"additions"', '"source"', '"content"', '"inferred"', '"empty"']) {
        expect(all, `Protokoll-Literal fehlt: ${lit}`).toContain(lit);
      }
    });
  }
});
