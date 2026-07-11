import { describe, it, expect } from "vitest";
import { generateToken, isAuthorized } from "../src/mcp/auth";

describe("mcp auth", () => {
  it("generateToken liefert 32 hex-Zeichen, jeweils verschieden", () => {
    const a = generateToken(), b = generateToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
  it("leerer Server-Token → alles erlaubt (kein Auth erzwungen)", () => {
    expect(isAuthorized(undefined, "")).toBe(true);
    expect(isAuthorized("Bearer x", "")).toBe(true);
  });
  it("gesetzter Token → nur exakter Bearer erlaubt", () => {
    expect(isAuthorized("Bearer geheim", "geheim")).toBe(true);
    expect(isAuthorized("Bearer falsch", "geheim")).toBe(false);
    expect(isAuthorized(undefined, "geheim")).toBe(false);
    expect(isAuthorized("geheim", "geheim")).toBe(false); // ohne "Bearer "-Präfix
  });
  it("falscher Token gleicher Länge → dennoch abgelehnt (zeitkonstanter Vergleich)", () => {
    expect(isAuthorized("Bearer gemein", "geheim")).toBe(false);
  });
});
