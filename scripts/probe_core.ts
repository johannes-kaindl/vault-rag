/**
 * Auswahl-Reihenfolge fuer `index-probe.ts` — die Haelfte, die NICHT im Renderer laufen muss.
 *
 * WARUM HIER UND NICHT IM RENDERER: die alte Fassung shuffelte im `evaluate`-String, war damit
 * unpruefbar, und ihre Zusage („ein Wiederholungslauf trifft dieselbe Auswahl") hielt nicht. Der
 * Renderer liefert jetzt nur noch die Dateiliste; wer davon gemessen wird, entscheidet Node —
 * normaler TypeScript-Code mit Tests (`tests/probe_core.test.ts`).
 */
export interface ProbeDatei { path: string; mtime: number }

/**
 * Deterministischer Rang einer Datei. FNV-1a ueber `<seed>:<pfad>` — der Wert haengt AUSSCHLIESSLICH
 * an Pfad und Seed, nie an der Menge der uebrigen Dateien.
 *
 * Das ist der ganze Fix: der alte Fisher-Yates zog `j = seed % (i + 1)`, also ging die LAENGE des
 * Feldes in jede Position ein. Eine einzige zusaetzliche Notiz verschob damit die gesamte Auswahl —
 * zwei Laeufe vor und nach einem Reindex teilten am 2026-09-05 keine einzige Notiz, obwohl das
 * Skript Vergleichbarkeit zusagte.
 */
function rang(path: string, seed: number): number {
  let h = 0x811c9dc5;
  const s = `${seed}:${path}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Alle Dateien in stabiler, gestreuter Reihenfolge. Der Aufrufer nimmt sich davon so viele, wie er
 * braucht — waechst der Vault, ruecken neue Notizen zwischen die alten, statt sie umzuwerfen.
 *
 * Bei Hash-Gleichstand entscheidet der Pfad, damit die Ordnung total bleibt (bei ~7.000 Notizen und
 * 32 Bit liegt die Kollisionswahrscheinlichkeit unter einem Prozent, ist aber nicht null).
 */
export function auswahlReihenfolge(dateien: ProbeDatei[], seed: number): ProbeDatei[] {
  return [...dateien].sort((a, b) =>
    rang(a.path, seed) - rang(b.path, seed) || a.path.localeCompare(b.path));
}

/** Ein gemessener Selbstfindungs-Versuch — die Zeile, die `--json` je Notiz schreibt. */
export interface Versuch {
  path: string;
  rank: number;
  score: number | null;
  topScore: number | null;
  top: string | null;
  mtime: number;
}

export interface Vergleich {
  gemeinsam: number;
  geheilt: Versuch[];
  verschlechtert: Versuch[];
  unveraendert: number;
  verschwunden: string[];
}

/**
 * Paarvergleich zweier Laeufe ueber DIESELBEN Notizen (`--wie`). Nur das erlaubt die Aussage
 * „der Reindex hat geholfen" — zwei Laeufe mit gleichem Seed sind sonst zwei unabhaengige
 * Stichproben, und ein Unterschied von vier bei n=40 traegt dann nichts.
 *
 * Gemessen wird der RANG, nicht der Score: Rang 0 ist der Erwartungswert und steht vorher fest,
 * waehrend ein Score ohne dokumentierten Aufrufweg keine Skala ist (AGENTS.md).
 *
 * `verschwunden` ist kein Randfall, sondern die Ehrlichkeitsbedingung: eine Notiz, die im zweiten
 * Lauf fehlt, faellt sonst lautlos aus der Bilanz — und ein geschrumpfter Vergleich sieht aus wie
 * ein sauberer.
 */
export function vergleicheLaeufe(alt: Versuch[], neu: Versuch[]): Vergleich {
  const neuNach = new Map(neu.map(v => [v.path, v]));
  const v: Vergleich = { gemeinsam: 0, geheilt: [], verschlechtert: [], unveraendert: 0, verschwunden: [] };
  for (const a of alt) {
    const n = neuNach.get(a.path);
    if (!n) { v.verschwunden.push(a.path); continue; }
    v.gemeinsam++;
    if (a.rank !== 0 && n.rank === 0) v.geheilt.push(n);
    else if (a.rank === 0 && n.rank !== 0) v.verschlechtert.push(n);
    else v.unveraendert++;
  }
  return v;
}
