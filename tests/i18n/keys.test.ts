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
 * Klassifiziert eine öffnende `{`: "fn" (Funktions-/Methoden-/Arrow-Körper — Inhalt wird erst bei
 * *Aufruf* ausgewertet, also sicher), "class" (Klassenrumpf — Feldinitialisierer darin laufen
 * eifrig) oder "other" (Objekt-/Array-Literal, Block, Kontrollfluss — Inhalt wird sofort beim
 * Modul-Load ausgewertet, also unsicher).
 * `prefix` ist der (bereits string-/kommentarbereinigte) Zeilentext vor der `{`.
 * Heuristik, kein Parser — bekannte Lücke: `if/for/while/switch/catch (…) {` wird korrekt als
 * "nicht Funktion" erkannt, ein mehrzeiliger Funktionskopf (Parameterliste über mehrere Zeilen)
 * wird dagegen als "nicht Funktion" fehlklassifiziert, weil die schließende `)` nicht auf
 * derselben Zeile wie die `{` steht.
 */
function braceKind(prefix: string): "fn" | "class" | "other" {
  const p = prefix.trimEnd();
  if (/=>$/.test(p)) return "fn"; // Arrow-Function-Körper
  if (/\b(if|for|while|switch|catch)\s*\([^{]*\)$/.test(p)) return "other"; // Kontrollfluss
  // Rückgabetyp bewusst als `.+` statt `[^{]+`: ein Typ darf selbst geschweifte Klammern tragen
  // (`): Promise<{ a: string }>`), und mit `[^{]+` wurde der Body-Öffner dann als Objektliteral
  // eingestuft — der ganze Methodenrumpf galt als Modul-Ebene. Die Typ-internen `{` bekommen
  // dabei ebenfalls "fn"; das ist harmlos, weil ihre `}` sie sauber wieder abräumen.
  if (/\)\s*(:\s*.+)?$/.test(p)) return "fn"; // function/Methode/Konstruktor, ggf. mit Rückgabetyp
  // Klassenrumpf ist NICHT "fn": ein blankes Feld (`label = t("x")`) wird bei der Instanziierung
  // ausgewertet, also potenziell vor setLang(). Nur die Methoden-/Getter-Rümpfe DARIN sind
  // verzögert — die bekommen beim Öffnen ihrer eigenen `{` selbst ein "fn".
  if (/\bclass\b/.test(p)) return "class";
  return "other"; // Objekt-/Array-Literal, nackter Block, …
}

/**
 * Alle t(…)-Aufrufe einer Datei, die beim Modul-Load ausgewertet werden (statt erst bei
 * späterem Funktionsaufruf) — per Klammer-Tiefen-Tracking über die ganze Datei: sobald eine
 * öffnende `{` einem Funktions-/Methoden-/Klassenkopf gehört, gilt alles darin (bis zur
 * passenden `}`) als "hinter einem Aufruf verzögert", auch wenn dort z.B. ein Objekt-Literal
 * mit t(…)-Werten steht. Zeichen-für-Zeichen statt Zeilen-für-Zeilen: die Tiefe wird an der
 * *Stelle des t(-Treffers* ausgewertet, nicht am Zeilenanfang — sonst würde eine einzeilige
 * Funktion wie `function bar(): string { return t("…"); }` fälschlich als Modul-Ebene gemeldet
 * (die `{` links vom Aufruf muss vor dem Check verarbeitet sein).
 */
function moduleLevelTCalls(src: string): { line: number; text: string }[] {
  const offenders: { line: number; text: string }[] = [];
  const stack: ("fn" | "class" | "other")[] = [];
  src.split("\n").forEach((rawLine, i) => {
    const codeOnly = stripLineComment(stripStringContents(rawLine));
    for (let ci = 0; ci < codeOnly.length; ci++) {
      const ch = codeOnly[ci];
      if (ch === "{") {
        stack.push(braceKind(codeOnly.slice(0, ci)));
      } else if (ch === "}") {
        stack.pop();
      } else if (ch === "t" && /^t\(\s*["'`]/.test(codeOnly.slice(ci))) {
        const prevChar = ci === 0 ? "" : codeOnly[ci - 1];
        const wordBoundary = !/[A-Za-z0-9_$]/.test(prevChar);
        // Ausdrucks-Arrow ohne eigenen Block (`x = () => t("k")`) öffnet keine `{` und taucht
        // deshalb nie im Stack auf — der Rumpf läuft trotzdem erst beim Aufruf. Ohne diesen
        // Zweig meldete der Wächter `const f = (): string => t("k")` fälschlich, und ein
        // Arrow-Klassenfeld wäre nach der class-Verschärfung neu falsch geworden.
        // VERANKERT, genau wie `braceKind` es fuer Block-Arrows tut: der Pfeil muss unmittelbar
        // vor dem Aufruf stehen. Eine blosse Suche in der Zeile gaebe einem eifrigen Aufruf einen
        // Freibrief, sobald irgendwo davor ein FREMDER Pfeil steht —
        // `const H = { onClick: () => run(), title: t("k") }` ist genau der Fall, den der
        // Waechter fangen soll.
        const deferredByArrow = /=>\s*$/.test(codeOnly.slice(0, ci));
        if (wordBoundary && !stack.includes("fn") && !deferredByArrow) {
          offenders.push({ line: i + 1, text: rawLine.trim() });
        }
      }
    }
  });
  return offenders;
}

// Selbsttest des Waechters. Ohne ihn ist jede Aenderung an moduleLevelTCalls ein Blindflug:
// die Funktion laeuft sonst nur gegen `src/`, und dort ist "keine Fundstelle" sowohl das
// Ergebnis eines gesunden Repos als auch das eines kaputten Waechters.
describe("moduleLevelTCalls (Waechter-Selbsttest)", () => {
  const offends = (src: string): boolean => moduleLevelTCalls(src).length > 0;

  it("meldet t() in einer Top-Level-Konstante", () => {
    expect(offends('const X = t("a.b");')).toBe(true);
  });
  it("meldet t() in einem mehrzeiligen Top-Level-Objektliteral", () => {
    expect(offends('const M = {\n  a: t("a.b"),\n};')).toBe(true);
  });
  it("meldet t() NICHT im Funktionsrumpf", () => {
    expect(offends('function f(): string {\n  return t("a.b");\n}')).toBe(false);
  });
  it("meldet t() NICHT im Getter einer Klasse — das korrekte verzoegerte Idiom", () => {
    expect(offends('class A {\n  get label(): string { return t("a.b"); }\n}')).toBe(false);
  });
  it("meldet ein blankes Klassenfeld mit t() — es wird bei der Instanziierung ausgewertet", () => {
    expect(offends('class A {\n  label = t("a.b");\n}')).toBe(true);
  });
  it("meldet ein Klassenfeld mit t() auch hinter Modifikatoren", () => {
    expect(offends('class A {\n  private readonly label = t("a.b");\n}')).toBe(true);
  });
  it("meldet ein Arrow-Klassenfeld NICHT — der Rumpf laeuft erst beim Aufruf", () => {
    expect(offends('class A {\n  getLabel = (): string => t("a.b");\n}')).toBe(false);
  });
  it("meldet t() NICHT im Rumpf einer Methode mit geschweiften Klammern im Rueckgabetyp", () => {
    // `Promise<{ a: string }>` bringt zwei Klammern in den Signaturkopf; wird der Body-Oeffner
    // deswegen als Objektliteral klassifiziert, gilt der ganze Methodenrumpf als Modul-Ebene.
    expect(offends('class A {\n  async send(): Promise<{ a: string }> {\n    return { a: t("a.b") };\n  }\n}')).toBe(false);
  });
  it("meldet t() NICHT in einer freien Funktion mit Objektliteral-Rueckgabetyp", () => {
    expect(offends('function f(): { a: string } {\n  return { a: t("a.b") };\n}')).toBe(false);
  });
  it("meldet ein eifriges t() auch dann, wenn frueher in der Zeile ein fremder Pfeil steht", () => {
    // Der Pfeil gehoert zu `onClick`, nicht zu `title` — `title` wird beim Modul-Load ausgewertet.
    // Eine ungeankerte Pfeil-Suche gaebe hier einen Freibrief fuer genau den Fall, den der
    // Waechter fangen soll.
    expect(offends('const H = { onClick: () => run(), title: t("a.b") };')).toBe(true);
  });
  it("meldet eine Top-Level-Arrow-Konstante NICHT", () => {
    expect(offends('const f = (): string => t("a.b");')).toBe(false);
  });
});

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
