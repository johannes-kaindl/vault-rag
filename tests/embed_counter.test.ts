import { describe, it, expect } from "vitest";
import { EmbedCounter } from "../src/embed_counter";

describe("EmbedCounter", () => {
  it("zählt Anfragen und Texte je Etikett und sortiert nach Anfragen", () => {
    let now = 0;
    const c = new EmbedCounter(() => now);
    c.count("indexer:modify", 3); now += 1000; c.count("indexer:modify", 1); c.count("chat-context", 1);
    const s = c.snapshot();
    expect(s.map(x => x.label)).toEqual(["indexer:modify", "chat-context"]);
    expect(s[0]).toMatchObject({ requests: 2, texts: 4 });
  });
  it("rechnet die Rate über das Fenster", () => {
    let now = 0;
    const c = new EmbedCounter(() => now);
    for (let i = 0; i < 30; i++) { c.count("x", 1); now += 1000; }   // 30 Anfragen in 30 s
    now = 60_000;
    expect(c.snapshot(60_000)[0]!.perMinute).toBe(30);
    expect(c.snapshot(120_000)[0]!.perMinute).toBe(15);
  });
  it("lässt Ereignisse außerhalb des Fensters weg und verwirft sehr alte", () => {
    let now = 0;
    const c = new EmbedCounter(() => now, 10_000);
    c.count("alt", 1); now = 20_000; c.count("neu", 1);
    expect(c.snapshot(5_000).map(x => x.label)).toEqual(["neu"]);
    now = 40_000; c.count("neu", 1);      // schneidet "neu"@20s (älter als keepMs) ab
    expect(c.snapshot(60_000).find(x => x.label === "neu")!.requests).toBe(1);
  });
});
