import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findUntranslatedSinksIn } from "./sink_guard";

const SRC = join(__dirname, "..", "..", "src");

/**
 * Dateien, die der Sink-Wächter (`sink_guard.ts`) bewusst NICHT scannt — mit Begründung.
 * PROP_SINKS ist nicht scope-bewusst (matcht bloße Property-Namen `name:`/`desc:`/`text:`/
 * `label:`/`placeholder:`), daher braucht jede Ausnahme hier eine eigene, nachvollziehbare
 * Begründung statt einer pauschalen Stummschaltung.
 */
const ALLOWED = new Set([
  // Die Sprachdatei selbst — Ziel der Übersetzung, nicht Objekt der Prüfung.
  "i18n/strings.ts",
  // vendor/-Module sind verbatim-Snapshots aus obsidian-kit (nie von Hand editiert,
  // siehe AGENTS.md) — hier migrieren wäre der falsche Ort für einen Fix.
  "vendor/kit/i18n.ts",
]);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...tsFiles(p));
      continue;
    }
    if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("i18n-Vollständigkeit: keine unübersetzten Text-Senken außerhalb der Sprachschicht", () => {
  it("scannt alle src/**/*.ts-Dateien mit dem Sink-Wächter", () => {
    const allFiles = tsFiles(SRC);
    const scanned = allFiles.filter((f) => {
      const rel = f.slice(SRC.length + 1);
      return !ALLOWED.has(rel) && !rel.startsWith("vendor/");
    });

    // Selbst-Check: der Scan darf nicht unbemerkt auf eine Handvoll Dateien einschrumpfen.
    expect(scanned.length).toBeGreaterThan(30);

    const findings = findUntranslatedSinksIn(scanned);
    const readout = findings
      .map((f) => `${f.file.slice(SRC.length + 1)}:${f.line} → ${f.text}`)
      .join("\n");
    expect(findings, `Unübersetzte Text-Senken:\n${readout}`).toEqual([]);
  });
});
