// Eine Nutzernotiz atomar ändern — ohne Fenster zwischen Lesen und Schreiben. Obsidian-frei: die Ports (`WritePorts` aus dem
// Kit-Modul block-writer) kommen aus main.ts (`obsidianWritePorts`).
//
// Der Weg (Welle 34, vorher `adapter.read` + `await` + `adapter.write` in Integrator und Smart Apply): Entscheidung UND neuer Text
// entstehen aus dem Stand, den `vault.process` liest, oder, bei einer im Quellmodus offenen Notiz, aus dem Stand des Editors (Strg+Z
// wirkt, kein getipptes Zeichen geht verloren). Danach wartet `editAtomic` bis zu 3 s, bis die Platte den Text trägt (Obsidian speichert
// den Editor erst nach rund 2 s): Plugin-API und Smoke lesen die Platte sofort.
import type { WritePorts, EditorHandle } from "./vendor/kit/block-writer";

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

/** Wartet, bis die Datei auf der Platte `next` trägt, höchstens `maxMs`. Kommt es nicht dazu, bleibt der Text im Editor und Obsidian speichert ihn selbst. */
async function waitPersisted(ports: WritePorts, path: string, next: string, maxMs: number): Promise<void> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    try { if ((await ports.vault.read(path)) === next) return; } catch { return; }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
}

/** Was `decide` aus dem aktuellen Text macht: `next` = neuer Text oder `null` (nichts schreiben), `outcome` = was der Aufrufer zurückbekommt. */
export interface EditDecision<T> { outcome: T; next: string | null }

export type EditResult<T> = { kind: "done"; outcome: T } | { kind: "error"; reason: "not-found" | "write-failed" };

export async function editAtomic<T>(
  ports: WritePorts,
  path: string,
  decide: (text: string) => EditDecision<T>,
  persistWaitMs = 3000,
): Promise<EditResult<T>> {
  // Offener Quell-Editor: sein Stand ist der, den der Nutzer sieht (und der noch nicht gespeichert sein muss). Mit `\r` im Text
  // (CRLF) stimmen Editor-Offsets und Rohtext nicht sicher überein; dort bleibt der Weg über `vault.process`.
  const editor = ports.editorFor(path);
  const editorText = editor?.getValue();
  if (editor && editorText !== undefined && !editorText.includes("\r")) {
    const d = decide(editorText);
    if (d.next !== null && d.next !== editorText) {
      try { replaceDiff(editor, editorText, d.next); } catch { return { kind: "error", reason: "write-failed" }; }
      // Der Vertrag bleibt „geschrieben heißt auf der Platte“.
      await waitPersisted(ports, path, d.next, persistWaitMs);
    }
    return { kind: "done", outcome: d.outcome };
  }
  const box: { d: EditDecision<T> | null } = { d: null };
  try {
    await ports.vault.process(path, (current) => {
      box.d = decide(current);
      return box.d.next ?? current;
    });
  } catch {
    return { kind: "error", reason: box.d === null ? "not-found" : "write-failed" };
  }
  return box.d === null ? { kind: "error", reason: "not-found" } : { kind: "done", outcome: box.d.outcome };
}

/** Vergleichsform: ein führendes BOM kann je nach Lesepfad (Adapter oder Vault) da sein oder fehlen. */
function plain(s: string): string { return s.replace(/^\uFEFF/, ""); }

/** Tauscht den Notiztext `expected` gegen `next` — nur, wenn die Notiz im Augenblick des Schreibens noch genau `expected` trägt.
 *  `true` = ersetzt (oder schon gleich); `false` = die Notiz hat sich geändert, nichts wurde geschrieben. Wirft, wenn die Notiz fehlt oder das Schreiben scheitert. */
export async function swapNote(ports: WritePorts, path: string, expected: string, next: string, persistWaitMs?: number): Promise<boolean> {
  const r = await editAtomic<boolean>(
    ports, path,
    (cur) => plain(cur) === plain(expected) ? { outcome: true, next } : plain(cur) === plain(next) ? { outcome: true, next: null } : { outcome: false, next: null },
    persistWaitMs,
  );
  if (r.kind === "error") throw new Error(r.reason);
  return r.outcome;
}
