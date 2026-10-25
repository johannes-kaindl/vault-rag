import { describe, it, expect } from "vitest";
import "../src/i18n/strings"; // i18n-Texte registrieren
import { StampGap, describeStampGap } from "../src/stamp_gap";
import { indexDeltaReadout } from "../src/index_delta";
import { countUnstampedRows } from "../src/vendor/kit/index-guard";

const UNBEKANNT: [number, number] = [0, 0];
const paths = ["a.md", "b.md", "c.md", "d.md"];

describe("describeStampGap — was die Index-Zustand-Zeile zur Stempel-Lücke sagt", () => {
  it.each([
    ["alle Zeilen gestempelt: keine Zahl", { missing: false, unstamped: 0, total: 20 }, { kind: "none" }],
    ["gemischt: N von M", { missing: false, unstamped: 3, total: 20 }, { kind: "some", unstamped: 3, total: 20 }],
    ["alle Zeilen ohne Stempel: N von M mit N = M", { missing: false, unstamped: 20, total: 20 }, { kind: "some", unstamped: 20, total: 20 }],
    ["Container ohne Stempel-Feld: der ehrliche Satz statt einer Zahl", { missing: true, unstamped: 0, total: 20 }, { kind: "no-stamps" }],
    ["leerer Index ohne Stempel-Feld: nichts zu sagen", { missing: true, unstamped: 0, total: 0 }, { kind: "none" }],
  ])("%s", (_name, input, expected) => {
    expect(describeStampGap(input)).toEqual(expected);
  });
});

describe("StampGap — gezählt aus dem geladenen Container, nachgeführt bei Live-Änderungen", () => {
  const stamps = (): [number, number][] => [[5, 10], UNBEKANNT, UNBEKANNT, [7, 3]];

  it("zählt dieselben Zeilen wie das Kit (countUnstampedRows)", () => {
    const g = new StampGap();
    g.load(paths, stamps());
    expect(g.view(4)).toEqual({ kind: "some", unstamped: countUnstampedRows(stamps()), total: 4 });
    expect(countUnstampedRows(stamps())).toBe(2);
  });

  it("ein Pfad, der seit dem Laden einen echten Stempel bekam, zählt nicht mehr (Live-Update, Drain)", () => {
    const g = new StampGap();
    g.load(paths, stamps());
    g.stamped("b.md");
    expect(g.view(4)).toEqual({ kind: "some", unstamped: 1, total: 4 });
    g.stamped("b.md");                        // doppelt gemeldet: nicht zweimal abziehen
    g.stamped("a.md");                        // war schon gestempelt: ändert nichts
    expect(g.view(4)).toEqual({ kind: "some", unstamped: 1, total: 4 });
    g.stamped("c.md");
    expect(g.view(4)).toEqual({ kind: "none" });
  });

  it("ein umbenannter Pfad trägt seine Lücke mit", () => {
    const g = new StampGap();
    g.load(paths, stamps());
    g.moved("b.md", "neu.md");
    g.stamped("b.md");                        // der alte Name gibt es nicht mehr
    expect(g.view(4)).toEqual({ kind: "some", unstamped: 2, total: 4 });
    g.stamped("neu.md");
    expect(g.view(4)).toEqual({ kind: "some", unstamped: 1, total: 4 });
  });

  it("ein Container ohne Stempel-Feld ist keine Zahl, sondern der ehrliche Satz", () => {
    const g = new StampGap();
    g.load(paths, undefined);
    expect(g.view(4)).toEqual({ kind: "no-stamps" });
  });

  it("ein neues Laden beginnt von vorn; settle() nach einem Voll-Reindex schließt die Lücke", () => {
    const g = new StampGap();
    g.load(paths, stamps());
    g.stamped("b.md");
    g.load(paths, stamps());
    expect(g.view(4)).toEqual({ kind: "some", unstamped: 2, total: 4 });
    g.settle();
    expect(g.view(4)).toEqual({ kind: "none" });
    g.load(paths, undefined);
    g.settle();                               // ein Voll-Reindex schreibt Stempel auch in einen Altbestand
    expect(g.view(4)).toEqual({ kind: "none" });
  });
});

describe("indexDeltaReadout — der Satz zur Lücke", () => {
  it("ohne Lücke bleibt die Zeile wie vorher", () => {
    expect(indexDeltaReadout(10, 10, 0, { kind: "none" })).toBe("10 / 10 notes (complete)");
  });
  it("nennt N von M Notizen ohne Änderungsmarke, was daraus folgt und den Weg", () => {
    expect(indexDeltaReadout(10, 10, 0, { kind: "some", unstamped: 3, total: 10 }))
      .toBe("10 / 10 notes (complete) · 3 of 10 notes have no change mark (their file date and size at indexing) — edits made outside Obsidian are not noticed there; a full re-index sets it.");
  });
  it("nennt für einen Container ohne Stempel den ehrlichen Satz", () => {
    expect(indexDeltaReadout(10, 10, 0, { kind: "no-stamps" }))
      .toBe("10 / 10 notes (complete) · this index has no change marks at all (it was built by an older version) — edits made outside Obsidian are not noticed; a full re-index sets them.");
  });
});
