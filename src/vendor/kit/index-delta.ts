// vendored from code-kit@0.36.0, src/ts/pure/index-delta.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/index_delta.ts (computeIndexDelta, classifyChunkless, splitHealTargets), 2026-10-11 (indexDeltaReadout und healResultMessage rufen t() mit vault-rag-Schlüsseln und bleiben dort)
import { chunkMarkdown } from "./chunker";

/** The numbers behind "embedded / total notes", without the notes that can never be in the index: empty notes (nothing
 *  but frontmatter) have no chunks and so count neither as missing nor in the target — they COULD NOT land in the index
 *  (`embedNote` → null). Only the intersection missing ∩ empty counts; an empty path that is (still) in the index stays
 *  in the target. */
export function computeIndexDelta(
  vaultTotal: number,
  missing: string[],
  emptyPaths: ReadonlySet<string>,
): { embedded: number; total: number; emptyCount: number } {
  const emptyCount = missing.filter(p => emptyPaths.has(p)).length;
  const total = vaultTotal - emptyCount;
  const embedded = total - (missing.length - emptyCount);
  return { embedded, total, emptyCount };
}

/** Classifies paths as chunkless (empty / frontmatter only → nothing to embed). Unreadable files do NOT count as
 *  empty — they stay honestly in the missing delta. */
export async function classifyChunkless(
  paths: string[],
  read: (p: string) => Promise<string>,
): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    try {
      if (chunkMarkdown(await read(p)).length === 0) out.push(p);
    } catch { /* unreadable ≠ empty */ }
  }
  return out;
}

/** Splits the missing paths into work to do and paths already known to be empty: empty ones are not embedded again
 *  (`embedNote` → null is certain) and so distort neither the progress counter nor the closing message. They are
 *  classified afresh at every load; new empties among the embeddable ones are caught by `healMissing` itself
 *  (`skippedEmpty`). */
export function splitHealTargets(
  missing: string[],
  emptyPaths: ReadonlySet<string>,
): { embeddable: string[]; knownEmpty: string[] } {
  return {
    embeddable: missing.filter(p => !emptyPaths.has(p)),
    knownEmpty: missing.filter(p => emptyPaths.has(p)),
  };
}
