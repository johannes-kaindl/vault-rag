export interface Chunk {
  text: string;
  startOffset: number;
  endOffset: number;
}

const FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n/;

export function chunkMarkdown(
  text: string,
  maxChars = 800,
  overlap = 150
): Chunk[] {
  const trimmed = text.replace(FRONTMATTER_RE, "").trim();
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

  while (curStart < trimmed.length) {
    const targetEnd = curStart + maxChars;
    const headingsInRange = positions.filter(p => p > curStart && p <= targetEnd);

    // Prefer headings >= minChunkSize from curStart; fall back to any heading in range
    const goodHeadings = headingsInRange.filter(p => p - curStart >= minChunkSize);
    let curEnd: number;
    let atHeading: boolean;
    if (goodHeadings.length > 0) {
      curEnd = Math.max(...goodHeadings);
      atHeading = true;
    } else if (headingsInRange.length > 0) {
      curEnd = Math.max(...headingsInRange);
      atHeading = posSet.has(curEnd);
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
