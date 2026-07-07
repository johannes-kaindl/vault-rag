// smart_apply.ts — Orchestrator for the Smart Apply feature. Pure-core, no obsidian import.
import {
  parseFrontmatter,
  serializeFrontmatter,
  mergeFrontmatter,
  diffFrontmatter,
  assertParseable,
  FmRow,
  ParsedFrontmatter,
  FmAssignedValue,
} from "./frontmatter";
import {
  parseTemplate,
  detectType,
  SuggestionSource,
  TypeSuggestion,
  TemplateSpec,
} from "./template_matcher";
import {
  splitBlocks,
  buildRestructurePrompt,
  parseAssignment,
  reconcileAssignment,
  reconcileAdditions,
  permutationCheck,
  assembleBody,
  CheckResult,
  SourceBlock,
  Addition,
  Assignment,
  ApplyMode,
} from "./note_restructurer";
import type { ChatClient } from "./chat_client";

// ── Public types ──────────────────────────────────────────────────────────────

export interface SmartApplyParams {
  model: string;
  temperature: number;
  suppressThinking: boolean;
  maxTokens: number;
}

export interface SmartApplyDeps {
  read: (path: string) => Promise<string>;
  write: (path: string, text: string) => Promise<void>;
  listTemplates: () => Promise<string[]>;
  embed: (text: string) => Promise<Float32Array>;
  search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
  typeOf: (path: string) => Promise<string | null>;
}

export interface SectionDiff {
  heading: string;
  blockIds: string[];
  /** SEAM-VERTRAG: original heading/first-line text of assigned block(s), NOT raw block-id list */
  provenance: string | null;
}

export interface ApplyProposal {
  notePath: string;
  templatePath: string;
  type: string;
  originalText: string;
  proposedText: string;
  fmRows: FmRow[];
  sectionDiff: SectionDiff[];
  unassigned: SourceBlock[];
  detection: { source: SuggestionSource; confidence: "no" | "likely" | "confirmed" };
  checks: CheckResult[];
  hardOk: boolean;
  reasoning: string;
  mode: ApplyMode;
  additions: Addition[];
  assembly: AssemblyContext;
  selection: ApplySelection;
}

export interface ApplyResult {
  written: boolean;
  reason?: "stale" | "blocked";
  undo?: () => Promise<void>;
}

// ── Non-deterministic mode: granular re-assembly ──────────────────────────────

export interface ApplySelection { inferredKeys: Set<string>; additionIds: Set<string> }

/** The building blocks a proposal carries so the text can be rebuilt without another LLM call. */
export interface AssemblyContext {
  tpl: TemplateSpec;
  original: ParsedFrontmatter;
  assignment: Assignment;
  blocks: SourceBlock[];
  additions: Addition[];
}

/**
 * Default granular selection: every inferred frontmatter key and every addition whose
 * confidence !== "niedrig" (hoch+mittel ON, niedrig OFF).
 */
export function defaultSelection(ctx: AssemblyContext): ApplySelection {
  const inferredKeys = new Set<string>();
  for (const [key, entry] of Object.entries(ctx.assignment.frontmatter)) {
    if (entry.source === "inferred" && entry.confidence !== "niedrig") {
      inferredKeys.add(key);
    }
  }
  const additionIds = new Set<string>();
  for (const add of ctx.additions) {
    if (add.confidence !== "niedrig") additionIds.add(add.id);
  }
  return { inferredKeys, additionIds };
}

/**
 * Pure re-assembler: rebuilds the proposed note text from a granular selection, without
 * another LLM call. Composes mergeFrontmatter → serializeFrontmatter + assembleBody.
 */
export function assembleProposedText(ctx: AssemblyContext, sel: ApplySelection, auditTrail: boolean): string {
  const merged = mergeFrontmatter(ctx.tpl.keys, ctx.tpl.fmDefaults, ctx.original, ctx.assignment.frontmatter, {
    acceptInferred: sel.inferredKeys,
    auditTrail,
  });
  const fmText = serializeFrontmatter(merged.data, merged.order);
  const body = assembleBody(
    ctx.tpl,
    ctx.assignment,
    ctx.blocks,
    ctx.additions.filter((a) => sel.additionIds.has(a.id)),
    auditTrail,
  );
  return fmText + body;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// ── SmartApply class ──────────────────────────────────────────────────────────

export class SmartApply {
  private controller: AbortController | null = null;

  constructor(
    private deps: SmartApplyDeps,
    private client: () => ChatClient,
    private params: () => SmartApplyParams = () => ({ model: '', temperature: 0, suppressThinking: false, maxTokens: 2048 }),
  ) {}

  /** Aborts any in-flight propose() call. */
  abort(): void {
    this.controller?.abort();
  }

  /** Detection: calls detectType() with the deps — real TypeSuggestion, never hardcoded */
  async detect(notePath: string): Promise<TypeSuggestion> {
    return detectType(notePath, this.deps);
  }

  /**
   * Core orchestration method. Exactly ONE stream per call.
   * SEAM-VERTRAG (7): onToken/onReasoning forwarded into the single client().stream() call
   * SEAM-VERTRAG (3): detection = real TypeSuggestion from this.detect(notePath)
   * SEAM-VERTRAG (4): sectionDiff[].provenance = original heading/first-line text of assigned block(s)
   */
  async propose(
    notePath: string,
    templatePath: string,
    mode: ApplyMode,
    onToken: (t: string) => void,
    onReasoning: (t: string) => void,
    signal?: AbortSignal,
    preDetection?: TypeSuggestion,
  ): Promise<ApplyProposal> {
    this.controller = new AbortController();
    // If caller passed an external signal, forward its abort into our controller
    if (signal) {
      signal.addEventListener("abort", () => this.controller?.abort(), { once: true });
    }
    try {
    // Step 1: detection — real TypeSuggestion (use provided pre-detection or detect fresh)
    const detection = preDetection ?? await this.detect(notePath);

    // Step 2: read original note
    const originalText = await this.deps.read(notePath);

    // Step 3: parse original
    const originalParsed = parseFrontmatter(originalText);

    // Step 4: read + parse template
    const tplText = await this.deps.read(templatePath);
    const tpl = parseTemplate(tplText);

    // Step 5: split blocks
    const blocks = splitBlocks(originalParsed.body);

    // Step 6: build prompt
    const messages = buildRestructurePrompt(tpl, blocks, mode);

    // Step 7: stream — exactly ONE stream call
    const p = this.params();
    const { content, reasoning } = await this.client().stream(
      messages,
      onToken,
      onReasoning,
      this.controller.signal,
      { model: p.model, temperature: p.temperature, suppressThinking: p.suppressThinking, maxTokens: p.maxTokens },
    );

    // Step 8: parse assignment
    const assignment = parseAssignment(content);

    if (!assignment) {
      // Assignment parse failed → hardOk false, build minimal proposal
      const checks: CheckResult[] = [
        { id: "assignment-parse", ok: false, detail: "LLM-Antwort enthält kein gültiges Assignment-JSON" },
      ];
      const emptyAssignment: Assignment = { version: 1, sections: [], unassigned: [], frontmatter: {} };
      const assembly: AssemblyContext = { tpl, original: originalParsed, assignment: emptyAssignment, blocks, additions: [] };
      return {
        notePath,
        templatePath,
        type: tpl.type,
        originalText,
        proposedText: originalText,
        fmRows: [],
        sectionDiff: [],
        unassigned: [],
        detection: { source: detection.source, confidence: detection.confidence },
        checks,
        hardOk: false,
        reasoning,
        mode,
        additions: [],
        assembly,
        selection: defaultSelection(assembly),
      };
    }

    const parseCheck: CheckResult = { id: "assignment-parse", ok: true };

    // Step 8b: reconcile — move blocks under non-template headings to unassigned
    const reconciled = reconcileAssignment(tpl, assignment);

    // Step 9: permutation check
    const permCheck = permutationCheck(blocks.map((b) => b.id), reconciled);

    // Step 10: soft check fm-source — gate fabricated values.
    // Mode gating (Task 8): in "deterministisch" mode, any FM value with source "inferred"
    // is treated as "content" — so it is subject to the SAME literal-match gate below (this
    // is today's behavior, generalized to the schema-v2 "inferred" source). In "additiv"
    // mode, "inferred" values are left as-is (with their confidence) and bypass this gate:
    // only "content" values must be a literal substring of the note.
    const bodyText = originalParsed.body;
    const existingFmValues = Object.values(originalParsed.data).flat().join(" ");
    const haystack = normalizeStr(bodyText + " " + existingFmValues);

    const preGateFm: Record<string, FmAssignedValue> =
      mode === "deterministisch"
        ? Object.fromEntries(
            Object.entries(reconciled.frontmatter).map(([k, v]) =>
              v.source === "inferred" ? [k, { source: "content", value: v.value }] : [k, v],
            ),
          )
        : reconciled.frontmatter;

    let fmSourceOk = true;
    const gatedFm = { ...preGateFm };
    for (const key of Object.keys(gatedFm)) {
      const entry = gatedFm[key];
      if (entry.source === "content" && entry.value.trim() !== "") {
        const needle = normalizeStr(entry.value);
        if (!haystack.includes(needle)) {
          gatedFm[key] = { source: "empty", value: "" };
          fmSourceOk = false;
        }
      }
    }

    const fmSourceCheck: CheckResult = { id: "fm-source", ok: fmSourceOk };

    // Update reconciled assignment with gated values
    const cleanedAssignment = { ...reconciled, frontmatter: gatedFm };

    // Step 10b: mode gating for additions (Task 8). "deterministisch" discards ALL
    // additions (today's behavior has no concept of additions). "additiv" keeps only
    // additions whose targetHeading matches a real template section (reconcileAdditions);
    // any dropped addition is reported via a SOFT "additions-target" check (does not
    // block hardOk).
    const rawAdditions = assignment.additions ?? [];
    let additions: Addition[] = [];
    let additionsTargetCheck: CheckResult | null = null;
    if (mode === "additiv") {
      const { kept, dropped } = reconcileAdditions(tpl, rawAdditions);
      additions = kept;
      additionsTargetCheck = {
        id: "additions-target",
        ok: dropped.length === 0,
        ...(dropped.length > 0
          ? { detail: `verworfene Ergänzungen (unbekannte Überschrift): ${dropped.map((d) => d.targetHeading).join(", ")}` }
          : {}),
      };
    }

    // Step 11: merge frontmatter
    const mergedFm = mergeFrontmatter(tpl.keys, tpl.fmDefaults, originalParsed, cleanedAssignment.frontmatter);

    // Step 12: assertParseable — throws on failure
    let fmRoundtripCheck: CheckResult;
    try {
      assertParseable(mergedFm);
      fmRoundtripCheck = { id: "fm-roundtrip", ok: true };
    } catch (err) {
      fmRoundtripCheck = {
        id: "fm-roundtrip",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
      const checks: CheckResult[] = [parseCheck, permCheck, fmRoundtripCheck, fmSourceCheck];
      if (additionsTargetCheck !== null) checks.push(additionsTargetCheck);
      const assembly: AssemblyContext = { tpl, original: originalParsed, assignment: cleanedAssignment, blocks, additions };
      return {
        notePath,
        templatePath,
        type: tpl.type,
        originalText,
        proposedText: originalText,
        fmRows: [],
        sectionDiff: [],
        unassigned: [],
        detection: { source: detection.source, confidence: detection.confidence },
        checks,
        hardOk: false,
        reasoning,
        mode,
        additions,
        assembly,
        selection: defaultSelection(assembly),
      };
    }

    // Step 13: assemble body
    let newBody: string;
    let assembleError: string | null = null;
    try {
      newBody = assembleBody(tpl, cleanedAssignment, blocks);
    } catch (err) {
      assembleError = err instanceof Error ? err.message : String(err);
      newBody = originalParsed.body;
    }

    // Step 14: build proposed text
    const proposedText = serializeFrontmatter(mergedFm.data, mergedFm.order) + newBody;

    // Step 15: diff frontmatter
    const fmRows = diffFrontmatter(originalParsed, mergedFm);

    // Step 15b (Task 8): mirror source/confidence onto matching fmRows for keys whose
    // FINAL (mode-gated) source is "inferred" — only possible in "additiv" mode, since
    // "deterministisch" already converted all inferred entries to content/empty above.
    // The base merge above never emits the inferred value itself (no acceptInferred) —
    // this only annotates the row so the UI can show it as "erschlossen".
    for (const row of fmRows) {
      const entry = cleanedAssignment.frontmatter[row.key];
      if (entry && entry.source === "inferred") {
        row.source = "inferred";
        row.confidence = entry.confidence;
      }
    }

    // Step 16: build sectionDiff — from template sections in template order
    const blockById = new Map(blocks.map((b) => [b.id, b.text]));
    const cleanedByHeading = new Map(cleanedAssignment.sections.map((s) => [s.heading, s.blocks]));
    const sectionDiff: SectionDiff[] = tpl.sections.map((sec) => {
      const secBlocks = cleanedByHeading.get(sec.heading) ?? [];
      const firstId = secBlocks[0];
      const provenance = firstId !== undefined ? (blockById.get(firstId) ?? null) : null;
      return { heading: sec.heading, blockIds: secBlocks, provenance };
    });

    // Step 16b: resolve unassigned block ids to SourceBlocks
    const unassigned: SourceBlock[] = cleanedAssignment.unassigned
      .map((id) => blocks.find((b) => b.id === id))
      .filter((b): b is SourceBlock => b !== undefined);

    // Step 17: collect checks
    const assembleCheck: CheckResult | null = assembleError !== null
      ? { id: "assemble", ok: false, detail: `assembleBody: ${assembleError}` }
      : null;
    const checks: CheckResult[] = [parseCheck, permCheck, fmRoundtripCheck, fmSourceCheck];
    if (additionsTargetCheck !== null) {
      checks.push(additionsTargetCheck);
    }
    if (assembleCheck !== null) {
      checks.push(assembleCheck);
    }

    // Step 18: hardOk — true iff assignment-parse + permutation + fm-roundtrip + assemble all
    // ok. "additions-target" is SOFT and never enters this formula (it does not block).
    const hardOk = parseCheck.ok && permCheck.ok && fmRoundtripCheck.ok && (assembleCheck === null || assembleCheck.ok);

    // Step 19: build the AssemblyContext (Task 7 seam) + its default granular selection,
    // and re-derive proposedText from it — this is now the SOLE source of truth for the
    // preview text (mode-aware: additions/inferred FM only ever reach it when kept above).
    // Only attempted when hardOk, matching the previous "else originalText" fallback;
    // guarded further with try/catch as defense-in-depth (kept additions/valid ids are
    // already guaranteed above, so this should not throw in practice).
    const assembly: AssemblyContext = { tpl, original: originalParsed, assignment: cleanedAssignment, blocks, additions };
    const selection = defaultSelection(assembly);
    let finalProposedText = originalText;
    if (hardOk) {
      try {
        finalProposedText = assembleProposedText(assembly, selection, false);
      } catch {
        // Defensive fallback to the legacy (additions-less) computation — should not trigger.
        finalProposedText = proposedText;
      }
    }

    return {
      notePath,
      templatePath,
      type: tpl.type,
      originalText,
      proposedText: finalProposedText,
      fmRows,
      sectionDiff,
      unassigned,
      detection: { source: detection.source, confidence: detection.confidence },
      checks,
      hardOk,
      reasoning,
      mode,
      additions,
      assembly,
      selection,
    };
    } finally {
      this.controller = null;
    }
  }

  /**
   * SOLE WRITER. Stale-hash guard: re-reads file, computes djb2 hash, compares to
   * hash of proposal.originalText. Mismatch → {written:false, reason:"stale"}.
   * If !proposal.hardOk → {written:false, reason:"blocked"}.
   * Else: build the final text FRESH from the granular selection (never the preview
   * proposal.proposedText — the user may have deselected inferred keys/additions after
   * the preview was rendered), then single write call, return
   * {written:true, undo: () => write(notePath, originalText)}.
   */
  async persistApply(proposal: ApplyProposal, selection: ApplySelection, auditTrail: boolean): Promise<ApplyResult> {
    if (!proposal.hardOk) {
      return { written: false, reason: "blocked" };
    }

    // Stale-hash guard
    const currentText = await this.deps.read(proposal.notePath);
    if (djb2(currentText) !== djb2(proposal.originalText)) {
      return { written: false, reason: "stale" };
    }

    const finalText = assembleProposedText(proposal.assembly, selection, auditTrail);
    await this.deps.write(proposal.notePath, finalText);

    const originalText = proposal.originalText;
    const notePath = proposal.notePath;

    return {
      written: true,
      undo: () => this.deps.write(notePath, originalText),
    };
  }
}
