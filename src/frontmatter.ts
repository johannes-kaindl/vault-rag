// frontmatter.ts — yaml_lite: flat scalars + simple lists only. No obsidian import.

export type FmValue = string | string[];
export type Confidence = "hoch" | "mittel" | "niedrig";
export type FmSource = "content" | "empty" | "inferred";
export interface FmAssignedValue { source: FmSource; value: string; confidence?: Confidence }
export interface ParsedFrontmatter { data: Record<string, FmValue>; order: string[]; body: string; comments?: Record<string, string> }
export type FmChange = "unveraendert" | "geaendert" | "neu" | "entfernt";
export interface FmRow { key: string; original?: FmValue; proposed?: FmValue; change: FmChange; source?: FmSource; confidence?: Confidence }

// Matches "---\n<block>\n---\n" at the very start of a document.
const DELIM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    const inner = s.slice(1, -1);
    return s[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  return s;
}

function parseInlineList(raw: string): string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (!inner) return [];
  // Tokenize respecting single- and double-quoted substrings so that a comma
  // inside a quoted element does NOT split the token.
  const tokens: string[] = [];
  let cur = "";
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '"' || ch === "'") {
      // Consume the entire quoted span including escape sequences.
      const q = ch;
      cur += ch;
      i++;
      while (i < inner.length) {
        const c = inner[i];
        if (q === '"' && c === '\\' && i + 1 < inner.length) {
          cur += c + inner[i + 1];
          i += 2;
        } else if (q === "'" && c === "'" && i + 1 < inner.length && inner[i + 1] === "'") {
          cur += "''";
          i += 2;
        } else if (c === q) {
          cur += c;
          i++;
          break;
        } else {
          cur += c;
          i++;
        }
      }
    } else if (ch === ",") {
      tokens.push(unquote(cur.trim()));
      cur = "";
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  tokens.push(unquote(cur.trim()));
  return tokens;
}

/** Trennt einen YAML-Zeilenkommentar (` #…`, außerhalb von Quotes) vom Skalar/Listen-Rest.
 *  `#` zählt nur als Kommentar mit Whitespace davor ODER am rest-Anfang (Wert leer). */
function splitComment(rest: string): { value: string; comment: string } {
  let inS = false, inD = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (inD && c === "\\" && i + 1 < rest.length) { i++; continue; }
    if (c === '"' && !inS) inD = !inD;
    else if (c === "'" && !inD) inS = !inS;
    else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(rest[i - 1]))) {
      return { value: rest.slice(0, i).trimEnd(), comment: rest.slice(i + 1).trim() };
    }
  }
  return { value: rest, comment: "" };
}

export function parseFrontmatter(text: string, opts?: { comments?: boolean }): ParsedFrontmatter {
  const extractComments = opts?.comments ?? false;
  const m = DELIM_RE.exec(text);
  if (!m) return { data: {}, order: [], body: text };
  const block = m[1];
  const body = text.slice(m[0].length);
  const data: Record<string, FmValue> = {};
  const order: string[] = [];
  const comments: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = /^([A-Za-z0-9_][\w .-]*?):[ \t]*(.*)$/.exec(line);
    if (!kv) { i++; continue; }
    const key = kv[1].trim();
    let rest = kv[2];
    if (extractComments) {
      const split = splitComment(kv[2]);
      rest = split.value;
      if (split.comment) comments[key] = split.comment;
    }
    if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
      data[key] = parseInlineList(rest);
      order.push(key);
      i++;
      continue;
    }
    if (rest.trim() === "") {
      // block list: following "- item" lines
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^[ \t]*-[ \t]+/.test(lines[j])) {
        items.push(unquote(lines[j].replace(/^[ \t]*-[ \t]+/, "")));
        j++;
      }
      if (items.length > 0) { data[key] = items; order.push(key); i = j; continue; }
      data[key] = "";
      order.push(key);
      i++;
      continue;
    }
    data[key] = unquote(rest);
    order.push(key);
    i++;
  }
  return { data, order, body, comments };
}

// Codepoints that YAML / our parser would mis-handle at scalar start.
const NEEDS_QUOTE_LEADING = /^[\s>|@`%&*!?#\-[{'"]/u;

function startsWithEmoji(s: string): boolean {
  const cp = s.codePointAt(0);
  if (cp === undefined) return false;
  // Symbols & pictographs, dingbats, misc symbols, regional indicators, etc.
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f000 && cp <= 0x1f2ff) ||
    cp === 0x2b50 || cp === 0x2705 || cp === 0x274c
  );
}

function needsQuoting(v: string): boolean {
  if (v === "") return false; // empty scalar emitted bare (key:)
  if (v !== v.trim()) return true;
  if (v.includes(": ") || v.endsWith(":")) return true;
  if (v.includes(" #") || v.includes("#")) return true;
  if (v.includes("[[") || v.includes("]]")) return true;
  if (v.includes(",")) return true; // comma would split inline-list tokenizer
  if (NEEDS_QUOTE_LEADING.test(v)) return true;
  if (startsWithEmoji(v)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(v)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) return true;
  return false;
}

function quoteScalar(v: string): string {
  if (!needsQuoting(v)) return v;
  return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function serializeValue(v: FmValue): string {
  if (Array.isArray(v)) return "[" + v.map(quoteScalar).join(", ") + "]";
  return v === "" ? "" : quoteScalar(v);
}

export function serializeFrontmatter(data: Record<string, FmValue>, order: string[]): string {
  const lines: string[] = ["---"];
  for (const key of order) {
    if (!(key in data)) continue;
    const ser = serializeValue(data[key]);
    lines.push(ser === "" ? `${key}:` : `${key}: ${ser}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

function isEmptyValue(v: FmValue | undefined): boolean {
  if (v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  return v.trim() === "";
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

function valueEquals(a: FmValue | undefined, b: FmValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [a];
    const bb = Array.isArray(b) ? b : [b];
    return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
  }
  return a === b;
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

export function assertParseable(fm: { data: Record<string, FmValue>; order: string[] }): void {
  const out = serializeFrontmatter(fm.data, fm.order);
  const reparsed = parseFrontmatter(out + " BODY ");
  if (reparsed.body !== " BODY ") {
    throw new Error("Frontmatter-Self-Check: Body-Delimiter nicht reparse-stabil");
  }
  for (const key of fm.order) {
    if (!valueEquals(fm.data[key], reparsed.data[key])) {
      throw new Error(`Frontmatter-Self-Check: Key "${key}" nicht reparse-stabil`);
    }
  }
  for (const key of Object.keys(reparsed.data)) {
    if (!fm.order.includes(key)) {
      throw new Error(`Frontmatter-Self-Check: unerwarteter Key "${key}" nach Reparse`);
    }
  }
}
