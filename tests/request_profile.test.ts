import { describe, it, expect } from "vitest";
import {
  buildChatParams, buildSmartApplyParams, buildReformatParams, migrateLegacySampling, LEGACY_SAMPLING_KEYS, NO_SOURCE,
} from "../src/request_profile";
import { DEFAULT_REQUEST_SETTINGS, type RequestSettings } from "../src/vendor/kit/sampling-profiles";

const fresh = (): RequestSettings => structuredClone(DEFAULT_REQUEST_SETTINGS);

describe("Wrapper mit festem Modus", () => {
  const src = { family: "qwen3.6" as const, backend: "lmstudio" as const };
  it("jeder Wrapper setzt seinen Modus: die Temperatur folgt der Modus-Tabelle", () => {
    expect(buildChatParams(src, fresh()).params.temperature).toBe(0.4);        // grounded
    expect(buildSmartApplyParams(src, fresh()).params.temperature).toBe(0.1);  // structured
    expect(buildReformatParams(src, fresh()).params.temperature).toBe(0.2);    // transform
  });
  it("ohne Plugin-Budget wird kein max_tokens gesendet", () => {
    expect(buildChatParams(src, fresh()).params.max_tokens).toBeUndefined();
  });
  it("mit Plugin-Budget kommt max_tokens mit (mindestens das Budget)", () => {
    const v = buildSmartApplyParams(src, fresh(), 4096).params.max_tokens;
    expect(typeof v).toBe("number");
    expect(v as number).toBeGreaterThanOrEqual(4096);
  });
  it("eine Überschreibung für Modus × Familie gewinnt, eine für eine andere Familie nicht", () => {
    const s = fresh();
    s.overrides.grounded = { "qwen3.6": { temperature: 0.9 }, gemma4: { temperature: 0.1 } };
    expect(buildChatParams(src, s).params.temperature).toBe(0.9);
  });
  it("eine Überschreibung unter `unknown` greift nur, wenn die Familie unbekannt ist", () => {
    const s = fresh();
    s.overrides.grounded = { unknown: { temperature: 1.3 } };
    expect(buildChatParams({ family: null, backend: "lmstudio" }, s).params.temperature).toBe(1.3);
    expect(buildChatParams(src, s).params.temperature).toBe(0.4);
  });
  it("die Denk-Stufe wird mitgeliefert und folgt den Einstellungen", () => {
    const s = fresh();
    expect(buildChatParams(src, s).level).toBe("off");
    s.thinking.grounded = "high";
    expect(buildChatParams(src, s).level).toBe("high");
  });
  it("Guard-Korrektur 7b10d84: gpt-oss bekommt kein reasoning_effort none (es kann nicht abschalten)", () => {
    for (const build of [buildChatParams, buildSmartApplyParams, buildReformatParams]) {
      const p = build({ family: "gpt-oss", backend: "openwebui" }, fresh()).params;
      expect(p.reasoning_effort).not.toBe("none");
    }
  });
  it("NO_SOURCE ist eine unbekannte Familie auf unbekanntem Backend", () => {
    expect(NO_SOURCE.family).toBeNull();
    expect(NO_SOURCE.backend).toBe("unknown");
  });
});

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
