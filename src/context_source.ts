export type ChatMode = "auto-rag" | "active-note" | "picked-notes";
export interface ContextResult { text: string; sources: string[] }
export interface ContextDeps {
  embed: (q: string) => Promise<Float32Array>;
  search: (qVec: Float32Array) => string[];
  related: (path: string) => string[];
  read: (path: string) => Promise<string>;
  activePath: () => string | null;
  picked: () => string[];
  k: number;
  budget: number;
}

export async function assembleContext(mode: ChatMode, query: string, deps: ContextDeps): Promise<ContextResult> {
  let paths: string[] = [];
  if (mode === "auto-rag") {
    const qVec = await deps.embed(query);
    paths = deps.search(qVec).slice(0, deps.k);
  } else if (mode === "active-note") {
    const a = deps.activePath();
    paths = a ? [a, ...deps.related(a)].slice(0, deps.k) : [];
  } else {
    paths = deps.picked().slice(0, deps.k);
  }
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
