import { describe, it, expect, afterEach } from "vitest";
import { embeddingListTexts } from "../src/settings";
import { setLang } from "../src/vendor/kit/i18n";
import { validateEndpointInput } from "../src/vendor/kit/endpoint_diagnostics";
import "../src/i18n/strings";

const st = (kind: string, raw?: string) => ({ reachable: kind === "ok", kind, klartext: "Kit-Prosa", ...(raw ? { raw } : {}) }) as never;

afterEach(() => setLang("en"));

describe("Embedding-Liste: Kit-Bündel mit Überschreibungen", () => {
  it("Rollen: Kit-Vokabular wie die Chat-Liste, nur skipped-model nennt den Index", () => {
    setLang("en");
    const x = embeddingListTexts("en");
    expect(x.role({ kind: "active" })).toBe("active — this one is used");
    expect(x.role({ kind: "standby", position: 2 })).toBe("reachable — fallback 2");
    expect(x.role({ kind: "unreachable" })).toBe("not reachable — skipped");
    expect(x.role({ kind: "skipped-model" })).toBe("skipped — model does not match the index");
  });

  it("Rolle search-only: die Zeile, die nur die Suche bedient, heißt nicht „übersprungen“ (Kit 0.67.0, code-kit 0.36.0)", () => {
    setLang("en");
    expect(embeddingListTexts("en").role({ kind: "search-only" })).toBe("used for search — does not write");
    setLang("de");
    expect(embeddingListTexts("de").role({ kind: "search-only" })).toBe("für Suche genutzt, schreibt nicht");
  });

  it("Status: die reicheren Texte (timeout, not-an-llm-api, unknown ohne Rohtext) kommen aus dem Kit", () => {
    setLang("en");
    const x = embeddingListTexts("en");
    expect(x.statusTooltip(st("timeout"))).toBe("Timeout — network unreachable (wrong network / VPN off?).");
    expect(x.statusTooltip(st("not-an-llm-api"))).toBe("Responds, but is not an OpenAI-compatible endpoint — wrong path/service?");
    expect(x.statusTooltip(st("unknown"))).toBe("Not reachable");
    expect(x.statusTooltip(st("unknown", "ECONNRESET"))).toBe("Not reachable — ECONNRESET");
    expect(x.statusTooltip(st("ok"))).toBe("Connected");
    expect(x.statusTooltip(st("refused"))).toBe("Connection refused — server not running or wrong port.");
  });

  it("Deutsch: dieselben Wege, deutscher Text", () => {
    setLang("de");
    const x = embeddingListTexts("de");
    expect(x.role({ kind: "skipped-model" })).toBe("übersprungen — Modell passt nicht zum Index");
    expect(x.role({ kind: "standby", position: 3 })).toBe("erreichbar — Reserve 3");
    expect(x.statusTooltip(st("unknown"))).toBe("Nicht erreichbar");
    expect(x.statusTooltip(st("timeout"))).toContain("falsches Netz");
  });

  it("Warnungen kommen aus dem Kit; eine unbekannte Regel fällt auf deren Text zurück", () => {
    setLang("en");
    const x = embeddingListTexts("en");
    expect(x.warnings(validateEndpointInput("localhost:1234"))).toBe("Address needs http:// or https://");
    expect(x.warnings([{ rule: "kit-neu-2027", message: "Neuer Kit-Befund" }])).toBe("Neuer Kit-Befund");
  });
});
