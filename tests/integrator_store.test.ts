import { describe, it, expect } from "vitest";
import { IntegratorStore, LinkProposal } from "../src/integrator_store";

const p = (notePath: string, links: string[], createdAt = 1, noteHash = 7): LinkProposal =>
  ({ notePath, noteHash, createdAt, stale: false, links: links.map(l => ({ path: l, score: 0.9 })) });

describe("IntegratorStore", () => {
  it("upsert ersetzt je Notiz statt zu stapeln", () => {
    const s = new IntegratorStore();
    s.upsert(p("a.md", ["b.md"], 1)); s.upsert(p("a.md", ["c.md"], 2));
    expect(s.count()).toBe(1);
    expect(s.get("a.md")?.links.map(l => l.path)).toEqual(["c.md"]);
  });
  it("list sortiert createdAt absteigend", () => {
    const s = new IntegratorStore();
    s.upsert(p("a.md", ["x.md"], 1)); s.upsert(p("b.md", ["x.md"], 5)); s.upsert(p("c.md", ["x.md"], 3));
    expect(s.list().map(x => x.notePath)).toEqual(["b.md", "c.md", "a.md"]);
  });
  it("resolve accepted entfernt das Ziel; letztes Ziel entfernt den Eintrag", () => {
    const s = new IntegratorStore();
    s.upsert(p("a.md", ["b.md", "c.md"]));
    s.resolve("a.md", "b.md", "accepted");
    expect(s.get("a.md")?.links.map(l => l.path)).toEqual(["c.md"]);
    s.resolve("a.md", "c.md", "accepted");
    expect(s.get("a.md")).toBeUndefined();
    expect(s.rejectedFor("a.md").size).toBe(0);
  });
  it("resolve rejected merkt sich das Ziel je Notiz, dedupliziert", () => {
    const s = new IntegratorStore();
    s.upsert(p("a.md", ["b.md"]));
    s.resolve("a.md", "b.md", "rejected"); s.resolve("a.md", "b.md", "rejected");
    expect([...s.rejectedFor("a.md")]).toEqual(["b.md"]);
    expect(s.rejectedFor("z.md").size).toBe(0);
  });
  it("upsert mit leeren links entfernt den Eintrag", () => {
    const s = new IntegratorStore();
    s.upsert(p("a.md", ["b.md"])); s.upsert(p("a.md", []));
    expect(s.get("a.md")).toBeUndefined();
  });
  it("markStale/updateHash", () => {
    const s = new IntegratorStore();
    s.upsert(p("a.md", ["b.md"]));
    s.markStale("a.md"); expect(s.get("a.md")?.stale).toBe(true);
    s.updateHash("a.md", 99); expect(s.get("a.md")).toMatchObject({ stale: false, noteHash: 99 });
  });
  it("rename zieht Vorschlag und Ablehnungen um", () => {
    const s = new IntegratorStore();
    s.upsert(p("a.md", ["b.md"])); s.resolve("a.md", "c.md", "rejected");
    s.rename("a.md", "n.md");
    expect(s.get("a.md")).toBeUndefined();
    expect(s.get("n.md")?.notePath).toBe("n.md");
    expect([...s.rejectedFor("n.md")]).toEqual(["c.md"]);
  });
  it("serialize/parse ist ein Round-Trip", () => {
    const s = new IntegratorStore();
    s.upsert(p("a.md", ["b.md"])); s.resolve("q.md", "r.md", "rejected");
    const t = new IntegratorStore(IntegratorStore.parse(s.serialize()));
    expect(t.serialize()).toBe(s.serialize());
  });
  it("parse wirft bei fremder Version und bei Nicht-JSON", () => {
    expect(() => IntegratorStore.parse('{"version":2,"proposals":{},"rejected":{}}')).toThrow(/version/);
    expect(() => IntegratorStore.parse("nope")).toThrow();
  });
});
