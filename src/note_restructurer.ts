import type { FmAssignedValue, Confidence } from "./frontmatter";
import type { ChatMessage } from "./chat_client";
import type { TemplateSpec } from "./template_matcher";
import { t } from "./vendor/kit/i18n";

export type { Confidence } from "./frontmatter";
export type ApplyMode = "deterministisch" | "additiv" | "transformativ";
export interface Addition { id: string; targetHeading: string; text: string; confidence: Confidence }

const CONF_MAP: Record<string, Confidence> = {
  hoch: "hoch", high: "hoch",
  mittel: "mittel", medium: "mittel", mid: "mittel",
  niedrig: "niedrig", low: "niedrig",
};
export function parseConfidence(raw: unknown): Confidence {
  if (typeof raw !== "string") return "niedrig";
  return CONF_MAP[raw.trim().toLowerCase()] ?? "niedrig";
}

export interface SourceBlock { id: string; text: string }

export interface Assignment {
  version: number;
  sections: { heading: string; blocks: string[] }[];
  unassigned: string[];
  additions?: Addition[];
  frontmatter: Record<string, FmAssignedValue>;
}

/** `output-truncated` ist ein reiner BEGLEIT-Befund: er erklaert einen anderen Fehlschlag
 *  (die Antwort lief ins Token-Budget), blockt aber selbst nie — `hardOk` kennt ihn nicht.
 *  `template-no-sections` ist das Gegenteil: ein VORAB-Abbruch, bevor ueberhaupt ein Modell
 *  gefragt wird. Ohne Ziel-Ueberschriften verwirft `reconcileAssignment` jede Zuordnung, das
 *  Ergebnis waere zwangslaeufig leer — und saehe wie ein Modell-Versagen aus. */
// `reasoning-consumed-budget` ist wie `output-truncated` ein Begleit-Befund und geht NICHT in
// die hardOk-Formel ein (s. smart_apply.ts Step 18) — abgeschnitten ist nicht automatisch kaputt.
export type CheckId = "assignment-parse" | "permutation" | "fm-roundtrip" | "fm-source" | "assemble" | "additions-target" | "output-truncated" | "reasoning-consumed-budget" | "template-no-sections";
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
    return { id: "permutation", ok: false, detail: t("noteRestructurer.permutation.unknownIds", unknown.join(", ")) };
  }
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  if (duplicates.length > 0) {
    return { id: "permutation", ok: false, detail: t("noteRestructurer.permutation.duplicateIds", duplicates.join(", ")) };
  }
  const missing = allIds.filter(id => !counts.has(id));
  if (missing.length > 0) {
    return { id: "permutation", ok: false, detail: t("noteRestructurer.permutation.missingIds", missing.join(", ")) };
  }
  return { id: "permutation", ok: true };
}

// ── assembleBody ─────────────────────────────────────────────────────────────

export const EMPTY_SECTION_SENTINEL = "(noch leer)";
// Edge: if a template heading is literally "Übrig", that section and this catch-all will both appear. Unlikely; not engineered against.
export const UEBRIG_HEADING = "## Übrig";

/**
 * Splits `additions` into those whose targetHeading matches a real tpl.sections[].heading
 * (kept) and the rest (dropped).
 */
export function reconcileAdditions(tpl: TemplateSpec, additions: Addition[]): { kept: Addition[]; dropped: Addition[] } {
  const tplHeadings = new Set(tpl.sections.map(s => s.heading));
  const kept: Addition[] = [];
  const dropped: Addition[] = [];
  for (const add of additions) {
    (tplHeadings.has(add.targetHeading) ? kept : dropped).push(add);
  }
  return { kept, dropped };
}

export function assembleBody(
  tpl: TemplateSpec,
  a: Assignment,
  blocks: SourceBlock[],
  additions: Addition[] = [],
  auditTrail = false,
): string {
  const byId = new Map(blocks.map(b => [b.id, b.text]));
  const assignedFor = new Map(a.sections.map(s => [s.heading, s.blocks]));
  const additionsFor = new Map<string, Addition[]>();
  for (const add of additions) {
    const list = additionsFor.get(add.targetHeading) ?? [];
    list.push(add);
    additionsFor.set(add.targetHeading, list);
  }
  const parts: string[] = [];
  for (const sec of tpl.sections) {
    const hashes = "#".repeat(sec.level);
    parts.push(`${hashes} ${sec.heading}`);
    const ids = assignedFor.get(sec.heading) ?? [];
    const texts = ids.map(id => byId.get(id)).filter((t): t is string => typeof t === "string");
    if (texts.length !== ids.length) {
      const unknownIds = ids.filter(id => !byId.has(id));
      throw new Error(t("noteRestructurer.assemble.unknownBlockIds", unknownIds.join(", ")));
    }
    const additionTexts = (additionsFor.get(sec.heading) ?? []).map(add =>
      auditTrail ? `${add.text} %%erschlossen: ${add.confidence}%%` : add.text,
    );
    const allTexts = [...texts, ...additionTexts];
    parts.push(allTexts.length > 0 ? allTexts.join("\n\n") : EMPTY_SECTION_SENTINEL);
  }
  if (a.unassigned.length > 0) {
    parts.push(UEBRIG_HEADING);
    const uebrigTexts: string[] = [];
    for (const id of a.unassigned) {
      const text = byId.get(id);
      if (text === undefined) throw new Error(t("noteRestructurer.assemble.unknownUnassignedId", id));
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

/** Filtert wohlgeformte Addition-Items aus einem beliebigen JSON-Wert; malformte Einträge werden gedroppt. */
function coerceAdditions(v: unknown): Addition[] {
  if (!Array.isArray(v)) return [];
  const out: Addition[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.targetHeading !== "string" || typeof o.text !== "string") continue;
    out.push({ id: o.id, targetHeading: o.targetHeading, text: o.text, confidence: parseConfidence(o.confidence) });
  }
  return out;
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
  if (!isAssignmentShape(parsed)) return null;
  const shaped = parsed;
  const additions = coerceAdditions(shaped.additions);
  // inferred-confidence normalisieren (source darf jetzt "inferred" sein)
  const fm: Record<string, FmAssignedValue> = {};
  for (const [k, val] of Object.entries(shaped.frontmatter)) {
    fm[k] = val.source === "inferred"
      ? { source: "inferred", value: val.value, confidence: parseConfidence((val as { confidence?: unknown }).confidence) }
      : val;
  }
  return { ...shaped, additions: additions.length > 0 ? additions : undefined, frontmatter: fm };
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

/** Anti-Fabrikations-Klausel — zur BAUZEIT des Prompts aufgelöst, nie als Modul-Konstante:
 *  `setLang()` läuft im onload, Modul-Konstanten werden beim import ausgewertet, also davor
 *  (AGENTS.md § i18n-Gotchas). Als Konstante fror sie die Sprache still auf `en` ein. */
export function antiFabrication(): string {
  return t("noteRestructurer.antiFabrication");
}

/** Zusatz-Erlaubnis des additiven Modus. Die Konfidenz-Stufen kommen interpoliert aus
 *  `confidenceValues()` — der Prompt darf keine Wörter verlangen, die `parseConfidence`
 *  nicht kennt, sonst fällt jede Ergänzung still auf "niedrig". */
export function additiveInstruction(): string {
  return t("noteRestructurer.additiveInstruction", confidenceValues());
}

/** Die drei Konfidenz-Wörter, wie der Prompt sie verlangt — PROTOKOLL, nicht Prosa:
 *  `CONF_MAP` (oben) kennt beide Sprachfassungen, deshalb darf der englische Prompt
 *  "high"|"medium"|"low" verlangen. Wer hier ein Wort ändert, muss CONF_MAP mitziehen. */
function confidenceValues(): string {
  return t("noteRestructurer.confidenceValues");
}

/** Vorlagen-Beispielwert als String (Selbst-Dokumentation, nie Inhalt). Leer → "". */
function fmExample(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.length ? v.map(x => String(x)).join(", ") : "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v).trim();
  return "";
}

export function buildRestructurePrompt(
  tpl: TemplateSpec,
  blocks: SourceBlock[],
  mode: ApplyMode = "deterministisch",
): ChatMessage[] {
  const numbered = blocks.map(b => `${b.id}:\n${b.text}`).join("\n\n");
  const headings = tpl.sections.map(s => s.heading).join(", ");

  // Ein Label, zwei Verwendungen: die erzeugte Zeile UND der Satz, der sie erklärt.
  // Getrennt übersetzt liefen beide auseinander — das Modell bekäme eine Erklärung für
  // eine Zeile, die so nicht im Prompt steht.
  const guidanceLabel = t("noteRestructurer.label.guidance");
  const exampleLabel = t("noteRestructurer.label.example");

  const sectionLines = tpl.sections
    .map(s => (s.guidance ? `- ${s.heading} — ${guidanceLabel}: ${s.guidance}` : `- ${s.heading}`))
    .join("\n");
  const fmG = tpl.fmGuidance ?? {};
  const keyLines = tpl.keys
    .map(k => {
      const ex = fmExample(tpl.fmDefaults[k]);
      const hint = (fmG[k] ?? "").trim();
      const parts: string[] = [];
      if (ex) parts.push(`${exampleLabel}: ${ex}`);
      if (hint) parts.push(`${t("noteRestructurer.label.hint")}: ${hint}`);
      return parts.length ? `- ${k} (${parts.join("; ")})` : `- ${k}`;
    })
    .join("\n");

  const userCommon = [
    t("noteRestructurer.heading.templateStructure"),
    sectionLines,
    "",
    t("noteRestructurer.heading.frontmatterKeys"),
    keyLines,
    "",
    t("noteRestructurer.orderedHeadings", headings),
    "",
    t("noteRestructurer.heading.body"),
    numbered,
    "",
  ];

  // JSON-Feldnamen und source-Werte sind Protokoll und bleiben in jeder Sprache wörtlich;
  // übersetzt wird nur, was in spitzen Klammern als Platzhalter steht.
  const guidanceIsSpec = t("noteRestructurer.guidanceIsSpec", guidanceLabel, exampleLabel);
  const phKey = t("noteRestructurer.ph.key");
  const phValue = t("noteRestructurer.ph.value");

  if (mode === "additiv") {
    const system = [
      t("noteRestructurer.role"),
      additiveInstruction(),
      guidanceIsSpec,
      `${t("noteRestructurer.schemaLabelAdditive")}: { "version": 2, "sections": [...], "unassigned": [...], "additions": [{ "id": "add_0", "targetHeading": "<${t("noteRestructurer.ph.existingHeading")}>", "text": "<${t("noteRestructurer.ph.newText")}>", "confidence": ${confidenceValues()} }], "frontmatter": { "<${phKey}>": { "source": "content"|"inferred"|"empty", "value": "<${phValue}>", "confidence": ${confidenceValues()} } } }`,
      t("noteRestructurer.frontmatterRuleAdditive"),
    ].join("\n");

    const user = [...userCommon, additiveInstruction(), t("noteRestructurer.jsonOnly")].join("\n");

    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  const system = [
    t("noteRestructurer.role"),
    antiFabrication(),
    guidanceIsSpec,
    `${t("noteRestructurer.schemaLabel")}: { "version": 1, "sections": [{ "heading": "<${t("noteRestructurer.ph.heading")}>", "blocks": ["block_3"] }],`,
    `"unassigned": ["block_7"], "frontmatter": { "<${phKey}>": { "source": "content"|"empty", "value": "<${phValue}>" } } }`,
    t("noteRestructurer.frontmatterRule"),
  ].join("\n");

  const user = [...userCommon, antiFabrication(), t("noteRestructurer.jsonOnly")].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
