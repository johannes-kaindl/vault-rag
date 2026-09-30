import { describe, it, expect } from "vitest";
import "../src/i18n/strings";
import { EN, DE } from "../src/i18n/strings";
import { requestText, deviationDetail } from "../src/request_text";
import {
  MODE_IDS, FIELD_ORDER, THINKING_LEVELS, type DeviationKind,
} from "../src/vendor/kit/sampling-profiles";

// Die Vollstaendigkeit der Kit-Tabellen gegen die Woerterbuecher — der Schluessel-Waechter
// sieht `requestText(gruppe, id)` nicht (Schluessel erst in der Funktion gebaut), also steht sie hier.
describe("Anfrage-Texte sind für jede ID der Kit-Tabellen vorhanden (EN und DE)", () => {
  const groups: [Parameters<typeof requestText>[0], readonly string[]][] = [
    ["request.mode", MODE_IDS],
    ["request.field", FIELD_ORDER],
    ["request.level", THINKING_LEVELS],
    ["request.familySource", ["manager", "name", "none"]],
    ["request.backendSource", ["manager", "probe", "none"]],
  ];
  for (const [group, ids] of groups) {
    it(`${group}: ${ids.length} IDs`, () => {
      for (const id of ids) {
        expect(EN[`${group}.${id}`], `EN ${group}.${id}`).toBeTruthy();
        expect(DE[`${group}.${id}`], `DE ${group}.${id}`).toBeTruthy();
      }
    });
  }
  it("requestText löst in die eingestellte Sprache auf", () => {
    expect(requestText("request.level", "off")).toBe("off");
  });
  it("jede Abweichungsart hat einen Text", () => {
    const kinds: DeviationKind[] = ["thinking-despite-off", "empty-by-budget", "family-mismatch", "family-detected", "rejected"];
    for (const k of kinds) expect(deviationDetail(k, "x").length, k).toBeGreaterThan(0);
  });
});
