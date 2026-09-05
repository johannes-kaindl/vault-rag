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
 * VERGLEICHBARKEIT ZWEIER LAEUFE — die Zusage, an der die erste Fassung scheiterte. Sie
 * shuffelte ueber `app.vault.getMarkdownFiles()` mit `j = seed % (i + 1)`, also ging die LAENGE
 * des Feldes in jede Position ein: eine einzige zusaetzliche Notiz verschob die gesamte Auswahl.
 * Zwei Laeufe vor und nach einem Voll-Reindex teilten am 2026-09-05 keine einzige Notiz und lasen
 * sich trotzdem wie eine Verbesserung (32/40 → 36/40). Zwei Antworten darauf, beide hier:
 *  - Die Auswahl ordnet jetzt `auswahlReihenfolge` (`probe_core.ts`, getestet) ueber einen Hash je
 *    PFAD statt ueber die Position — eine neue Notiz rueckt zwischen die alten, statt sie
 *    umzuwerfen. Das macht den Default-Lauf ueber die Zeit stabil.
 *  - Fuer ein echtes Vorher/Nachher genuegt das nicht (Laengenfenster und Index-Zugehoerigkeit
 *    haengen weiter am Vaultzustand): `--wie <bericht.json>` misst exakt die Notizen des frueheren
 *    Laufs und stellt die Raenge gegenueber. Nur DAS erlaubt „diese Notiz ist geheilt".
 *
 * Aufruf (Obsidian muss mit Debug-Port laufen):
 *   npx tsx scripts/index-probe.ts --port 9222 --vault 10_Pallas
 *   npx tsx scripts/index-probe.ts --port 9222 --vault 10_Pallas --n 40 --json vorher.json
 *   npx tsx scripts/index-probe.ts --port 9222 --vault 10_Pallas --wie vorher.json --json nachher.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Cdp, attachTo, pollUntil } from "../../tools/obsidian-cdp/cdp.js";
import { auswahlReihenfolge, vergleicheLaeufe, type Versuch } from "./probe_core.js";

const PLUGIN_ID = "vault-retrieval";

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
  const wieDatei = arg("wie");

  let voraufNamen: string[] | null = null;
  let vorlauf: Versuch[] | null = null;
  if (wieDatei) {
    const roh = JSON.parse(readFileSync(wieDatei, "utf-8")) as { tried?: Versuch[] };
    vorlauf = roh.tried ?? [];
    voraufNamen = vorlauf.map(v => v.path);
    if (voraufNamen.length === 0) {
      console.error(`${wieDatei} enthaelt keine gemessenen Notizen — nichts zu wiederholen.`);
      process.exit(1);
    }
  }

  const cdp: Cdp | null = await attachTo("workspace", port, vault);
  if (!cdp) {
    console.error(`Kein Obsidian-Fenster auf Port ${port}${vault ? ` fuer Vault ${vault}` : ""}.`);
    process.exit(2);
  }

  // AUSWAHL AUF DER NODE-SEITE. Der Renderer liefert nur die Dateiliste; wer gemessen wird,
  // entscheidet getesteter Code (`probe_core.ts`). Die alte Fassung shuffelte im evaluate-String
  // und war damit weder pruefbar noch stabil — s. Kopf dieser Datei.
  const dateien = await cdp.evaluate<{ path: string; mtime: number }[]>(
    `return app.vault.getMarkdownFiles().map(f => ({ path: f.path, mtime: f.stat.mtime }));`);

  const reihenfolge = voraufNamen ?? auswahlReihenfolge(dateien, seed).map(d => d.path);
  if (voraufNamen) {
    const bekannt = new Set(dateien.map(d => d.path));
    const fehlen = voraufNamen.filter(p => !bekannt.has(p));
    console.log(`Wiederholung nach ${wieDatei}: ${voraufNamen.length} Notizen des Vorlaufs.`);
    if (fehlen.length) console.log(`  ${fehlen.length} davon liegen nicht mehr im Vault.`);
  } else {
    console.log(`Probe laeuft: bis zu ${n} kurze Notizen, je eine Suche ueber den Endpunkt.`);
  }
  console.log("Das dauert unter Last mehrere Minuten — es wird gepollt, nicht gewartet.\n");

  // `strict` = Wiederholungslauf: KEIN Laengenfenster und kein n-Limit, sonst waere es wieder eine
  // andere Auswahl. Eine Notiz, die inzwischen fehlt oder aus dem Index gefallen ist, wird
  // uebersprungen und taucht im Vergleich als `verschwunden` auf — nicht stillschweigend.
  await cdp.evaluate(`
    window.__vaultRagProbe = null;
    (async () => {
    const api = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].api;
    if (!api) { window.__vaultRagProbe = { present: false, offline: false, tried: [], kandidaten: 0 }; return; }
    const strip = (t) => t.replace(/^---\\s*\\n[\\s\\S]*?\\n---\\s*\\n/, "").trim();
    const strict = ${voraufNamen ? "true" : "false"};
    const wunsch = ${JSON.stringify(reihenfolge)};
    const limit = ${voraufNamen ? "wunsch.length" : String(n)};
    const cands = [];
    for (const pfad of wunsch) {
      if (cands.length >= limit) break;
      const f = app.vault.getAbstractFileByPath(pfad);
      if (!f || !("stat" in f)) continue;
      let body;
      try { body = strip(await app.vault.cachedRead(f)); } catch (e) { continue; }
      if (!strict && (body.length <= 200 || body.length > 800)) continue;
      if (body.length === 0) continue;
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

  // PAARVERGLEICH — die eigentliche Antwort auf „hat der Reindex geholfen?". Ohne ihn sind zwei
  // Laeufe zwei Stichproben: am 2026-09-05 las sich 32/40 → 36/40 wie eine Verbesserung, obwohl
  // die beiden Laeufe keine einzige Notiz teilten.
  if (vorlauf) {
    const v = vergleicheLaeufe(vorlauf, r.tried);
    const vorherTreffer = vorlauf.filter(t => t.rank === 0).length;
    console.log(`\n=== Vergleich mit ${wieDatei} ===\n`);
    console.log(`  dieselben Notizen gemessen:  ${v.gemeinsam}`);
    console.log(`  Rang 0 vorher / nachher:     ${vorherTreffer} / ${treffer.length}`);
    console.log(`  geheilt (daneben → Rang 0):  ${v.geheilt.length}`);
    console.log(`  verschlechtert:              ${v.verschlechtert.length}`);
    console.log(`  unveraendert:                ${v.unveraendert}`);
    if (v.verschwunden.length) {
      // NICHT still schlucken: ein geschrumpfter Vergleich sieht sonst aus wie ein sauberer.
      console.log(`  im zweiten Lauf nicht gemessen: ${v.verschwunden.length}`);
      for (const p of v.verschwunden.slice(0, 10)) console.log(`   · ${p}`);
      if (v.verschwunden.length > 10) console.log(`   · … und ${v.verschwunden.length - 10} weitere`);
    }
    if (v.geheilt.length) {
      console.log("\n  Geheilt:");
      for (const t of v.geheilt) console.log(`   · ${t.path.split("/").pop()} (${datum(t.mtime)})`);
    }
    if (v.verschlechtert.length) {
      console.log("\n  Verschlechtert:");
      for (const t of v.verschlechtert) console.log(`   · ${t.path.split("/").pop()} → Rang ${t.rank}`);
    }
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(r, null, 2));
    console.log(`\nRohdaten: ${jsonOut}`);
  }
  cdp.close();
}

void main();
