import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, embedThrottleFactor, normalizeEmbedThrottle, type VaultRagSettings } from "../src/settings_core";
import { EmbeddingPause } from "../src/embedding_pause";
import { throttleEmbedder } from "../src/vendor/kit/throttle-embedder";
import type { Embedder } from "../src/vendor/kit/embeddings-client";

const mit = (embedThrottle: unknown): VaultRagSettings => ({ ...structuredClone(DEFAULT_SETTINGS), embedThrottle } as VaultRagSettings);

describe("Einstellung „Pause zwischen Embedding-Anfragen“", () => {
  it("Vorgabe ist 1 (Pause so lang wie der letzte Batch)", () => {
    expect(DEFAULT_SETTINGS.embedThrottle).toBe("1");
    expect(embedThrottleFactor(DEFAULT_SETTINGS)).toBe(1);
  });
  it("die vier Stufen ergeben ihren Faktor", () => {
    expect(["0", "0.5", "1", "2"].map((v) => embedThrottleFactor(mit(v)))).toEqual([0, 0.5, 1, 2]);
  });
  it("ein unbekannter Wert gilt als Vorgabe 1, nie als „aus“", () => {
    for (const v of [undefined, null, 1, "3", "-1", "abc", "", "NaN", "toString", "__proto__"]) expect(embedThrottleFactor(mit(v))).toBe(1);
  });
  it("normalizeEmbedThrottle setzt einen unbekannten Wert auf \"1\" und lässt eine Stufe stehen", () => {
    const a = mit("7"); normalizeEmbedThrottle(a); expect(a.embedThrottle).toBe("1");
    const b = mit("0"); normalizeEmbedThrottle(b); expect(b.embedThrottle).toBe("0");
    const c = mit(0.5); normalizeEmbedThrottle(c); expect(c.embedThrottle).toBe("1");
  });
});

describe("Drossel im Pause-Gate (so wie main.ts sie baut)", () => {
  function aufbau(faktor: number) {
    let t = 0;
    const log: string[] = [];
    const inner: Embedder = { embed: async (texts) => { log.push(`embed@${t}:${texts.length}`); t += 400; return texts.map(() => new Float32Array(1)); } };
    const slept: number[] = [];
    const sleep = async (ms: number) => { slept.push(ms); t += ms; };
    const store = new Map<string, string>();
    const pause = new EmbeddingPause({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: (k) => { store.delete(k); } });
    const throttled = throttleEmbedder(inner, { faktor, slice: 32, now: () => t, sleep });
    const gated = pause.gate(() => throttled, "wait");
    return { gated, log, slept, pause };
  }

  it("nach einem Batch kommt die Pause Faktor × Dauer, bevor der nächste Aufruf beginnt", async () => {
    const x = aufbau(1);
    await Promise.all([x.gated.embed(["a"]), x.gated.embed(["b"])]);
    expect(x.slept).toEqual([400, 400]);
    expect(x.log).toEqual(["embed@0:1", "embed@800:1"]);   // der zweite beginnt erst nach 400 ms Arbeit + 400 ms Pause
  });
  it("Faktor 0 schaltet die Pause ab", async () => {
    const x = aufbau(0);
    await Promise.all([x.gated.embed(["a"]), x.gated.embed(["b"])]);
    expect(x.slept).toEqual([]);
    expect(x.log).toEqual(["embed@0:1", "embed@400:1"]);
  });
  it("ein Aufruf mit mehr als 32 Texten wird in Batches zu 32 geschnitten, jeder mit Pause", async () => {
    const x = aufbau(1);
    const r = await x.gated.embed(Array.from({ length: 70 }, (_, i) => String(i)));
    expect(r).toHaveLength(70);
    expect(x.log.map((l) => l.split(":")[1])).toEqual(["32", "32", "6"]);
    expect(x.slept).toEqual([400, 400, 400]);
  });
});
