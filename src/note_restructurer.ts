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

export type CheckId = "assignment-parse" | "permutation" | "fm-roundtrip" | "fm-source" | "assemble";
export interface CheckResult { id: CheckId; ok: boolean; detail?: string }

// ── splitBlocks ──────────────────────────────────────────────────────────────

const HEADING_LINE_RE = /^#{1,6}\s+\S/;

export function splitBlocks(body: string): SourceBlock[] {
  const lines = body.split("\n");
  const raw: string[] = [];
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length > 0) {
      const text = buf.join("\n");
      // Only emit if the buffer contains at least one non-whitespace character.
      // We test for non-whitespace WITHOUT mutating the text we keep.
      if (/\S/.test(text)) raw.push(text);
      buf = [];
    }
  };
  for (const line of lines) {
    if (HEADING_LINE_RE.test(line)) {
      flush();
      raw.push(line);          // preserve verbatim — no .trim()
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

export const EMPTY_SECTION_SENTINEL = "(noch leer)";
// Edge: if a template heading is literally "Übrig", that section and this catch-all will both appear. Unlikely; not engineered against.
export const UEBRIG_HEADING = "## Übrig";

export function assembleBody(tpl: TemplateSpec, a: Assignment, blocks: SourceBlock[]): string {
  const byId = new Map(blocks.map(b => [b.id, b.text]));
  const assignedFor = new Map(a.sections.map(s => [s.heading, s.blocks]));
  const parts: string[] = [];
  for (const sec of tpl.sections) {
    const hashes = "#".repeat(sec.level);
    parts.push(`${hashes} ${sec.heading}`);
    const ids = assignedFor.get(sec.heading) ?? [];
    const texts = ids.map(id => byId.get(id)).filter((t): t is string => typeof t === "string");
    if (texts.length !== ids.length) {
      const unknownIds = ids.filter(id => !byId.has(id));
      throw new Error(`assembleBody: unbekannte Block-IDs: ${unknownIds.join(", ")}`);
    }
    parts.push(texts.length > 0 ? texts.join("\n\n") : EMPTY_SECTION_SENTINEL);
  }
  if (a.unassigned.length > 0) {
    parts.push(UEBRIG_HEADING);
    const uebrigTexts: string[] = [];
    for (const id of a.unassigned) {
      const text = byId.get(id);
      if (text === undefined) throw new Error(`assembleBody: unbekannte Block-ID in unassigned: ${id}`);
      uebrigTexts.push(text);
    }
    parts.push(uebrigTexts.join("\n\n"));
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

// ── reconcileAssignment ──────────────────────────────────────────────────────

/**
 * Returns a new Assignment where any section whose heading is NOT in tpl.sections[].heading
 * is removed, and ALL its block ids are appended to `unassigned` (dedup, preserve first-seen order).
 * Sections with matching headings are kept as-is. version/frontmatter pass through.
 * Guarantees: after reconcile, every block id is either under a real template heading or in
 * unassigned — so permutationCheck coverage genuinely means "placed-or-visibly-unassigned".
 */
export function reconcileAssignment(tpl: TemplateSpec, a: Assignment): Assignment {
  const tplHeadings = new Set(tpl.sections.map(s => s.heading));
  const seenIds = new Set<string>(a.unassigned);
  const newUnassigned: string[] = [...a.unassigned];

  const newSections: { heading: string; blocks: string[] }[] = [];
  for (const sec of a.sections) {
    if (tplHeadings.has(sec.heading)) {
      newSections.push(sec);
    } else {
      // stray heading: route all blocks to unassigned (dedup)
      for (const id of sec.blocks) {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          newUnassigned.push(id);
        }
      }
    }
  }

  return {
    version: a.version,
    sections: newSections,
    unassigned: newUnassigned,
    frontmatter: a.frontmatter,
  };
}

// ── buildRestructurePrompt ───────────────────────────────────────────────────

export const ANTI_FABRICATION = [
  "Du darfst KEINEN Text erfinden, umschreiben oder zusammenfassen.",
  "Du ordnest ausschließlich die nummerierten Block-IDs den Template-Überschriften zu.",
  "Jede Block-ID muss genau einmal vorkommen: entweder in einer Sektion oder in `unassigned`.",
  "Du gibst AUSSCHLIESSLICH ein einzelnes JSON-Objekt zurück, keinen Fließtext, keine Erklärung.",
].join(" ");

/** Vorlagen-Beispielwert als String (Selbst-Dokumentation, nie Inhalt). Leer → "". */
function fmExample(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.length ? v.map(x => String(x)).join(", ") : "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v).trim();
  return "";
}

export function buildRestructurePrompt(tpl: TemplateSpec, blocks: SourceBlock[]): ChatMessage[] {
  const numbered = blocks.map(b => `${b.id}:\n${b.text}`).join("\n\n");
  const headings = tpl.sections.map(s => s.heading).join(", ");

  const sectionLines = tpl.sections
    .map(s => (s.guidance ? `- ${s.heading} — Anleitung: ${s.guidance}` : `- ${s.heading}`))
    .join("\n");
  const fmG = tpl.fmGuidance ?? {};
  const keyLines = tpl.keys
    .map(k => {
      const ex = fmExample(tpl.fmDefaults[k]);
      const hint = (fmG[k] ?? "").trim();
      const parts: string[] = [];
      if (ex) parts.push(`Beispiel: ${ex}`);
      if (hint) parts.push(`Hinweis: ${hint}`);
      return parts.length ? `- ${k} (${parts.join("; ")})` : `- ${k}`;
    })
    .join("\n");

  const system = [
    "Du bist ein strukturierender Assistent für Obsidian-Notizen.",
    ANTI_FABRICATION,
    "Die `Anleitung:`-Zeilen und `(Beispiel: …)`-Angaben der Vorlage sind VORGABEN — sie sagen dir, welche Original-Blöcke unter welche Überschrift gehören und was in ein Frontmatter-Feld passt. Sie sind KEIN zuzuordnender Inhalt; übernimm ihren Text niemals in den Output.",
    'Schema: { "version": 1, "sections": [{ "heading": "<Überschrift>", "blocks": ["block_3"] }],',
    '"unassigned": ["block_7"], "frontmatter": { "<key>": { "source": "content"|"empty", "value": "<wert>" } } }',
    'Frontmatter mit source="content" muss wörtlich aus den Blöcken stammen; sonst source="empty".',
  ].join("\n");

  const user = [
    "## Vorlagen-Struktur (Überschriften + Anleitung)",
    sectionLines,
    "",
    "## Frontmatter-Keys",
    keyLines,
    "",
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
