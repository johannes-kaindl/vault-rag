import { describe, it, expect } from "vitest";
import { DeadRowGrace, DEAD_ROW_GRACE_MS, type DeadRowStorage } from "../src/dead_rows";

/** Frist für tote Zeilen (Welle 33): eine Zeile ohne Datei wird erst entfernt, wenn die Datei auf diesem Gerät durchgehend über die Frist fehlt (Sync-Rückstand darf eine lebende Zeile nicht töten). */
function speicher(): DeadRowStorage & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return { daten, getItem: (k) => daten.get(k) ?? null, setItem: (k, v) => { daten.set(k, v); } };
}

describe("DeadRowGrace", () => {
  it("die erste Beobachtung entfernt nichts, sie merkt sich nur", () => {
    const s = speicher(); let t = 1000;
    const g = new DeadRowGrace(s, "k", DEAD_ROW_GRACE_MS, () => t);
    expect(g.observe(["a.md", "b.md"])).toEqual({ due: [], waiting: 2 });
  });

  it("nach der Frist sind die durchgehend fehlenden Zeilen fällig, auch über einen Neustart (anderer Objekt, gleicher Speicher)", () => {
    const s = speicher(); let t = 1000;
    new DeadRowGrace(s, "k", DEAD_ROW_GRACE_MS, () => t).observe(["a.md", "b.md"]);
    t += DEAD_ROW_GRACE_MS;
    const r = new DeadRowGrace(s, "k", DEAD_ROW_GRACE_MS, () => t).observe(["a.md", "b.md"]);
    expect(r.due.sort()).toEqual(["a.md", "b.md"]);
    expect(r.waiting).toBe(0);
  });

  it("kurz vor Ablauf der Frist ist noch nichts fällig", () => {
    const s = speicher(); let t = 0;
    const g = new DeadRowGrace(s, "k", DEAD_ROW_GRACE_MS, () => t);
    g.observe(["a.md"]);
    t += DEAD_ROW_GRACE_MS - 1;
    expect(g.observe(["a.md"])).toEqual({ due: [], waiting: 1 });
  });

  it("kommt die Datei dazwischen zurück, beginnt die Frist von vorn (Sync-Rückstand)", () => {
    const s = speicher(); let t = 0;
    const g = new DeadRowGrace(s, "k", DEAD_ROW_GRACE_MS, () => t);
    g.observe(["a.md"]);
    t += DEAD_ROW_GRACE_MS / 2;
    g.observe([]);                       // die Datei ist angekommen
    t += DEAD_ROW_GRACE_MS / 2;          // seit der ersten Beobachtung ist ein ganzer Tag vergangen …
    expect(g.observe(["a.md"])).toEqual({ due: [], waiting: 1 });   // … aber nicht durchgehend
  });

  it("forget nimmt entfernte Zeilen aus der Merkliste", () => {
    const s = speicher(); let t = 0;
    const g = new DeadRowGrace(s, "k", DEAD_ROW_GRACE_MS, () => t);
    g.observe(["a.md"]);
    t += DEAD_ROW_GRACE_MS;
    g.forget(["a.md"]);
    expect(g.observe(["a.md"])).toEqual({ due: [], waiting: 1 });
  });

  it("ein beschädigter oder fremder Speicherinhalt zählt als leer und wirft nicht", () => {
    const s = speicher(); s.daten.set("k", "{kaputt"); let t = 0;
    expect(new DeadRowGrace(s, "k", DEAD_ROW_GRACE_MS, () => t).observe(["a.md"])).toEqual({ due: [], waiting: 1 });
    s.daten.set("k", JSON.stringify(["a.md"]));
    expect(new DeadRowGrace(s, "k", DEAD_ROW_GRACE_MS, () => t).observe(["a.md"])).toEqual({ due: [], waiting: 1 });
  });

  it("ein Speicher, der nicht schreiben lässt, bricht die Beobachtung nicht ab", () => {
    const s: DeadRowStorage = { getItem: () => null, setItem: () => { throw new Error("voll"); } };
    expect(new DeadRowGrace(s, "k").observe(["a.md"])).toEqual({ due: [], waiting: 1 });
  });

  it("Vaults trennt der Schlüssel", () => {
    const s = speicher(); let t = 0;
    new DeadRowGrace(s, "vault-a", DEAD_ROW_GRACE_MS, () => t).observe(["a.md"]);
    t += DEAD_ROW_GRACE_MS;
    expect(new DeadRowGrace(s, "vault-b", DEAD_ROW_GRACE_MS, () => t).observe(["a.md"]).due).toEqual([]);
  });
});
