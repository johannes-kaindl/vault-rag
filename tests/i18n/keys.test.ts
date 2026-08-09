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

/** Alle t("…")/t('…')/t(`…`)-Literale einer Datei mit ihrer Zeilennummer. */
function tCalls(src: string): { key: string; line: number }[] {
  const out: { key: string; line: number }[] = [];
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\bt\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
      out.push({ key: m[2], line: i + 1 });
    }
  });
  return out;
}

/** Platzhalter-Indizes eines Strings, sortiert und dedupliziert: "{1} von {0}" → [0,1]. */
function placeholders(s: string): number[] {
  return [...new Set([...s.matchAll(/\{(\d+)\}/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
}

/**
 * Ersetzt String-/Template-Literal-Inhalte durch ihre öffnenden/schließenden Anführungszeichen
 * (Inhalt verworfen) — damit Klammern/Kommentar-Marker *innerhalb* eines Literals die
 * brace-Zählung bzw. die Kommentarerkennung nicht verfälschen. Bekannte Lücke: mehrzeilige
 * Template-Literale und `${…}`-Interpolationen innerhalb eines Template-Literals werden nicht
 * aufgelöst (das Literal wird als ein Block bis zum nächsten gleichen Anführungszeichen auf
 * derselben Zeile behandelt) — im Repo bislang nicht in einer Form aufgetreten, die die
 * brace-Zählung stören würde.
 */
function stripStringContents(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += quote;
      i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === "\\") i++;
        i++;
      }
      if (i < line.length) { out += line[i]; i++; }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Entfernt einen `//`-Zeilenkommentar (String-Inhalte müssen vorher bereits entfernt sein). */
function stripLineComment(codeOnlyLine: string): string {
  const idx = codeOnlyLine.indexOf("//");
  return idx === -1 ? codeOnlyLine : codeOnlyLine.slice(0, idx);
}

/**
 * Entscheidet, ob eine öffnende `{` einen Funktions-/Methoden-/Klassenkörper beginnt (Inhalt
 * wird erst bei *Aufruf* ausgewertet, also sicher) oder etwas anderes (Objekt-/Array-Literal,
 * Block, Kontrollfluss — Inhalt wird sofort beim Modul-Load ausgewertet, also unsicher).
 * `prefix` ist der (bereits string-/kommentarbereinigte) Zeilentext vor der `{`.
 * Heuristik, kein Parser — bekannte Lücke: `if/for/while/switch/catch (…) {` wird korrekt als
 * "nicht Funktion" erkannt, ein mehrzeiliger Funktionskopf (Parameterliste über mehrere Zeilen)
 * wird dagegen als "nicht Funktion" fehlklassifiziert, weil die schließende `)` nicht auf
 * derselben Zeile wie die `{` steht.
 */
function isFunctionOpener(prefix: string): boolean {
  const p = prefix.trimEnd();
  if (/=>$/.test(p)) return true; // Arrow-Function-Körper
  if (/\b(if|for|while|switch|catch)\s*\([^{]*\)$/.test(p)) return false; // Kontrollfluss
  if (/\)\s*(:\s*[^{]+)?$/.test(p)) return true; // function/Methode/Konstruktor, ggf. mit Rückgabetyp
  if (/\bclass\b/.test(p)) return true; // Klassenkörper
  return false; // Objekt-/Array-Literal, nackter Block, …
}

/**
 * Alle t(…)-Aufrufe einer Datei, die beim Modul-Load ausgewertet werden (statt erst bei
 * späterem Funktionsaufruf) — per Klammer-Tiefen-Tracking über die ganze Datei: sobald eine
 * öffnende `{` einem Funktions-/Methoden-/Klassenkopf gehört, gilt alles darin (bis zur
 * passenden `}`) als "hinter einem Aufruf verzögert", auch wenn dort z.B. ein Objekt-Literal
 * mit t(…)-Werten steht.
 */
function moduleLevelTCalls(src: string): { line: number; text: string }[] {
  const offenders: { line: number; text: string }[] = [];
  const stack: boolean[] = []; // true = Eintrag ist ein Funktions-/Klassenkörper
  src.split("\n").forEach((rawLine, i) => {
    const trimmed = rawLine.trim();
    const deferred = stack.some(Boolean);
    if (trimmed !== "" && !trimmed.startsWith("//") && /\bt\(\s*["'`]/.test(rawLine) && !deferred) {
      offenders.push({ line: i + 1, text: trimmed });
    }
    const codeOnly = stripLineComment(stripStringContents(rawLine));
    for (let ci = 0; ci < codeOnly.length; ci++) {
      const ch = codeOnly[ci];
      if (ch === "{") stack.push(isFunctionOpener(codeOnly.slice(0, ci)));
      else if (ch === "}") stack.pop();
    }
  });
  return offenders;
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
    // Klammer-Tiefen-Tracking (moduleLevelTCalls) statt reiner Einrückungs-/Zeilenheuristik —
    // erfasst auch mehrzeilige Top-Level-Deklarationen (z.B. ein Objekt-Literal, dessen
    // Werte über mehrere Zeilen t(…) aufrufen), bei denen `t(` nicht in derselben Zeile wie
    // `const …=` steht. Bekannte Restlücke: siehe Kommentare an isFunctionOpener/
    // stripStringContents.
    const offenders: string[] = [];
    for (const file of files) {
      for (const { line, text } of moduleLevelTCalls(readFileSync(file, "utf8"))) {
        offenders.push(`${file.slice(SRC.length + 1)}:${line} → ${text}`);
      }
    }
    expect(offenders, `t() auf Modul-Ebene:\n${offenders.join("\n")}`).toEqual([]);
  });
});
