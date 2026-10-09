import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { findVendoredCss, missingKitCss } from "./vendor/kit/kit-css";

// Kit-Vertrag: die `*_CSS`-Konstanten der gevendorten Bausteine stehen wortgleich in `styles.css`.
// Beide Ordner tragen Bausteine mit Darstellung (kit-obsidian: Hub, Endpunkt-Liste, Anfrage-Abschnitt,
// Stream-Bereich, ...; kit: keine, aber der Wächter prüft sie mit).
describe("Kit-CSS steht wortgleich in styles.css", () => {
  const styles = readFileSync("styles.css", "utf8");
  for (const dir of ["src/vendor/kit-obsidian", "src/vendor/kit"]) {
    it(dir, () => {
      expect(missingKitCss(dir, styles)).toEqual([]);
    });
  }
  it("der Wächter findet überhaupt Konstanten (sonst prüft er nichts)", () => {
    expect(findVendoredCss("src/vendor/kit-obsidian").length).toBeGreaterThan(0);
  });
});
