import { describe, it, expect } from "vitest";
import "../src/i18n/strings";
import { EN, DE } from "../src/i18n/strings";
import { requestText } from "../src/request_text";
import { THINKING_LEVELS } from "../src/vendor/kit/sampling-profiles";

// Die Vollstaendigkeit der Kit-Tabellen gegen die Woerterbuecher — der Schluessel-Waechter
// sieht `requestText(gruppe, id)` nicht (Schluessel erst in der Funktion gebaut), also steht sie hier.
describe("Anfrage-Texte sind für jede ID der Kit-Tabellen vorhanden (EN und DE)", () => {
  const groups: [Parameters<typeof requestText>[0], readonly string[]][] = [
    ["request.level", THINKING_LEVELS],
  ];
  for (const [group, ids] of groups) {
    it(`${group}: ${ids.length} IDs`, () => {
      for (const id of ids) {
        expect((EN as Record<string, string>)[`${group}.${id}`], `EN ${group}.${id}`).toBeTruthy();
        expect((DE as Record<string, string>)[`${group}.${id}`], `DE ${group}.${id}`).toBeTruthy();
      }
    });
  }
  it("requestText löst in die eingestellte Sprache auf", () => {
    expect(requestText("request.level", "off")).toBe("off");
  });
});
