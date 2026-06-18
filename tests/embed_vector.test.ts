import { describe, it, expect } from "vitest";
import { toIndexVector } from "../src/embed_vector";

const norm = (v: Float32Array) => Math.sqrt([...v].reduce((s, x) => s + x * x, 0));

describe("toIndexVector", () => {
  it("normalisiert einen einzelnen Vektor auf Einheitslänge", () => {
    const v = toIndexVector([new Float32Array([3, 4])], 2);
    expect(v[0]).toBeCloseTo(0.6, 5);
    expect(v[1]).toBeCloseTo(0.8, 5);
    expect(norm(v)).toBeCloseTo(1, 5);
  });
  it("mittelt mehrere Vektoren, dann normalisiert", () => {
    const v = toIndexVector([new Float32Array([1, 0]), new Float32Array([0, 1])], 2);
    expect(v[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(v[1]).toBeCloseTo(Math.SQRT1_2, 5);
  });
  it("truncatet auf dim (Matryoshka)", () => {
    const v = toIndexVector([new Float32Array([1, 2, 99, 99])], 2);
    expect(v.length).toBe(2);
    expect(norm(v)).toBeCloseTo(1, 5);
  });
  it("leere Eingabe → leeres Float32Array", () => {
    expect(toIndexVector([], 256).length).toBe(0);
  });
});
