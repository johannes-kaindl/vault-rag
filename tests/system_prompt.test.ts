import { describe, it, expect, afterEach } from "vitest";
import { setLang } from "../src/vendor/kit/i18n";
import "../src/i18n/strings";
import {
  DEFAULT_SETTINGS,
  LEGACY_SYSTEM_PROMPT,
  effectiveSystemPrompt,
  migrateSystemPrompt,
} from "../src/settings_core";

afterEach(() => setLang("en"));

/**
 * Der Chat-System-Prompt ist die einzige Text-Konstante des Repos, die NICHT in die
 * Oberfläche geht, sondern ins Modell — und genau deshalb ist sie durch jeden Guard
 * gefallen: `sink_guard.ts` erkennt Text-Senken (UI-Elemente), ein Prompt ist keine.
 *
 * Gefunden am 2026-08-21 beim README-Aufnahme-Lauf: auf englischer Oberfläche kam auf eine
 * englische Frage eine deutsche Antwort, weil der Auslieferungs-Default wörtlich
 * „Antworte knapp und auf Deutsch." verlangte. Das Denkprotokoll des Modells benannte es
 * selbst: „Language: English (but system prompt says answer in German)".
 */
describe("effectiveSystemPrompt", () => {
  it("leerer gespeicherter Wert → lokalisierter Default (EN)", () => {
    setLang("en");
    const p = effectiveSystemPrompt("");
    expect(p).toContain("English");
    expect(p).not.toContain("Deutsch");
  });

  it("leerer gespeicherter Wert → lokalisierter Default (DE)", () => {
    setLang("de");
    const p = effectiveSystemPrompt("");
    expect(p).toContain("Deutsch");
  });

  it("ein eigener Prompt bleibt unangetastet — in jeder Sprache", () => {
    const eigen = "Answer only in haiku.";
    setLang("en");
    expect(effectiveSystemPrompt(eigen)).toBe(eigen);
    setLang("de");
    expect(effectiveSystemPrompt(eigen)).toBe(eigen);
  });

  it("der alte deutsche Default gilt als NICHT angepasst und wird lokalisiert", () => {
    // Migration für Bestandsnutzer: der Text steht wörtlich in ihrer data.json, weil er
    // beim ersten Speichern aus DEFAULT_SETTINGS dorthin kopiert wurde. Ihn als bewusste
    // Anpassung zu behandeln hiesse, sie dauerhaft auf der deutschen Fassung festzuhalten.
    setLang("en");
    const p = effectiveSystemPrompt(LEGACY_SYSTEM_PROMPT);
    expect(p).toContain("English");
    expect(p).not.toBe(LEGACY_SYSTEM_PROMPT);
  });

  it("Whitespace-only zählt als leer", () => {
    setLang("en");
    expect(effectiveSystemPrompt("   \n  ")).toBe(effectiveSystemPrompt(""));
  });

  it("der Auslieferungs-Default ist leer, nicht der deutsche Text", () => {
    // Die eigentliche Wurzel: stünde hier wieder ein fertiger Satz, wäre er auf Modul-Ebene
    // ausgewertet — vor `setLang()` — und damit erneut in einer Sprache eingefroren.
    expect(DEFAULT_SETTINGS.chatSystemPrompt).toBe("");
  });
});

/**
 * Die Umdeutung zur Anfragezeit allein genügt nicht: das Einstellungs-Feld zeigt den
 * GESPEICHERTEN Wert. Ein Bestandsnutzer sähe dort weiter den deutschen Satz, bekäme aber
 * englische Antworten — sichtbarer Widerspruch, und niemand könnte ihn sich erklären.
 * Aufgefallen beim Ansehen von `settings.png`, nicht durch einen Test.
 */
describe("migrateSystemPrompt", () => {
  it("räumt den alten Default beim Laden weg", () => {
    expect(migrateSystemPrompt(LEGACY_SYSTEM_PROMPT)).toBe("");
  });

  it("lässt einen eigenen Prompt stehen", () => {
    expect(migrateSystemPrompt("Answer only in haiku.")).toBe("Answer only in haiku.");
  });

  it("lässt Leeres leer", () => {
    expect(migrateSystemPrompt("")).toBe("");
  });

  it("toleriert umgebenden Whitespace am alten Default", () => {
    expect(migrateSystemPrompt(`  ${LEGACY_SYSTEM_PROMPT}  `)).toBe("");
  });
});
