import { describe, it, expect } from "vitest";
import { hubPlacement } from "../src/hub_placement";

// Wo öffnet der Hub? Handy (alle Mobilgeräte): Tab im Hauptbereich, denn in der Schublade hängt Obsidians eigene Tab-Auswahl
// und der Chat endet rund 155 px über der Tastatur. Desktop: rechte Seitenleiste. Ein offener Hub wird immer wiederverwendet.
describe("hubPlacement", () => {
  it("Handy ohne offenen Hub: Tab im Hauptbereich", () => {
    expect(hubPlacement(false, true)).toBe("tab");
  });
  it("Desktop ohne offenen Hub: rechte Seitenleiste", () => {
    expect(hubPlacement(false, false)).toBe("sidebar");
  });
  it("ein offener Hub wird wiederverwendet, auf dem Handy wie am Desktop", () => {
    expect(hubPlacement(true, true)).toBe("existing");
    expect(hubPlacement(true, false)).toBe("existing");
  });
  // Gegenprobe: die Wahl hängt an beiden Eingaben (ein Tausch der Argumente fiele auf).
  it("Mobil und Desktop liefern ohne offenen Hub verschiedene Orte", () => {
    expect(hubPlacement(false, true)).not.toBe(hubPlacement(false, false));
  });
});
