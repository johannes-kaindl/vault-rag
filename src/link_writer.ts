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
