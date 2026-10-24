// vendored from code-kit@0.36.0, src/ts/pure/probe-core.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/scripts/probe_core.ts (rang, auswahlReihenfolge, vergleicheLaeufe) und index-probe.ts (Kandidatenregel), 2026-10-17; Gleichstand nach UTF-16 statt localeCompare
import { stripFrontmatter } from "./chunker";

/**
 * Core of the self-find probe: pick a stable, scattered sample of notes, query the index with each note's own text,
 * and compare two runs over the same notes. Everything that does not have to run inside the host lives here, as
 * plain testable code; reading notes and asking the index stay with the caller.
 */

/** Default seed of the probe (the day of its first run). */
export const PROBE_SEED = 20260903;
/** Default sample size. */
export const PROBE_N = 40;

/** A candidate file as the host lists it. */
export interface ProbeFile { path: string; mtime: number }

/**
 * Deterministic rank of a path: FNV-1a over `<seed>:<path>` on UTF-16 code units. The value depends ONLY on path and
 * seed, never on the other files — the old Fisher-Yates drew `j = seed % (i + 1)`, so one extra note shifted the whole
 * selection and two runs before and after a reindex shared no note at all (2026-09-05).
 */
export function probeRank(path: string, seed: number): number {
  let h = 0x811c9dc5;
  const s = `${seed}:${path}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Sorts by `rank(path)` ascending; equal ranks fall back to UTF-16 code unit order of the path (never
 *  `localeCompare`: that depends on the host's locale, a port in another language could not reproduce it). Does not
 *  mutate its input. Exported so the tie-break is testable. */
export function sortByRankThenPath<T extends { path: string }>(files: readonly T[], rank: (path: string) => number): T[] {
  return [...files].sort((a, b) => {
    const d = rank(a.path) - rank(b.path);
    if (d !== 0) return d;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** All files in stable, scattered order. The caller takes as many as it needs — when the vault grows, new notes slot
 *  between the old ones instead of reshuffling them. */
export function probeOrder<T extends { path: string }>(files: readonly T[], seed: number): T[] {
  return sortByRankThenPath(files, (p) => probeRank(p, seed));
}

/**
 * The query for one note, or `null` when the note is not a candidate: the body (frontmatter stripped, trimmed) must
 * not be empty, and unless `strict` its length must lie in the window 200 < len <= 800. The query is the first 300
 * UTF-16 units of the body.
 */
export function probeQuery(text: string, opts: { strict?: boolean } = {}): string | null {
  const body = stripFrontmatter(text).trim();
  if (body.length === 0) return null;
  if (!opts.strict && (body.length <= 200 || body.length > 800)) return null;
  return body.slice(0, 300);
}

/** One measured self-find attempt — the row `--json` writes per note. */
export interface ProbeAttempt {
  path: string;
  rank: number;
  score: number | null;
  topScore: number | null;
  top: string | null;
  mtime: number;
}

export interface RunComparison {
  shared: number;
  healed: ProbeAttempt[];
  worsened: ProbeAttempt[];
  unchanged: number;
  missing: string[];
}

/**
 * Pair comparison of two runs over the SAME notes. Only this supports "the reindex helped": two runs with the same
 * seed are otherwise two independent samples. The RANK is compared, not the score — rank 0 is the expected value and
 * fixed beforehand. `missing` is the honesty condition: a note absent from the second run must not fall silently out
 * of the balance, or a shrunken comparison looks like a clean one.
 */
export function compareRuns(previous: readonly ProbeAttempt[], next: readonly ProbeAttempt[]): RunComparison {
  const nextByPath = new Map(next.map((v) => [v.path, v]));
  const r: RunComparison = { shared: 0, healed: [], worsened: [], unchanged: 0, missing: [] };
  for (const a of previous) {
    const n = nextByPath.get(a.path);
    if (!n) { r.missing.push(a.path); continue; }
    r.shared++;
    if (a.rank !== 0 && n.rank === 0) r.healed.push(n);
    else if (a.rank === 0 && n.rank !== 0) r.worsened.push(n);
    else r.unchanged++;
  }
  return r;
}
