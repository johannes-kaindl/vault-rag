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
export function parseTable(md: string): string[][] | null {
  const lines = md.trim().split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return null;
  if (!lines.every(l => l.includes("|"))) return null;
  const rows = lines.map(splitCells);
  if (!isDelimiterRow(rows[1])) return null;
  const matrix = [rows[0], ...rows.slice(2)];
  const width = Math.max(...matrix.map(r => r.length));
  return matrix.map(r => { const c = [...r]; while (c.length < width) c.push(""); return c; });
}

function renderTable(matrix: string[][]): string {
  const header = matrix[0];
  const body = matrix.slice(1);
  const headerLine = `| ${header.join(" | ")} |`;
  const delim = `| ${header.map(() => "---").join(" | ")} |`;
  const bodyLines = body.map(r => `| ${r.join(" | ")} |`);
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

/** Wandelt eine Tabelle in eine Liste: pro Datenzeile ein Punkt mit Header:Wert-Paaren. null bei Nicht-Tabelle. */
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

/** Packt beliebigen Text in einen Obsidian-Callout `> [!type]`. Immer erfolgreich. */
export function wrapInCallout(md: string, type: string): string {
  const body = md.split("\n").map(l => `> ${l}`).join("\n");
  return `> [!${type}]\n${body}`;
}
