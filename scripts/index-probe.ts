/**
 * Selbstfindungs-Stichprobe ueber den LAUFENDEN Index — die 40er-Probe aus der Task
 * „Aeltere Notizen finden sich ueber ihren eigenen Text nicht" als wiederholbares Werkzeug.
 *
 * WARUM EIGENES SKRIPT UND NICHT DER GUI-SMOKE: der Smoke-Pruefpunkt nimmt SECHS Notizen und
 * beantwortet „ist der Index grob in Ordnung". Diese Frage hier ist eine andere — sie misst die
 * VERTEILUNG ueber das Aenderungsdatum, und das war am 2026-08-30 der wirksame Faktor: korrekt
 * platzierte Notizen hatten Median 2026-08-23, falsch platzierte 2026-07-03. Sechs Notizen
 * koennen das nicht zeigen; sie sagen nur, ob es noch brennt.
 *
 * BAUART, uebernommen aus `scripts/gui-smoke.ts` (Abschnitt 0a) — beide Punkte sind dort teuer
 * gelernt worden:
 *  - Nur KURZE Notizen (200–800 Zeichen). Unter der Chunk-Grenze ist die Notiz genau EIN Chunk,
 *    ihr Index-Vektor also das Embedding genau dieses Textes → Rang 0 ist die einzig richtige
 *    Antwort und steht VORHER fest. Bei langen Notizen mischt die mean-Aggregation mehrere
 *    Chunks, und ein Rang > 0 waere legitim — die Probe haette dann keinen Erwartungswert.
 *  - Mutation und Wartephase TRENNEN: N Suchen, jede embeddet ihre Query ueber den Endpunkt und
 *    dauert unter Last 5–8 s. In EINEM `evaluate` sprengt das die 30-s-Grenze von `Cdp.send`.
 *    Also im Renderer starten, Ergebnis ablegen, auf der Node-Seite pollen.
 *
 * Aufruf (Obsidian muss mit Debug-Port laufen):
 *   npx tsx scripts/index-probe.ts --port 9222 --vault 10_Pallas
 *   npx tsx scripts/index-probe.ts --port 9222 --vault 10_Pallas --n 40 --json bericht.json
 */
import { writeFileSync } from "node:fs";
import { Cdp, attachTo, pollUntil } from "../../tools/obsidian-cdp/cdp.js";

const PLUGIN_ID = "vault-retrieval";

interface Versuch {
  path: string;
  rank: number;
  score: number | null;
  topScore: number | null;
  top: string | null;
  mtime: number;
}
interface Ergebnis {
  present: boolean;
  offline: boolean;
  tried: Versuch[];
  kandidaten: number;
  error?: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const datum = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

async function main(): Promise<void> {
  const port = Number(arg("port", "9222"));
  const vault = arg("vault");
  const n = Number(arg("n", "40"));
  const seed = Number(arg("seed", "20260903"));
  const jsonOut = arg("json");

  const cdp: Cdp | null = await attachTo("workspace", port, vault);
  if (!cdp) {
    console.error(`Kein Obsidian-Fenster auf Port ${port}${vault ? ` fuer Vault ${vault}` : ""}.`);
    process.exit(2);
  }

  console.log(`Probe laeuft: bis zu ${n} kurze Notizen, je eine Suche ueber den Endpunkt.`);
  console.log("Das dauert unter Last mehrere Minuten — es wird gepollt, nicht gewartet.\n");

  await cdp.evaluate(`
    window.__vaultRagProbe = null;
    (async () => {
    const api = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].api;
    if (!api) { window.__vaultRagProbe = { present: false, offline: false, tried: [], kandidaten: 0 }; return; }
    const strip = (t) => t.replace(/^---\\s*\\n[\\s\\S]*?\\n---\\s*\\n/, "").trim();
    // Voraussetzung selbst herstellen: nur Notizen nehmen, die WIRKLICH im Index stehen.
    // related() ist der billige Test — es rechnet offline auf dem Index, ohne Endpunkt.
    // STREUUNG: nicht die ersten N in Vault-Reihenfolge nehmen. Der erste Lauf am 2026-09-03
    // lieferte 40 Notizen aus EINEM Ordner (50_Ressourcen) — die Verteilung ueber das
    // Aenderungsdatum ist der Messgegenstand, und eine Auswahl aus einem Ordner kann sie nicht
    // zeigen. Deterministischer Shuffle (seeded LCG), damit ein Wiederholungslauf dieselbe
    // Auswahl trifft und zwei Laeufe vergleichbar bleiben.
    const alle = app.vault.getMarkdownFiles().slice().sort((a, b) => a.path.localeCompare(b.path));
    let seed = ${seed};
    for (let i = alle.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      const tmp = alle[i]; alle[i] = alle[j]; alle[j] = tmp;
    }
    const cands = [];
    for (const f of alle) {
      if (cands.length >= ${n}) break;
      let body;
      try { body = strip(await app.vault.cachedRead(f)); } catch (e) { continue; }
      if (body.length <= 200 || body.length > 800) continue;
      const r = await api.related(f.path);
      if (!r.ok && r.reason === "not-indexed") continue;
      cands.push({ path: f.path, query: body.slice(0, 300), mtime: f.stat.mtime });
    }
    const tried = [];
    let offline = false;
    for (const c of cands) {
      const res = await api.search(c.query);
      if (!res.ok) { if (res.reason === "offline") offline = true; continue; }
      const hits = res.hits ?? [];
      const rank = hits.findIndex(h => h.path === c.path);
      tried.push({
        path: c.path,
        rank,
        score: rank >= 0 && hits[rank] ? hits[rank].score : null,
        topScore: hits[0] ? hits[0].score : null,
        top: hits[0] ? hits[0].path : null,
        mtime: c.mtime,
      });
    }
    window.__vaultRagProbe = { present: true, offline, tried, kandidaten: cands.length };
    })().catch(e => { window.__vaultRagProbe = { present: true, offline: false, tried: [], kandidaten: 0, error: String(e) }; });
    return true;
  `);

  // Grosszuegig: 40 Suchen à 5–8 s sind im schlechten Fall ueber fuenf Minuten.
  const r = await pollUntil<Ergebnis>(cdp, `return window.__vaultRagProbe;`, 900_000, 5_000);
  if (!r) { console.error("Probe nach 15 Minuten ohne Ergebnis — Endpunkt unter Last?"); process.exit(1); }
  if (r.error) { console.error(`Probe brach ab: ${r.error}`); process.exit(1); }
  if (!r.present) { console.error("Plugin-API nicht erreichbar — laeuft vault-retrieval?"); process.exit(1); }
  if (r.offline || r.tried.length === 0) {
    console.error("Kein Embedding-Endpunkt erreichbar — ohne ihn ist 'keine Antwort' die richtige Antwort, kein Befund.");
    process.exit(3);
  }

  const treffer = r.tried.filter(t => t.rank === 0);
  const daneben = r.tried.filter(t => t.rank !== 0);

  console.log(`\n=== Selbstfindung: ${treffer.length}/${r.tried.length} auf Rang 0 ===\n`);
  console.log("                      Anzahl   Median letzte Aenderung");
  console.log(`  korrekt platziert   ${String(treffer.length).padStart(6)}   ${datum(median(treffer.map(t => t.mtime)) ?? 0)}`);
  if (daneben.length) {
    console.log(`  falsch platziert    ${String(daneben.length).padStart(6)}   ${datum(median(daneben.map(t => t.mtime)) ?? 0)}`);
  }

  // STREUUNG AUSWEISEN, nicht nur beteuern: ist der Messgegenstand die Verteilung ueber das
  // Aenderungsdatum, entscheidet die Breite der Auswahl ueber die Aussagekraft. Ein Bericht,
  // der sie nennt, bleibt auch dann verwertbar, wenn sie klumpt — dann steht wenigstens fest,
  // was er NICHT zeigt.
  const ordner = new Map<string, number>();
  for (const t of r.tried) {
    const top = t.path.split("/")[0] ?? "(root)";
    ordner.set(top, (ordner.get(top) ?? 0) + 1);
  }
  console.log(`\n  Streuung der Auswahl: ${ordner.size} Top-Ordner`);
  for (const [k, v] of [...ordner].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`   · ${String(v).padStart(3)}  ${k}`);
  }
  if (ordner.size === 1) {
    console.log("   ⚠️  ALLES AUS EINEM ORDNER — die Verteilung ueber das Aenderungsdatum");
    console.log("       traegt damit keine Aussage ueber den Vault. Mit anderem --seed wiederholen.");
  }

  // KEIN Vergleich gegen die Skala vom 2026-08-30 (0.4 gesund / 0.85–0.92 verschoben): die
  // stammt aus einem anderen Aufrufweg und ist als Bezugssystem nicht belegt — „ein Score ohne
  // dokumentierten Aufrufweg ist keine Skala" (koda-agent, 2026-09-03). Fuer DIESE Probe ist ein
  // hoher Wert ohnehin der Erwartungswert und kein Warnsignal: die Query IST der eigene Text der
  // Notiz, cos gegen sich selbst liegt nahe 1. Die tragende Zahl ist der RANG, nicht der Score.
  const eigene = treffer.map(t => t.score).filter((s): s is number => s !== null);
  console.log(`\n  Median Score der eigenen Notiz auf Rang 0: ${median(eigene)?.toFixed(3) ?? "—"}`);
  console.log("  (Erwartungswert nahe 1 — die Query ist der eigene Text. Kein Guetemass;");
  console.log("   nur als Vergleichsbasis fuer spaetere Laeufe DESSELBEN Aufrufs brauchbar.)");

  if (daneben.length) {
    console.log("\n  Nicht auf Rang 0:");
    for (const t of daneben) {
      const wer = t.top ? t.top.split("/").pop() : "nichts";
      // GLEICHSTAND VON VERDRAENGUNG TRENNEN: steht die eigene Notiz punktgleich mit dem
      // Ranglisten-Ersten, ist die Reihenfolge willkuerlich und kein Befund — mehrere Notizen
      // tragen dann (nahezu) denselben Vektor. Nur ein ECHTER Rueckstand ist eine Fehlzuordnung.
      const gleich = t.score !== null && t.topScore !== null
        && Math.abs(t.score - t.topScore) < 1e-9;
      const art = gleich ? "GLEICHSTAND (punktgleich, Reihenfolge willkuerlich)" : "Rueckstand";
      console.log(`   · ${t.path.split("/").pop()} → Rang ${t.rank} (${datum(t.mtime)}), vorn steht ${wer}`);
      console.log(`     ${art} — eigener Score ${t.score?.toFixed(6) ?? "—"}, Spitze ${t.topScore?.toFixed(6) ?? "—"}`);
    }
    const echte = daneben.filter(t => !(t.score !== null && t.topScore !== null
      && Math.abs(t.score - t.topScore) < 1e-9));
    console.log(`\n  Davon echte Rueckstaende: ${echte.length} (Gleichstaende zaehlen nicht als Fehlzuordnung)`);
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(r, null, 2));
    console.log(`\nRohdaten: ${jsonOut}`);
  }
  cdp.close();
}

void main();
