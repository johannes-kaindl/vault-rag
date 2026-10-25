// vendored from code-kit@0.37.3, src/ts/pure/chunker.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/chunker.ts, 2026-10-11 (Änderungen: `FRONTMATTER_RE` durch den linearen `stripFrontmatter` ersetzt, `noUncheckedIndexedAccess`-clean; Ergebnis unverändert). 0.27.1: die Heading-Suche läuft mit einem Zeiger statt eines `filter` über alle Positionen je Chunk (linear; Ergebnis unverändert, Differentialtest gegen die Fassung 0.27.0)
/** Splits Markdown into overlapping chunks for embedding: frontmatter off, a cut preferably at a heading, after a
 *  hard cut an overlap for continuity. Offsets refer to the text AFTER `stripFrontmatter` and `trim`.
 *
 *  Origin: vault-rag's indexer (embedding unit, 800 characters, 150 overlap). */
export interface Chunk {
  text: string;
  startOffset: number;
  endOffset: number;
}

const WS = /\s/;
const isWs = (s: string, i: number): boolean => WS.test(s.charAt(i));

/** End of the line break that closes a `---` run: after the three dashes at `from - 3` a run of whitespace that holds
 *  at least one `\n`; the match takes everything up to the LAST `\n` of the run (`\s*\n`, greedy). -1 if the run has none. */
function closeEnd(text: string, from: number): number {
  let last = -1;
  for (let i = from; i < text.length && isWs(text, i); i++) if (text.charCodeAt(i) === 10) last = i;
  return last < 0 ? -1 : last + 1;
}

/** `text` without a leading YAML frontmatter block — exactly what `text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "")`
 *  returned, without its cost: that expression is quadratic on `---` followed by many line breaks (measured
 *  2026-10-11: 10 000 → 20 ms, 50 000 → 513 ms, and it ran on every edit of such a note). Tested against the regex over
 *  every string of up to seven pieces from `---`, `\n`, blank, `\r` and a letter.
 *
 *  How the regex decided, which this follows: the opening `---` is followed by whitespace that holds a line break; the
 *  greedy `\s*` first tries the LAST line break of that run as the end of the opening line, so the body starts after it
 *  and the closing `\n---` must lie after it. Only when no closing line is found that way does it fall back to an
 *  earlier line break, and the one closing line that can then still match is the last line break of the run itself
 *  (`---\n\n---\nBody`). `---\n---\nBody` is therefore not frontmatter. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  let lastNl = -1;
  let nlCount = 0;
  for (let i = 3; i < text.length && isWs(text, i); i++) {
    if (text.charCodeAt(i) === 10) { lastNl = i; nlCount++; }
  }
  if (nlCount === 0) return text;
  // The closing line: the earliest `\n---` after the opening line whose dashes are followed by whitespace with a `\n`.
  for (let from = lastNl + 1; ; ) {
    const c = text.indexOf("\n---", from);
    if (c < 0) break;
    const end = closeEnd(text, c + 4);
    if (end >= 0) return text.slice(end);
    from = c + 1;
  }
  // Fallback of the backtracking: the closing line is the last line break of the opening run (needs an earlier one to open).
  if (nlCount >= 2 && text.startsWith("---", lastNl + 1)) {
    const end = closeEnd(text, lastNl + 4);
    if (end >= 0) return text.slice(end);
  }
  return text;
}

export function chunkMarkdown(
  text: string,
  maxChars = 800,
  overlap = 150
): Chunk[] {
  const trimmed = stripFrontmatter(text).trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [{ text: trimmed, startOffset: 0, endOffset: trimmed.length }];

  const headingRe = /^#{1,6}\s+/gm;
  const posSet = new Set<number>([0, trimmed.length]);
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(trimmed)) !== null) posSet.add(m.index);
  const positions = [...posSet].sort((a, b) => a - b);

  const minChunkSize = Math.max(maxChars - overlap, Math.floor(maxChars / 2));
  const chunks: Chunk[] = [];
  let curStart = 0;
  // Index of the first position after `curStart`. `curStart` only grows (every branch below ends in a start that is larger),
  // so the index only moves forward and the search costs the positions inside the window, not all of them: 0.22.0–0.27.0
  // filtered the whole list for every chunk (headings × chunks, 20× the time for 5× the headings).
  let lo = 0;

  while (curStart < trimmed.length) {
    const targetEnd = curStart + maxChars;
    while (lo < positions.length && (positions[lo] ?? 0) <= curStart) lo++;
    // The positions are sorted, so the last one in the window is the largest. 0.27.0 chose "the largest of those at least
    // `minChunkSize` away from `curStart`, else the largest in the window": whenever one of them is far enough, the largest
    // is (it is the farthest), so both branches name the same position — and every position is in `posSet`, so `atHeading`
    // was `true` in both. Differential-tested against that version (tests/chunker.test.ts). The `Math.max(...)` over the
    // window is gone with the filters.
    let lastInRange = -1;
    for (let k = lo; k < positions.length; k++) {
      const p = positions[k] ?? 0;
      if (p > targetEnd) break;
      lastInRange = p;
    }
    let curEnd: number;
    let atHeading: boolean;
    if (lastInRange >= 0) {
      curEnd = lastInRange;
      atHeading = true;
    } else {
      curEnd = Math.min(targetEnd, trimmed.length);
      atHeading = false;
    }

    if (curEnd <= curStart) curEnd = Math.min(curStart + maxChars, trimmed.length);

    const chunkText = trimmed.slice(curStart, curEnd).trim();
    if (chunkText) chunks.push({ text: chunkText, startOffset: curStart, endOffset: curEnd });
    if (curEnd >= trimmed.length) break;

    // At a heading boundary: next chunk starts at the heading (clean break, no overlap)
    // After a hard split: use overlap for continuity
    curStart = atHeading ? curEnd : Math.max(curEnd - overlap, curStart + minChunkSize);
  }
  return chunks;
}
