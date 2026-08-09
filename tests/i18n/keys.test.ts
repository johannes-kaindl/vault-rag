import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EN, DE } from "../../src/i18n/strings";

const SRC = join(__dirname, "..", "..", "src");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { out.push(...tsFiles(p)); continue; }
    if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Alle t("…")-Literale einer Datei mit ihrer Zeilennummer. */
function tCalls(src: string): { key: string; line: number }[] {
  const out: { key: string; line: number }[] = [];
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\bt\(\s*"([^"]+)"/g)) out.push({ key: m[1], line: i + 1 });
  });
  return out;
}

/** Platzhalter-Indizes eines Strings, sortiert und dedupliziert: "{1} von {0}" → [0,1]. */
function placeholders(s: string): number[] {
  return [...new Set([...s.matchAll(/\{(\d+)\}/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
}

describe("i18n key guard", () => {
  const files = tsFiles(SRC).filter(p => !p.includes("/vendor/") && !p.endsWith("/i18n/strings.ts"));

  it("jeder im Code verwendete Key existiert in EN", () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const { key, line } of tCalls(readFileSync(file, "utf8"))) {
        if (!(key in EN)) missing.push(`${file.slice(SRC.length + 1)}:${line} → "${key}"`);
      }
    }
    expect(missing, `Unbekannte Keys:\n${missing.join("\n")}`).toEqual([]);
  });

  it("EN und DE nutzen je Key dieselben Platzhalter-Indizes", () => {
    const bad: string[] = [];
    for (const key of Object.keys(EN)) {
      const en = placeholders(EN[key as keyof typeof EN]);
      const de = placeholders(DE[key as keyof typeof DE] ?? "");
      if (en.join(",") !== de.join(",")) bad.push(`${key}: EN {${en}} vs DE {${de}}`);
    }
    expect(bad, `Platzhalter-Drift:\n${bad.join("\n")}`).toEqual([]);
  });

  it("kein t()-Aufruf steht auf Modul-Ebene", () => {
    // setLang() läuft erst im onload; ein t() auf Modul-Ebene friert die Sprache still ein.
    // Heuristik: Einrückungstiefe 0 ODER eine top-level const/let/var-Zuweisung, die t( enthält.
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (!/\bt\(\s*"/.test(line)) return;
        if (/^(export\s+)?(const|let|var)\s/.test(line) || /^\S/.test(line)) {
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1} → ${line.trim()}`);
        }
      });
    }
    expect(offenders, `t() auf Modul-Ebene:\n${offenders.join("\n")}`).toEqual([]);
  });
});
