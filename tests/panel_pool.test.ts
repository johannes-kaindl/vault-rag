import { describe, it, expect } from "vitest";
import { PanelPool } from "../src/panel_pool";

/**
 * Hub-Zustand geht beim Schließen des Blatts verloren (Task, gemessen 2026-11-03: „Panel gleich: false · Verlauf im Panel: 0“).
 * `registerView` baute die Panels bei jeder View-Erzeugung neu; der Pool legt sie beim Schließen zurück und gibt sie der nächsten View wieder.
 */
describe("PanelPool: die Panels überleben das Blatt", () => {
  const neu = () => {
    let n = 0;
    const baut = () => ({ nr: ++n });
    return { baut, gebaut: () => n };
  };

  it("erste View baut, nach Schließen und Öffnen bekommt die nächste dieselben Panels", () => {
    const f = neu();
    const pool = new PanelPool(f.baut);
    const a = pool.take("k");
    pool.give(a, "k");
    const b = pool.take("k");
    expect(b).toBe(a);
    expect(f.gebaut()).toBe(1);
  });

  it("ein zweites Blatt bei geöffnetem ersten bekommt eigene Panels (ein Panel passt nur in einen Container)", () => {
    const f = neu();
    const pool = new PanelPool(f.baut);
    const a = pool.take("k");
    const b = pool.take("k");
    expect(b).not.toBe(a);
    expect(f.gebaut()).toBe(2);
  });

  it("schließen beide Blätter, behält der Pool den Satz des zuletzt geschlossenen; der andere wird verworfen", () => {
    const f = neu();
    const pool = new PanelPool(f.baut);
    const a = pool.take("k");
    const b = pool.take("k");
    pool.give(b, "k");
    pool.give(a, "k");
    expect(pool.take("k")).toBe(a);
    expect(pool.take("k")).not.toBe(b);   // der Satz b ist weg
  });

  it("ein geänderter Schlüssel (Einstellung, die beim Bauen eingelesen wird) verwirft die zurückgelegten Panels", () => {
    const f = neu();
    const pool = new PanelPool(f.baut);
    const a = pool.take("k1");
    pool.give(a, "k1");
    const b = pool.take("k2");
    expect(b).not.toBe(a);
    expect(f.gebaut()).toBe(2);
  });

  it("Gegenprobe: ohne Zurücklegen baut jede View neu (das war der Fehler)", () => {
    const f = neu();
    const pool = new PanelPool(f.baut);
    const a = pool.take("k");
    const b = pool.take("k");
    expect(b).not.toBe(a);
  });
});
