import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Seit Kit 0.74.0 addiert sich ein Außenabstand des Einschub-Inhalts zum `gap` des Composers (16 statt 8 px zur Modellzeile, gemessen am Pilot settings-assistant).
// Die Kontextzeile trug seit der Kopfzeilen-Zeit `margin-top: 6px`; der Abstand kommt jetzt vom Composer.
describe("styles.css: Chat-Zeile", () => {
  const css = readFileSync("styles.css", "utf8");
  const rule = (sel: string): string => {
    const m = css.match(new RegExp(`(^|\\n)${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`));
    return m?.[2] ?? "";
  };
  it("die Kontextzeile im Einschub hat keinen Außenabstand oben (der gap des Composers genügt)", () => {
    const body = rule(".vault-rag-chat-context");
    expect(body).not.toBe("");   // der Wächter findet die Regel überhaupt
    expect(body).not.toMatch(/margin(-top|-block|-block-start)?\s*:/);
  });
});
