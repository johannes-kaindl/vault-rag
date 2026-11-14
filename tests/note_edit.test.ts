import { describe, it, expect } from "vitest";
import { swapNote } from "../src/note_edit";
import type { EditorHandle, WritePorts } from "../src/vendor/kit/block-writer";

/** Notiz im Speicher mit Platte (`disk`), optional offenem Editor und einer Lücke vor `process`, in der „jemand“ die Notiz ändert. */
function notiz(disk: string, opt: { editor?: string; vorProcess?: () => void; fehlt?: boolean } = {}) {
  const st = { disk, editor: opt.editor ?? (null as string | null), processed: 0, replaces: 0 };
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

describe("swapNote — vault.process", () => {
  it("tauscht, wenn die Notiz noch den erwarteten Text trägt", async () => {
    const n = notiz("alt");
    expect(await swapNote(n.ports, "A.md", "alt", "neu", 0)).toBe(true);
    expect(n.st.disk).toBe("neu");
  });

  it("weigert sich, wenn sich die Notiz in der Lücke geändert hat — die fremde Änderung bleibt (Rot-Probe des alten Musters: Lesen, await, Schreiben hätte sie überschrieben)", async () => {
    const n = notiz("alt", { vorProcess: () => { n.st.disk = "alt + von Sync"; } });
    expect(await swapNote(n.ports, "A.md", "alt", "neu", 0)).toBe(false);
    expect(n.st.disk).toBe("alt + von Sync");
  });

  it("trägt die Notiz schon den neuen Text, gilt der Tausch als gelungen und schreibt nichts", async () => {
    const n = notiz("neu");
    expect(await swapNote(n.ports, "A.md", "alt", "neu", 0)).toBe(true);
    expect(n.st.processed).toBe(1);
    expect(n.st.disk).toBe("neu");
  });

  it("ein führendes BOM auf einer Seite ist kein Unterschied", async () => {
    const n = notiz("﻿alt");
    expect(await swapNote(n.ports, "A.md", "alt", "neu", 0)).toBe(true);
    expect(n.st.disk).toBe("neu");
  });

  it("fehlende Notiz wirft not-found", async () => {
    const n = notiz("", { fehlt: true });
    await expect(swapNote(n.ports, "A.md", "alt", "neu", 0)).rejects.toThrow("not-found");
  });
});

describe("swapNote — offener Quell-Editor", () => {
  it("prüft und tauscht auf dem Editorstand (ungespeichert), nicht über process", async () => {
    const n = notiz("alt", { editor: "alt" });
    expect(await swapNote(n.ports, "A.md", "alt", "neu", 0)).toBe(true);
    expect(n.st.editor).toBe("neu");
    expect(n.st.processed).toBe(0);
  });

  it("weigert sich, wenn im Editor seit der Berechnung getippt wurde — die getippten Zeichen bleiben", async () => {
    const n = notiz("alt", { editor: "alt, gerade getippt" });
    expect(await swapNote(n.ports, "A.md", "alt", "neu", 0)).toBe(false);
    expect(n.st.editor).toBe("alt, gerade getippt");
    expect(n.st.replaces).toBe(0);
  });

  it("ersetzt nur die Spanne, die sich unterscheidet (mehrzeilig)", async () => {
    const alt = "---\ntitel: x\n---\n\nText\nmehr";
    const neu = "---\ntitel: x\ntyp: y\n---\n\nText\nmehr";
    const n = notiz(alt, { editor: alt });
    expect(await swapNote(n.ports, "A.md", alt, neu, 0)).toBe(true);
    expect(n.st.editor).toBe(neu);
  });
});
