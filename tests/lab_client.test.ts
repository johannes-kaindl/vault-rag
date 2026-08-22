import { describe, it, expect } from "vitest";
import { readLabApi } from "../src/lab_client";

const good = { apiVersion: 1, status: () => ({}), log: () => "id" };

describe("readLabApi", () => {
  it("liefert null, wenn das Lab nicht installiert ist", () => {
    expect(readLabApi({ plugins: { plugins: {} } })).toBeNull();
  });

  it("liefert null bei fremder Vertragsversion statt zu raten", () => {
    const app = { plugins: { plugins: { "llm-lab": { api: { ...good, apiVersion: 2 } } } } };
    expect(readLabApi(app)).toBeNull();
  });

  it("liefert null, wenn log fehlt — ein halb initialisiertes Objekt darf nicht durchrutschen", () => {
    const app = { plugins: { plugins: { "llm-lab": { api: { apiVersion: 1 } } } } };
    expect(readLabApi(app)).toBeNull();
  });

  it("liefert die API, wenn Version und Form stimmen", () => {
    const app = { plugins: { plugins: { "llm-lab": { api: good } } } };
    expect(readLabApi(app)).toBe(good);
  });

  it("wirft nie, auch bei kaputtem app-Objekt", () => {
    expect(readLabApi(null)).toBeNull();
    expect(readLabApi(undefined)).toBeNull();
    expect(readLabApi({})).toBeNull();
  });
});
