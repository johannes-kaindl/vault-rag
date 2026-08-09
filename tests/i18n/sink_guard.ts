import { readFileSync } from "node:fs";

/**
 * Sink-basierter i18n-Vollständigkeits-Wächter.
 *
 * Prüft NICHT „ist dieser String deutsch?" — das ist sprachabhängig und nie vollständig
 * (eine Wortliste ist am Tag nach ihrer Erstellung veraltet, siehe Task-7-Fix-Report). Geprüft
 * wird stattdessen strukturell und sprachunabhängig: „erreicht ein String-/Template-Literal
 * eine Text-Senke (Setting-Name, Tooltip, Button-Text, aria-label, …), ohne durch t() zu
 * laufen?" Ein `createEl("p", { text: "Verbindung" })` schlägt an — unabhängig davon, ob
 * "Verbindung" für einen Menschen erkennbar deutsch aussieht oder nicht; ein
 * `createEl("p", { text: t("settings.conn.offline") })` schlägt NICHT an.
 *
 * Erkannte Senken:
 *  - Methodenaufrufe: .setName(), .setDesc(), .setTooltip(), .setButtonText(),
 *    .setPlaceholder(), .setText()
 *  - .setAttribute("aria-label", …) / .setAttribute("title", …)
 *  - .setAttr("placeholder", …)
 *  - Objektliteral-Properties: name:, desc:, text:, label:, placeholder:
 *    (deckt createEl/createDiv/createSpan({ text: … }) UND die Definitions-Arrays ab, ohne
 *    die Aufruf-Syntax dieser Fälle einzeln nachzubilden)
 *
 * Ausnahmen (bewusst KEIN Befund):
 *  - Literale ganz ohne Buchstaben (Zahlen, reine Interpunktion/Symbole: "…", "·", "8123") —
 *    sprachneutral per Definition (\p{L}-Test).
 *  - Zeilen mit dem Marker `i18n-exempt:` — Begründung folgt im selben Kommentar (CSS-Klassen,
 *    technische Platzhalter-Beispiele wie URLs/Pfade/Modellnamen, bewusst nicht übersetzte
 *    Lehnwörter). Der Marker ersetzt keine Begründung, er trägt sie.
 *  - Kommentarzeilen (`//`, `*`).
 *
 * Bekannte Grenze (Zeilen-Heuristik, kein AST): Sink-Aufrufe, deren Argument über mehrere
 * Zeilen verteilt ist, werden nur bis zum Zeilenende gelesen — im Repo bislang nicht in einer
 * Form aufgetreten, die dadurch einen Fund verschluckt (alle Senken in diesem Repo sind
 * einzeilig; Stand Task 7). Ebenso nicht erfasst: ein Literal, das über eine Zwischenvariable
 * an eine Senke gereicht wird (`const x = "…"; setText(x)`) — der Fund müsste an der
 * Zuweisung selbst erfolgen, das ist ein Assignment, keine Senke. Für den in Fix-Runde 1
 * gemeldeten Fall (`createEl(..., { text: "…" })`) reicht das aus.
 */

export interface SinkFinding {
  file: string;
  line: number;
  text: string;
}

const CALL_SINKS = /\.(?:setName|setDesc|setTooltip|setButtonText|setPlaceholder|setText)\(/g;
const ATTR_SINKS = /\.setAttribute\(\s*"(?:aria-label|title)"\s*,\s*/g;
const SETATTR_SINKS = /\.setAttr\(\s*"placeholder"\s*,\s*/g;
const PROP_SINKS = /\b(?:name|desc|text|label|placeholder)\s*:\s*/g;

export const EXEMPT_MARKER = "i18n-exempt";

/** Liest ab `startIdx` (direkt hinter der öffnenden Klammer eines Funktionsaufrufs, Tiefe
 *  bereits 1) klammer-/string-bewusst bis zur zugehörigen schließenden Klammer. */
function readBalancedCall(line: string, startIdx: number): string {
  let depth = 1;
  let i = startIdx;
  let out = "";
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\"" || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch; i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === "\\" && i + 1 < line.length) { out += line[i] + line[i + 1]; i += 2; continue; }
        out += line[i]; i++;
      }
      if (i < line.length) { out += line[i]; i++; }
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; out += ch; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0 && ch === ")") { i++; break; }
      out += ch; i++; continue;
    }
    out += ch; i++;
  }
  return out;
}

/** Liest ab `startIdx` (direkt hinter dem Doppelpunkt einer Objektliteral-Property) bis zum
 *  nächsten Komma/schließenden Klammer auf Tiefe 0 — der Wert einer Property endet dort. */
function readBalancedProp(line: string, startIdx: number): string {
  let depth = 0;
  let i = startIdx;
  let out = "";
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\"" || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch; i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === "\\" && i + 1 < line.length) { out += line[i] + line[i + 1]; i += 2; continue; }
        out += line[i]; i++;
      }
      if (i < line.length) { out += line[i]; i++; }
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; out += ch; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth--; out += ch; i++; continue;
    }
    if (depth === 0 && ch === ",") break;
    out += ch; i++;
  }
  return out;
}

/** Entfernt alle t(…)-Aufrufe (klammer-balanciert, auch verschachtelt) aus einem Text-Schnipsel
 *  — was danach übrig bleibt, ist der Teil, der NICHT über die Sprachschicht lief. */
function stripTCalls(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const m = /\bt\(/.exec(rest);
    if (!m) { out += rest; break; }
    out += rest.slice(0, m.index);
    let depth = 1;
    let j = i + m.index + m[0].length;
    while (j < text.length && depth > 0) {
      const ch = text[j];
      if (ch === "\"" || ch === "'" || ch === "`") {
        const quote = ch; j++;
        while (j < text.length && text[j] !== quote) { if (text[j] === "\\") j++; j++; }
        j++; continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      j++;
    }
    i = j;
  }
  return out;
}

/** true, wenn im übergebenen Argument-Text (nach Entfernen aller t(…)-Aufrufe) noch ein
 *  String-/Template-Literal mit mindestens einem Buchstaben übrig ist. */
function hasUntranslatedLiteral(argText: string): boolean {
  const stripped = stripTCalls(argText);
  const literalRe = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(stripped))) {
    const raw = m[0];
    let content = raw.slice(1, -1);
    // Template-Literale: ${…}-Interpolationen sind Code (Bezeichner tragen Buchstaben),
    // kein statischer Text — vor dem Buchstaben-Test entfernen, sonst meldet z.B.
    // `+ ${preset.label}` einen Fund allein wegen "preset"/"label" im Bezeichnernamen.
    if (raw[0] === "`") content = content.replace(/\$\{[^{}]*\}/g, "");
    if (/\p{L}/u.test(content)) return true;
  }
  return false;
}

/** Prüft eine einzelne Quelldatei auf Text-Senken, die ein String-/Template-Literal ohne
 *  t()-Aufruf erreichen. Wiederverwendbar für weitere Dateien/Slices — einfach den Pfad
 *  wechseln bzw. über mehrere Pfade mappen. */
export function findUntranslatedSinks(filePath: string): SinkFinding[] {
  const src = readFileSync(filePath, "utf8");
  const findings: SinkFinding[] = [];
  src.split("\n").forEach((line, idx) => {
    const lineNo = idx + 1;
    const trimmed = line.trim();
    if (/^(?:\/\/|\*)/.test(trimmed)) return;
    if (line.includes(EXEMPT_MARKER)) return;

    const args: string[] = [];
    for (const m of line.matchAll(CALL_SINKS)) args.push(readBalancedCall(line, m.index! + m[0].length));
    for (const m of line.matchAll(ATTR_SINKS)) args.push(readBalancedCall(line, m.index! + m[0].length));
    for (const m of line.matchAll(SETATTR_SINKS)) args.push(readBalancedCall(line, m.index! + m[0].length));
    for (const m of line.matchAll(PROP_SINKS)) args.push(readBalancedProp(line, m.index! + m[0].length));

    if (args.some(hasUntranslatedLiteral)) findings.push({ file: filePath, line: lineNo, text: trimmed });
  });
  return findings;
}

/** Prüft mehrere Dateien in einem Rutsch — für spätere Slices, die dieselbe Prüfung über
 *  mehr als eine Datei brauchen. */
export function findUntranslatedSinksIn(filePaths: string[]): SinkFinding[] {
  return filePaths.flatMap(findUntranslatedSinks);
}
