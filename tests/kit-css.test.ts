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
  // Eine Kit-Konstante kann eine andere einsetzen (`${COPY_BUTTON_CSS}` in `STREAM_AREA_CSS`): der Rohtext der Quelle in styles.css trägt dann ein ungültiges `${…}`,
  // und `missingKitCss` meldet es nicht (Befund svg-studio 0.1.3, Store „Caution": Unknown word COPY_BUTTON_CSS). Nach jedem Kopieren oder Pin gilt: keins.
  it("styles.css enthält kein ungelöstes ${…} aus einer Kit-Konstante", () => {
    expect(readFileSync("styles.css", "utf8").match(/\$\{[^}\n]*\}/g) ?? []).toEqual([]);
  });
  it("Gegenprobe: der Wächter erkennt ein ${…} in einem CSS-Text", () => {
    expect("a { color: red; }\n${COPY_BUTTON_CSS}\n".match(/\$\{[^}\n]*\}/g)).toEqual(["${COPY_BUTTON_CSS}"]);
  });
});
