import { describe, it, expect, vi } from "vitest";
import { SmartApply, SmartApplyDeps, SmartApplyParams, assembleProposedText, defaultSelection, AssemblyContext } from "../src/smart_apply";
import type { ChatClient } from "../src/chat_client";
import { parseFrontmatter } from "../src/frontmatter";
import { splitBlocks } from "../src/note_restructurer";
import type { Assignment, Addition } from "../src/note_restructurer";
import { parseTemplate } from "../src/template_matcher";

// ── Test data ────────────────────────────────────────────────────────────────

const testNoteText = `---
type: Meeting
title: Projekt-Kickoff
---
## Agenda

Punkte für das Meeting.

## Ergebnisse

Erste Ergebnisse hier.
`;

const templateText = `---
type: Meeting
title:
datum:
---
## Agenda

%% Was besprochen werden soll %%

## Ergebnisse

%% Was dabei herauskam %%
`;

// Block IDs verified with splitBlocks on testNoteText:
// block_0: "## Agenda"
// block_1: "Punkte für das Meeting."
// block_2: "## Ergebnisse"
// block_3: "Erste Ergebnisse hier."

function validAssignmentJSON(): string {
  return JSON.stringify({
    version: 1,
    sections: [
      { heading: "Agenda", blocks: ["block_0", "block_1"] },
      { heading: "Ergebnisse", blocks: ["block_2", "block_3"] },
    ],
    unassigned: [],
    frontmatter: {
      title: { source: "content", value: "Projekt-Kickoff" },
      datum: { source: "empty", value: "" },
    },
  });
}

// ── Fake helpers ─────────────────────────────────────────────────────────────

function makeClient(returnContent: string, returnReasoning = "") {
  return () =>
    ({
      stream: async (
        _msgs: unknown,
        onToken: (t: string) => void,
        onReasoning: (t: string) => void,
        _signal?: AbortSignal,
      ) => {
        onToken(returnContent);
        if (returnReasoning) onReasoning(returnReasoning);
        return { content: returnContent, reasoning: returnReasoning };
      },
    }) as unknown as ChatClient;
}

function makeDeps(overrides: Partial<SmartApplyDeps> = {}): SmartApplyDeps {
  return {
    read: async () => testNoteText,
    write: vi.fn(),
    listTemplates: async () => ["Templates/Meeting.md"],
    embed: async () => new Float32Array(3).fill(0.1),
    search: () => [],
    typeOf: async () => null,
    ...overrides,
  };
}

const NOTE_PATH = "Notes/Kickoff.md";
const TEMPLATE_PATH = "Templates/Meeting.md";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SmartApply", () => {
  it("gültiges Assignment → hardOk true, assembleBody korrekt, Frontmatter gemergt", async () => {
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    expect(proposal.hardOk).toBe(true);
    expect(proposal.proposedText).toContain("## Agenda");
    expect(proposal.proposedText).toContain("Punkte für das Meeting.");
    expect(proposal.proposedText).toContain("## Ergebnisse");
    expect(proposal.proposedText).toContain("Erste Ergebnisse hier.");
    expect(proposal.fmRows.length).toBeGreaterThan(0);
    // SEAM-VERTRAG (3): detection threaded from this.detect(), not hardcoded
    expect(proposal.detection.source).toBe("frontmatter");
    expect(proposal.detection.confidence).toBe("confirmed");
  });

  it("unbekannte Block-ID → hardOk false", async () => {
    const badAssignment = JSON.stringify({
      version: 1,
      sections: [
        { heading: "Agenda", blocks: ["block_0", "block_1", "block_99"] },
        { heading: "Ergebnisse", blocks: ["block_2", "block_3"] },
      ],
      unassigned: [],
      frontmatter: {
        title: { source: "content", value: "Projekt-Kickoff" },
        datum: { source: "empty", value: "" },
      },
    });

    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient(badAssignment), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    expect(proposal.hardOk).toBe(false);
    const permCheck = proposal.checks.find((c) => c.id === "permutation");
    expect(permCheck?.ok).toBe(false);
  });

  it("fabricated (non-substring) Frontmatter-Value → Feld geleert (fm-source soft)", async () => {
    const fabricatedAssignment = JSON.stringify({
      version: 1,
      sections: [
        { heading: "Agenda", blocks: ["block_0", "block_1"] },
        { heading: "Ergebnisse", blocks: ["block_2", "block_3"] },
      ],
      unassigned: [],
      frontmatter: {
        title: { source: "content", value: "Komplett erfundener Titel XYZ" },
        datum: { source: "empty", value: "" },
      },
    });

    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient(fabricatedAssignment), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    // hardOk still true (fm-source is a soft check)
    expect(proposal.hardOk).toBe(true);
    // The title key should be empty or the original value (not the fabricated one)
    const titleRow = proposal.fmRows.find((r) => r.key === "title");
    expect(titleRow).toBeDefined();
    // Fabricated value must NOT appear in proposed text
    expect(proposal.proposedText).not.toContain("Komplett erfundener Titel XYZ");
  });

  it("malformed JSON → hardOk false (assignment-parse)", async () => {
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient("Dies ist kein JSON und kann nicht geparst werden."), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    expect(proposal.hardOk).toBe(false);
    const parseCheck = proposal.checks.find((c) => c.id === "assignment-parse");
    expect(parseCheck?.ok).toBe(false);
  });

  it("abort propagiert", async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const abortingClient = () =>
      ({
        stream: async (
          _msgs: unknown,
          _onToken: (t: string) => void,
          _onReasoning: (t: string) => void,
          signal?: AbortSignal,
        ) => {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          throw new DOMException("Aborted", "AbortError");
        },
      }) as unknown as ChatClient;

    controller.abort();
    const sa = new SmartApply(deps, abortingClient, () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));

    await expect(
      sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {}, controller.signal),
    ).rejects.toThrow();
  });

  it("persistApply stale-hash → kein Write", async () => {
    let fileContent = testNoteText;
    const writeFn = vi.fn();
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return fileContent;
      },
      write: writeFn,
    });
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    // Simulate the file being modified externally
    fileContent = testNoteText + "\n<!-- external edit -->";

    const result = await sa.persistApply(proposal);
    expect(result.written).toBe(false);
    expect(result.reason).toBe("stale");
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("persistApply happy path → genau ein Write (spy)", async () => {
    const writeFn = vi.fn();
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
      write: writeFn,
    });
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    expect(proposal.hardOk).toBe(true);
    const result = await sa.persistApply(proposal);

    expect(result.written).toBe(true);
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledWith(NOTE_PATH, proposal.proposedText);
  });

  it("undo stellt Original wieder her", async () => {
    const writeFn = vi.fn();
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
      write: writeFn,
    });
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    const result = await sa.persistApply(proposal);
    expect(result.written).toBe(true);
    expect(result.undo).toBeDefined();

    writeFn.mockClear();
    await result.undo!();
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledWith(NOTE_PATH, testNoteText);
  });

  it("Idempotenz: erneute Anwendung auf bereits angewandte Notiz → leeres diff", async () => {
    const writeFn = vi.fn();
    let currentContent = testNoteText;
    let clientJson = validAssignmentJSON();
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return currentContent;
      },
      write: writeFn,
    });
    const sa = new SmartApply(deps, () => makeClient(clientJson)(), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));

    // First apply
    const proposal1 = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});
    expect(proposal1.hardOk).toBe(true);
    await sa.persistApply(proposal1);
    // Update "stored" content to proposedText
    currentContent = proposal1.proposedText;

    // Discover actual block IDs in the applied note by splitting its body
    const appliedParsed = parseFrontmatter(proposal1.proposedText);
    const appliedBlocks = splitBlocks(appliedParsed.body);
    // Partition blocks into their sections by heading boundaries
    const agendaIdx = appliedBlocks.findIndex((b) => b.text.startsWith("## Agenda"));
    const ergebnisseIdx = appliedBlocks.findIndex((b) => b.text.startsWith("## Ergebnisse"));
    const secondAgendaIds = appliedBlocks
      .slice(agendaIdx, ergebnisseIdx)
      .map((b) => b.id);
    const secondErgebnisseIds = appliedBlocks
      .slice(ergebnisseIdx)
      .map((b) => b.id);
    clientJson = JSON.stringify({
      version: 1,
      sections: [
        { heading: "Agenda", blocks: secondAgendaIds },
        { heading: "Ergebnisse", blocks: secondErgebnisseIds },
      ],
      unassigned: [],
      frontmatter: {
        title: { source: "content", value: "Projekt-Kickoff" },
        datum: { source: "empty", value: "" },
      },
    });

    // Second apply — re-run on the already-applied note with correct block IDs
    const proposal2 = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});
    expect(proposal2.hardOk).toBe(true);
    const changedRows = proposal2.fmRows.filter((r) => r.change !== "unveraendert");
    expect(changedRows.length).toBe(0);
  });

  it("provenance zeigt Original-Überschrift", async () => {
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    // provenance should be the block text (e.g. "## Agenda"), not "block_0"
    const agendaSection = proposal.sectionDiff.find((s) => s.heading === "Agenda");
    expect(agendaSection).toBeDefined();
    expect(agendaSection!.provenance).not.toMatch(/^block_\d+$/);
    expect(agendaSection!.provenance).toBe("## Agenda");
  });

  it("RAG-Zweig: detection.source === 'rag' wenn keine frontmatter-type aber embed/search/typeOf greifen", async () => {
    // Note WITHOUT a frontmatter type: field
    const noteWithoutType = `---
title: Projekt-Kickoff
---
## Agenda

Punkte für das Meeting.

## Ergebnisse

Erste Ergebnisse hier.
`;
    const ragDeps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return noteWithoutType;
      },
      // embed returns a non-zero vector so search is called
      embed: async () => new Float32Array(3).fill(0.5),
      // search returns a hit
      search: () => [{ path: "Notes/SomeNote.md", score: 0.9 }],
      // typeOf resolves to "Meeting" for that hit
      typeOf: async () => "Meeting",
      // listTemplates contains the matching template
      listTemplates: async () => ["Templates/Meeting.md"],
    });
    const sa = new SmartApply(ragDeps, makeClient(validAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    // SEAM-VERTRAG (3): RAG path threaded from this.detect()
    expect(proposal.detection.source).toBe("rag");
    expect(proposal.detection.confidence).toBe("likely");
  });

  it("onToken/onReasoning an Stream weitergeleitet", async () => {
    const tokens: string[] = [];
    const reasonings: string[] = [];
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const client = () =>
      ({
        stream: async (
          _msgs: unknown,
          onToken: (t: string) => void,
          onReasoning: (t: string) => void,
          _signal?: AbortSignal,
        ) => {
          onToken("tok1");
          onToken("tok2");
          onReasoning("reason1");
          return { content: validAssignmentJSON(), reasoning: "reason1" };
        },
      }) as unknown as ChatClient;

    const sa = new SmartApply(deps, client, () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    await sa.propose(
      NOTE_PATH,
      TEMPLATE_PATH,
      "deterministisch",
      (t) => tokens.push(t),
      (t) => reasonings.push(t),
    );

    expect(tokens).toContain("tok1");
    expect(tokens).toContain("tok2");
    expect(reasonings).toContain("reason1");
  });

  it("temperature: konfigurierter Wert erreicht stream opts", async () => {
    let capturedOpts: { temperature?: number; model?: string; suppressThinking?: boolean; maxTokens?: number } | undefined;
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const client = () =>
      ({
        stream: async (
          _msgs: unknown,
          onToken: (t: string) => void,
          _onReasoning: (t: string) => void,
          _signal?: AbortSignal,
          opts?: { temperature?: number; model?: string; suppressThinking?: boolean; maxTokens?: number },
        ) => {
          capturedOpts = opts;
          onToken(validAssignmentJSON());
          return { content: validAssignmentJSON(), reasoning: "" };
        },
      }) as unknown as ChatClient;

    const sa = new SmartApply(deps, client, () => ({ model: 'm', temperature: 0.7, suppressThinking: false, maxTokens: 2048 }));
    await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    expect(capturedOpts?.temperature).toBe(0.7);
  });

  it("params(): alle vier Werte (model, temperature, suppressThinking, maxTokens) erreichen stream opts", async () => {
    let capturedOpts: { temperature?: number; model?: string; suppressThinking?: boolean; maxTokens?: number } | undefined;
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const client = () =>
      ({
        stream: async (
          _msgs: unknown,
          onToken: (t: string) => void,
          _onReasoning: (t: string) => void,
          _signal?: AbortSignal,
          opts?: { temperature?: number; model?: string; suppressThinking?: boolean; maxTokens?: number },
        ) => {
          capturedOpts = opts;
          onToken(validAssignmentJSON());
          return { content: validAssignmentJSON(), reasoning: "" };
        },
      }) as unknown as ChatClient;

    const testParams: SmartApplyParams = { model: 'm-fast', temperature: 0.4, suppressThinking: true, maxTokens: 777 };
    const sa = new SmartApply(deps, client, () => testParams);
    await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    expect(capturedOpts?.model).toBe('m-fast');
    expect(capturedOpts?.temperature).toBe(0.4);
    expect(capturedOpts?.suppressThinking).toBe(true);
    expect(capturedOpts?.maxTokens).toBe(777);
  });

  it("abort() bricht laufendes propose() ab", async () => {
    let resolveStream!: () => void;
    const streamStarted = new Promise<void>((res) => { resolveStream = res; });
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const client = () =>
      ({
        stream: async (
          _msgs: unknown,
          _onToken: (t: string) => void,
          _onReasoning: (t: string) => void,
          signal?: AbortSignal,
        ) => {
          resolveStream();
          // Wait for abort or a long timeout
          await new Promise<void>((_, reject) => {
            if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          });
        },
      }) as unknown as ChatClient;

    const sa = new SmartApply(deps, client, () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposePromise = sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});
    await streamStarted;
    sa.abort();

    await expect(proposePromise).rejects.toThrow();
  });

  it("Block unter unbekannter Überschrift landet in unassigned (kein stiller Verlust)", async () => {
    // LLM puts block_3 under a non-template heading "Notizen" (not in template)
    const badHeadingAssignment = JSON.stringify({
      version: 1,
      sections: [
        { heading: "Agenda", blocks: ["block_0", "block_1"] },
        { heading: "Ergebnisse", blocks: ["block_2"] },
        { heading: "Notizen", blocks: ["block_3"] }, // not in template!
      ],
      unassigned: [],
      frontmatter: {
        title: { source: "content", value: "Projekt-Kickoff" },
        datum: { source: "empty", value: "" },
      },
    });
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient(badHeadingAssignment), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    // block_3 ("Erste Ergebnisse hier.") must be in unassigned
    expect(proposal.unassigned.map(b => b.id)).toContain("block_3");
    // block_3 must NOT be in the assembled body under "Notizen"
    expect(proposal.proposedText).not.toContain("Notizen");
    // hardOk = true (permutation check passes after reconcile)
    expect(proposal.hardOk).toBe(true);
  });

  it("sectionDiff enthält alle Template-Sektionen in Template-Reihenfolge (auch LLM-ausgelassene)", async () => {
    // LLM only returns one section, omits "Ergebnisse"
    const partialAssignment = JSON.stringify({
      version: 1,
      sections: [
        { heading: "Agenda", blocks: ["block_0", "block_1"] },
      ],
      unassigned: ["block_2", "block_3"],
      frontmatter: {
        title: { source: "content", value: "Projekt-Kickoff" },
        datum: { source: "empty", value: "" },
      },
    });
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient(partialAssignment), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    // sectionDiff must have both template sections
    const headings = proposal.sectionDiff.map(s => s.heading);
    expect(headings).toContain("Agenda");
    expect(headings).toContain("Ergebnisse");
    // Template order: Agenda first, then Ergebnisse
    expect(headings.indexOf("Agenda")).toBeLessThan(headings.indexOf("Ergebnisse"));
    // Ergebnisse was omitted by LLM → empty blockIds
    const ergebnisse = proposal.sectionDiff.find(s => s.heading === "Ergebnisse");
    expect(ergebnisse?.blockIds).toHaveLength(0);
  });

  it("Template-Frontmatter-Default füllt auf wenn Note-Frontmatter fehlt (type=Besprechung)", async () => {
    const besprechungTemplate = `---
type: Besprechung
status: offen
---
## Tagesordnung

%% Was besprochen werden soll %%

## Ergebnisse

%% Ergebnisse der Besprechung %%
`;
    const noteWithoutType = `## Tagesordnung

Punkt 1: Projektstand.

## Ergebnisse

Keine bisher.
`;
    // Blocks in noteWithoutType: block_0="## Tagesordnung", block_1="Punkt 1: Projektstand.", block_2="## Ergebnisse", block_3="Keine bisher."
    const assignment = JSON.stringify({
      version: 1,
      sections: [
        { heading: "Tagesordnung", blocks: ["block_0", "block_1"] },
        { heading: "Ergebnisse", blocks: ["block_2", "block_3"] },
      ],
      unassigned: [],
      frontmatter: {
        type: { source: "empty", value: "" }, // LLM correctly marks as empty (not in body)
        status: { source: "empty", value: "" },
      },
    });
    const deps = makeDeps({
      read: async (p: string) => {
        if (p === "Templates/Besprechung.md") return besprechungTemplate;
        return noteWithoutType;
      },
      listTemplates: async () => ["Templates/Besprechung.md"],
    });
    const sa = new SmartApply(deps, makeClient(assignment), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, "Templates/Besprechung.md", "deterministisch", () => {}, () => {});

    expect(proposal.hardOk).toBe(true);
    // type and status must come from template defaults
    const parsedFm = parseFrontmatter(proposal.proposedText);
    expect(parsedFm.data["type"]).toBe("Besprechung");
    expect(parsedFm.data["status"]).toBe("offen");
  });

  it("unassigned Block erscheint in proposedText unter ## Übrig", async () => {
    // Using testNoteText + templateText from the existing test setup
    // Block that goes to unassigned: block_3 = "Erste Ergebnisse hier."
    // (block_3 is put under non-template heading "Notizen" → reconcile moves to unassigned)
    const assignmentWithUnassigned = JSON.stringify({
      version: 1,
      sections: [
        { heading: "Agenda", blocks: ["block_0", "block_1"] },
        { heading: "Ergebnisse", blocks: ["block_2"] },
        { heading: "Notizen", blocks: ["block_3"] }, // non-template → reconcile → unassigned
      ],
      unassigned: [],
      frontmatter: {
        title: { source: "content", value: "Projekt-Kickoff" },
        datum: { source: "empty", value: "" },
      },
    });
    const deps = makeDeps({
      read: async (p: string) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient(assignmentWithUnassigned), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {});

    expect(proposal.hardOk).toBe(true);
    expect(proposal.proposedText).toContain("## Übrig");
    expect(proposal.proposedText).toContain("Erste Ergebnisse hier.");
    // And unassigned is also in the proposal.unassigned array
    expect(proposal.unassigned.map((b) => b.id)).toContain("block_3");
  });

  it("propose() mit übergebener detection ruft detect() nicht erneut auf", async () => {
    const detectSpy = vi.spyOn(SmartApply.prototype, "detect");
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const preDetection = await sa.detect(NOTE_PATH); // call once explicitly
    detectSpy.mockClear(); // reset call count
    await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", () => {}, () => {}, undefined, preDetection);
    expect(detectSpy).not.toHaveBeenCalled();
    detectSpy.mockRestore();
  });
});

// ── propose(mode) — Gating ──────────────────────────────────────────────────────

describe("propose mode gating", () => {
  const noop = () => {};

  // v2-Assignment: addition targets "Agenda" (existing template heading); "datum" is
  // inferred (not literally in testNoteText) with confidence "mittel" (not "niedrig").
  function gatingAssignmentJSON(): string {
    return JSON.stringify({
      version: 2,
      sections: [
        { heading: "Agenda", blocks: ["block_0", "block_1"] },
        { heading: "Ergebnisse", blocks: ["block_2", "block_3"] },
      ],
      unassigned: [],
      additions: [
        { id: "add_0", targetHeading: "Agenda", text: "Ergänzter Punkt.", confidence: "hoch" },
      ],
      frontmatter: {
        title: { source: "content", value: "Projekt-Kickoff" },
        datum: { source: "inferred", value: "System", confidence: "mittel" },
      },
    });
  }

  // Template WITHOUT an "Agenda" section — the addition's targetHeading has no match here.
  const tplWithStrayAdditionText = `---
type: Meeting
title:
datum:
---
## Ergebnisse

%% Was dabei herauskam %%
`;
  const STRAY_TEMPLATE_PATH = "Templates/StrayAddition.md";

  function makeGatingDeps(templatePath: string, templateText_: string) {
    return makeDeps({
      read: async (p) => {
        if (p === templatePath) return templateText_;
        return testNoteText;
      },
      listTemplates: async () => [templatePath],
    });
  }

  it("deterministisch verwirft additions und inferred (Wörtlichkeit erzwungen)", async () => {
    const deps = makeGatingDeps(TEMPLATE_PATH, templateText);
    const sa = new SmartApply(deps, makeClient(gatingAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const p = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "deterministisch", noop, noop);

    expect(p.additions).toHaveLength(0);
    expect(p.mode).toBe("deterministisch");
    // inferred-Wert, der nicht wörtlich im Text steht, ist nicht gesetzt:
    expect(p.proposedText).not.toContain("System");
  });

  it("additiv behält additions + inferred", async () => {
    const deps = makeGatingDeps(TEMPLATE_PATH, templateText);
    const sa = new SmartApply(deps, makeClient(gatingAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const p = await sa.propose(NOTE_PATH, TEMPLATE_PATH, "additiv", noop, noop);

    expect(p.additions.length).toBeGreaterThan(0);
    expect(p.mode).toBe("additiv");
    // default-selection (mittel) hat den inferred-Wert schon in der Preview:
    expect(p.proposedText).toContain("System");
    // Step 6: fmRows tragen source/confidence für inferred-Keys
    const datumRow = p.fmRows.find((r) => r.key === "datum");
    expect(datumRow?.source).toBe("inferred");
    expect(datumRow?.confidence).toBe("mittel");
  });

  it("additiv droppt addition mit fremder targetHeading → weicher Check, hardOk bleibt true", async () => {
    const deps = makeGatingDeps(STRAY_TEMPLATE_PATH, tplWithStrayAdditionText);
    const sa = new SmartApply(deps, makeClient(gatingAssignmentJSON()), () => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 }));
    const p = await sa.propose(NOTE_PATH, STRAY_TEMPLATE_PATH, "additiv", noop, noop);

    expect(p.checks.find((c) => c.id === "additions-target")?.ok).toBe(false);
    expect(p.hardOk).toBe(true);
  });
});

// ── assembleProposedText / defaultSelection ────────────────────────────────────

describe("assembleProposedText", () => {
  const assembleTemplateText = `---
type: Notiz
bereich:
---
## Notizen

%% Beliebige Notizen %%
`;

  const assembleNoteText = `---
type: Notiz
---
## Notizen

Ein Punkt.
`;

  function buildCtx(): AssemblyContext {
    const tpl = parseTemplate(assembleTemplateText);
    const original = parseFrontmatter(assembleNoteText);
    const blocks = splitBlocks(original.body);
    // blocks: block_0 = "## Notizen", block_1 = "Ein Punkt."
    const assignment: Assignment = {
      version: 1,
      sections: [{ heading: "Notizen", blocks: ["block_0", "block_1"] }],
      unassigned: [],
      frontmatter: {
        bereich: { source: "inferred", value: "System", confidence: "mittel" },
      },
    };
    const additions: Addition[] = [
      { id: "add_0", targetHeading: "Notizen", text: "Erschlossen.", confidence: "niedrig" },
    ];
    return { tpl, original, assignment, blocks, additions };
  }

  const ctx = buildCtx();

  it("defaultSelection nimmt hoch+mittel, lässt niedrig aus", () => {
    const sel = defaultSelection(ctx);
    expect(sel.inferredKeys.has("bereich")).toBe(true); // mittel
    expect(sel.additionIds.has("add_0")).toBe(false); // niedrig
  });

  it("volle Auswahl bringt inferred-Wert + addition-Text in den Output", () => {
    const text = assembleProposedText(
      ctx,
      { inferredKeys: new Set(["bereich"]), additionIds: new Set(["add_0"]) },
      false,
    );
    expect(text).toContain("System");
    expect(text).toContain("Erschlossen.");
  });

  it("leere Auswahl → weder inferred noch addition im Output", () => {
    const text = assembleProposedText(ctx, { inferredKeys: new Set(), additionIds: new Set() }, false);
    expect(text).not.toContain("System");
    expect(text).not.toContain("Erschlossen.");
  });
});
