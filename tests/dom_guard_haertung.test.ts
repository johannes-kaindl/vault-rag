// @vitest-environment happy-dom
/**
 * Linkschutz-Härtung (code-kit 0.68.0 `link-guard`, obsidian-kit 0.88.0 `dom-guard`, Welle 34): `attachDomGuard` auf echtem (happy-dom-)DOM.
 * Modelltext erreicht den Wächter im Betrieb nie (`neutralizeModelMarkdown` maskiert `<`); gemessen wird das Netz dahinter.
 * Die Gegenprobe (dasselbe HTML außerhalb des Beobachters) belegt, dass der Test rot werden kann: behält sie nicht alle Marker, ist die Messung ungültig.
 */
import { describe, it, expect } from "vitest";
import { attachDomGuard } from "../src/vendor/kit-obsidian/dom-guard";

const HTML = [
  '<a href="https://example.org/ok" onclick="window.x = 1" ping="https://example.invalid/ping">h-ok</a>',
  '<p onmouseover="window.x = 2">h-p</p>',
  '<form action="https://example.invalid/form"><button formaction="https://example.invalid/fa">h-form</button></form>',
].join("");

function zaehle(root: Element): { forms: number; formaction: number; on: number; ping: number; hrefOk: string | null } {
  const all = Array.from(root.querySelectorAll("*"));
  const a = all.find((e) => e.localName === "a" && e.textContent === "h-ok");
  return {
    forms: all.filter((e) => e.localName === "form").length,
    formaction: all.filter((e) => e.hasAttribute("formaction")).length,
    on: all.filter((e) => e.getAttributeNames().some((n) => n.startsWith("on"))).length,
    ping: all.filter((e) => e.hasAttribute("ping")).length,
    hrefOk: a?.getAttribute("href") ?? null,
  };
}

const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("dom-guard: Härtung gegen on*, form, formaction, ping", () => {
  it("kappt mitten im Strom gesetztes rohes HTML, der https-Link bleibt (Gegenprobe außerhalb behält alle Marker)", async () => {
    const aussen = document.body.appendChild(document.createElement("div"));
    aussen.innerHTML = HTML;
    const gegen = zaehle(aussen);
    // Gültigkeit der Messung: ohne Wächter bleiben alle Marker.
    expect(gegen.forms).toBe(1);
    expect(gegen.formaction).toBe(1);
    expect(gegen.on).toBe(2);
    expect(gegen.ping).toBe(1);

    const body = document.body.appendChild(document.createElement("div"));
    const guard = attachDomGuard(body);
    try {
      body.appendChild(document.createElement("p")).textContent = "Strom läuft";
      const innen = body.appendChild(document.createElement("div"));
      innen.innerHTML = HTML;
      await warte(50);
      const m = zaehle(innen);
      expect(m.forms).toBe(0);
      expect(m.formaction).toBe(0);
      expect(m.on).toBe(0);
      expect(m.ping).toBe(0);
      expect(m.hrefOk).toBe("https://example.org/ok");
    } finally {
      guard.disconnect();
    }
  });
});
