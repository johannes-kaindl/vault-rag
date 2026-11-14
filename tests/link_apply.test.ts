import { describe, it, expect } from "vitest";
import { applyLinkAtomic } from "../src/link_apply";
import { appendSectionLink } from "../src/link_writer";
import { hashText } from "../src/integrator";
import type { EditorHandle, WritePorts } from "../src/vendor/kit/block-writer";

/** Notiz im Speicher. `vorProcess` ist die Lücke, in der vorher gelesen und danach geschrieben wurde: hier ändert „jemand“ die Notiz. */
function notiz(start: string, opt: { editor?: string; vorProcess?: () => void; fehlt?: boolean } = {}) {
  const st = { disk: start, editor: opt.editor ?? null as string | null, processed: 0, replaces: 0 };
  const editor: EditorHandle = {
    getValue: () => st.editor ?? "",
    replaceRange(text, from, to) {
      const e = st.editor ?? "";
      const off = (pos: { line: number; ch: number }) => e.split("\n").slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.ch;
      st.editor = e.slice(0, off(from)) + text + e.slice(off(to));
      st.replaces++;
    },
  };
  const ports: WritePorts = {
    editorFor: () => (st.editor === null ? null : editor),
    vault: {
      read: async () => st.disk,
      async process(_p, fn) {
        if (opt.fehlt) throw new Error("Note not found");
        await Promise.resolve();
        opt.vorProcess?.();
        st.processed++;
        st.disk = fn(st.disk);
      },
    },
  };
  return { st, ports };
}

const compute = (text: string) => appendSectionLink(text, "Verwandte Notizen", "Notes/B.md");
const eingabe = (path = "A.md", expectHash: number | null = null) => ({ path, expectHash, hash: hashText, compute, persistWaitMs: 0 });

describe("applyLinkAtomic — vault.process", () => {
  it("schreibt den Link in den Stand, den process liest, und behält eine Änderung aus der Lücke (applyLinkNow)", async () => {
    const n = notiz("# A\n\nText", { vorProcess: () => { n.st.disk += "\nvon Sync"; } });
    const r = await applyLinkAtomic(n.ports, eingabe());
    expect(r.kind).toBe("written");
    expect(n.st.disk).toContain("von Sync");
    expect(n.st.disk).toContain("[[Notes/B|B]]");
  });

  it("Hash-Guard prüft den Stand beim Schreiben: wurde die Notiz in der Lücke geändert, kommt stale und nichts wird geschrieben (acceptLink)", async () => {
    const vorher = "# A\n\nText";
    const n = notiz(vorher, { vorProcess: () => { n.st.disk = vorher + "\nin der Lücke getippt"; } });
    const r = await applyLinkAtomic(n.ports, eingabe("A.md", hashText(vorher)));
    expect(r).toEqual({ kind: "stale" });
    expect(n.st.disk).toBe(vorher + "\nin der Lücke getippt");
  });

  it("unveränderter Stand mit passendem Hash wird geschrieben", async () => {
    const vorher = "# A\n\nText";
    const n = notiz(vorher);
    const r = await applyLinkAtomic(n.ports, eingabe("A.md", hashText(vorher)));
    expect(r.kind).toBe("written");
    expect(n.st.disk).toBe("# A\n\nText\n\n## Verwandte Notizen\n- [[Notes/B|B]]\n");
  });

  it("Link schon da: unchanged, der Text bleibt", async () => {
    const n = notiz("# A\n\nsiehe [[Notes/B]]");
    const r = await applyLinkAtomic(n.ports, eingabe());
    expect(r.kind).toBe("unchanged");
    expect(n.st.disk).toBe("# A\n\nsiehe [[Notes/B]]");
  });

  it("Notiz fehlt: not-found", async () => {
    const n = notiz("", { fehlt: true });
    expect(await applyLinkAtomic(n.ports, eingabe())).toEqual({ kind: "error", reason: "not-found" });
  });

  it("Rechenfehler des Schreibers wird als Grund durchgereicht und nichts geschrieben", async () => {
    const n = notiz("---\ntags: >\n  x\nverwandt: >\n  y\n---\nText");
    const r = await applyLinkAtomic(n.ports, { path: "A.md", expectHash: null, hash: hashText, compute: (t) => ({ ok: false, reason: "block-scalar" }) });
    expect(r).toEqual({ kind: "error", reason: "block-scalar" });
    expect(n.st.disk).toContain("verwandt: >");
  });

  it("CRLF im Editorstand: Weg über process, der Editor bleibt unberührt", async () => {
    const n = notiz("# A\r\n\r\nText", { editor: "# A\r\n\r\nText" });
    const r = await applyLinkAtomic(n.ports, eingabe());
    expect(r.kind).toBe("written");
    expect(n.st.replaces).toBe(0);
    expect(n.st.processed).toBe(1);
  });
});

describe("applyLinkAtomic — offener Quell-Editor", () => {
  it("rechnet auf dem Stand des Editors (ungespeichert), schreibt nur die Spanne des Links und nicht über process", async () => {
    const n = notiz("# A\n\nText", { editor: "# A\n\nText, gerade getippt" });
    const r = await applyLinkAtomic(n.ports, eingabe());
    expect(r.kind).toBe("written");
    expect(n.st.editor).toBe("# A\n\nText, gerade getippt\n\n## Verwandte Notizen\n- [[Notes/B|B]]\n");
    expect(n.st.processed).toBe(0);
    expect(n.st.disk).toBe("# A\n\nText");
  });

  it("Hash-Guard gilt für den Editorstand: Tippen seit der Berechnung heißt stale, der Editor bleibt", async () => {
    const n = notiz("# A", { editor: "# A\n\nneu getippt" });
    const r = await applyLinkAtomic(n.ports, eingabe("A.md", hashText("# A")));
    expect(r).toEqual({ kind: "stale" });
    expect(n.st.editor).toBe("# A\n\nneu getippt");
    expect(n.st.replaces).toBe(0);
  });

  it("Einfügen mitten im Text (unter vorhandener Überschrift) ersetzt nur die eingefügte Zeile", async () => {
    const text = "# A\n\n## Verwandte Notizen\n- [[Notes/C|C]]\n\n## Sonst\nx\n";
    const n = notiz(text, { editor: text });
    const r = await applyLinkAtomic(n.ports, eingabe());
    expect(r.kind).toBe("written");
    expect(n.st.editor).toBe("# A\n\n## Verwandte Notizen\n- [[Notes/C|C]]\n- [[Notes/B|B]]\n\n## Sonst\nx\n");
  });

  it("Frontmatter-Weg: der Editorstand entspricht danach genau dem berechneten Text", async () => {
    const text = "---\nverwandt:\n  - \"[[Notes/C|C]]\"\ntitel: x\n---\nText\n";
    const n = notiz(text, { editor: text });
    const rechnen = (t: string) => ({ ok: true as const, changed: true, content: t.replace("titel: x", "titel: x\nneu: 1") });
    const r = await applyLinkAtomic(n.ports, { path: "A.md", expectHash: null, hash: hashText, compute: rechnen, persistWaitMs: 0 });
    expect(r.kind).toBe("written");
    expect(n.st.editor).toBe(rechnen(text).content);
  });

  it("wartet nach dem Editor-Schreiben, bis die Platte den Text trägt (Obsidian speichert den Editor entzögert)", async () => {
    const n = notiz("# A\n\nText", { editor: "# A\n\nText" });
    // „Speichern“ nach 120 ms: die Platte übernimmt den Editorstand erst dann
    const ports = { ...n.ports, vault: { ...n.ports.vault, read: async () => n.st.disk } };
    setTimeout(() => { n.st.disk = n.st.editor ?? ""; }, 120);
    const r = await applyLinkAtomic(ports, { ...eingabe(), persistWaitMs: 2000 });
    expect(r.kind).toBe("written");
    expect(n.st.disk).toBe(n.st.editor);
    expect(n.st.disk).toContain("[[Notes/B|B]]");
  });

  it("speichert Obsidian nicht innerhalb der Frist, bleibt es bei written (der Text steht im Editor)", async () => {
    const n = notiz("# A", { editor: "# A" });
    const r = await applyLinkAtomic(n.ports, { ...eingabe(), persistWaitMs: 100 });
    expect(r.kind).toBe("written");
    expect(n.st.disk).toBe("# A");
    expect(n.st.editor).toContain("[[Notes/B|B]]");
  });

  it("Wirft der Editor beim Ersetzen, kommt write-failed", async () => {
    const n = notiz("# A", { editor: "# A" });
    n.ports.editorFor = () => ({ getValue: () => "# A", replaceRange: () => { throw new Error("kaputt"); } });
    expect(await applyLinkAtomic(n.ports, eingabe())).toEqual({ kind: "error", reason: "write-failed" });
  });
});
