import { describe, it, expect } from "vitest";
import { hubPlacement } from "../src/hub_placement";

// Wo öffnet der Hub? Mobilgerät (Handy und Tablet): Tab im Hauptbereich, denn in der Schublade hängt Obsidians eigene Tab-Auswahl
// und der Chat endet rund 155 px über der Tastatur. Desktop: rechte Seitenleiste. Ein offener Hub wird wiederverwendet — außer auf
// einem Mobilgerät in der Schublade: das Layout bleibt über das Update hinaus gespeichert, der Hub säße dort für immer (gemessen
// 2026-11-03: der Wirt hing unter `workspace-drawer.mod-right`), also zieht er in einen Tab um.
describe("hubPlacement", () => {
  it("Mobil ohne offenen Hub: Tab im Hauptbereich", () => {
    expect(hubPlacement("none", true)).toBe("tab");
  });
  it("Desktop ohne offenen Hub: rechte Seitenleiste", () => {
    expect(hubPlacement("none", false)).toBe("sidebar");
  });
  it("ein offener Hub im Hauptbereich bleibt, mobil wie am Desktop", () => {
    expect(hubPlacement("main", true)).toBe("existing");
    expect(hubPlacement("main", false)).toBe("existing");
  });
  it("Desktop: ein Hub in der Seitenleiste bleibt dort", () => {
    expect(hubPlacement("side", false)).toBe("existing");
  });
  it("Mobil: ein Hub in der Schublade zieht in einen Tab um", () => {
    expect(hubPlacement("side", true)).toBe("move-to-tab");
  });
  // Gegenprobe: die Wahl hängt an beiden Eingaben (ein Tausch der Argumente oder ein Dauer-„existing“ fiele auf).
  it("Mobil und Desktop liefern ohne offenen Hub und für „Schublade“ verschiedene Orte", () => {
    expect(hubPlacement("none", true)).not.toBe(hubPlacement("none", false));
    expect(hubPlacement("side", true)).not.toBe(hubPlacement("side", false));
  });
});
