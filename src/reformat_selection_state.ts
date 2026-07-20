import type { TransformDef, MechanicalTransform, LlmTransform } from "./reformat_transforms";

/** Ob ein Transform gerade laufen kann — und wenn nein, warum nicht. */
export type ReformatReadiness =
  | { kind: "ready"; text: string }
  | { kind: "reading-mode" }
  | { kind: "no-selection" }
  | { kind: "no-editor" };

/** Klartext-Grund für den blockierten Zustand — EINE Wahrheit für die Notice (Command)
 *  und die Panel-Kopfzeile. Bei "ready" leer: dort zeigt das Panel die Auswahl-Vorschau. */
export function readinessMessage(r: ReformatReadiness): string {
  switch (r.kind) {
    case "ready": return "";
    case "reading-mode": return "Formatierung im Lese-Modus nicht möglich — wechsle in den Bearbeiten-Modus.";
    case "no-selection": return "Nichts markiert.";
    case "no-editor": return "Keine Notiz im Bearbeiten-Modus geöffnet.";
  }
}

export function canRun(r: ReformatReadiness): boolean {
  return r.kind === "ready";
}

export interface SelectionPreview { snippet: string; lines: number }

/** Ein-Zeilen-Vorschau der Auswahl + Zeilenzahl für die Panel-Kopfzeile. */
export function selectionPreview(text: string, maxLen = 60): SelectionPreview {
  const t = text.trim();
  if (t === "") return { snippet: "", lines: 0 };
  const lines = t.split("\n");
  const first = lines[0];
  const snippet = first.length > maxLen ? `${first.slice(0, maxLen)}…` : first;
  return { snippet, lines: lines.length };
}

/** Steht an der gemerkten Stelle noch der gemerkte Text? Schutz davor, an einer
 *  verschobenen Position zu ersetzen, wenn zwischen Markieren und Klicken editiert wurde. */
export function isRangeStale(currentText: string, capturedText: string): boolean {
  return currentText !== capturedText;
}

export interface TransformGroups { mechanical: MechanicalTransform[]; llm: LlmTransform[] }

/** Teilt die Registry in die zwei Panel-Gruppen. Jeder Eintrag landet in genau einer —
 *  dadurch kann kein Transform aus dem Panel fallen. */
export function groupTransforms(defs: TransformDef[]): TransformGroups {
  const mechanical: MechanicalTransform[] = [];
  const llm: LlmTransform[] = [];
  for (const d of defs) {
    if (d.kind === "mechanical") mechanical.push(d);
    else llm.push(d);
  }
  return { mechanical, llm };
}
