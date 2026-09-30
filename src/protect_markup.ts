// uebernommen aus wikijs-maintainer/src/core/links.ts, 2026-09-30 (Wikilink-/Embed-Regex, Embed zuerst)
//
// Schutz geschuetzter Markdown-Stellen beim LLM-Umformulieren (Welle 14).
//
// Ein Modell, das Text umformt, verletzt Wikilinks gern: es uebersetzt das Ziel, klammert um,
// loest `[[A|B]]` in Fliesstext auf. Zwei Schichten, nur die zweite ist die Sicherung:
//  1. `maskProtected` ersetzt Links, Embeds, Inline-Code und Codebloecke durch Platzhalter, die
//     das Modell unveraendert zurueckgeben soll — das verbessert die Quote.
//  2. `compareLinks` / `integrityProblem` zaehlen nach dem Lauf die Links des Ergebnisses gegen
//     die des Originals. Weicht etwas ab, sperrt der Aufrufer „Anwenden“. Ein Modell kann auch
//     einen Platzhalter weglassen oder erfinden, darum traegt nur die Zaehlung.
//
// Rein: keine obsidian-Importe, nur Text rein, Text/Zahlen raus. Texte entstehen erst an der
// Anzeigestelle (Codes statt Sprache, i18n Teil 3).

export interface RestoreResult {
  text: string;
  /** Platzhalter, die im Modell-Ergebnis fehlten (Link oder Code ist verschwunden). */
  lost: number;
}

export interface Masked {
  masked: string;
  restore: (modelOutput: string) => RestoreResult;
}

export interface LinkComparison {
  ok: boolean;
  /** Ziele, die im Original standen und im Ergebnis fehlen. */
  missing: string[];
  /** Ziele, die im Ergebnis stehen und im Original nicht. */
  added: string[];
}

export interface IntegrityProblem {
  missing: number;
  added: number;
  lost: number;
}

const TOKEN_PREFIX = "ZQX";
const TOKEN_SUFFIX = "QXZ";
const TOKEN_RE = /ZQX(\d+)QXZ/g;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)(?!`)([^\n]*?[^`\n])\1(?!`)/g;
const EMBED = /!\[\[([^\]]+)\]\]/g;
const WIKILINK = /\[\[([^\]]+)\]\]/g;

/** Wendet `fn` auf jeden Codeblock an (Zeilen von Zaun bis passendem Zaun oder Textende) und
 *  liefert den Text mit dem Rueckgabewert an dieser Stelle. */
function replaceFences(text: string, fn: (block: string) => string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i] ?? "");
    if (!open) { out.push(lines[i] ?? ""); i++; continue; }
    const fence = open[1] ?? "```";
    const char = fence[0] ?? "`";
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      const t = (lines[j] ?? "").trimStart();
      if (t.startsWith(char.repeat(fence.length)) && /^[`~]+\s*$/.test(t)) { closed = true; break; }
      j++;
    }
    const end = closed ? j : lines.length - 1;
    out.push(fn(lines.slice(i, end + 1).join("\n")));
    i = end + 1;
  }
  return out.join("\n");
}

/** Text ohne Code — Links darin sind Inhalt, keine Links. */
function stripCode(text: string): string {
  return replaceFences(text, () => "").replace(INLINE_CODE, "");
}

/** Normalisierte Link-Ziele in Textreihenfolge: `Ziel` bzw. `Ziel#Ueberschrift`, Embeds mit `!`.
 *  Der Alias nach `|` gehoert nicht zum Ziel — ein anderer Anzeigetext zerstoert keinen Link. */
export function extractLinks(text: string): string[] {
  const src = stripCode(text);
  const found: { index: number; key: string }[] = [];
  const rest = src.replace(EMBED, (m, inner: string, offset: number) => {
    found.push({ index: offset, key: "!" + (inner.split("|")[0] ?? "").trim() });
    return " ".repeat(m.length);
  });
  rest.replace(WIKILINK, (m, inner: string, offset: number) => {
    found.push({ index: offset, key: (inner.split("|")[0] ?? "").trim() });
    return m;
  });
  return found.sort((a, b) => a.index - b.index).map(f => f.key);
}

export function countWikilinks(text: string): number {
  return extractLinks(text).length;
}

/** Ersetzt geschuetzte Stellen durch nummerierte Platzhalter (`ZQX1QXZ`: nur Grossbuchstaben
 *  und Ziffern, damit Markdown nichts daran deutet). Steckt die Platzhalter-Form schon im Text,
 *  wird NICHT maskiert — ein Verwechseln waere schlimmer als ein Lauf ohne Maske; die Zaehlung
 *  deckt den Fall trotzdem ab. */
export function maskProtected(text: string): Masked {
  if (text.includes(TOKEN_PREFIX) && new RegExp(TOKEN_RE.source).test(text)) {
    return { masked: text, restore: (out) => ({ text: out, lost: 0 }) };
  }
  const originals: string[] = [];
  const hide = (original: string): string => {
    originals.push(original);
    return `${TOKEN_PREFIX}${originals.length - 1}${TOKEN_SUFFIX}`;
  };
  let masked = replaceFences(text, hide);
  masked = masked.replace(INLINE_CODE, (m) => hide(m));
  masked = masked.replace(EMBED, (m) => hide(m));
  masked = masked.replace(WIKILINK, (m) => hide(m));

  return {
    masked,
    restore: (out) => {
      const seen = new Set<number>();
      const restored = out.replace(TOKEN_RE, (m, d: string) => {
        const n = Number(d);
        const original = originals[n];
        if (original === undefined) return m;
        seen.add(n);
        return original;
      });
      return { text: restored, lost: originals.length - seen.size };
    },
  };
}

/** Vergleicht die Link-Ziele zweier Texte als Mehrfachmenge (Reihenfolge und Alias egal). */
export function compareLinks(original: string, result: string): LinkComparison {
  const pool = new Map<string, number>();
  for (const k of extractLinks(original)) pool.set(k, (pool.get(k) ?? 0) + 1);
  const added: string[] = [];
  for (const k of extractLinks(result)) {
    const n = pool.get(k) ?? 0;
    if (n > 0) pool.set(k, n - 1);
    else added.push(k);
  }
  const missing: string[] = [];
  for (const [k, n] of pool) for (let i = 0; i < n; i++) missing.push(k);
  return { ok: missing.length === 0 && added.length === 0, missing, added };
}

/** null, wenn nichts Geschuetztes verloren ging; sonst Zahlen fuer die Anzeige. */
export function integrityProblem(original: string, result: string, lost: number): IntegrityProblem | null {
  const c = compareLinks(original, result);
  if (c.ok && lost === 0) return null;
  return { missing: c.missing.length, added: c.added.length, lost };
}
