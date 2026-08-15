import { describe, it, expect } from "vitest";
import {
  classifyLoadResult, assertSafeToPersist, isSuspiciousShrink,
  diffIndexVsVault, PersistBlockedError, canPersistHealedIndex, embeddingModelMatchesIndex,
  assertModelSafeToPersist, planAutoHeal,
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

describe("canPersistHealedIndex", () => {
  it("nur ein restlos sauberer Heal-Lauf darf persistieren (failed === 0)", () => {
    expect(canPersistHealedIndex(0)).toBe(true);
    expect(canPersistHealedIndex(1)).toBe(false);
    expect(canPersistHealedIndex(50)).toBe(false);
  });
});

describe("PersistBlockedError", () => {
  it("trägt kind", () => {
    const e = new PersistBlockedError("shrink", "x");
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("shrink");
  });
  it("trägt kind 'unreadable'", () => {
    const e = new PersistBlockedError("unreadable", "y");
    expect(e.kind).toBe("unreadable");
  });
});

describe("embeddingModelMatchesIndex", () => {
  it("ohne Index-Modell wird nie blockiert (Erstinstallation, Alt-Index ohne Feld)", () => {
    expect(embeddingModelMatchesIndex("egal", undefined)).toBe(true);
    expect(embeddingModelMatchesIndex("egal", "")).toBe(true);
    expect(embeddingModelMatchesIndex("egal", "   ")).toBe(true);
  });

  it("gleiches Modell passt (auch mit Rand-Whitespace)", () => {
    expect(embeddingModelMatchesIndex("qwen3-embedding:8b", "qwen3-embedding:8b")).toBe(true);
    expect(embeddingModelMatchesIndex("  qwen3-embedding:8b  ", "qwen3-embedding:8b")).toBe(true);
    expect(embeddingModelMatchesIndex("qwen3-embedding:8b", "  qwen3-embedding:8b  ")).toBe(true);
  });

  it("fremdes Modell passt nicht — anderer Vektorraum", () => {
    expect(embeddingModelMatchesIndex("text-embedding-3-small", "qwen3-embedding:8b")).toBe(false);
  });

  it("unterscheidet Groß-/Kleinschreibung (Modellnamen sind exakt)", () => {
    expect(embeddingModelMatchesIndex("Qwen3-Embedding:8b", "qwen3-embedding:8b")).toBe(false);
  });
});

describe("assertModelSafeToPersist", () => {
  it("reindex ist immer erlaubt — Voll-Ersatz, das Manifest beschreibt danach ehrlich alles", () => {
    expect(assertModelSafeToPersist("qwen3-embedding:8b", "text-embedding-3-small", "reindex").allowed).toBe(true);
  });

  it("live blockt bei fremdem Modell", () => {
    const d = assertModelSafeToPersist("qwen3-embedding:8b", "text-embedding-3-small", "live");
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe("model-mismatch");
    expect(d.message).toContain("qwen3-embedding:8b");
    expect(d.message).toContain("text-embedding-3-small");
  });

  it("heal blockt ebenfalls — additives Einmischen ist genau das Problem", () => {
    expect(assertModelSafeToPersist("qwen3-embedding:8b", "text-embedding-3-small", "heal").allowed).toBe(false);
  });

  it("gleiches Modell ist erlaubt (auch mit Rand-Whitespace)", () => {
    expect(assertModelSafeToPersist("qwen3-embedding:8b", "  qwen3-embedding:8b  ", "live").allowed).toBe(true);
  });

  it("Disk-Modell leer/fehlend → erlauben (Alt-Index ohne Feld, frischer Index)", () => {
    expect(assertModelSafeToPersist(undefined, "text-embedding-3-small", "live").allowed).toBe(true);
    expect(assertModelSafeToPersist("", "text-embedding-3-small", "live").allowed).toBe(true);
    expect(assertModelSafeToPersist("   ", "text-embedding-3-small", "heal").allowed).toBe(true);
  });
});

// ── Auto-Heal-Reihenfolge (Vorfall 2026-08-14) ───────────────────────────────
// Gemeldet aus einer Nachbar-Session: index.bin war 0 Bytes, ein CRC-beweisbares Backup
// lag daneben — und die Kaskade übernahm es NICHT, weil der Embedding-Endpunkt tot war.
// Sie prüfte `embedderReady()`, bevor sie überhaupt nach einem Backup sah. Das koppelt zwei
// Dinge, von denen nur eines Netz braucht: ein Backup zu ÜBERNEHMEN geht offline, nur der
// Delta-Reindex der fehlenden Notizen braucht einen Endpunkt.
describe("planAutoHeal", () => {
  it("ohne Backup ist nichts zu holen — mit oder ohne Endpunkt", () => {
    expect(planAutoHeal({ hasBackup: false, embedderReady: true })).toEqual({ kind: "no-backup" });
    expect(planAutoHeal({ hasBackup: false, embedderReady: false })).toEqual({ kind: "no-backup" });
  });

  it("mit Backup und Endpunkt: übernehmen und die Lücke schließen", () => {
    expect(planAutoHeal({ hasBackup: true, embedderReady: true }))
      .toEqual({ kind: "restore-and-reindex" });
  });

  it("mit Backup, ohne Endpunkt: trotzdem übernehmen — der Kern des Vorfalls", () => {
    // Ein CRC-bewiesenes Backup ist unter allen verfügbaren Optionen die beste; der defekte
    // Container hat keinerlei Wert. Höchstens fehlen ein paar Notizen — dauerhaft „kein Index"
    // ist strikt schlechter als „Index von gestern".
    expect(planAutoHeal({ hasBackup: true, embedderReady: false }))
      .toEqual({ kind: "restore-only" });
  });
});
