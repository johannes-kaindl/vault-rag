// frontmatter.ts — smart-apply-Domäne über dem Kit-Serializer.
// Parser/Serializer/Selbstcheck liegen im Kit (src/vendor/kit/frontmatter.ts) und werden
// hier re-exportiert, damit die bestehenden Importstellen unverändert bleiben.
import {
  parseFrontmatter,
  serializeFrontmatter,
  valueEquals,
  assertParseable,
} from "./vendor/kit/frontmatter";
import type { FmValue, ParsedFrontmatter } from "./vendor/kit/frontmatter";

export { parseFrontmatter, serializeFrontmatter, valueEquals, assertParseable };
export type { FmValue, ParsedFrontmatter };

export type Confidence = "hoch" | "mittel" | "niedrig";
export type FmSource = "content" | "empty" | "inferred";
export interface FmAssignedValue { source: FmSource; value: string; confidence?: Confidence }
export type FmChange = "unveraendert" | "geaendert" | "neu" | "entfernt";
export interface FmRow { key: string; original?: FmValue; proposed?: FmValue; change: FmChange; source?: FmSource; confidence?: Confidence }

function isEmptyValue(v: FmValue | undefined): boolean {
  if (v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === "";
}

export function mergeFrontmatter(
  tplKeys: string[],
  tplDefaults: Record<string, FmValue>,
  original: ParsedFrontmatter,
  llm: Record<string, FmAssignedValue>,
  opts?: { acceptInferred?: Set<string>; auditTrail?: boolean },
): { data: Record<string, FmValue>; order: string[] } {
  const data: Record<string, FmValue> = {};
  const order: string[] = [];
  const emit = (key: string, value: FmValue): void => {
    if (!(key in data)) order.push(key);
    data[key] = value;
  };
  const inferredEmitted: string[] = [];
  for (const key of tplKeys) {
    const existing = original.data[key];
    if (!isEmptyValue(existing)) { emit(key, existing); continue; }
    const a = llm[key];
    if (a && a.source === "content" && a.value.trim() !== "") { emit(key, a.value); continue; }
    if (a && a.source === "inferred" && a.value.trim() !== "" && opts?.acceptInferred?.has(key)) {
      emit(key, a.value);
      inferredEmitted.push(key);
      continue;
    }
    const def = tplDefaults[key];
    if (!isEmptyValue(def)) { emit(key, def); continue; }
    emit(key, "");
  }
  // preserve-unknown: bestehende Keys, die nicht im Template stehen, am Ende behalten
  for (const key of original.order) {
    if (key in data) continue;
    emit(key, original.data[key]);
  }
  if (opts?.auditTrail && inferredEmitted.length > 0) {
    emit("smartapply_erschlossen", inferredEmitted);
  }
  return { data, order };
}

export function diffFrontmatter(
  original: ParsedFrontmatter,
  proposed: { data: Record<string, FmValue>; order: string[] },
): FmRow[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const k of proposed.order) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  for (const k of original.order) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  const rows: FmRow[] = [];
  for (const key of keys) {
    const hasO = key in original.data;
    const hasP = key in proposed.data;
    const o = original.data[key];
    const p = proposed.data[key];
    let change: FmChange;
    if (hasO && !hasP) change = "entfernt";
    else if (!hasO && hasP) change = "neu";
    else change = valueEquals(o, p) ? "unveraendert" : "geaendert";
    rows.push({
      key,
      ...(hasO ? { original: o } : {}),
      ...(hasP ? { proposed: p } : {}),
      change,
    });
  }
  return rows;
}
