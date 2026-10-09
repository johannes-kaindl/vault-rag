import { describe, it, expect } from "vitest";
import { migrateLegacySampling, LEGACY_SAMPLING_KEYS } from "../src/request_profile";
import { DEFAULT_REQUEST_SETTINGS, type RequestSettings } from "../src/vendor/kit/sampling-profiles";

const fresh = (): RequestSettings => structuredClone(DEFAULT_REQUEST_SETTINGS);

describe("migrateLegacySampling", () => {
  it("eine Chat-Temperatur ≠ 0.7 wird Überschreibung grounded/unknown", () => {
    const m = migrateLegacySampling({ chatTemperature: 0.9 }, fresh());
    expect(m.request.overrides.grounded?.unknown?.temperature).toBe(0.9);
    expect(m.overridesCreated).toBe(true);
  });
  it("eine Chat-Temperatur gleich dem alten Default (0.7) wird verworfen", () => {
    const m = migrateLegacySampling({ chatTemperature: 0.7 }, fresh());
    expect(m.request.overrides.grounded).toBeUndefined();
    expect(m.overridesCreated).toBe(false);
    expect(m.touched).toBe(true);
  });
  it("die Smart-Apply-Temperatur ≠ 0 wird Überschreibung structured/unknown, 0 wird verworfen", () => {
    expect(migrateLegacySampling({ smartApplyTemperature: 0.3 }, fresh()).request.overrides.structured?.unknown?.temperature).toBe(0.3);
    expect(migrateLegacySampling({ smartApplyTemperature: 0 }, fresh()).request.overrides.structured).toBeUndefined();
  });
  it("suppressThinking true → off, false → die Einschalt-Stufe des Modus", () => {
    expect(migrateLegacySampling({ suppressThinking: true }, fresh()).request.thinking.grounded).toBe("off");
    const on = migrateLegacySampling({ suppressThinking: false }, fresh()).request.thinking.grounded;
    expect(on).toBeDefined();
    expect(on).not.toBe("off");
  });
  it("smartApplySuppressThinking wirkt auf structured", () => {
    expect(migrateLegacySampling({ smartApplySuppressThinking: true }, fresh()).request.thinking.structured).toBe("off");
    expect(migrateLegacySampling({ smartApplySuppressThinking: false }, fresh()).request.thinking.structured).not.toBe("off");
  });
  it("eine schon gesetzte Denk-Stufe oder Überschreibung bleibt — die neuere Wahl gewinnt", () => {
    const s = fresh();
    s.thinking.grounded = "high";
    s.overrides.grounded = { unknown: { temperature: 1.1 } };
    const m = migrateLegacySampling({ suppressThinking: true, chatTemperature: 0.2 }, s);
    expect(m.request.thinking.grounded).toBe("high");
    expect(m.request.overrides.grounded?.unknown?.temperature).toBe(1.1);
  });
  it("eine ungültige Temperatur (außerhalb 0–2) wird nicht zur Überschreibung", () => {
    const m = migrateLegacySampling({ chatTemperature: 5 }, fresh());
    expect(m.request.overrides.grounded).toBeUndefined();
    expect(m.overridesCreated).toBe(false);
  });
  it("ohne Alt-Schlüssel ist nichts berührt", () => {
    const m = migrateLegacySampling({ chatK: 5 }, fresh());
    expect(m.touched).toBe(false);
    expect(m.request).toEqual(fresh());
  });
  it("mutiert weder die Eingabe-Einstellungen noch die Rohdaten", () => {
    const s = fresh();
    const raw = { chatTemperature: 0.9, suppressThinking: true };
    migrateLegacySampling(raw, s);
    expect(s).toEqual(fresh());
    expect(raw).toEqual({ chatTemperature: 0.9, suppressThinking: true });
  });
  it("die Liste der Alt-Schlüssel nennt genau die vier entfallenen Regler", () => {
    expect([...LEGACY_SAMPLING_KEYS].sort()).toEqual(["chatTemperature", "smartApplySuppressThinking", "smartApplyTemperature", "suppressThinking"]);
  });
});
