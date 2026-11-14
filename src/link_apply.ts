// Link in eine Nutzernotiz schreiben — atomar, ohne Fenster zwischen Lesen und Schreiben. Obsidian-frei: die Ports
// (`WritePorts` aus dem Kit-Modul block-writer) kommen aus main.ts (`obsidianWritePorts`).
//
// Vorher lasen `acceptLink` und `applyLinkNow` mit `adapter.read`, rechneten und schrieben mit `adapter.write` zurück. Zwischen
// beiden liegt ein `await`: was in dieser Zeit in der Notiz geschah (ungespeicherter Editorstand, Sync, anderes Plugin), ging
// verloren, und der Hash-Guard von `acceptLink` prüfte den Stand der Berechnung, nicht den beim Schreiben. Jetzt läuft Prüfung
// UND Rechnung in `vault.process` (liest und schreibt in einem Zug) oder, bei einer im Quellmodus offenen Notiz, auf dem Stand
// des Editors (Strg+Z wirkt, kein getipptes Zeichen geht verloren).
import type { WritePorts, EditorHandle } from "./vendor/kit/block-writer";
import type { WriteResult } from "./link_writer";

export type LinkApplyOutcome =
  | { kind: "written"; content: string }
  | { kind: "unchanged"; content: string }
  | { kind: "stale" }
  | { kind: "error"; reason: "not-found" | "write-failed" | Exclude<WriteResult, { ok: true }>["reason"] };

export interface LinkApplyInput {
  path: string;
  /** Rechnet den neuen Text (reine Funktion, `writeLinkInto` in main.ts). */
  compute: (text: string) => WriteResult;
  /** Hash des Notiztexts zur Berechnungszeit (acceptLink); `null` = kein Guard (applyLinkNow). */
  expectHash: number | null;
  hash: (text: string) => number;
}

/** Position `offset` im Text als Zeile/Zeichen (UTF-16, wie CodeMirror/Obsidian). */
function posAt(text: string, offset: number): { line: number; ch: number } {
  let line = 0;
  let last = -1;
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) { line++; last = i; }
  return { line, ch: offset - (last + 1) };
}

/** Ersetzt im Editor nur die Spanne, in der `cur` und `next` sich unterscheiden: Cursor, Auswahl und Undo-Verlauf der übrigen Notiz bleiben. */
function replaceDiff(editor: EditorHandle, cur: string, next: string): void {
  let a = 0;
  const max = Math.min(cur.length, next.length);
  while (a < max && cur.charCodeAt(a) === next.charCodeAt(a)) a++;
  let b = 0;
  while (b < max - a && cur.charCodeAt(cur.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b++;
  editor.replaceRange(next.slice(a, next.length - b), posAt(cur, a), posAt(cur, cur.length - b));
}

type Decision = { outcome: LinkApplyOutcome; next: string | null };

function decide(input: LinkApplyInput, text: string): Decision {
  if (input.expectHash !== null && input.hash(text) !== input.expectHash) return { outcome: { kind: "stale" }, next: null };
  const r = input.compute(text);
  if (!r.ok) return { outcome: { kind: "error", reason: r.reason }, next: null };
  if (!r.changed) return { outcome: { kind: "unchanged", content: r.content }, next: null };
  return { outcome: { kind: "written", content: r.content }, next: r.content };
}

export async function applyLinkAtomic(ports: WritePorts, input: LinkApplyInput): Promise<LinkApplyOutcome> {
  const { path } = input;
  // Offener Quell-Editor: sein Stand ist der, den der Nutzer sieht (und der noch nicht gespeichert sein muss). Mit `\r` im Text
  // (CRLF) stimmen Editor-Offsets und Rohtext nicht sicher überein; dort bleibt der Weg über `vault.process`.
  const editor = ports.editorFor(path);
  const editorText = editor?.getValue();
  if (editor && editorText !== undefined && !editorText.includes("\r")) {
    const d = decide(input, editorText);
    if (d.next !== null) {
      try { replaceDiff(editor, editorText, d.next); } catch { return { kind: "error", reason: "write-failed" }; }
    }
    return d.outcome;
  }
  const box: { d: Decision | null } = { d: null };
  try {
    await ports.vault.process(path, (current) => {
      box.d = decide(input, current);
      return box.d.next ?? current;
    });
  } catch {
    return { kind: "error", reason: box.d === null ? "not-found" : "write-failed" };
  }
  return box.d?.outcome ?? { kind: "error", reason: "not-found" };
}
