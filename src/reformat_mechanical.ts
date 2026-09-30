// Reine Markdown-Struktur-Transforms (kein obsidian, in Node testbar).

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, "|"));
}

function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every(c => /^:?-{1,}:?$/.test(c.replace(/\s/g, "")));
}

/** Parst eine Markdown-Tabelle in eine Matrix (Header + Datenzeilen, ohne Delimiter-Zeile).
 *  null, wenn der Text keine Tabelle mit Delimiter-Zeile ist. Ragged rows werden aufgefüllt. */
function parseTable(md: string): string[][] | null {
  const lines = md.trim().split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return null;
  if (!lines.every(l => l.includes("|"))) return null;
  const rows = lines.map(splitCells);
  if (!isDelimiterRow(rows[1])) return null;
  const matrix = [rows[0], ...rows.slice(2)];
  const width = Math.max(...matrix.map(r => r.length));
  return matrix.map(r => { const c = [...r]; while (c.length < width) c.push(""); return c; });
}

/** Re-escaped `|` → `\|`, damit ein Zellinhalt mit einem literalen Pipe nicht als zusätzliche
 *  Spaltengrenze gelesen wird (splitCells entschärft beim Parsen — hier muss symmetrisch
 *  wieder escaped werden, sonst bricht das Tabellen-Grid). */
function escapeCell(cell: string): string {
  return cell.replace(/\|/g, "\\|");
}

function renderTable(matrix: string[][]): string {
  const header = matrix[0];
  const body = matrix.slice(1);
  const headerLine = `| ${header.map(escapeCell).join(" | ")} |`;
  const delim = `| ${header.map(() => "---").join(" | ")} |`;
  const bodyLines = body.map(r => `| ${r.map(escapeCell).join(" | ")} |`);
  return [headerLine, delim, ...bodyLines].join("\n");
}

/** Kippt eine Markdown-Tabelle (Spalten↔Zeilen). null bei Nicht-Tabelle. */
export function transposeTable(md: string): string | null {
  const m = parseTable(md);
  if (!m) return null;
  const cols = m[0].length;
  const transposed: string[][] = [];
  for (let c = 0; c < cols; c++) transposed.push(m.map(row => row[c] ?? ""));
  return renderTable(transposed);
}

/** Wandelt eine Tabelle in eine Liste: pro Datenzeile ein Punkt mit Header:Wert-Paaren. null bei Nicht-Tabelle.
 *  Bewusst KEIN escapeCell hier (anders als renderTable): ein literales `|` im Listen-Output ist
 *  nicht strukturzerstörend — es ist Fließtext hinter einem `-`, keine Tabellen-Spaltengrenze —
 *  und escaping würde nur sichtbare `\|` in der Liste erzeugen, wo ein einfaches `|` genauso
 *  lesbar und korrekt ist. Geprüft, nicht übersehen. */
export function tableToList(md: string): string | null {
  const m = parseTable(md);
  if (!m) return null;
  const header = m[0];
  const body = m.slice(1);
  if (body.length === 0) return null;
  return body.map(row =>
    "- " + header.map((h, i) => `**${h}:** ${row[i] ?? ""}`).join(" · "),
  ).join("\n");
}

export interface SelectionAffix { lead: string; core: string; trail: string }

/** Zerlegt eine Auswahl in erhaltenswerten Rand-Whitespace und den zu transformierenden Kern.
 *  `lead` behält nur den Zeilenumbruch-Anteil (ein reiner Spalten-Einzug gehört zum Kern,
 *  sonst würde er nur an die erste Ergebniszeile geklebt). */
export function splitSelectionAffix(text: string): SelectionAffix {
  const rawLead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  const lead = rawLead.slice(0, rawLead.lastIndexOf("\n") + 1);
  const core = text.slice(lead.length, text.length - trail.length);
  return { lead, core, trail };
}

// Die Block-Start-Marker stammen aus obsidian-transmute/src/core/presets/remove-newlines.ts
// (uebernommen 2026-09-30): eine Zeile, die so beginnt, wird weder an die davor noch an die
// danach gezogen. Dort als Regex ohne Zustand, hier zeilenweise MIT Fence-Zustand — die
// Regex-Fassung kennt ihre Grenze selbst: Zeilen zwischen zwei Zaeunen wuerden zusammengezogen.
const BLOCK_START = /^ {0,3}(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\||```|~~~|\$\$|([-*_])\1{2,}\s*$)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Zwei Leerzeichen oder ein Backslash am Zeilenende sind ein gewollter Umbruch. */
function endsWithHardBreak(line: string): boolean {
  return / {2,}$/.test(line) || line.endsWith("\\");
}

/** Fuehrt weich umgebrochene Zeilen eines Absatzes zu einer Zeile zusammen (ein Leerzeichen).
 *  Unberuehrt bleiben: Leerzeilen (Absatzgrenzen), Ueberschriften, Listen, Zitate, Tabellen,
 *  Trennlinien, eingerueckter Code, Zeilen in Codebloecken und `$$`-Formeln, harte Umbrueche.
 *  Konservativ wie die Vorlage: eine Zeile mit Block-Start nimmt keine Folgezeile auf, auch
 *  nicht die umgebrochene Fortsetzung eines Listenpunkts. null, wenn nichts zusammenzuziehen
 *  war (Struktur passt nicht — dieselbe Zusage wie bei den anderen mechanischen Transforms). */
export function removeLineBreaks(md: string): string | null {
  const out: string[] = [];
  let fence: string | null = null;
  let changed = false;
  let mergeable = false;
  for (const line of md.split("\n")) {
    if (fence !== null) {
      out.push(line);
      const t = line.trim();
      if (fence === "$$" ? t === "$$" : (t.startsWith(fence) && /^[`~]+$/.test(t))) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) { fence = open[1] ?? null; out.push(line); mergeable = false; continue; }
    if (line.trim() === "$$") { fence = "$$"; out.push(line); mergeable = false; continue; }
    if (line.trim() === "" || BLOCK_START.test(line) || /^(?: {4}|\t)/.test(line)) {
      out.push(line);
      mergeable = false;
      continue;
    }
    if (mergeable) {
      out[out.length - 1] = (out[out.length - 1] ?? "").trimEnd() + " " + line.trimStart();
      changed = true;
    } else {
      out.push(line);
    }
    mergeable = !endsWithHardBreak(line);
  }
  return changed ? out.join("\n") : null;
}
