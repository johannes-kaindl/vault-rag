import { describe, it, expect } from "vitest";
import { newTurnId } from "../src/lab_client";

// readLabApi/Versionsvergleich liegen seit Welle 11 im Kit (lab-client) und sind dort getestet.
describe("newTurnId", () => {
  it("liefert je Aufruf eine frische, nicht leere id", () => {
    const a = newTurnId();
    expect(a).not.toBe("");
    expect(newTurnId()).not.toBe(a);
  });
});
