import { describe, it, expect } from "vitest";
import { waitingMessage, COLD_START_HINT_AFTER_MS, truncationKey } from "../src/reformat_progress";

describe("waitingMessage", () => {
  it("zeigt von Anfang an, dass gewartet wird — mit Sekundenzahl", () => {
    expect(waitingMessage(0)).toBe("Warte auf Antwort … 0 s");
  });

  it("rundet auf volle Sekunden ab", () => {
    expect(waitingMessage(1999)).toBe("Warte auf Antwort … 1 s");
    expect(waitingMessage(2000)).toBe("Warte auf Antwort … 2 s");
  });

  it("blendet den Kaltstart-Hinweis erst nach der Schwelle ein", () => {
    // Vorher: kein Hinweis — eine schnelle Antwort soll nicht unnoetig beunruhigen.
    expect(waitingMessage(COLD_START_HINT_AFTER_MS - 1)).toBe("Warte auf Antwort … 4 s");
    // Ab der Schwelle: Erwartung setzen, statt Zweifel zu lassen.
    expect(waitingMessage(COLD_START_HINT_AFTER_MS)).toBe(
      "Warte auf Antwort … 5 s\nBeim ersten Aufruf muss das Modell ggf. erst geladen werden.",
    );
  });

  it("behaelt den Hinweis, solange weiter gewartet wird", () => {
    expect(waitingMessage(42_000)).toBe(
      "Warte auf Antwort … 42 s\nBeim ersten Aufruf muss das Modell ggf. erst geladen werden.",
    );
  });

  it("behandelt negative Werte als 0 (Uhr-Sprung)", () => {
    expect(waitingMessage(-500)).toBe("Warte auf Antwort … 0 s");
  });

  it("nennt keine Ursache, die wir nicht kennen koennen", () => {
    // Der Endpunkt sagt uns nicht, ob das Modell laedt oder nur nachdenkt.
    // Der Text darf das daher nicht als Tatsache behaupten.
    const spaet = waitingMessage(60_000);
    expect(spaet).not.toMatch(/Modell wird geladen/);
    expect(spaet).toMatch(/ggf\./);
  });
});

describe("truncationKey", () => {
  it("meldet den Token-Limit-Abbruch als Schluessel, nicht als fertigen Text", () => {
    // i18n-Doktrin: die Diagnose liefert einen Code, uebersetzt wird an der Anzeigestelle.
    expect(truncationKey("length")).toBe("reformatPreview.truncated");
  });

  it("ein regulaeres Stream-Ende ist kein Befund", () => {
    expect(truncationKey("stop")).toBeNull();
  });

  it("ein Server ohne finish_reason erzeugt keinen Befund", () => {
    expect(truncationKey(undefined)).toBeNull();
  });
});
