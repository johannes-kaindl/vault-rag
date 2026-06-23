import { describe, it, expect, vi } from "vitest";
import { SmartApply, SmartApplyDeps } from "../src/smart_apply";
import type { ChatClient } from "../src/chat_client";
import { parseFrontmatter } from "../src/frontmatter";
import { splitBlocks } from "../src/note_restructurer";

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
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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
    const sa = new SmartApply(deps, makeClient(badAssignment), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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
    const sa = new SmartApply(deps, makeClient(fabricatedAssignment), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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
    const sa = new SmartApply(deps, makeClient("Dies ist kein JSON und kann nicht geparst werden."), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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
    const sa = new SmartApply(deps, abortingClient, () => 0);

    await expect(
      sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {}, controller.signal),
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
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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
    const sa = new SmartApply(deps, () => makeClient(clientJson)(), () => 0);

    // First apply
    const proposal1 = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});
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
    const proposal2 = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});
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
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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
    const sa = new SmartApply(ragDeps, makeClient(validAssignmentJSON()), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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

    const sa = new SmartApply(deps, client, () => 0);
    await sa.propose(
      NOTE_PATH,
      TEMPLATE_PATH,
      (t) => tokens.push(t),
      (t) => reasonings.push(t),
    );

    expect(tokens).toContain("tok1");
    expect(tokens).toContain("tok2");
    expect(reasonings).toContain("reason1");
  });

  it("temperature: konfigurierter Wert erreicht stream opts", async () => {
    let capturedOpts: { temperature?: number } | undefined;
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
          opts?: { temperature?: number },
        ) => {
          capturedOpts = opts;
          onToken(validAssignmentJSON());
          return { content: validAssignmentJSON(), reasoning: "" };
        },
      }) as unknown as ChatClient;

    const sa = new SmartApply(deps, client, () => 0.7);
    await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

    expect(capturedOpts?.temperature).toBe(0.7);
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

    const sa = new SmartApply(deps, client, () => 0);
    const proposePromise = sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});
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
    const sa = new SmartApply(deps, makeClient(badHeadingAssignment), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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
    const sa = new SmartApply(deps, makeClient(partialAssignment), () => 0);
    const proposal = await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {});

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

  it("propose() mit übergebener detection ruft detect() nicht erneut auf", async () => {
    const detectSpy = vi.spyOn(SmartApply.prototype, "detect");
    const deps = makeDeps({
      read: async (p) => {
        if (p === TEMPLATE_PATH) return templateText;
        return testNoteText;
      },
    });
    const sa = new SmartApply(deps, makeClient(validAssignmentJSON()), () => 0);
    const preDetection = await sa.detect(NOTE_PATH); // call once explicitly
    detectSpy.mockClear(); // reset call count
    await sa.propose(NOTE_PATH, TEMPLATE_PATH, () => {}, () => {}, undefined, preDetection);
    expect(detectSpy).not.toHaveBeenCalled();
    detectSpy.mockRestore();
  });
});
