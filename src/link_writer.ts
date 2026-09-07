// wikilinkFor uebernommen aus mailstone/src/core/render/wikilink.ts, 2026-09-07 (angepasst: strippt .md, setzt Alias)
//
// Reine Textfunktionen, die einen Wikilink in eine Notiz einfuegen — obsidian-frei, damit
// jeder Fall in Node testbar ist. Die Datei-I/O liegt in main.ts (VaultAdapter).

export type WriteResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; reason: "unlinkable" | "block-scalar" | "not-a-list" | "frontmatter-unparseable" };

/** Obsidian kennt in `[[…]]` keine Fluchtsymbole: `[`/`]` verschachteln, `#` beginnt eine
 *  Ueberschriftsreferenz, `^` eine Blockreferenz, `|` den Anzeigetext. Ein Pfad mit einem
 *  dieser Zeichen ergibt keinen kaputten Link, sondern einen auf etwas ANDERES. */
const BRICHT_WIKILINK = /[[\]#^|]/;

export function linkTargetOf(path: string): string {
  return path.replace(/\.md$/i, "");
}

function basenameOf(target: string): string {
  return target.split("/").pop() ?? target;
}

export function wikilinkFor(path: string): string | null {
  if (path === "" || BRICHT_WIKILINK.test(path)) return null;
  const target = linkTargetOf(path);
  return `[[${target}|${basenameOf(target)}]]`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Link auf `path` in `text` — voller Pfad oder nackter Basename, jeweils optional mit
 *  `#Ueberschrift` und/oder `|Alias`. */
export function containsLink(text: string, path: string): boolean {
  const target = linkTargetOf(path);
  const alts = [escapeRe(target), escapeRe(basenameOf(target))].join("|");
  return new RegExp(`\\[\\[(?:${alts})(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`).test(text);
}

function eolOf(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function appendSectionLink(text: string, heading: string, path: string): WriteResult {
  const link = wikilinkFor(path);
  if (link === null) return { ok: false, reason: "unlinkable" };
  if (containsLink(text, path)) return { ok: true, content: text, changed: false };
  const eol = eolOf(text);
  const lines = text.split(/\r?\n/);
  const headRe = new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`);
  const start = lines.findIndex(l => headRe.test(l));
  if (start < 0) {
    const body = text.replace(/(\r?\n)*$/, "");           // genau eine Leerzeile vor dem Abschnitt
    return { ok: true, changed: true, content: `${body}${eol}${eol}## ${heading}${eol}- ${link}${eol}` };
  }
  // Block: bis zur naechsten Ueberschrift oder zum Ende; eingefuegt wird nach der letzten
  // Listenzeile des Blocks (Leerzeilen am Blockende bleiben dahinter stehen).
  let end = start + 1;
  while (end < lines.length && !/^#/.test(lines[end] ?? "")) end++;
  let insertAt = start + 1;
  for (let i = start + 1; i < end; i++) if (/^\s*-\s+/.test(lines[i] ?? "")) insertAt = i + 1;
  lines.splice(insertAt, 0, `- ${link}`);
  return { ok: true, changed: true, content: lines.join(eol) };
}

// readFm/scanEntries-Semantik uebernommen aus mailstone/src/core/merge/merge.ts, 2026-09-07
// (dort setFrontmatterField; hier auf "einen Listeneintrag anhaengen" zugeschnitten).
// Warum zeilenweise statt fileManager.processFrontMatter: die API liest den Block als YAML und
// schreibt ihn KOMPLETT neu — Kommentare weg, Formatierung fremder Felder umgeschrieben
// (mailstone, gemessen 2026-08-30). Hier bleibt jede nicht betroffene Zeile byte-identisch.
const FM_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/;
const KEY_RE = /^([A-Za-z0-9_][\w .-]*?):[ \t]*(.*)$/;
const CONT_RE = /^([ \t]|-[ \t])/;
const ITEM_RE = /^([ \t]*)-[ \t]+(.*)$/;

interface FmEntry { start: number; end: number; rest: string }

function scanEntries(lines: string[]): Map<string, FmEntry> {
  const out = new Map<string, FmEntry>();
  let i = 0;
  while (i < lines.length) {
    const kv = KEY_RE.exec(lines[i] ?? "");
    if (!kv) { i++; continue; }
    let j = i + 1;
    while (j < lines.length && CONT_RE.test(lines[j] ?? "")) j++;
    const key = (kv[1] ?? "").trim();
    if (!out.has(key)) out.set(key, { start: i, end: j, rest: (kv[2] ?? "").trim() });
    i = j;
  }
  return out;
}

function unquoteItem(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) return s.slice(1, -1);
  return s;
}

function quoteLike(sample: string, value: string): string {
  const s = sample.trim();
  if (s.startsWith("'")) return `'${value.replace(/'/g, "''")}'`;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function appendFrontmatterLink(text: string, field: string, path: string): WriteResult {
  const link = wikilinkFor(path);
  if (link === null) return { ok: false, reason: "unlinkable" };
  const m = FM_RE.exec(text);
  if (!m) {
    if (text.startsWith("---")) return { ok: false, reason: "frontmatter-unparseable" };
    const eol = eolOf(text);
    return { ok: true, changed: true, content: `---${eol}${field}:${eol}  - "${link}"${eol}---${eol}${text}` };
  }
  const open = m[1] ?? "", raw = m[2] ?? "", close = m[3] ?? "";
  const eol = eolOf(open + raw);
  const body = text.slice(m[0].length);
  const lines = raw.split(/\r?\n/);
  const entry = scanEntries(lines).get(field);
  const rebuild = (ls: string[]): WriteResult => ({ ok: true, changed: true, content: `${open}${ls.join(eol)}${close}${body}` });

  if (!entry) return rebuild([...lines, `${field}:`, `  - "${link}"`]);
  const { start, end, rest } = entry;
  if (/^[|>]/.test(rest)) return { ok: false, reason: "block-scalar" };

  if (rest.startsWith("[") && rest.endsWith("]")) {
    const inner = rest.slice(1, -1).trim();
    if (inner === "") return rebuild([...lines.slice(0, start), `${field}:`, `  - "${link}"`, ...lines.slice(end)]);
    if (containsLink(inner, path)) return { ok: true, content: text, changed: false };
    const sample = inner.split(",").pop() ?? "";
    return rebuild([...lines.slice(0, start), `${field}: [${inner}, ${quoteLike(sample, link)}]`, ...lines.slice(end)]);
  }
  if (rest !== "") return { ok: false, reason: "not-a-list" };

  const items = lines.slice(start + 1, end);
  if (items.length === 0) return rebuild([...lines.slice(0, start), `${field}:`, `  - "${link}"`, ...lines.slice(end)]);
  if (items.some(l => containsLink(unquoteItem((ITEM_RE.exec(l)?.[2]) ?? ""), path))) return { ok: true, content: text, changed: false };
  let indent = "  ", sample = '"';
  let firstIndent = "  ";
  let foundNonEmpty = false;
  for (const l of items) {
    const im = ITEM_RE.exec(l);
    if (!im) continue;
    if (!foundNonEmpty) firstIndent = im[1] ?? firstIndent;
    if ((im[2] ?? "").trim() !== "") {
      indent = im[1] ?? indent;
      sample = im[2] ?? sample;
      foundNonEmpty = true;
    }
  }
  if (!foundNonEmpty) indent = firstIndent;
  return rebuild([...lines.slice(0, end), `${indent}- ${quoteLike(sample, link)}`, ...lines.slice(end)]);
}
