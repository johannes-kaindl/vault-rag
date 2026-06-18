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
  const body = text.replace(FRONTMATTER_RE, "");

  if (body.trim().length === 0) return [];
  if (body.length <= maxChars)
    return [{ text: body, startOffset: 0, endOffset: body.length }];

  const headingRe = /^#{1,6}\s+/gm;
  const positions: number[] = [0];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(body)) !== null) positions.push(m.index);
  positions.push(body.length);

  const minChunkSize = Math.max(maxChars - overlap, Math.floor(maxChars / 2));
  const chunks: Chunk[] = [];
  let curStart = 0;

  while (curStart < body.length) {
    const targetEnd = curStart + maxChars;
    // Find all headings within the target range
    const allHeadings = positions.filter(
      (p) => p > curStart && p <= targetEnd
    );

    let curEnd: number;
    if (allHeadings.length > 0) {
      // Prefer large headings that maintain minChunkSize
      const goodHeadings = allHeadings.filter(
        (p) => p - curStart >= minChunkSize
      );
      if (goodHeadings.length > 0) {
        curEnd = Math.max(...goodHeadings);
      } else {
        // Use the largest heading even if it makes a small chunk
        curEnd = Math.max(...allHeadings);
      }
    } else {
      // No heading in range, use hard split
      curEnd = Math.min(targetEnd, body.length);
    }

    if (curEnd <= curStart) curEnd = Math.min(curStart + maxChars, body.length);

    const chunkText = body.slice(curStart, curEnd).trim();
    if (chunkText) {
      chunks.push({ text: chunkText, startOffset: curStart, endOffset: curEnd });
    }
    if (curEnd >= body.length) break;

    // If current chunk ended at a heading, prefer to start the next chunk there (with overlap)
    if (positions.includes(curEnd)) {
      curStart = Math.max(curEnd - overlap, curEnd);
    } else {
      curStart = Math.max(curEnd - overlap, curStart + minChunkSize);
    }
  }
  return chunks;
}
