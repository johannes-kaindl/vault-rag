// vendored from code-kit@0.37.5, src/ts/pure/markdown-table.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Text that stands in a Markdown table cell: what is written around it and what is done to it.
 *
 *  Two different jobs that five local versions did under one name, measured 2026-10-18:
 *
 *  - {@link escapeTableCell} / {@link renderMarkdownTable} — **lossless**. A cell is the caller's own content (a table being
 *    reformatted, an export): the only thing that must change is a `|`, which would split the cell in two and give the row more
 *    columns than the head. Links, code, entities stay. Taken from health-vitals `src/core/serialize.ts` (`escapeCell`,
 *    `toMarkdownTable`) and vault-rag `src/reformat_mechanical.ts` (`escapeCell`, `renderTable`), which hold the same lines (health-vitals says it took them from vault-rag).
 *  - {@link neutralizeCellText} — **lossy, for foreign text** (a payee, a purpose line from a bank): control characters and line
 *    breaks become one space, `[`, `]` and `` ` `` are removed, `<` and `>` become entities, and the pipe is escaped. Taken from
 *    finance-ledger `core/notes/wikilinks.ts` (`anzeigeSicher`, with the pipe only `forTable`), `dimensionNotes.ts` and
 *    `mandatNotes.ts` (`tabellenText`, both identical to it).
 *
 *  Why the second removes brackets instead of escaping them: text from outside must not be able to *become* anything — a
 *  `[[wikilink]]` or an embed `![[file]]` that points at a note of the user's, a `[text](url)` link, a code span. Escaping would
 *  keep the characters and, in Obsidian's source view and in anything that does not read the backslash, show them; removing them
 *  leaves nothing to interpret. The price is a name with a bracket in it losing it; on ordinary names the result is unchanged
 *  (the finance-ledger comment says the same of its Python original, which wrote names raw). `&` is left alone, so a text
 *  that already says `&lt;` still says `&lt;`.
 *
 *  What neither does, as none of the five did: a `\` in front of a `|` (`a\|b` becomes `a\\|b`, which a GFM reader may take as an
 *  escaped backslash and a column split); a line break in {@link escapeTableCell}'s input (the caller keeps cells to one line);
 *  zero-width and bidirectional-override characters (`U+200B`, `U+202E` are format characters, not control characters, and pass
 *  {@link neutralizeCellText}); `#tag` in a cell, which Obsidian reads as a tag. A caller that has to defend against those does
 *  it before or after; this module keeps the behaviour all five agreed on.
 *
 *  Pure, no I/O; linear in the length of the text. */

/** Escapes the one character that breaks a table row: `|` becomes `\|`. Everything else stays as it is. */
export function escapeTableCell(cell: string): string {
  return cell.replace(/\|/g, "\\|");
}

export interface NeutralizeOptions {
  /** Default `true`: escape `|` as `\|` (the text goes into a table cell). `false`: leave it (the text goes into prose or a list). */
  escapePipe?: boolean;
}

/** Foreign text made safe to put into a table cell (or, with `escapePipe: false`, into a line of prose): runs of control
 *  characters (`\p{Cc}`, which includes `\n`, `\r`, `\t`, NUL and DEL) and the Unicode line and paragraph separators become ONE
 *  space, `[`, `]` and `` ` `` are removed, `<` becomes `&lt;`, `>` becomes `&gt;`, `|` becomes `\|`. Not idempotent on the pipe: a
 *  second pass escapes the backslash's pipe again, so call it once, on the raw text. */
export function neutralizeCellText(text: string, options: NeutralizeOptions = {}): string {
  const safe = text
    .replace(/[\p{Cc}\u2028\u2029]+/gu, " ")
    .replace(/[[\]`]/g, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return options.escapePipe === false ? safe : safe.replace(/\|/g, "\\|");
}

/** A Markdown table: the head line, a `| --- |` line with one `---` per head cell, and one line per row. Every cell goes through
 *  {@link escapeTableCell}. Rows are not padded or cut to the width of the head, and no column alignment is written; no
 *  columns give `|  |` lines. The text of a cell is the caller's: foreign text goes through {@link neutralizeCellText} first. */
export function renderMarkdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.map(escapeTableCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  return [line(headers), separator, ...rows.map(line)].join("\n");
}
