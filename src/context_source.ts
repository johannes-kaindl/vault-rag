export interface ContextResult { text: string; sources: string[] }

/** Baut den Kontext-Block aus einer fixen Pfadliste: liest jede Notiz, kürzt anteilig aufs
 *  Budget, überspringt nicht lesbare. Die Auswahl der Pfade passiert im ContextPanel. */
export async function buildContext(
  paths: string[],
  deps: { read: (p: string) => Promise<string>; budget: number },
): Promise<ContextResult> {
  const perNote = paths.length > 0 ? Math.floor(deps.budget / paths.length) : deps.budget;
  const blocks: string[] = [];
  const sources: string[] = [];
  for (const p of paths) {
    let text: string;
    try { text = await deps.read(p); } catch { continue; }
    blocks.push(`## ${p}\n${text.slice(0, perNote)}`);
    sources.push(p);
  }
  return { text: blocks.join("\n\n"), sources };
}
