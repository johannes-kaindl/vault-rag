import { describe, it, expect, vi } from "vitest";
import VaultRagPlugin from "../src/main";
import { TFile } from "obsidian";
import { hashText } from "../src/integrator";
import "../src/i18n/strings";

/** Verdrahtung von acceptLink/applyLinkNow (Welle 34): beide schreiben über `vault.process`, nicht mit `adapter.read` + `adapter.write`.
 *  Der Rest (Hash-Guard im Callback, Editor-Weg) steht in link_apply.test.ts; hier zählt, dass main.ts diesen Weg nimmt. */
function plugin(opt: { disk: string; vorProcess?: () => void; hash?: number }) {
  const st = { disk: opt.disk, adapterWrites: 0, saves: 0, resolved: [] as string[], stale: 0, hash: opt.hash ?? hashText(opt.disk) };
  const file = new (TFile as unknown as new (path: string) => TFile)("A.md");   // der Mock nimmt den Pfad, die echte d.ts nicht
  const fake = {
    app: {
      workspace: { getLeavesOfType: () => [] },
      vault: {
        getAbstractFileByPath: (p: string) => (p === "A.md" ? file : null),
        async process(_f: TFile, fn: (t: string) => string) { await Promise.resolve(); opt.vorProcess?.(); st.disk = fn(st.disk); return st.disk; },
        adapter: {
          read: async () => { throw new Error("adapter.read ist der alte, nicht atomare Weg"); },
          write: async () => { st.adapterWrites++; },
        },
      },
    },
    settings: { linkTarget: "section", linkHeading: "Verwandte Notizen", linkField: "verwandt", integratorEnabled: true, exclude: [] as string[] },
    integratorStore: {
      get: () => ({ noteHash: st.hash }),
      markStale: () => { st.stale++; },
      resolve: (_p: string, t: string) => { st.resolved.push(t); },
      updateHash: (_p: string, h: number) => { st.hash = h; },
    },
    saveIntegratorStore: async () => { st.saves++; },
    writeLinkInto: (VaultRagPlugin.prototype as unknown as { writeLinkInto: unknown }).writeLinkInto,
  };
  return { st, fake };
}
const proto = VaultRagPlugin.prototype;

describe("acceptLink / applyLinkNow schreiben über vault.process", () => {
  it("acceptLink: schreibt, löst die Karte auf, zieht den Hash nach — ohne adapter.write", async () => {
    const { st, fake } = plugin({ disk: "# A\n\nText" });
    const r = await proto.acceptLink.call(fake as never, "A.md", "Notes/B.md");
    expect(r).toEqual({ kind: "written" });
    expect(st.disk).toContain("[[Notes/B|B]]");
    expect(st.adapterWrites).toBe(0);
    expect(st.resolved).toEqual(["Notes/B.md"]);
    expect(st.hash).toBe(hashText(st.disk));
  });

  it("acceptLink: Änderung zwischen Berechnung und Schreiben — stale, die Änderung bleibt, die Karte wird als veraltet markiert", async () => {
    const fremd = "# A\n\nText\nvon Sync";
    const f2 = plugin({ disk: "# A\n\nText", vorProcess: () => { f2.st.disk = fremd; } });
    const r = await proto.acceptLink.call(f2.fake as never, "A.md", "Notes/B.md");
    expect(r).toEqual({ kind: "stale" });
    expect(f2.st.disk).toBe(fremd);
    expect(f2.st.stale).toBe(1);
    expect(f2.st.resolved).toEqual([]);
  });

  it("applyLinkNow: behält eine Änderung aus der Lücke und hängt den Link an den neuen Stand", async () => {
    const p = plugin({ disk: "# A\n\nText", vorProcess: () => { p.st.disk += "\nvon Sync"; } });
    const r = await proto.applyLinkNow.call(p.fake as never, "A.md", "Notes/B.md");
    expect(r).toEqual({ ok: true, changed: true });
    expect(p.st.disk).toContain("von Sync");
    expect(p.st.disk).toContain("[[Notes/B|B]]");
    expect(p.st.adapterWrites).toBe(0);
  });

  it("applyLinkNow: unbekannte Notiz → not-found, ausgeschlossener Pfad → excluded", async () => {
    const p = plugin({ disk: "x" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await proto.applyLinkNow.call(p.fake as never, "fehlt.md", "Notes/B.md")).toEqual({ ok: false, reason: "not-found" });
    p.fake.settings.exclude = ["A"];
    expect(await proto.applyLinkNow.call(p.fake as never, "A.md", "Notes/B.md")).toEqual({ ok: false, reason: "excluded" });
  });
});
