import { describe, it, expect } from "vitest";
import VaultRagPlugin from "../src/main";
import { TFile } from "obsidian";
import "../src/i18n/strings";

/** Verdrahtung (Welle 34): Smart Apply tauscht den Notiztext über `vault.process` (Plugin-Methode `swapNoteText`), nie mit `adapter.write`. Die Regeln des Tauschs stehen in note_edit.test.ts. */
function plugin(opt: { disk: string; vorProcess?: () => void }) {
  const st = { disk: opt.disk, adapterWrites: 0 };
  const file = new (TFile as unknown as new (path: string) => TFile)("A.md");   // der Mock nimmt den Pfad, die echte d.ts nicht
  const fake = {
    app: {
      workspace: { getLeavesOfType: () => [] },
      vault: {
        getAbstractFileByPath: (p: string) => (p === "A.md" ? file : null),
        async process(_f: TFile, fn: (t: string) => string) { await Promise.resolve(); opt.vorProcess?.(); st.disk = fn(st.disk); return st.disk; },
        adapter: { read: async () => { throw new Error("adapter.read ist der alte Weg"); }, write: async () => { st.adapterWrites++; } },
      },
    },
  };
  return { st, fake };
}
const swap = (VaultRagPlugin.prototype as unknown as { swapNoteText(this: unknown, p: string, e: string, n: string): Promise<boolean> }).swapNoteText;

describe("Smart Apply tauscht über vault.process", () => {
  it("tauscht den erwarteten Text, ohne adapter.write", async () => {
    const { st, fake } = plugin({ disk: "alt" });
    expect(await swap.call(fake, "A.md", "alt", "neu")).toBe(true);
    expect(st.disk).toBe("neu");
    expect(st.adapterWrites).toBe(0);
  });

  it("eine Änderung zwischen Berechnung und Tausch bleibt erhalten, der Tausch meldet false", async () => {
    const p = plugin({ disk: "alt", vorProcess: () => { p.st.disk = "alt von Sync"; } });
    expect(await swap.call(p.fake, "A.md", "alt", "neu")).toBe(false);
    expect(p.st.disk).toBe("alt von Sync");
  });
});
