import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findUntranslatedSinks, findUntranslatedSinksIn } from "./sink_guard";

/**
 * Selbsttest des Sink-Wächters (Fix-Runde 1, Task-7-Review). Schreibt Fixture-Dateien in ein
 * Temp-Verzeichnis statt gegen echten Repo-Code zu testen — die beiden Pflicht-Gegenproben aus
 * dem Review sind hier dauerhaft verankert, nicht nur einmalig im Fix-Report demonstriert:
 *
 *  1. Ein Literal, das eine Text-Senke ohne t() erreicht, MUSS anschlagen (mit Datei+Zeile).
 *  2. Derselbe Fall, korrekt mit t() umschlossen, DARF NICHT anschlagen (kein Wächter, der bei
 *     korrektem Code Alarm schlägt).
 */
describe("sink_guard", () => {
  const dir = mkdtempSync(join(tmpdir(), "sink-guard-test-"));
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  function write(name: string, content: string): string {
    const p = join(dir, name);
    writeFileSync(p, content, "utf8");
    return p;
  }

  it("Gegenprobe 1: ein Literal an einer Text-Senke ohne t() schlägt an, mit Datei und Zeile", () => {
    const file = write(
      "bad.ts",
      [
        "function render(contentEl: any): void {",
        '  contentEl.createEl("p", { text: "Verbindung" });',
        "}",
      ].join("\n"),
    );
    const findings = findUntranslatedSinks(file);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe(file);
    expect(findings[0].line).toBe(2);
    expect(findings[0].text).toContain("Verbindung");
  });

  it("Gegenprobe 2: dieselbe Senke korrekt mit t() umschlossen schlägt NICHT an", () => {
    const file = write(
      "good.ts",
      [
        'import { t } from "../vendor/kit/i18n";',
        "function render(contentEl: any): void {",
        '  contentEl.createEl("p", { text: t("settings.conn.offline") });',
        "}",
      ].join("\n"),
    );
    const findings = findUntranslatedSinks(file);
    expect(findings).toEqual([]);
  });

  it("erkennt weitere deutsche Wörter ohne Sonderzeichen, die eine reine Umlaut-Regex übersehen hätte", () => {
    // Genau die Wörter aus dem Review-Befund: "geladen", "aktiv", "Ordner", "Fehler",
    // "Speichern", "Status", "Einstellungen", "verbunden" — keins trägt ein deutsches
    // Sonderzeichen, alle erreichen hier direkt eine Senke.
    const file = write(
      "review_words.ts",
      [
        "function render(s: any): void {",
        '  s.setName("Status");',
        '  s.setDesc("Einstellungen");',
        '  s.setTooltip("verbunden");',
        '  s.setButtonText("Speichern");',
        '  s.setPlaceholder("Ordner");',
        '  s.setText("Fehler");',
        "}",
      ].join("\n"),
    );
    const findings = findUntranslatedSinks(file);
    expect(findings).toHaveLength(6);
  });

  it("ignoriert Literale ganz ohne Buchstaben (sprachneutral: Zahlen, Interpunktion)", () => {
    const file = write(
      "neutral.ts",
      [
        "function render(s: any): void {",
        '  s.setPlaceholder("8123");',
        '  s.setText("…");',
        '  s.setTooltip("·");',
        "}",
      ].join("\n"),
    );
    expect(findUntranslatedSinks(file)).toEqual([]);
  });

  it("ignoriert Zeilen mit i18n-exempt-Marker (begründete Ausnahme im Code)", () => {
    const file = write(
      "exempt.ts",
      [
        "function render(s: any): void {",
        '  s.setPlaceholder("http://localhost:11434");   // i18n-exempt: URL-Beispiel, sprachneutral',
        "}",
      ].join("\n"),
    );
    expect(findUntranslatedSinks(file)).toEqual([]);
  });

  it("ignoriert Variablen/Ausdrücke ohne eigenes Literal an der Senke (kein AST, keine Assignment-Verfolgung)", () => {
    const file = write(
      "variable.ts",
      [
        "function render(s: any, label: string): void {",
        "  s.setName(label);",
        "  s.setDesc(this.plugin.indexHealthReadout());",
        "}",
      ].join("\n"),
    );
    expect(findUntranslatedSinks(file)).toEqual([]);
  });

  it("findUntranslatedSinksIn prüft mehrere Dateien in einem Rutsch", () => {
    const bad = write("multi_bad.ts", 's.setTooltip("Verbindung prüfen ohne t");\n');
    const good = write("multi_good.ts", 's.setTooltip(t("x"));\n');
    const findings = findUntranslatedSinksIn([bad, good]);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe(bad);
  });
});
