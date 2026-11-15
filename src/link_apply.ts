// Link in eine Nutzernotiz schreiben — atomar, ohne Fenster zwischen Lesen und Schreiben. Obsidian-frei: die Ports
// (`WritePorts` aus dem Kit-Modul block-writer) kommen aus main.ts (`obsidianWritePorts`).
//
// Vorher lasen `acceptLink` und `applyLinkNow` mit `adapter.read`, rechneten und schrieben mit `adapter.write` zurück. Zwischen
// beiden liegt ein `await`: was in dieser Zeit in der Notiz geschah (ungespeicherter Editorstand, Sync, anderes Plugin), ging
// verloren, und der Hash-Guard von `acceptLink` prüfte den Stand der Berechnung, nicht den beim Schreiben. Jetzt läuft Prüfung
// UND Rechnung in `vault.process` (liest und schreibt in einem Zug) oder, bei einer im Quellmodus offenen Notiz, auf dem Stand
// des Editors (Strg+Z wirkt, kein getipptes Zeichen geht verloren).
import type { WritePorts } from "./vendor/kit/block-writer";
import { editAtomic, type EditDecision } from "./vendor/kit/note-edit";
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
  /** Wie lange nach einem Editor-Schreiben auf die Platte gewartet wird (ms); Standard 3000. Obsidian speichert den Editor erst nach rund 2 s. */
  persistWaitMs?: number;
}

type Decision = EditDecision<LinkApplyOutcome>;

function decide(input: LinkApplyInput, text: string): Decision {
  if (input.expectHash !== null && input.hash(text) !== input.expectHash) return { outcome: { kind: "stale" }, next: null };
  const r = input.compute(text);
  if (!r.ok) return { outcome: { kind: "error", reason: r.reason }, next: null };
  if (!r.changed) return { outcome: { kind: "unchanged", content: r.content }, next: null };
  return { outcome: { kind: "written", content: r.content }, next: r.content };
}

export async function applyLinkAtomic(ports: WritePorts, input: LinkApplyInput): Promise<LinkApplyOutcome> {
  const r = await editAtomic<LinkApplyOutcome>(ports, input.path, (text) => decide(input, text), { persistWaitMs: input.persistWaitMs });
  return r.kind === "done" ? r.outcome : { kind: "error", reason: r.reason };
}
