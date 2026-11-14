import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings_core";
import { mergeSettings } from "../src/vendor/kit/settings";
import { makeFakeEl } from "./vendor/kit/obsidian-mock";
import { createStatusBarItem, statusBarEnabled } from "../src/vendor/kit-obsidian/status-bar-item";

/** Wie `onload`: erst `mergeSettings` über die Vorgabe, dann `statusBarEnabled` auf den Wert. */
function geladen(roh: Record<string, unknown> | null): boolean {
  const s = mergeSettings(DEFAULT_SETTINGS, roh as never);
  return statusBarEnabled(s.showStatusBar);
}

function host() {
  const angelegt: HTMLElement[] = [];
  return {
    angelegt,
    plugin: { addStatusBarItem: () => { const el = makeFakeEl("DIV"); el.hide = () => undefined; el.show = () => undefined; angelegt.push(el); return el as HTMLElement; } },
  };
}

describe("Statusleiste: Standard an, gespeicherte Werte bleiben", () => {
  it("frische Installation (keine data.json): an", () => {
    expect(geladen(null)).toBe(true);
  });

  it("alte data.json ohne den Schlüssel: an", () => {
    expect(geladen({ k: 10 })).toBe(true);
  });

  it("gespeichertes false bleibt aus, gespeichertes true bleibt an", () => {
    expect(geladen({ showStatusBar: false })).toBe(false);
    expect(geladen({ showStatusBar: true })).toBe(true);
  });

  it("ein Wert, der kein Boolean ist, fällt auf die Vorgabe an", () => {
    expect(geladen({ showStatusBar: "nein" })).toBe(true);
    expect(geladen({ showStatusBar: null })).toBe(true);
  });
});

describe("Statusleiste: Umschalten und vorübergehendes Einblenden", () => {
  it("der Schalter legt den Eintrag an und hängt ihn ab, der Text bleibt erhalten", () => {
    const h = host();
    const item = createStatusBarItem({ plugin: h.plugin, visible: false, text: null });
    expect(item.shown).toBe(false);
    item.set("● 12");
    item.setVisible(true);
    expect(item.shown).toBe(true);
    expect(item.el?.textContent).toBe("● 12");
    item.setVisible(false);
    expect(item.shown).toBe(false);
  });

  it("Reindex und Pause blenden bei ausgeschaltetem Schalter ein; der Eintrag bleibt, bis der letzte Anlass frei ist", () => {
    const h = host();
    const item = createStatusBarItem({ plugin: h.plugin, visible: false, text: null });
    const reindex = item.reveal();
    const pause = item.reveal();
    expect(item.shown).toBe(true);
    reindex();
    expect(item.shown).toBe(true);
    pause();
    expect(item.shown).toBe(false);
  });

  it("bei eingeschaltetem Schalter bleibt der Eintrag nach dem Reindex stehen", () => {
    const h = host();
    const item = createStatusBarItem({ plugin: h.plugin, visible: true, text: null });
    const frei = item.reveal();
    frei();
    expect(item.shown).toBe(true);
    expect(h.angelegt).toHaveLength(1);
  });
});
