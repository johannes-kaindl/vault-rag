import { describe, it, expect } from "vitest";
import {
  classifyLoadResult, assertSafeToPersist, isSuspiciousShrink,
  diffIndexVsVault, PersistBlockedError,
} from "../src/index_guard";

describe("classifyLoadResult", () => {
  it("kein Manifest → no-index (frische Installation)", () => {
    expect(classifyLoadResult(false, false)).toBe("no-index");
  });
  it("Manifest da + Load ok → loaded-ok", () => {
    expect(classifyLoadResult(true, false)).toBe("loaded-ok");
  });
  it("Manifest da + Parse wirft → Gefahrenzustand", () => {
    expect(classifyLoadResult(true, true)).toBe("load-failed-index-present");
  });
  it("kein Manifest aber parseThrew (inkonsistent) → no-index (nichts zu schützen)", () => {
    expect(classifyLoadResult(false, true)).toBe("no-index");
  });
});

describe("assertSafeToPersist", () => {
  it("live: Wachstum erlaubt", () => {
    expect(assertSafeToPersist(100, 101, "live").allowed).toBe(true);
  });
  it("live: gleich erlaubt (Rename/Modify ohne Count-Änderung)", () => {
    expect(assertSafeToPersist(100, 100, "live").allowed).toBe(true);
  });
  it("live: Einzel-Löschung (-1) erlaubt", () => {
    expect(assertSafeToPersist(100, 99, "live").allowed).toBe(true);
  });
  it("live: Sturz um mehr als 1 verweigert (Clobber)", () => {
    const d = assertSafeToPersist(4700, 1, "live");
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe("shrink");
    expect(d.message).toMatch(/4700/);
  });
  it("live: -2 in einem Schritt verweigert (Live-Op ändert nur ±1)", () => {
    expect(assertSafeToPersist(10, 8, "live").allowed).toBe(false);
  });
  it("live: letzte Notiz löschen 1→0 erlaubt", () => {
    expect(assertSafeToPersist(1, 0, "live").allowed).toBe(true);
  });
  it("live: leerer Indexer über guten Index (0-Basis diskCount) — 4700→1 bleibt geblockt", () => {
    expect(assertSafeToPersist(4700, 1, "live").allowed).toBe(false);
  });
  it("reindex: darf beliebig schrumpfen (explizit)", () => {
    expect(assertSafeToPersist(4700, 10, "reindex").allowed).toBe(true);
  });
  it("heal: darf beliebig (wächst faktisch nur)", () => {
    expect(assertSafeToPersist(4700, 4701, "heal").allowed).toBe(true);
  });
});

describe("isSuspiciousShrink", () => {
  it("Einbruch unter 50% ist verdächtig (cross-device)", () => {
    expect(isSuspiciousShrink(4700, 3)).toBe(true);
    expect(isSuspiciousShrink(4700, 2000)).toBe(true);
  });
  it("moderat kleiner ist NICHT verdächtig (legitimes Fremd-Gerät)", () => {
    expect(isSuspiciousShrink(4700, 4000)).toBe(false);
  });
  it("Wachstum ist nie verdächtig", () => {
    expect(isSuspiciousShrink(100, 200)).toBe(false);
  });
  it("aktueller Count 0 → nie verdächtig (nichts zu verlieren)", () => {
    expect(isSuspiciousShrink(0, 0)).toBe(false);
  });
});

describe("diffIndexVsVault", () => {
  it("missing = im Vault, nicht im Index; stale = im Index, nicht im Vault", () => {
    const r = diffIndexVsVault(["a.md", "b.md"], ["a.md", "c.md", "d.md"]);
    expect(r.missing.sort()).toEqual(["c.md", "d.md"]);
    expect(r.stale).toEqual(["b.md"]);
  });
  it("deckungsgleich → leer", () => {
    const r = diffIndexVsVault(["a.md"], ["a.md"]);
    expect(r.missing).toEqual([]);
    expect(r.stale).toEqual([]);
  });
});

describe("PersistBlockedError", () => {
  it("trägt kind", () => {
    const e = new PersistBlockedError("shrink", "x");
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("shrink");
  });
});
