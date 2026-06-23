import type { FmAssignedValue } from "./frontmatter";
import type { ChatMessage } from "./chat_client";
import type { TemplateSpec } from "./template_matcher";

export interface SourceBlock { id: string; text: string }

export interface Assignment {
  version: number;
  sections: { heading: string; blocks: string[] }[];
  unassigned: string[];
  frontmatter: Record<string, FmAssignedValue>;
}

export type CheckId = "assignment-parse" | "permutation" | "fm-roundtrip" | "fm-source";
export interface CheckResult { id: CheckId; ok: boolean; detail?: string }

// ── splitBlocks ──────────────────────────────────────────────────────────────

const HEADING_LINE_RE = /^#{1,6}\s+\S/;

export function splitBlocks(body: string): SourceBlock[] {
  const lines = body.split("\n");
  const raw: string[] = [];
  let buf: string[] = [];
  const flush = (): void => {
    const text = buf.join("\n").trim();
    if (text) raw.push(text);
    buf = [];
  };
  for (const line of lines) {
    if (HEADING_LINE_RE.test(line)) {
      flush();
      raw.push(line.trim());
    } else if (line.trim() === "") {
      flush();
    } else {
      buf.push(line);
    }
  }
  flush();
  return raw.map((text, i) => ({ id: `block_${i}`, text }));
}

// ── permutationCheck ─────────────────────────────────────────────────────────

export function permutationCheck(allIds: string[], a: Assignment): CheckResult {
  const seen: string[] = [];
  for (const s of a.sections) for (const id of s.blocks) seen.push(id);
  for (const id of a.unassigned) seen.push(id);

  const known = new Set(allIds);
  const counts = new Map<string, number>();
  const unknown: string[] = [];
  for (const id of seen) {
    if (!known.has(id)) unknown.push(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (unknown.length > 0) {
    return { id: "permutation", ok: false, detail: `unbekannte IDs: ${unknown.join(", ")}` };
  }
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  if (duplicates.length > 0) {
    return { id: "permutation", ok: false, detail: `doppelte IDs: ${duplicates.join(", ")}` };
  }
  const missing = allIds.filter(id => !counts.has(id));
  if (missing.length > 0) {
    return { id: "permutation", ok: false, detail: `fehlende IDs: ${missing.join(", ")}` };
  }
  return { id: "permutation", ok: true };
}

// ── assembleBody ─────────────────────────────────────────────────────────────

export const EMPTY_SECTION_SENTINEL = "*(noch leer)*";

export function assembleBody(tpl: TemplateSpec, a: Assignment, blocks: SourceBlock[]): string {
  const byId = new Map(blocks.map(b => [b.id, b.text]));
  const assignedFor = new Map(a.sections.map(s => [s.heading, s.blocks]));
  const parts: string[] = [];
  for (const sec of tpl.sections) {
    const hashes = "#".repeat(sec.level);
    parts.push(`${hashes} ${sec.heading}`);
    const ids = assignedFor.get(sec.heading) ?? [];
    const texts = ids.map(id => byId.get(id)).filter((t): t is string => typeof t === "string");
    parts.push(texts.length > 0 ? texts.join("\n\n") : EMPTY_SECTION_SENTINEL);
  }
  return parts.join("\n\n") + "\n";
}

// ── parseAssignment ──────────────────────────────────────────────────────────

function isAssignmentShape(v: unknown): v is Assignment {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.version !== "number") return false;
  if (!Array.isArray(o.sections)) return false;
  for (const s of o.sections) {
    if (typeof s !== "object" || s === null) return false;
    const sec = s as Record<string, unknown>;
    if (typeof sec.heading !== "string") return false;
    if (!Array.isArray(sec.blocks) || !sec.blocks.every(b => typeof b === "string")) return false;
  }
  if (!Array.isArray(o.unassigned) || !o.unassigned.every(b => typeof b === "string")) return false;
  if (typeof o.frontmatter !== "object" || o.frontmatter === null) return false;
  return true;
}

/** Erstes balanciert geklammertes {...}-Objekt aus einem Text ziehen (Fences/Prosa-tolerant). */
function extractFirstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAssignment(raw: string): Assignment | null {
  const candidate = extractFirstObject(raw);
  if (!candidate) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  return isAssignmentShape(parsed) ? parsed : null;
}

// ── buildRestructurePrompt ───────────────────────────────────────────────────

const ANTI_FABRICATION = [
  "Du darfst KEINEN Text erfinden, umschreiben oder zusammenfassen.",
  "Du ordnest ausschließlich die nummerierten Block-IDs den Template-Überschriften zu.",
  "Jede Block-ID muss genau einmal vorkommen: entweder in einer Sektion oder in `unassigned`.",
  "Du gibst AUSSCHLIESSLICH ein einzelnes JSON-Objekt zurück, keinen Fließtext, keine Erklärung.",
].join(" ");

export function buildRestructurePrompt(tpl: TemplateSpec, blocks: SourceBlock[]): ChatMessage[] {
  const numbered = blocks.map(b => `${b.id}:\n${b.text}`).join("\n\n");
  const keys = tpl.keys.join(", ");
  const headings = tpl.sections.map(s => s.heading).join(", ");

  const system = [
    "Du bist ein strukturierender Assistent für Obsidian-Notizen.",
    ANTI_FABRICATION,
    'Schema: { "version": 1, "sections": [{ "heading": "<Überschrift>", "blocks": ["block_3"] }],',
    '"unassigned": ["block_7"], "frontmatter": { "<key>": { "source": "content"|"empty", "value": "<wert>" } } }',
    'Frontmatter mit source="content" muss wörtlich aus den Blöcken stammen; sonst source="empty".',
  ].join("\n");

  const user = [
    "## Template-Struktur (verbatim)",
    tpl.raw,
    "",
    `Frontmatter-Keys: ${keys}`,
    `Geordnete Überschriften: ${headings}`,
    "",
    "## Original-Body in nummerierten Blöcken",
    numbered,
    "",
    ANTI_FABRICATION,
    "Antworte AUSSCHLIESSLICH mit dem JSON-Objekt.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
