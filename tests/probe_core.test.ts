import { describe, it, expect } from "vitest";
import { auswahlReihenfolge, vergleicheLaeufe, type ProbeDatei, type Versuch } from "../scripts/probe_core";

const datei = (path: string, mtime = 0): ProbeDatei => ({ path, mtime });

const vault = (n: number): ProbeDatei[] =>
  Array.from({ length: n }, (_, i) => datei(`ordner${i % 7}/notiz-${i}.md`, 1_700_000_000_000 + i));

describe("auswahlReihenfolge", () => {
  // DER KERNVERTRAG. Der alte Fisher-Yates-Shuffle zog `j = seed % (i + 1)` — die Laenge des
  // Feldes ging in JEDE Position ein, eine zusaetzliche Notiz verschob damit die gesamte
  // Auswahl. Zwei Laeufe vor/nach einem Reindex teilten am 2026-09-05 keine einzige Notiz.
  it("laesst die relative Reihenfolge bestehender Dateien unveraendert, wenn eine dazukommt", () => {
    const vorher = vault(200);
    const nachher = [...vorher, datei("ordner3/ganz-neue-notiz.md", 1_800_000_000_000)];

    const a = auswahlReihenfolge(vorher, 20260903).map(d => d.path);
    const b = auswahlReihenfolge(nachher, 20260903)
      .map(d => d.path)
      .filter(p => p !== "ordner3/ganz-neue-notiz.md");

    expect(b).toEqual(a);
  });

  it("laesst die relative Reihenfolge unveraendert, wenn eine Datei geloescht wird", () => {
    const vorher = vault(200);
    const weg = vorher[42]!.path;
    const nachher = vorher.filter(d => d.path !== weg);

    const a = auswahlReihenfolge(vorher, 20260903).map(d => d.path).filter(p => p !== weg);
    const b = auswahlReihenfolge(nachher, 20260903).map(d => d.path);

    expect(b).toEqual(a);
  });

  it("liefert bei gleichem Seed dieselbe Reihenfolge", () => {
    const v = vault(50);
    expect(auswahlReihenfolge(v, 7).map(d => d.path)).toEqual(auswahlReihenfolge(v, 7).map(d => d.path));
  });

  it("liefert bei anderem Seed eine andere Reihenfolge", () => {
    const v = vault(50);
    expect(auswahlReihenfolge(v, 7).map(d => d.path)).not.toEqual(auswahlReihenfolge(v, 8).map(d => d.path));
  });

  it("haengt nicht von der Eingabereihenfolge ab", () => {
    const v = vault(50);
    const gedreht = [...v].reverse();
    expect(auswahlReihenfolge(gedreht, 7)).toEqual(auswahlReihenfolge(v, 7));
  });

  it("ist eine Permutation — nichts faellt weg, nichts doppelt sich", () => {
    const v = vault(120);
    const r = auswahlReihenfolge(v, 20260903);
    expect(r).toHaveLength(v.length);
    expect(new Set(r.map(d => d.path)).size).toBe(v.length);
  });

  // Ohne Streuung waere `sort(path)` auch stabil — und genau die Klumpung, gegen die der
  // Shuffle ueberhaupt eingebaut wurde (erster Lauf 2026-09-03: 40 Notizen aus EINEM Ordner).
  it("streut ueber die Ordner statt sie alphabetisch zu klumpen", () => {
    const ersteZwanzig = auswahlReihenfolge(vault(700), 20260903).slice(0, 20);
    const ordner = new Set(ersteZwanzig.map(d => d.path.split("/")[0]));
    expect(ordner.size).toBeGreaterThan(3);
  });

  it("kommt mit einer leeren Liste zurecht", () => {
    expect(auswahlReihenfolge([], 1)).toEqual([]);
  });
});

// ── Paarvergleich zweier Laeufe ────────────────────────────────────────────────────────────────
const versuch = (path: string, rank: number): Versuch =>
  ({ path, rank, score: 0.9, topScore: 0.9, top: rank === 0 ? path : "andere.md", mtime: 0 });

describe("vergleicheLaeufe", () => {
  it("meldet eine Notiz als geheilt, die vorher danebenlag und jetzt auf Rang 0 steht", () => {
    const v = vergleicheLaeufe([versuch("a.md", 5)], [versuch("a.md", 0)]);
    expect(v.geheilt.map(g => g.path)).toEqual(["a.md"]);
    expect(v.verschlechtert).toEqual([]);
  });

  it("meldet eine Notiz als verschlechtert, die vorher auf Rang 0 stand und jetzt danebenliegt", () => {
    const v = vergleicheLaeufe([versuch("a.md", 0)], [versuch("a.md", 3)]);
    expect(v.verschlechtert.map(g => g.path)).toEqual(["a.md"]);
    expect(v.geheilt).toEqual([]);
  });

  it("zaehlt nur Notizen als gemeinsam, die in BEIDEN Laeufen gemessen wurden", () => {
    const v = vergleicheLaeufe(
      [versuch("a.md", 0), versuch("b.md", 0)],
      [versuch("a.md", 0), versuch("c.md", 0)],
    );
    expect(v.gemeinsam).toBe(1);
  });

  // DER PUNKT, an dem ein stiller Vergleich luegen wuerde: eine Notiz, die es im zweiten Lauf
  // nicht mehr gibt (geloescht, unter die Laengengrenze gerutscht, aus dem Index gefallen), darf
  // nicht einfach aus der Bilanz fallen — sonst sieht ein geschrumpfter Vergleich aus wie ein
  // sauberer. Die Task nennt genau das als Bedingung: „vertraegt geloeschte Notizen nur mit Meldung".
  it("weist Notizen aus, die im zweiten Lauf fehlen, statt sie still zu schlucken", () => {
    const v = vergleicheLaeufe([versuch("a.md", 0), versuch("weg.md", 4)], [versuch("a.md", 0)]);
    expect(v.verschwunden).toEqual(["weg.md"]);
  });

  it("zaehlt eine unveraendert danebenliegende Notiz weder als geheilt noch als verschlechtert", () => {
    const v = vergleicheLaeufe([versuch("a.md", 2)], [versuch("a.md", 7)]);
    expect(v.geheilt).toEqual([]);
    expect(v.verschlechtert).toEqual([]);
    expect(v.unveraendert).toBe(1);
  });

  it("kommt mit zwei Laeufen ohne gemeinsame Notiz zurecht", () => {
    const v = vergleicheLaeufe([versuch("a.md", 0)], [versuch("b.md", 0)]);
    expect(v.gemeinsam).toBe(0);
    expect(v.verschwunden).toEqual(["a.md"]);
  });
});
