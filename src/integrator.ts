// Vorschlagslogik des Integrators (Spec §3): Kandidaten aus dem Index, deterministisch
// gefiltert, kein LLM, kein Netz. Obsidian-frei; die Ports kommen aus main.ts.
import type { RelatedResult } from "./retrieval_facade";
import type { LinkProposal } from "./integrator_store";
import { wikilinkFor } from "./link_writer";

/** djb2 — dieselbe Funktion wie der Stale-Guard von Smart Apply (smart_apply.ts). */
export function hashText(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Bereich = Pfad-PRAEFIXE wie `exclude` ("00_Inbox/"). Leer heisst bewusst "kein Bereich":
 *  der automatische Ausloeser ist dann aus (Spec E3). */
export function inScope(path: string, folders: string[]): boolean {
  return folders.some(f => f !== "" && path.startsWith(f));
}

export interface ProposeDeps {
  related(path: string): RelatedResult;
  /** Aufgeloeste ausgehende Links der Notiz (Ziel-Pfade mit .md) — am Rand aus
   *  metadataCache.resolvedLinks, damit auch kurze Linkformen zaehlen. */
  existingLinks(path: string): Set<string>;
  rejected(path: string): Set<string>;
  now(): number;
}

export type ProposeResult =
  | { kind: "proposal"; proposal: LinkProposal }
  | { kind: "no-index" }
  | { kind: "not-indexed" }
  | { kind: "nothing-new" };

export function proposeLinks(path: string, noteText: string, deps: ProposeDeps): ProposeResult {
  const r = deps.related(path);
  if (r.kind === "no-index") return { kind: "no-index" };
  if (r.kind === "not-indexed") return { kind: "not-indexed" };
  const linked = deps.existingLinks(path);
  const rejected = deps.rejected(path);
  const links = r.hits
    .filter(h => h.path !== path && !linked.has(h.path) && !rejected.has(h.path) && wikilinkFor(h.path) !== null)
    .map(h => ({ path: h.path, score: h.score }));
  if (links.length === 0) return { kind: "nothing-new" };
  return { kind: "proposal", proposal: { notePath: path, noteHash: hashText(noteText), createdAt: deps.now(), links, stale: false } };
}
