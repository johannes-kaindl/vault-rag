/**
 * GUI-Smoke-Treiber — fährt die Abnahme-Prüfpunkte gegen ein **laufendes** Obsidian
 * statt von Hand.
 *
 * Warum getrackt (CORE-TEST-02 b): dieselbe Lesson wie in `3d-codeblocks/scripts/gui-smoke.ts` —
 * ein Treiber, der nur im Session-Scratchpad liegt, ist beim nächsten Mal weg, und was er
 * einmal gefunden hat, findet niemand wieder.
 *
 * Was er prüft, das Unit-Tests strukturell nicht können: ob ein Icon-Name in Obsidians
 * gebündeltem Lucide überhaupt existiert (ein unbekannter Name rendert **still nichts**),
 * ob die Zeile im echten Flex-Layout so umbricht wie gedacht, und ob ein Klick durch die
 * ganze Kette geht (Speichern → Resolve → Neuzeichnen).
 *
 * ## Voraussetzung
 *
 * Obsidian muss mit offenem Debug-Port laufen.
 *
 * ⚠️ **ERST PRUEFEN, OB SCHON EINS LAEUFT — nicht blind quitten.** Obsidian ist
 * Single-Instance: es gibt keinen Weg, "mein eigenes Obsidian daneben" zu starten, und ein
 * `quit` beendet das der anderen mit. Am 2026-08-30 haette diese Anweisung beinahe zwei
 * Stunden Reindex einer parallel arbeitenden Session vernichtet — der eigene Lauf waere
 * danach sauber gruen gewesen, der Schaden entstand woanders und waere nicht aufgefallen.
 *
 * ```bash
 * curl -s http://127.0.0.1:9222/json/version >/dev/null && echo "laeuft schon — MITNUTZEN"
 * ```
 *
 * Laeuft schon eins: mitnutzen. Ein eigenes Vault-Fenster oeffnet man per `vault-open` ueber
 * IPC (`open -a Obsidian` und `obsidian://open?path=` tun es NICHT), gewaehlt wird ueber
 * `attachTo("workspace", port, "<vault>")` — der Vault-Filter trennt sauber.
 *
 * Laeuft keins (oder nur nach Absprache mit dem, der es benutzt):
 *
 * ```bash
 * osascript -e 'quit app "Obsidian"'
 * open -a Obsidian --args --remote-debugging-port=9222
 * ```
 *
 * **Leichen zaehlen — aber am richtigen Merkmal:**
 *
 * ```bash
 * curl -s http://127.0.0.1:9222/json/list \
 *   | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for t in d if t.get('title')==t.get('url')), 'von', len(d))"
 * ```
 *
 * ⚠️ **Nicht auf `about:blank` filtern.** Das liegt nahe und ist zu schwach: gemessen am
 * 2026-08-30 an einer Instanz mit 22 Targets waren **14 Leichen** — davon trug genau **eine**
 * `about:blank`. Der `about:blank`-Test haette „1" gemeldet und die Lage harmlos aussehen
 * lassen. Das tragfaehige Merkmal ist `title === url` (CDP setzt die URL als Titel ein, wenn
 * `document.title` fehlt); so filtert sie auch die zentrale Bruecke seit `0ae3cef`/`8364009`.
 *
 * ⚠️ **Und: ein zweiter Lauf in derselben Obsidian-Sitzung ist nicht sauber.**
 * `app.setting.close()` schliesst die **Ansicht**, nicht das **Target** — gemessen an 1.13.7:
 * nach dem Schliessen steht das `about:blank`-Target weiter in `/json/list`, und
 * `/json/close` raeumt es nicht weg (antwortet `Target is closing`, danach ist es noch da).
 * Jeder Lauf hinterlaesst also einen Settings-Kandidaten; beim naechsten Lauf ist
 * `attachTo("settings", …)` mehrdeutig und nimmt den erstbesten — moeglicherweise die tote
 * Ansicht des Vorlaufs, was die Endpunkt-Pruefpunkte falsch-rot macht. Das braucht **keine**
 * zweite Session, es passiert im Normalbetrieb eines einzigen Repos.
 * **Deshalb: vor einem erneuten Lauf Obsidian neu starten** (dann sind alle Target-Leichen weg).
 * Das einzige, was sie sonst raeumt, ist das Schliessen des zugehoerigen Vault-Fensters.
 *
 * ## Wo der Lauf hingehoert: Staging-Vault auf einer ZWEITINSTANZ (seit 2026-09-03)
 *
 * Im Arbeitsvault `10_Pallas` sind Pruefpunkte STRUKTURELL nicht messbar: dort ist ein echtes
 * llm-lab installiert (der ganze Meldestrecken-Zweig wird uebersprungen, damit der Smoke dessen
 * Aufzeichnung nicht verunreinigt), und die Endpunkt-Listen tragen je EINE Zeile (Prioritaets-Knopf
 * und „Zuerst verwenden" haben nichts zu messen). Der Staging-Vault `vault-rag` (Fixture
 * `docs/images/fixture/`, Plugin-Einstellungen mit je ZWEI Zeilen aus
 * `docs/images/fixture/plugin/settings.json`) hat beides nicht — dort laeuft der ganze Treiber.
 *
 * Und weil ein zweiter Lauf in derselben Obsidian-Sitzung nicht sauber ist (Target-Leichen, s. o.),
 * die regulaere Instanz aber vier fremden Sessions gehoert, laeuft er auf einer ZWEITINSTANZ mit
 * eigenem Profil (Dach-AGENTS.md § Staging-Vaults: die Single-Instance-Sperre haengt am Profil):
 *
 * ```bash
 * npm run build && npm run shots -- --setup        # Vault aus dem Fixture (Index ist danach weg)
 * UD=/tmp/obs-vault-rag; mkdir -p "$UD"
 * cp ~/Library/Application\ Support/obsidian/obsidian-1.13.7.asar "$UD"/   # sonst startet 1.12.4
 * # $UD/obsidian.json: {"vaults":{"<id>":{"path":"$STAGING_VAULTS_DIR/vault-rag","ts":0,"open":true}}}
 * /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9333 &
 * npm run shots -- --port 9333 --prepare          # Index bauen (18 Notizen, Sekunden)
 * npm run smoke:gui -- --port 9333 --vault vault-rag
 * ```
 *
 * Der CDP-Lock (`obsidian-cdp-lock.py acquire --exclusive quit-reload`) bleibt Pflicht: der Guard
 * gatet den Kommandotext, und ein fremdes `pkill -f Obsidian` traefe auch die Zweitinstanz.
 *
 * Gegen die regulaere Instanz (Port 9222) geht es weiterhin — dann mit den Skips in der Bilanz:
 *
 * ```bash
 * npm run smoke:gui -- --port 9222 --vault 10_Pallas
 * ```
 *
 * `--vault` matcht seit der zentralen CDP-Brücke exakt gegen `app.vault.getName()`
 * (den Vault-**Ordnernamen**), nicht mehr als Teilstring des Fenstertitels — `10_Pallas`
 * genügt also nicht mehr, es muss `10_Pallas` heißen.
 *
 * Der Klick-Prüfpunkt verändert die Endpunkt-Reihenfolge in den Einstellungen. Der Treiber
 * sichert sie vorher und schreibt sie im `finally` zurück — auch nach einem Abbruch mitten
 * im Lauf. Mit `--keep` bleibt die geänderte Reihenfolge stehen.
 *
 * ⚠️ **Der letzte Prüfpunkt (Auto-Heal-Kaskade) beschädigt `index.bin` absichtlich** und stellt
 * die Embedding-Endpunkte kurzzeitig tot — anders ist die Verdrahtung nicht zu messen, und
 * genau dort lag der Bug (nicht in der unit-getesteten Entscheidung `planAutoHeal`). Er läuft
 * nur, wenn ein geräte-lokales Backup existiert, parkt die Original-Bytes im Renderer und
 * schreibt sie im `finally` zurück. Bleibt selbst das aus, holt die Auto-Heal-Kaskade den
 * Index beim nächsten Start aus demselben Backup — das ist die zweite Absicherung.
 *
 * Die CDP-Brücke liegt seit 2026-08-16 zentral im Dach (`tools/obsidian-cdp/`) und wird
 * importiert, nicht vendored: sie ist plugin-neutral und lief zuvor byte-identisch/inline
 * in mehreren Repos. Fehlt das Dach (fremder Checkout), bricht esbuild beim Auflösen ab —
 * das ist die gewollte Meldung. Was ihr fehlt, wird DORT ergänzt, nicht hier nachgebaut.
 */

import { join } from "node:path";
import { cwd } from "node:process";

import { Cdp, attachTo, pollUntil } from "../../tools/obsidian-cdp/cdp.js";
import { requireEigenerBuild } from "../../tools/obsidian-cdp/vault.js";
import { EN, DE } from "../src/i18n/strings";

const PLUGIN_ID = "vault-retrieval";
/** Muss zu `setIcon(...)` in `buildEndpointList` passen. */
const PRIORITY_ICON = "arrow-up-to-line";
const FALLBACK_ICON = "chevrons-up";
/** Die Pruefpunkte des llm-lab-Zweigs — namentlich, damit ein Skip des ganzen Zweigs JEDEN
 *  davon in die Bilanz traegt. Muss zu den `record(...)`-Namen im `else` von `if (labReal)`
 *  passen; die Zaehlung 2026-09-03: sechs (die Task nannte 15 — das war ein grep ueber
 *  `record(` inklusive Definition und Kommentare, nicht ueber Aufrufe). */
/** Frist fuer EINE Chat-Antwort ueber die Oberflaeche. Nicht 180 s: ein denkendes 27B-Modell
 *  brauchte bei WARMEM Endpunkt 218 s fuer „Antworte mit genau einem Wort: Hallo." (1.191
 *  Reasoning-Tokens, gemessen 2026-09-03 per curl) — der Punkt war rot, waehrend der zweite Chat
 *  desselben Laufs durchlief. Das Fixture setzt `suppressThinking`, damit der Normalfall in
 *  Sekunden liegt; die Frist deckt den Fall, dass ein Modell trotzdem denkt. */
const CHAT_FRIST_MS = 360_000;
/** Die Pruefpunkte des Integrator-Abschnitts — namentlich, damit ein Skip des Zweigs JEDEN in die
 *  Bilanz traegt (dieselbe Regel wie LAB_PRUEFPUNKTE). */
const INTEGRATOR_PRUEFPUNKTE = [
  "Tab „Integrator“ steht in der Leiste, vor „Umformatieren“",
  "Kommando-Pfad erzeugt einen Vorschlag für die Fixture-Notiz",
  "Annehmen im Panel schreibt den Abschnitt mit dem Wikilink in die Datei",
  "Zweites Anwenden desselben Ziels lässt die Datei byte-identisch",
  "Abgelehntes Ziel kommt beim Neuberechnen nicht wieder",
  "Frontmatter-Modus: related: [] wird zur Blockliste, Rest byte-identisch",
];
const LAB_PRUEFPUNKTE = [
  "Ein Chat über die Oberfläche meldet sich beim Lab",
  "Die Chat-Zeile trägt ttftMs und latencyMs",
  "Die Chat-Zeile trägt die Kontext-Pfade, die das Panel zeigt",
  "Die Endpunkt-Probe meldet sich unter eigenem feature (damit das Lab sie ausschließen kann)",
  "Reformat meldet sich mit der Transform-ID im feature",
  "Die Reformat-Vorschau ist nach dem Verwerfen geschlossen",
  "Ohne Lab läuft der Chat vollständig durch und meldet nichts",
];

// --- Prüfpunkte -------------------------------------------------------------

interface Check { name: string; passed: boolean; detail: string }

interface HubProbe {
  present: boolean;
  tablist?: string | null;
  count?: number;
  selected?: number;
  focusable?: number;
  controls?: boolean;
}
const results: Check[] = [];

function record(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Uebersprungene Pruefpunkte — bewusst eine EIGENE Liste, nicht `results`. Ein Punkt, der nicht
 *  gelaufen ist, ist weder bestanden noch durchgefallen, und beide Zuordnungen sind belegt
 *  falsch: obsidian-transmute zaehlte ihn als gruen, dieser Treiber bis 2026-09-03 als rot
 *  („nur eine Endpunkt-Zeile konfiguriert — nicht pruefbar" stand als ✗ in der Bilanz). Er
 *  gehoert aber IN die Bilanz: „23/25 gruen" las sich am 2026-09-02 wie ein vollstaendiger Lauf,
 *  waehrend 15 weitere Punkte im llm-lab-Zweig nie erreicht wurden. Uebernommen aus
 *  yijing-oracle `c0a6f6e`. Der zweite Parameter nennt den GRUND — ein Skip ohne Grund ist von
 *  einem vergessenen Pruefpunkt nicht zu unterscheiden. */
const uebersprungen: { name: string; reason: string }[] = [];

function skipped(name: string, reason: string): void {
  uebersprungen.push({ name, reason });
  console.log(`  – ${name} — übersprungen: ${reason}`);
}

/** Liest die sichtbaren Endpunkt-Zeilen der zuletzt geöffneten Einstellungs-Seite. */
const READ_ROWS = `
  const rows = [...document.querySelectorAll(".okit-ep-row")];
  // Es gibt ZWEI Listen (Embedding und Chat) im selben Tab, jede mit ihrem eigenen aktiven
  // Endpunkt. Global zu zählen ergäbe zwei "aktiv" und sähe wie ein Bug aus, der keiner ist.
  // Der gemeinsame Eltern-Container trennt sie zuverlässig.
  const parents = [];
  const listIndexOf = (row) => {
    const p = row.parentElement;
    let idx = parents.indexOf(p);
    if (idx === -1) { parents.push(p); idx = parents.length - 1; }
    return idx;
  };
  return rows.map((row, i) => {
    const listIndex = listIndexOf(row);
    const state = row.querySelector(".okit-ep-state");
    const url = row.querySelector('input[type="text"]');
    const buttons = [...row.querySelectorAll(".extra-setting-button, .clickable-icon")];
    return {
      index: i,
      listIndex,
      url: url ? url.value : "",
      state: state ? state.textContent : null,
      stateWidthRatio: state && row.querySelector(".setting-item-control")
        ? Math.round(100 * state.getBoundingClientRect().width /
            row.querySelector(".setting-item-control").getBoundingClientRect().width)
        : null,
      stateTopBelowFields: state && url
        ? state.getBoundingClientRect().top >= url.getBoundingClientRect().bottom - 1
        : null,
      buttonCount: buttons.length,
      modelValue: (() => { const sel = row.querySelector("select"); return sel ? sel.value : null; })(),
      hasPriorityButton: !!row.querySelector('svg[class*="arrow-up-to-line"], svg[class*="chevrons-up"]'),
      priorityIconClass: (() => {
        const svg = row.querySelector('svg[class*="arrow-up-to-line"], svg[class*="chevrons-up"]');
        return svg ? (svg.getAttribute("class") || "") : null;
      })(),
      buttonIcons: buttons.map(b => {
        const svg = b.querySelector("svg");
        return svg ? (svg.getAttribute("class") || "").replace("svg-icon ", "") : "(leer)";
      }),
      warnIconBelowState: (() => {
        const warn = row.querySelector(".okit-ep-warn, .okit-ep-thirdparty");
        if (!warn || !state) return null;
        return warn.getBoundingClientRect().top >= state.getBoundingClientRect().bottom - 1;
      })(),
    };
  });
`;

interface Row {
  index: number; listIndex: number; url: string; state: string | null;
  hasPriorityButton: boolean; priorityIconClass: string | null; modelValue: string | null;
  stateWidthRatio: number | null; stateTopBelowFields: boolean | null;
  buttonCount: number; buttonIcons: string[]; warnIconBelowState: boolean | null;
}

interface ApiProbe {
  present: boolean;
  apiVersion?: number;
  keys?: string[];
  status?: { apiVersion: number; indexed: boolean; noteCount: number };
  statusIsSync?: boolean;
  related?: { ok: boolean; reason?: string; hits?: { path: string; score: number }[] } | null;
  relatedPath?: string | null;
  search?: { ok: boolean; reason?: string; hits?: { path: string; score: number }[] };
  serialisable?: boolean;
}

interface SelfFindProbe {
  present: boolean;
  offline: boolean;
  tried: { path: string; rank: number; top: string | null }[];
}

/** Muss im HAUPTfenster laufen — nur dort existiert `app`. */
async function openSettings(main: Cdp): Promise<void> {
  await main.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise(r => setTimeout(r, 1500));
  `);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const port = Number(flag("port") ?? 9222);
  const vault = flag("vault");
  const keep = argv.includes("--keep");

  console.log(`GUI-Smoke vault-retrieval — Obsidian auf Port ${port}\n`);
  // `attachTo` unterscheidet Haupt- und Einstellungen-Fenster an der Sache (nur das
  // Hauptfenster trägt einen Workspace), nicht am lokalisierten Titel.
  const main = await attachTo("workspace", port, vault);
  if (!main) {
    throw new Error(
      `Kein Obsidian-Hauptfenster auf Port ${port}` +
        (vault ? ` für Vault „${vault}“` : "") +
        ". Läuft Obsidian mit --remote-debugging-port? (siehe Kopfkommentar)",
    );
  }
  // Außerhalb des try, damit das finally die Reihenfolge auch nach einem Abbruch
  // mitten im Lauf zurückschreiben kann.
  // Ein `ungeklaert`-Ausgang des Herkunfts-Guards WARNT nur (ein Guard darf keinen Lauf toeten,
  // gegen den er nichts in der Hand hat) — die Warnung gehoert dann aber in die Zusammenfassung,
  // sonst scrollt sie oben weg und der Lauf sieht sauber aus.
  let herkunftsWarnung: string | null = null;
  let savedChatOrder: string[] | null = null;
  let settings: Cdp | null = null;
  // Der Heal-Prüfpunkt zerstört absichtlich den Container und stellt die Endpunkt-Liste tot.
  // Beides wird im finally zurückgeschrieben — auch nach einem Abbruch mitten im Lauf.
  let healRestore: { indexPath: string; savedEndpoints: unknown } | null = null;
  // Der Integrator-Abschnitt schreibt in zwei Fixture-Notizen und in integrator.json. Beides wird
  // im finally zurueckgesetzt, damit ein zweiter Lauf ohne `--setup` dieselbe Lage vorfindet.
  let integratorRestore: { plain: string; rel: string } | null = null;
  // Das Lab-Stub haengt im Renderer und muss auch nach einem Abbruch mitten im Lauf weg —
  // sonst glaubt ein spaeter installiertes echtes Lab, es sei bereits registriert.
  let labStubbed = false;

  try {
    // Chromium drosselt nicht-fokussierte Fenster — ohne bringToFront misst man Phantome.
    await main.send("Page.bringToFront");

    const active = await main.evaluate<boolean>(
      `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`,
    );
    if (!active) throw new Error(`Plugin ${PLUGIN_ID} ist nicht aktiv — Obsidian neu laden (Cmd+R)?`);

    // Laeuft dieser Lauf ueberhaupt gegen den eigenen Stand? `manifest.version` ist dagegen
    // STRUKTURELL blind — Store- und Repo-Build tragen dieselbe Nummer.
    //
    // Der Pfad kommt aus der LAUFENDEN Instanz, nicht aus `stagingVaultDir(...)`: der Treiber
    // dockt per `--vault` an ein beliebiges Fenster an, ein Check gegen den Staging-Pfad wuerde
    // also eine Datei pruefen, die mit dem Lauf nichts zu tun hat. Geprueft wird, was gemessen
    // wird (Dach-README, korrigiert 2026-09-02).
    //
    // Fuer dieses Repo besonders wichtig: die AGENTS.md fuehrte `10_Pallas` bis 2026-09-02 als
    // "Plugin-Ordner ist ein Symlink aufs Repo, Reload reicht". Gemessen ist es ein echtes
    // Verzeichnis mit Kopien — ohne `npm run deploy` misst der Lauf den alten Build (`7adf475`).
    const vaultInfo = await main.evaluate<{ basePath: string; configDir: string }>(`
      return { basePath: app.vault.adapter.basePath, configDir: app.vault.configDir };
    `);
    requireEigenerBuild(
      join(vaultInfo.basePath, vaultInfo.configDir, "plugins", PLUGIN_ID, "main.js"),
      // Der Vergleichsstand muss frisch sein — sonst sagt der Vergleich nichts. `npm run deploy`
      // baut ihn direkt davor.
      join(cwd(), "main.js"),
      (meldung) => {
        herkunftsWarnung = meldung;
        console.warn(meldung);
      },
    );

    // Sprache der LAUFENDEN Oberfläche ermitteln und daraus die erwarteten Zustandstexte
    // ableiten. Obsidian legt die Wahl in `localStorage.language` ab; fehlt sie, gilt Englisch.
    // Der Treiber vergleicht danach gegen dasselbe Wörterbuch, aus dem die UI ihre Texte nimmt —
    // er prüft also weiterhin, dass die richtige ROLLE angezeigt wird (ein falscher Schlüssel
    // fällt weiter auf), nur nicht mehr, in welcher Sprache.
    // DIESELBE Quelle wie das Plugin: `main.ts:186` ruft `pickLang(getLanguage())`, und Obsidian
    // spiegelt `getLanguage()` in `document.documentElement.lang`. (Das Plugin selbst leitet
    // nirgends aus `localStorage` ab — gemessen 2026-09-06, `src/` kennt den Key nicht.)
    //
    // `localStorage.language` ist dagegen die **Einstellung fuer den naechsten Start**, nicht
    // die geladene Sprache. Beide Werte weichen deshalb in ZWEI Lagen ab, nicht nur in einer:
    //   · frisches Profil (Zweitinstanz) — der Key fehlt, Obsidian nimmt die Systemsprache;
    //     der Treiber erwartete „active" gegen eine Oberflaeche, die „aktiv" rendert:
    //     drei falsch-rote Punkte (2026-09-03, hier gemessen).
    //   · nach einer Sprachumstellung OHNE Neustart — der Key sagt schon „de", die laufende
    //     Oberflaeche steht noch auf Englisch (2026-08-18 in `apple-health` gemessen, zwei
    //     Wochen vor uns; deren Fassung nennt diesen allgemeineren Grund, unsere nannte nur
    //     die erste Lage).
    //
    // n=3 (apple-health 08-18, hier 09-03, local-image-generator 09-06), drei unabhaengige
    // Entdeckungen ohne REGISTRY-Eintrag — genau der Fall, gegen den der Katalog steht; der
    // Eintrag entsteht gerade. Sechs Treiber im Dach tragen die defekte Fassung noch, fuenf
    // davon `shots.ts`: dort erzeugt sie falsch beschriftete README-Bilder statt roter Punkte,
    // der Lauf ist also gruen und das Ergebnis trotzdem falsch.
    const uiLang = await main.evaluate<string>(
      `return document.documentElement.lang || (window.localStorage && localStorage.getItem("language")) || "en";`,
    );
    const W = uiLang.startsWith("de") ? DE : EN;
    const L = {
      active: W["endpointRole.active"],
      standby: W["endpointRole.standby"],
      unreachable: W["endpointRole.unreachable"],
      skippedModel: W["endpointRole.skippedModel"],
      checking: W["settings.conn.checking"],
    };
    console.log(`  (Oberflächensprache: ${uiLang} — erwarte „${L.active}" / „${L.unreachable}")\n`);

    // --- 0. Plugin-API für Fremdplugins ------------------------------------
    // Der Aufruf läuft über CDP im Renderer, also exakt auf dem Weg, den ein anderes
    // Obsidian-Plugin nimmt (`app.plugins.plugins[id].api`) — nicht über internen Code.
    // Genau das können Unit-Tests strukturell nicht: dass der Vertrag am echten
    // Plugin-Objekt hängt und über die Renderer-Grenze JSON-tauglich ankommt.
    const probe = await main.evaluate<ApiProbe>(`
      const api = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].api;
      if (!api) return { present: false };
      const status = api.status();
      // Voraussetzung selbst herstellen statt sie zu hoffen (REGISTRY-Falle 11): eine
      // Notiz suchen, die WIRKLICH im Index steht. Irgendeine zu raten macht den
      // Prüfpunkt falsch-rot, sobald die erste Datei eine leere Ordner-Notiz ist.
      let related = null, relatedPath = null;
      for (const f of app.vault.getMarkdownFiles().slice(0, 200)) {
        const r = await api.related(f.path);
        if (r.ok || r.reason !== "not-indexed") { related = r; relatedPath = f.path; break; }
      }
      const search = await api.search("Notiz");
      return {
        present: true,
        apiVersion: api.apiVersion,
        keys: Object.keys(api).sort(),
        status,
        statusIsSync: !(status && typeof status.then === "function"),
        related, relatedPath, search,
        serialisable: JSON.stringify({ status, related, search }).length > 0,
      };
    `);

    record("Plugin-API hängt am Plugin-Objekt und nennt ihre Version",
      probe.present && probe.apiVersion === 1, `apiVersion ${String(probe.apiVersion)}`);
    // Regressionsschutz gegen ein spaeteres `this.api = this.facade`: der externe Vertrag
    // darf NICHT readNote/embedQuery/searchVector tragen (Dateizugriff und Vektor-Interna).
    // Seit 0.32.0 kommen `proposeLinks`/`applyLink` dazu (Integrator, Spec 2026-09-07 §8) —
    // additiv, apiVersion bleibt 1. Die Liste bleibt vollstaendig aufgezaehlt, damit eine
    // versehentliche Ausweitung (etwa `this.api = this.facade`) weiter auffaellt.
    record("Fläche ist auf status/search/related/proposeLinks/applyLink begrenzt",
      JSON.stringify(probe.keys) === JSON.stringify(["apiVersion", "applyLink", "proposeLinks", "related", "search", "status"]),
      (probe.keys ?? []).join(", "));
    record("status() ist synchron und meldet einen Index",
      probe.statusIsSync === true && probe.status?.indexed === true && (probe.status?.noteCount ?? 0) > 0,
      `indexed=${String(probe.status?.indexed)} · ${probe.status?.noteCount ?? 0} Notizen`);
    // Regressionsschutz für den Abnahme-Befund vom 2026-09-07: der Kit-Merge kopiert unbekannte
    // Schlüssel aus data.json, die Migration lief deshalb bei jedem Start erneut und füllte ein
    // bewusst geleertes Zeilen-Modell wieder auf. Die pure Hälfte (`stripLegacyGlobalModels`)
    // ist unit-getestet; dass sie in `onload` an der richtigen Stelle läuft, sieht nur dieser Punkt.
    const legacyKeys = await main.evaluate<string[]>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      return ["embeddingModel","chatModel"].filter(k => k in p.settings);
    `);
    record("Keine Alt-Schlüssel des globalen Modells in den Einstellungen",
      legacyKeys.length === 0,
      legacyKeys.length === 0 ? "Alt-Schlüssel: keine" : `Alt-Schlüssel: ${legacyKeys.join(", ")}`);
    record("related() liefert Treffer für eine indexierte Notiz",
      probe.related?.ok === true && (probe.related.hits?.length ?? 0) > 0,
      `${probe.relatedPath ?? "(keine Notiz geprüft)"} → ${probe.related?.ok ? `${probe.related.hits?.length ?? 0} Treffer` : `reason=${String(probe.related?.reason)}`}`);
    record("Rückgaben überstehen die Renderer-Grenze (JSON-tauglich)",
      probe.serialisable === true, "kein TypedArray, keine Klasseninstanz");
    // Falle 16 der REGISTRY: ein Prüfpunkt, der nur den Fehlerfall anfasst, beweist nichts.
    // search() braucht den Embedding-Endpunkt — ist er tot, ist "offline" die RICHTIGE
    // Antwort und kein Befund. Dann übersprungen statt falsch-grün oder falsch-rot.
    if (probe.search?.ok) {
      record("search() liefert semantische Treffer", (probe.search.hits?.length ?? 0) > 0,
        `${probe.search.hits?.length ?? 0} Treffer`);
    } else if (probe.search?.reason === "offline") {
      skipped("search() liefert semantische Treffer", "Embedding-Endpunkt nicht erreichbar (korrekte Antwort, aber der Erfolgsfall bleibt ungeprüft)");
    } else {
      record("search() liefert semantische Treffer", false, `reason=${String(probe.search?.reason)}`);
    }

    // --- 0a. Selbstfindungs-Probe (Index-Zuordnung) -------------------------
    // WARUM DIESER PRUEFPUNKT EXISTIERT: am 2026-08-30 trug der Arbeits-Vault einen Index,
    // dessen Vektormatrix zu einer aelteren, kuerzeren Pfadliste gehoerte — jede Zeile war um
    // 4 bis 29 Positionen verschoben, ~79 % der Notizen lieferten damit die Aehnlichkeit einer
    // FREMDEN Notiz. Kein bestehender Waechter konnte das sehen: CRC32 gruen, count plausibel,
    // Byte-Guard zufrieden, `status()` meldete `indexed: true`, und die Scores sahen mit
    // 0.85–0.92 vertrauenswuerdiger aus als ein gesunder Index. Der Schaden war nur daran zu
    // erkennen, dass eine Notiz sich ueber ihren EIGENEN Wortlaut nicht mehr fand.
    //
    // Die Probe ist bewusst auf kurze Notizen beschraenkt: unter der Chunk-Grenze (800 Zeichen)
    // ist die Notiz genau EIN Chunk, ihr Index-Vektor also das Embedding genau dieses Textes.
    // Damit ist Rang 0 die einzig richtige Antwort und der Prueflings-Erwartungswert steht
    // VORHER fest (LESSON local-image-generator 2026-08-23) — bei langen Notizen mischt die
    // mean-Aggregation mehrere Chunks und ein Rang > 0 waere legitim.
    // Mutation und Wartephase TRENNEN (Dach-AGENTS.md, Umbau-Muster `paperless-storage:201`):
    // die Probe macht bis zu sechs `search()`-Aufrufe, jeder embeddet seine Query ueber den
    // Endpunkt. Unter Last dauert einer 5–8 s (gemessen 2026-09-03: neun fremde Verbindungen an
    // Ollama), sechs davon in EINEM `evaluate` sprengen die 30-s-Grenze von `Cdp.send` — der
    // Lauf brach mit „Zeitueberschreitung: Runtime.evaluate" ab, ohne dass am Prueffling etwas
    // fehlte. Deshalb: im Renderer STARTEN und das Ergebnis ablegen, auf der Node-Seite pollen.
    await main.evaluate(`
      window.__vaultRagSelfFind = null;
      (async () => {
      const api = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].api;
      if (!api) { window.__vaultRagSelfFind = { present: false, tried: [], offline: false }; return; }
      const strip = (t) => t.replace(/^---\\s*\\n[\\s\\S]*?\\n---\\s*\\n/, "").trim();
      // Voraussetzung selbst herstellen (REGISTRY-Falle 11): nur Notizen nehmen, die WIRKLICH
      // im Index stehen. related() ist dafuer der billige Test — es rechnet offline auf dem
      // Index und braucht keinen Embedding-Endpunkt.
      const cands = [];
      for (const f of app.vault.getMarkdownFiles()) {
        if (cands.length >= 6) break;
        let body;
        try { body = strip(await app.vault.cachedRead(f)); } catch (e) { continue; }
        if (body.length <= 200 || body.length > 800) continue;
        const r = await api.related(f.path);
        if (!r.ok && r.reason === "not-indexed") continue;
        cands.push({ path: f.path, query: body.slice(0, 300) });
      }
      const tried = [];
      let offline = false;
      for (const c of cands) {
        const res = await api.search(c.query);
        if (!res.ok) { if (res.reason === "offline") offline = true; continue; }
        const hits = res.hits ?? [];
        const rank = hits.findIndex(h => h.path === c.path);
        tried.push({ path: c.path, rank, top: hits[0] ? hits[0].path : null });
      }
      window.__vaultRagSelfFind = { present: true, tried, offline };
      })().catch(e => { window.__vaultRagSelfFind = { present: true, tried: [], offline: false, error: String(e) }; });
      return true;
    `);
    const selfFind = await pollUntil<SelfFindProbe & { error?: string }>(main,
      `return window.__vaultRagSelfFind;`, 240_000, 2_000)
      ?? { present: true, tried: [], offline: false, error: "Probe nach 240 s ohne Ergebnis — Embedding-Endpunkt unter Last?" };

    if (selfFind.error) {
      record("Notizen finden sich ueber ihren eigenen Wortlaut", false, selfFind.error);
    } else if (!selfFind.present) {
      record("Notizen finden sich ueber ihren eigenen Wortlaut", false, "Plugin-API nicht erreichbar");
    } else if (selfFind.offline || selfFind.tried.length === 0) {
      // Falle 16 der REGISTRY: ohne Embedding-Endpunkt ist "keine Antwort" die RICHTIGE
      // Antwort und kein Befund — dann uebersprungen statt falsch-gruen oder falsch-rot.
      skipped("Notizen finden sich ueber ihren eigenen Wortlaut", "kein Embedding-Endpunkt oder keine kurze indexierte Notiz gefunden");
    } else {
      const hit = selfFind.tried.filter(t => t.rank === 0);
      // Schwelle statt Perfektion: zwei Notizen mit (fast) gleichem Wortlaut duerfen sich
      // gegenseitig verdraengen. Ein VERSCHOBENER Index faellt damit trotzdem sicher auf —
      // dort lag die Trefferquote bei 20 %, nicht bei 80 %.
      const ok = hit.length >= Math.max(1, selfFind.tried.length - 1);
      const misses = selfFind.tried.filter(t => t.rank !== 0)
        .map(t => `${t.path.split("/").pop()}: Rang ${t.rank} (statt ihrer steht ${t.top ? t.top.split("/").pop() : "nichts"} vorn)`);
      record("Notizen finden sich ueber ihren eigenen Wortlaut",
        ok, `${hit.length}/${selfFind.tried.length} auf Rang 0${misses.length ? " · " + misses.join(" · ") : ""}`);
    }

    // --- 0b. Hub-Tab-Leiste (obsidian-kit buildHubInto) ---------------------
    // Was hier gemessen wird, kann vitest strukturell nicht: das node-Env hat kein Layout,
    // also auch keinen Zeilenumbruch. Genau dafuer existiert dieser Treiber. Die ARIA-Rollen
    // sind mit Kit 0.27.0 neu — die lokale Fassung setzte keinerlei Attribute.
    const hub = await main.evaluate<HubProbe>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      await p.openHub("related");
      const root = document.querySelector(".okit-hub-root");
      if (!root) return { present: false };
      const tabs = [...root.querySelectorAll(".okit-hub-tab")];
      return {
        present: true,
        tablist: root.querySelector(".okit-hub-tabs")?.getAttribute("role") ?? null,
        count: tabs.length,
        selected: tabs.filter(t => t.getAttribute("aria-selected") === "true").length,
        // Roving tabindex: genau der aktive Tab ist per Tab-Taste erreichbar, der Rest per Pfeil.
        focusable: tabs.filter(t => t.getAttribute("tabindex") !== "-1").length,
        controls: tabs.every(t => {
          const id = t.getAttribute("aria-controls");
          return !!id && !!document.getElementById(id);
        }),
      };
    `);
    record("Hub rendert die Kit-Grammatik", hub.present, hub.present ? ".okit-hub-root vorhanden" : "kein .okit-hub-root — altes Bundle geladen?");
    record("Tab-Leiste ist eine ARIA-Tabliste", hub.tablist === "tablist", `role="${hub.tablist ?? "(fehlt)"}" · ${hub.count} Tabs`);
    record("Genau ein Tab ist als ausgewaehlt gemeldet", hub.selected === 1, `${hub.selected} von ${hub.count} mit aria-selected=true`);
    record("Roving tabindex: nur der aktive Tab ist tabbar", hub.focusable === 1, `${hub.focusable} von ${hub.count} tabbar`);
    record("Jeder Tab zeigt auf ein existierendes Panel", hub.controls === true, "aria-controls aufloesbar");

    // Der eigentliche Layout-Beleg: bricht die Leiste bei schmaler Sidebar um, statt die Tabs
    // unlesbar zu stauchen? Das kann vitest nicht — node hat kein Layout.
    //
    // Die Breite wird ueber `rightSplit.setSize()` gesetzt, NICHT ueber `style.width` am
    // `.workspace-leaf`: gemessen 2026-08-27 ist das Leaf nicht breitenbestimmend, die Zahlen
    // blieben von 1000px bis 140px unveraendert. Ein Pruefpunkt, dessen Mutation nicht wirkt,
    // ist gruen oder rot ohne etwas zu belegen — die teurere Variante ist hier die einzige.
    //
    // Mutation und Wartephase getrennt (Muster: paperless-storage/scripts/gui-smoke.ts:201):
    // ein `waitFor` IM Renderer liefe gegen den 30-s-Abbruch von `Cdp.send`.
    const WIDE = 560, NARROW = 240;
    // ⚠️ Der Guard `Math.abs(breite - soll) > 8 -> null` ist load-bearing, nicht defensiv:
    // `pollUntil` kehrt beim ersten TRUTHY Wert zurueck, und ein Objektliteral ist immer truthy.
    // Ohne ihn misst der Poll den Zustand VOR `setSize` und kehrt sofort damit zurueck — der
    // Punkt war am 2026-09-04 deshalb rot, mit „560px (ist 300px) / 240px (ist 300px)": zweimal
    // dieselbe Breite, also eine Mutation, die nie ankam. Isoliert nachgemessen liefert dasselbe
    // Plugin 560px -> 1 Zeile und 240px -> 2 Zeilen, der Punkt ist also inhaltlich gruen.
    // (Verwandt und schon bekannt: eine EINGEKLAPPTE Sidebar ignoriert `setSize` ganz — der
    // Guard faengt jetzt beide Faelle, statt nur den einen zu kommentieren.)
    const TAB_ROWS = (soll: number): string => `
      const root = document.querySelector(".okit-hub-root");
      if (!root) return null;
      const breite = Math.round(root.getBoundingClientRect().width);
      if (Math.abs(breite - ${soll}) > 8) return null;   // Mutation noch nicht angekommen
      const tabs = [...document.querySelectorAll(".okit-hub-tab")];
      const boxen = tabs.map(t => t.getBoundingClientRect());
      return { zeilen: new Set(boxen.map(b => Math.round(b.top))).size,
               ueberlauf: boxen.some(b => b.right > document.querySelector(".okit-hub-tabs").getBoundingClientRect().right + 1),
               breite };
    `;
    const rowsAfter = async (px: number): Promise<{ zeilen: number; ueberlauf: boolean; breite: number }> => {
      await main.evaluate(`app.workspace.rightSplit.setSize(${px}); return true;`);
      const r = await pollUntil<{ zeilen: number; ueberlauf: boolean; breite: number }>(main, TAB_ROWS(px), 5000, 200);
      // Kommt hier null zurueck, ist die Breite nie angekommen. Die 0 im Detailtext ist dann das
      // Signal „Mutation wirkungslos" — nicht „Hub ist 0 breit" (CORE-TEST-14).
      return r ?? { zeilen: 0, ueberlauf: false, breite: 0 };
    };
    // Der Hub kann vom Nutzer auch links oder im Hauptbereich liegen — dann greift setSize
    // auf den falschen Split und der Punkt maesse Phantome. Lieber ueberspringen als luegen.
    const inRight = await main.evaluate<boolean>(`
      return !!app.workspace.rightSplit?.containerEl?.contains(document.querySelector(".okit-hub-root"));
    `);
    if (!inRight) {
      skipped("Umbruch der Tab-Leiste", "Hub liegt nicht in der rechten Sidebar");
    } else {
      // Die Breite ist eine Einstellung des Nutzers — vorher merken, im finally zurueckgeben.
      const userWidth = await main.evaluate<number>(`
        return Math.round(app.workspace.rightSplit.containerEl.getBoundingClientRect().width);
      `);
      // Voraussetzung herstellen (REGISTRY-Falle 11): eine EINGEKLAPPTE Sidebar ignoriert
      // `setSize` — der Hub blieb 24 px breit, beide Breiten meldeten 2 Zeilen, der Punkt war
      // rot ohne Befund (frisches Profil, 2026-09-03). Vorher ausklappen, nachher zurueck.
      const wasCollapsed = await main.evaluate<boolean>(`
        const rs = app.workspace.rightSplit;
        if (rs.collapsed) { rs.expand(); return true; }
        return false;
      `);
      let wide = { zeilen: 0, ueberlauf: false, breite: 0 }, narrow = { zeilen: 0, ueberlauf: false, breite: 0 };
      try {
        wide = await rowsAfter(WIDE);
        narrow = await rowsAfter(NARROW);
      } finally {
        await main.evaluate(`
          app.workspace.rightSplit.setSize(${userWidth});
          if (${wasCollapsed}) app.workspace.rightSplit.collapse();
          return true;
        `).catch(() => { console.log("  ! Sidebar-Breite konnte nicht zurückgesetzt werden"); });
      }
      // Die GEMESSENE Breite steht mit im Detail: wirkt die Mutation nicht, sieht man es hier,
      // statt einen Layout-Defekt im Plugin zu suchen (CORE-TEST-14).
      record("Tab-Leiste bricht bei schmaler Sidebar um, statt zu stauchen",
        narrow.zeilen > wide.zeilen,
        `${WIDE}px (ist ${wide.breite}px) → ${wide.zeilen} Zeile(n) · ${NARROW}px (ist ${narrow.breite}px) → ${narrow.zeilen} Zeile(n)`);
      record("Kein Tab rutscht aus der Leiste heraus",
        !wide.ueberlauf && !narrow.ueberlauf,
        "kein horizontaler Überlauf bei beiden Breiten");
    }

    // --- 1./2. Einstellungen öffnen, Zeilen lesen ---------------------------
    // Öffnen über das Hauptfenster (dort lebt `app`), lesen im Einstellungs-Fenster
    // (dort lebt das DOM). Seit 1.13 sind das zwei getrennte Targets.
    await openSettings(main);
    settings = await attachTo("settings", port, vault);
    if (!settings) throw new Error(`Kein Einstellungen-Fenster auf Port ${port} gefunden — hat sich die Seite geöffnet?`);
    await settings.send("Page.bringToFront");
    // Auf abgeschlossene Proben warten: ein toter Endpunkt läuft in einen 5-s-Timeout,
    // ein zu früher Blick liest „prüfe…" und meldet einen Fehler, der keiner ist.
    const readRowsSettled = async (): Promise<Row[]> => {
      const deadline = Date.now() + 20_000;
      let last: Row[] = [];
      for (;;) {
        last = await settings!.evaluate<Row[]>(READ_ROWS);
        const pending = last.filter(r => r.state === L.checking).length;
        if (pending === 0 || Date.now() > deadline) return last;
        await new Promise(r => setTimeout(r, 750));
      }
    };
    const rows = await readRowsSettled();
    record("Endpunkt-Zeilen gefunden", rows.length > 0, `${rows.length} Zeilen`);
    if (rows.length === 0) throw new Error("Keine .okit-ep-row im DOM — falscher Tab?");

    const listNames = ["Embedding", "Chat"];
    console.log("\n  Zeilen wie gerendert:");
    for (const r of rows) {
      const list = listNames[r.listIndex] ?? `Liste ${r.listIndex}`;
      console.log(`    [${list}] ${r.url || "(leer/Adder)"} → ${r.state === null ? "(keine Zustandszeile)" : `"${r.state}"`} · ${r.buttonCount} Knöpfe`);
    }
    console.log("");

    const withState = rows.filter(r => r.state !== null);
    const lists = [...new Set(withState.map(r => r.listIndex))];

    // --- 3. Knopf-Verteilung (in der Liste mit den meisten Zeilen) -----------
    // Die Chat-Liste ist die zweite gerenderte Gruppe. Sie trägt den Klick-Test, weil
    // nur für sie die Reihenfolge gesichert und zurückgeschrieben wird (savedChatOrder).
    const CHAT_LIST = 1;
    const chatRows = withState.filter(r => r.listIndex === CHAT_LIST);
    const testRows = chatRows.length >= 2
      ? chatRows
      : (lists.map(li => withState.filter(r => r.listIndex === li)).sort((a, b) => b.length - a.length)[0] ?? []);
    const inChatList = testRows === chatRows;
    const first = testRows[0];
    const second = testRows[1];
    // Gezielt nach dem Icon suchen statt Knöpfe zu zählen: die Zeile trägt je nach
    // Ladezustand zusätzlich einen „Modelle abrufen"-Knopf, eine Anzahl sagt also nichts.
    record(
      "Zeile 1 trägt keinen Prioritäts-Knopf",
      first ? !first.hasPriorityButton : false,
      first ? (first.hasPriorityButton ? "Knopf vorhanden — die i>0-Bedingung greift nicht" : "korrekt ohne") : "keine Zeile mit Zustand",
    );
    if (second) {
      record(
        "Zeile 2 trägt den Prioritäts-Knopf",
        second.hasPriorityButton,
        second.hasPriorityButton ? `Icon: ${second.priorityIconClass}` : `nicht gefunden · Icons: ${second.buttonIcons.join(", ")}`,
      );
      // Der Prüfpunkt, der statisch nicht zu klären war: Obsidian bündelt Lucide, ohne die
      // Namen zu exportieren, und `setIcon` rendert einen unbekannten Namen kommentarlos
      // als NICHTS — ein unsichtbarer, aber klickbarer Knopf. Gemessen wird deshalb das
      // gerenderte SVG, nicht eine API-Auskunft über den Namen: nur das Ergebnis zählt.
      const iconOk = (second.priorityIconClass ?? "").includes(PRIORITY_ICON);
      record(
        `Icon "${PRIORITY_ICON}" rendert tatsächlich ein SVG`,
        iconOk,
        iconOk
          ? (second.priorityIconClass ?? "")
          : `KEIN SVG — Obsidians Lucide kennt den Namen nicht. Auf "${FALLBACK_ICON}" wechseln (setIcon in buildEndpointList).`,
      );
    } else {
      // Kein ✗: mit nur einer Zeile gibt es nichts zu messen. Bis 2026-09-03 zaehlte das als
      // Fehlschlag und hielt jede Bilanz im Arbeitsvault dauerhaft rot — der Staging-Vault traegt
      // deshalb zwei Zeilen je Liste (docs/images/fixture/plugin/settings.json).
      skipped("Zeile 2 trägt den Prioritäts-Knopf", "nur eine Endpunkt-Zeile konfiguriert — nicht prüfbar");
      skipped(`Icon "${PRIORITY_ICON}" rendert tatsächlich ein SVG`, "braucht eine zweite Endpunkt-Zeile");
    }

    // --- 4. Zustandstexte ---------------------------------------------------
    // PRO LISTE prüfen: Embedding und Chat haben je einen aktiven Endpunkt. Global gezählt
    // wären zwei „aktiv" ein Fehlalarm.
    for (const li of lists) {
      const inList = withState.filter(r => r.listIndex === li);
      const activeRows = inList.filter(r => r.state === L.active);
      const reachable = inList.filter(r => r.state !== L.unreachable && r.state !== L.checking);
      const name = listNames[li] ?? `Liste ${li}`;
      // Ist gar nichts erreichbar, ist „keine aktive Zeile" die ehrliche Anzeige, kein Fehler.
      const expected = reachable.length === 0 ? 0 : 1;
      record(
        `${name}: genau ${expected === 0 ? "keine" : "eine"} Zeile als aktiv markiert`,
        activeRows.length === expected,
        activeRows.length === 1 ? `„${activeRows[0].url}"` : `${activeRows.length} aktive Zeilen von ${inList.length}`,
      );
    }
    // Die erwarteten Zustandstexte kommen aus DEM Woerterbuch, das die Oberflaeche gerade
    // benutzt — nicht aus fest verdrahtetem Deutsch. Vorher pruefte der Treiber hart gegen
    // „aktiv"/„nicht erreichbar" und wurde auf einer englisch gestellten Instanz dreimal rot,
    // ohne dass am Produkt etwas fehlte (gemessen von der llm-lab-Session am 2026-08-30: 25/30
    // statt 27/30). Bemerkenswert daran: dieses Repo hat vier i18n-Waechter fuer den
    // Produktcode — nur der PRUEFSTAND wurde nie gegen dieselbe Regel gehalten.
    const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const zustandsRegex = new RegExp("^(" + [
      escape(L.active),
      escape(L.standby).replace("\\{0\\}", "\\d+"),
      escape(L.unreachable),
      escape(L.skippedModel),
      escape(L.checking),
    ].join("|") + ")$");
    const known = zustandsRegex;
    const unknown = withState.filter(r => !known.test(r.state ?? ""));
    record("Alle Zustandstexte sind bekannte Formulierungen", unknown.length === 0,
      unknown.length ? unknown.map(r => `"${r.state}"`).join(", ") : `${withState.length} Zeilen geprüft`);
    const stillProbing = withState.filter(r => r.state === L.checking);
    if (stillProbing.length) {
      record("Alle Proben abgeschlossen", false, `${stillProbing.length} Zeilen noch bei „${L.checking}" — Timeout zu kurz?`);
    }

    // --- 5. Layout ----------------------------------------------------------
    const layoutRow = withState.find(r => r.stateWidthRatio !== null);
    record(
      "Zustandszeile bricht auf volle Breite um",
      layoutRow ? (layoutRow.stateWidthRatio ?? 0) >= 95 : false,
      layoutRow ? `${layoutRow.stateWidthRatio}% der Zeilenbreite` : "nicht messbar",
    );
    record(
      "Zustandszeile steht unter den Feldern",
      layoutRow ? layoutRow.stateTopBelowFields === true : false,
      layoutRow ? String(layoutRow.stateTopBelowFields) : "nicht messbar",
    );
    const withWarn = withState.filter(r => r.warnIconBelowState !== null);
    if (withWarn.length) {
      const misplaced = withWarn.filter(r => r.warnIconBelowState === true);
      record(
        "Warn-/Schlüssel-Icons bleiben in der Feldzeile",
        misplaced.length === 0,
        misplaced.length ? `${misplaced.length} Zeile(n) mit Icon unter dem Text (order-Fix wirkt nicht)` : `${withWarn.length} Zeile(n) geprüft`,
      );
    }

    // --- 6. Klick: zuerst verwenden -----------------------------------------
    if (second && second.hasPriorityButton && inChatList) {
      savedChatOrder = await main.evaluate<string[]>(`
        return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.chatEndpoints.map(e => e.url);
      `);
      const beforeUrl = second.url;
      // Die Zeile über ihre URL treffen, nicht über den Index: die Adder-Zeilen und die
      // zweite Liste verschieben jede Index-Rechnung.
      await settings.evaluate(`
        const wanted = ${JSON.stringify(beforeUrl)};
        const rows = [...document.querySelectorAll(".okit-ep-row")];
        const target = rows.find(r => {
          const input = r.querySelector('input[type="text"]');
          return input && input.value === wanted;
        });
        if (!target) throw new Error("Zeile nicht mehr gefunden: " + wanted);
        const svg = target.querySelector('svg[class*="arrow-up-to-line"], svg[class*="chevrons-up"]');
        if (!svg) throw new Error("Kein Prioritäts-Knopf in der Zeile");
        svg.closest("div").click();
      `);
      // Auf die tatsächliche Umordnung warten, nicht auf eine Pauschalfrist: der Klick
      // löst reconnect() aus, das jeden konfigurierten Endpunkt pingt — drei tote Einträge
      // sind bis zu 15 s. Wer vorher liest, sieht das ALTE DOM und hält den Klick für
      // wirkungslos (genau dieser Fehlalarm, 2026-08-05).
      const after = await (async (): Promise<Row[]> => {
        const deadline = Date.now() + 30_000;
        let last: Row[] = [];
        for (;;) {
          last = await readRowsSettled();
          const inList = last.filter(r => r.listIndex === second.listIndex && r.state !== null);
          if (inList[0]?.url === beforeUrl || Date.now() > deadline) return last;
          await new Promise(r => setTimeout(r, 750));
        }
      })();
      const afterInList = after.filter(r => r.listIndex === second.listIndex && r.state !== null);
      const top = afterInList[0];
      const movedToTop = top?.url === beforeUrl;
      record("Klick setzt die Zeile an die Spitze", movedToTop,
        movedToTop ? `„${beforeUrl}" steht auf Platz 1` : `Platz 1 ist „${top?.url}"`);
      record("Die nach oben geholte Zeile meldet danach ihren Zustand",
        !!top && top.state !== null && top.state !== L.checking,
        `„${top?.state}"`);
      record("Die nach oben geholte Zeile trägt keinen Prioritäts-Knopf mehr",
        !!top && !top.hasPriorityButton,
        top?.hasPriorityButton ? "Knopf noch da" : "korrekt entfernt");
    } else {
      const grund = inChatList ? "kein zweiter Chat-Endpunkt mit Knopf" : "Chat-Liste hat weniger als zwei Einträge";
      skipped("Klick setzt die Zeile an die Spitze", grund);
      skipped("Die nach oben geholte Zeile meldet danach ihren Zustand", grund);
      skipped("Die nach oben geholte Zeile trägt keinen Prioritäts-Knopf mehr", grund);
    }

    // --- 7. Rolle folgt dem Zeilen-Modell -----------------------------------
    // Regressionsschutz für eine Fehlerklasse, die zweimal auftrat: die Zustandszeile ist
    // ein Schnappschuss. Ein Modell-Commit ändert die Rolle (`skipped-model`), löst aber
    // bewusst kein Neuzeichnen aus — ohne Nachziehen behauptet die Zeile weiter, der
    // Endpunkt stünde nur hinten an, während der Guard ihn längst überspringt. Seit jede
    // Zeile ihr Modell traegt (kein globalModel/allowEmpty mehr, siehe endpoint-list),
    // wird nicht mehr ein Override entfernt, sondern auf ein ANDERES gelistetes Modell
    // gewechselt — dieselbe Bauart, nur ohne die inzwischen nicht mehr existierende
    // Leer-Option im Dropdown.
    const modelRow = withState.find(r => r.listIndex === 0 && r.modelValue);
    if (modelRow) {
      const original = modelRow.modelValue as string;
      const rowIndex = modelRow.index;
      const options = await settings!.evaluate<string[]>(`
        const row = [...document.querySelectorAll(".okit-ep-row")][${rowIndex}];
        const sel = row.querySelector("select");
        return sel ? [...sel.options].map(o => o.value) : [];
      `);
      const other = options.find(v => v && v !== original);
      if (other === undefined) {
        skipped("Rolle folgt dem Zeilen-Modell ohne Tab-Neuaufbau", "Endpunkt listet nur ein Modell — kein Wechsel möglich");
      } else {
        const setModel = async (value: string): Promise<string | null> => {
          await settings!.evaluate(`
            const row = [...document.querySelectorAll(".okit-ep-row")][${rowIndex}];
            const sel = row.querySelector("select");
            if (!sel) throw new Error("Kein Modell-Dropdown in der Zeile");
            sel.value = ${JSON.stringify("__V__")};
            sel.dispatchEvent(new Event("change"));
            await new Promise(r => setTimeout(r, 4000));
          `.replace("__V__", value));
          const rows2 = await readRowsSettled();
          return rows2[rowIndex]?.state ?? null;
        };
        let withOther: string | null = null;
        let withOriginal: string | null = null;
        try {
          withOther = await setModel(other);
          withOriginal = await setModel(original);
        } finally {
          // Zeile IMMER auf das Original zurückstellen, auch wenn ein setModel oben wirft —
          // sonst hinterlässt ein fehlgeschlagener Lauf einen fremden Modellnamen in der
          // Konfiguration des Nutzers.
          const rows3 = await readRowsSettled();
          if (rows3[rowIndex]?.modelValue !== original) await setModel(original);
        }
        record(
          "Rolle folgt dem Zeilen-Modell ohne Tab-Neuaufbau",
          // Gegen das Woerterbuch der LAUFENDEN Oberflaeche, nicht gegen festes Deutsch — dieselbe
          // Fehlerklasse wie der Sprachbefund vom 2026-08-30 (drei falsch-rote Zustandstexte).
          withOther === L.skippedModel && withOriginal !== L.skippedModel,
          `mit fremdem Modell „${withOther}" · zurück „${withOriginal}"`,
        );
      }
    } else {
      skipped("Rolle folgt dem Zeilen-Modell ohne Tab-Neuaufbau", "kein Embedding-Endpunkt mit Modell konfiguriert");
    }

    // --- 7b. llm-lab-Meldestrecke (KONSUMENTEN-Seite) -----------------------
    // Spiegelbild zu `llm-lab/scripts/gui-smoke.ts`: dort spielt der Treiber den Konsumenten,
    // um den Anbieter zu pruefen. Hier haengt er ein Lab-Stub ein und prueft, was vault-rag
    // tatsaechlich sendet — genau die Haelfte, die uns gehoert. Ob das echte Lab die Zeile
    // dann speichert, filtert oder verwirft, ist dessen Zusage und dessen Smoke.
    //
    // Warum ein Stub und kein installiertes Lab: die Zusage lautet "wir rufen readLabApi(app)
    // ?.log(...) mit diesen Feldern". Ein installiertes Lab wuerde diese Zusage nicht schaerfer
    // pruefen, aber den Lauf an eine fremde Installation binden — und CORE-TEST-02 (b) verlangt
    // die Verdrahtung getrackt im Repo, das sie besitzt.
    //
    // Ist ein ECHTES Lab installiert, wird nichts eingehaengt: der Smoke darf dessen
    // Aufzeichnung nicht mit Testzeilen verunreinigen.
    const labReal = await main.evaluate<boolean>(`return !!app.plugins.plugins["llm-lab"];`);
    if (labReal) {
      // EIN Skip-Eintrag je nicht gelaufenem Pruefpunkt, nicht einer fuer den Block: die Bilanz soll
      // sagen, wie viele Punkte fehlen, nicht wie viele Abschnitte. Am 2026-09-02 verbarg genau
      // diese Zeile 15 von 40 Punkten hinter einem einzigen Gedankenstrich.
      const grund = "echtes llm-lab installiert — der Smoke hängt kein Stub ein, um dessen Aufzeichnung nicht zu verfälschen; im Staging-Vault (ohne llm-lab) fahren";
      for (const name of LAB_PRUEFPUNKTE) skipped(name, grund);
    } else {
      // Den Chat-Endpunkt AUFWAERMEN, bevor ein Pruefpunkt an seiner Antwort haengt: LM Studio
      // laedt das Modell erst beim ersten Request (JIT) und entlaedt es nach Leerlauf wieder;
      // bei 27B dauert das laenger als die 180-s-Frist des Chat-Punkts — der meldete „Antwort
      // blieb aus", waehrend der ZWEITE Chat desselben Laufs in Sekunden kam (2026-09-03).
      // Ladezeit ist Umgebung, kein Befund; sie gehoert deshalb vor den Punkt und ins Protokoll.
      // Auf der NODE-Seite, nicht im Renderer: von dort scheitert `fetch` am CORS-Preflight
      // (LM Studio ohne `--cors`; das Plugin selbst geht ueber `requestUrl`/XHR, die kein CORS
      // kennen), der erste Anlauf meldete „Failed to fetch" nach 2 s und waermte nichts.
      // Den Endpunkt nehmen, den das Plugin WIRKLICH benutzt (`chatEndpointInUse`), nicht
      // `chatEndpoints[0]`: der Klick-Pruefpunkt weiter oben hat die Liste umsortiert (den toten
      // Endpunkt an Platz 1), und zurueckgeschrieben wird erst im finally — der Warmup traf so
      // zweimal ECONNREFUSED, waehrend der Chat danach ueber den aktiven Endpunkt lief.
      const warmEp = await main.evaluate<{ url: string; model: string; apiKey?: string } | null>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const ep = (p.chatEndpointInUse && p.chatEndpointInUse.url) ? p.chatEndpointInUse : (p.settings.chatEndpoints || [])[0];
        return ep ? { url: ep.url, model: ep.model || "", apiKey: ep.apiKey } : null;
      `);
      const warmStart = Date.now();
      let warm = "kein Chat-Endpunkt konfiguriert";
      if (warmEp) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (warmEp.apiKey) headers["Authorization"] = `Bearer ${warmEp.apiKey}`;
        try {
          const r = await fetch(`${warmEp.url.replace(/\/+$/, "")}/v1/chat/completions`, {
            method: "POST", headers, signal: AbortSignal.timeout(300_000),
            body: JSON.stringify({ model: warmEp.model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
          });
          warm = `HTTP ${r.status}`;
        } catch (e) {
          // `fetch failed` allein sagt nichts — der Grund steckt in `cause` (undici).
          const c = (e as { cause?: { code?: string; message?: string } }).cause;
          const cause = c ? ` (${c.code ?? c.message ?? "?"})` : "";
          warm = `Fehler: ${e instanceof Error ? e.message : String(e)}${cause}`;
        }
      }
      console.log(`  (Chat-Endpunkt aufgewärmt: ${warm} nach ${Math.round((Date.now() - warmStart) / 1000)} s)`);

      labStubbed = true;   // fuers finally
      // Die apiVersion hier ist eine VERTRAGSKOPIE — genau wie `lab_client.ts`s eigene
      // SUPPORTED_API_VERSION traegt sie den Stand von llm-labs LLM_LAB_API_VERSION
      // (src/plugin_api.ts) manuell nach und muss bei jedem Bump dort mitziehen. Aktueller
      // Stand: 3 (seit dem Bump vom 2026-08-30). Vorher 2 (431c23c).
      // Ein veralteter Wert hier faellt `readLabApi()`s strikten Vergleich
      // durch und laesst den Stub aussehen, als waere kein llm-lab installiert.
      await main.evaluate(`
        window.__vaultRagLabSeen = [];
        app.plugins.plugins["llm-lab"] = {
          api: {
            apiVersion: 3,
            status: () => ({ apiVersion: 3, recording: true }),
            log: (input) => { window.__vaultRagLabSeen.push(input); return "smoke-" + window.__vaultRagLabSeen.length; },
          },
        };
      `);

      // (1) Chat ueber die OBERFLAECHE — nicht ueber Plugin-Interna: der Punkt ist, dass der
      // trace-Parameter den ganzen Weg Panel → ChatSession → ChatClient uebersteht.
      // ⚠️ Tippen und Senden sind ZWEI Schritte, und das ist der ganze Punkt.
      // `scheduleQuery` entprellt die Eingabe 400 ms, bevor das Kontext-Panel embedded und
      // sucht; `submit()` raeumt genau diesen Timer ab (chat_view.ts). Wer Text setzt und
      // sofort klickt, sendet also garantiert mit LEEREM Kontext — ein Zustand, den ein
      // Benutzer nie erzeugt, weil Tippen dauert. Der Treiber mass damit bis 2026-09-06 die
      // `contextPaths`-Haelfte unserer Lab-Zusage nie (aufgefallen im llm-lab-Lauf am
      // 2026-08-24, dort belegt — aber dort gehoert sie nicht hin, es ist unsere Zusage).
      //
      // Die Frage traegt deshalb zweierlei: Fachbegriffe, die im Fixture wirklich vorkommen
      // ("Semantic search", "Vector embeddings", "Cosine similarity" sind eigene Notizen),
      // damit die semantische Suche ueberhaupt Treffer hat — und die Ein-Wort-Auflage, damit
      // der Punkt nicht an der Antwortlaenge haengt.
      await main.evaluate(`
        await app.commands.executeCommandById("vault-retrieval:open-vault-chat");
        await new Promise(r => setTimeout(r, 800));
        const ta = document.querySelector(".vault-rag-chat-input");
        ta.value = "Answer with exactly one word. Which note of mine covers vector embeddings and cosine similarity?";
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      `);
      // Auf die Chips warten statt auf eine feste Frist: das Embedden der Frage geht ueber den
      // Endpunkt, und dessen Dauer ist Umgebung. 30 s reichen fuer einen lokalen Embedder mit
      // Abstand; laeuft keiner, bleibt die Liste leer und der Punkt sagt genau das.
      const chipsDa = await pollUntil(main,
        `return document.querySelectorAll(".vault-rag-ctx-chip").length > 0;`,
        30_000, 500).catch(() => false);
      // Basenames, nicht Pfade: die Chips zeigen `basename(p)` (context_panel.ts), der Trace
      // traegt volle Pfade. Der Vergleich laeuft deshalb ueber die Namen — Pinned-Chips tragen
      // zusaetzlich ein 📌, alle ein ✕ zum Entfernen.
      const panelChips = await main.evaluate<string[]>(`
        return [...document.querySelectorAll(".vault-rag-ctx-chip")]
          .map(c => (c.textContent || "").replace(/^\s*📌\s*/, "").replace(/\s*✕\s*$/, "").trim())
          .filter(Boolean);
      `);
      // ERST JETZT senden — mit gefuelltem Panel.
      await main.evaluate(`document.querySelector(".vault-rag-chat-send").click();`);
      // Auf das ERGEBNIS warten, nie auf den Sende-Knopf: der durchlaeuft im selben Turn
      // mehrere Uebergaenge (Senden→Stop→Senden) und meldet zu frueh "fertig"
      // (_docs/LESSONS.md 2026-08-23, n=2). Die Ergebniszeile stellt nur ein fertiger Lauf her.
      const chatDone = await pollUntil(main,
        `const w = document.querySelector(".vault-rag-chat-working"); return !!w && /✓/.test(w.textContent || "");`,
        CHAT_FRIST_MS, 1_000).catch(() => false);
      const chatTrace = await main.evaluate<{ n: number; last: Record<string, unknown> | null }>(`
        const seen = window.__vaultRagLabSeen;
        return { n: seen.length, last: seen.length ? seen[seen.length - 1] : null };
      `);
      const ct = chatTrace.last as { plugin?: string; feature?: string; ttftMs?: number; model?: string; latencyMs?: number } | null;
      record("Ein Chat über die Oberfläche meldet sich beim Lab",
        chatDone === true && ct?.plugin === "vault-retrieval" && ct?.feature === "chat",
        chatDone ? `plugin=${String(ct?.plugin)} · feature=${String(ct?.feature)} · model=${String(ct?.model)}` : `keine Ergebniszeile in ${CHAT_FRIST_MS / 1000} s — Warmup sagte „${warm}"; denkendes Modell ohne suppressThinking?`);
      // ttftMs trennt "Modell dachte lange" von "Verbindung stand nicht" — ohne den Wert ist
      // eine langsame Antwort in der Aufzeichnung nicht diagnostizierbar.
      record("Die Chat-Zeile trägt ttftMs und latencyMs",
        typeof ct?.ttftMs === "number" && typeof ct?.latencyMs === "number" && (ct.ttftMs ?? 0) <= (ct.latencyMs ?? 0),
        `ttftMs=${String(ct?.ttftMs)} · latencyMs=${String(ct?.latencyMs)}`);

      // Die zweite Haelfte der Lab-Zusage: WAS als Kontext mitging, nicht nur DASS gemeldet wurde.
      // Verglichen wird gegen das, was der Nutzer SIEHT (die Chips), nicht gegen eine zweite
      // Abfrage derselben Quelle — sonst prueft der Punkt die Funktion gegen sich selbst.
      // Bleiben die Chips aus, ist die naechste Frage immer dieselbe: Index oder Endpunkt?
      // Einmal nachsehen ist billiger, als den Lauf mit „keine Chips" zu beenden und raten zu
      // lassen — und `status()` ist synchron und netzfrei, kostet also nichts am Ergebnis.
      const ctxDiagnose = chipsDa ? "" : await main.evaluate<string>(`
        const api = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api;
        const st = api ? api.status() : null;
        if (!st) return "Plugin-API nicht erreichbar";
        if (!st.indexed) return "Index NICHT geladen — daher kein Kontext (kein Befund am Chat)";
        if (st.reindexing) return "Voll-Reindex laeuft — Kontext waere unvollstaendig";
        return "Index geladen (" + st.noteCount + " Notizen) — dann haengt es am Embedding-Endpunkt";
      `).catch(() => "Diagnose fehlgeschlagen");
      const ctxPaths = (chatTrace.last as { contextPaths?: unknown } | null)?.contextPaths;
      const ctxListe = Array.isArray(ctxPaths) ? ctxPaths.map(String) : [];
      const chipsGedeckt = panelChips.length > 0
        && ctxListe.length === panelChips.length
        && panelChips.every(name => ctxListe.some(pfad => pfad.endsWith(`/${name}.md`) || pfad === `${name}.md`));
      record("Die Chat-Zeile trägt die Kontext-Pfade, die das Panel zeigt",
        chipsGedeckt,
        chipsDa
          ? `${panelChips.length} Chips · ${ctxListe.length} contextPaths${chipsGedeckt ? "" : ` — Chips: [${panelChips.join(", ")}] · Trace: [${ctxListe.join(", ")}]`}`
          : `keine Kontext-Chips in 30 s — ${ctxDiagnose}`);

      // (2) Endpunkt-Probe: sie meldet sich unter EIGENEM feature. Nicht geprueft wird, ob das
      // Lab sie ausschliesst — die Ausschlussliste ist llm-labs Zusage. Unsere ist, dass die
      // Probe unterscheidbar ankommt; ohne das kann sie dort niemand ausschliessen.
      const probeBefore = await main.evaluate<number>(`return window.__vaultRagLabSeen.length;`);
      await main.evaluate(`
        app.setting.open();
        app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
        await new Promise(r => setTimeout(r, 1200));
        // Ueber die DEFINITION statt ueber einen Knopf im DOM: genau diese action ruft das
        // Framework beim Klick auf, und sie ist unabhaengig von der gerenderten Oberflaeche
        // (1.13 deklarativ vs. renderImperative auf 1.12).
        const tab = app.setting.pluginTabs.find(t => t.id === ${JSON.stringify(PLUGIN_ID)});
        const walk = (items) => items.flatMap(i => i.type === "group" ? walk(i.items || []) : [i]);
        const withAction = walk(tab.getSettingDefinitions()).filter(i => typeof i.action === "function");
        window.__vaultRagProbeCount = withAction.length;
        for (const item of withAction) {
          if (String(item.name || "").length) { /* nur zur Sicht */ }
        }
        const probe = withAction.find(i => /denk|think/i.test(String(i.name || "") + String(i.desc || "")));
        window.__vaultRagProbeFound = !!probe;
        if (probe) probe.action();
      `);
      const probeFound = await main.evaluate<boolean>(`return !!window.__vaultRagProbeFound;`);
      if (!probeFound) {
        skipped("Die Endpunkt-Probe meldet sich unter eigenem feature (damit das Lab sie ausschließen kann)", "Testknopf in den Einstellungen nicht gefunden");
      } else {
        await pollUntil(main, `return window.__vaultRagLabSeen.length > ${probeBefore};`, 180_000, 1_000).catch(() => false);
        const probeTrace = await main.evaluate<{ features: string[] }>(`
          return { features: window.__vaultRagLabSeen.slice(${probeBefore}).map(x => x.feature) };
        `);
        record("Die Endpunkt-Probe meldet sich unter eigenem feature (damit das Lab sie ausschließen kann)",
          probeTrace.features.length > 0 && probeTrace.features.every(f => f === "settings-probe"),
          probeTrace.features.length ? probeTrace.features.join(", ") : "keine Zeile — Probe lief nicht");
      }
      await main.evaluate(`app.setting.close();`);

      // (3) Reformat: das feature traegt die Transform-ID. Ohne sie stehen alle Umformatierungen
      // als ein Topf in der Aufzeichnung, und "welcher Transform frisst mein Budget" ist nicht
      // beantwortbar. Ueber den echten Panel-Knopf, damit die Registry-Verdrahtung mitgeprueft ist.
      const rfBefore = await main.evaluate<number>(`return window.__vaultRagLabSeen.length;`);
      const rfStarted = await main.evaluate<boolean>(`
        const file = app.vault.getMarkdownFiles().find(f => f.stat.size > 400 && f.stat.size < 20000);
        if (!file) return false;
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source" } });
        await new Promise(r => setTimeout(r, 600));
        // KEIN require("obsidian") — im CDP-Renderer-Kontext existiert der Modul-Loader nicht
        // (Cannot find module 'obsidian'), und getActiveViewOfType braucht die Klasse. Der
        // Workspace haelt den Editor ohnehin direkt.
        const ed = app.workspace.activeEditor?.editor;
        if (!ed) return false;
        // Eine Auswahl herstellen, die der Nutzer auch treffen wuerde: die erste nichtleere Zeile.
        let line = 0;
        while (line < ed.lineCount() && ed.getLine(line).trim().length < 20) line++;
        if (line >= ed.lineCount()) return false;
        ed.setSelection({ line, ch: 0 }, { line, ch: ed.getLine(line).length });
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        p.captureSelection();
        await app.commands.executeCommandById("vault-retrieval:open-reformat");
        await new Promise(r => setTimeout(r, 800));
        // Gezielt die ZWEITE Gruppe (LLM mit Vorschau). Nicht "der letzte Knopf": das ist der
        // Freitext-Knopf, und der tut ohne Anweisung im Textfeld bewusst nichts (er kehrt bei
        // leerer Anweisung sofort zurueck) — der Pruefpunkt lief damit ins Leere und meldete
        // "Transform lief nicht", was wie ein Verdrahtungsfehler aussah. KEINE Backticks in
        // diesem Kommentar: der ganze Block ist selbst ein Template-String, ein Backtick
        // beendet ihn mitten im Code. Und nicht "der erste": die erste
        // Gruppe ist mechanisch, die ersetzt sofort ohne Modell und ohne Lab-Zeile.
        const nodes = [...document.querySelectorAll(".vault-rag-reformat-group-title, .vault-rag-reformat-btn")];
        let titles = 0;
        const llm = [];
        for (const n of nodes) {
          if (n.classList.contains("vault-rag-reformat-group-title")) { titles++; continue; }
          if (titles === 2 && !n.closest(".vault-rag-reformat-freetext")) llm.push(n);
        }
        window.__vaultRagRfButtons = llm.length;
        const usable = llm.filter(b => !b.classList.contains("is-disabled"));
        if (!usable.length) return false;
        usable[0].click();
        return true;
      `);
      if (!rfStarted) {
        skipped("Reformat meldet sich mit der Transform-ID im feature", "keine geeignete Notiz/Auswahl herstellbar");
      } else {
        await pollUntil(main, `return window.__vaultRagLabSeen.length > ${rfBefore};`, 180_000, 1_000).catch(() => false);
        const rfTrace = await main.evaluate<{ features: string[] }>(`
          return { features: window.__vaultRagLabSeen.slice(${rfBefore}).map(x => x.feature) };
        `);
        const rf = rfTrace.features[rfTrace.features.length - 1] ?? "";
        record("Reformat meldet sich mit der Transform-ID im feature",
          /^reformat:.+/.test(rf), rf ? `feature=${rf}` : "keine Zeile — Transform lief nicht");
        // Modal schliessen, ohne anzuwenden: der Smoke veraendert keine Notiz.
        //
        // `.modal-container` ist Obsidians GETEILTE Region — jedes Plugin haengt seine Modals
        // dort ein. Ungescoped nimmt `querySelectorAll` das erstbeste, also moeglicherweise den
        // Abbrechen-Knopf eines FREMDEN Dialogs, waehrend unsere Vorschau offen stehen bleibt
        // und die nachfolgenden Pruefpunkte verfaelscht. Deshalb erst unser eigenes Modal
        // suchen (`.vault-rag-reformat-preview`) und nur darin klicken; nur wenn es nicht da
        // ist, bleibt Escape als Notausgang. Dach-Befund 2026-08-30 („GUI-Smoke greift geteilte
        // Obsidian-DOM-Regionen"), fuer dieses Repo war es die einzige solche Stelle.
        //
        // Gescoped wird ueber ein KIND, nicht ueber das Modal selbst: `ReformatPreviewModal`
        // setzt keine eigene Klasse auf `modalEl` (gemessen an `src/reformat_preview_modal.ts` —
        // dort tragen nur `.vault-rag-reformat-{label,notice,original,result}` eine). Ein Scope
        // auf eine erfundene Modal-Klasse haette immer leer getroffen und waere still auf den
        // Escape-Zweig gefallen: derselbe Ausgang wie vorher, nur unsichtbar.
        await main.evaluate(`
          const marker = document.querySelector(".vault-rag-reformat-original, .vault-rag-reformat-result");
          const eigenes = marker && (marker.closest(".modal") || marker.closest(".modal-container"));
          const btns = eigenes ? [...eigenes.querySelectorAll("button")] : [];
          const discard = btns.find(b => /verwerf|discard|abbrech|cancel/i.test(b.textContent || ""));
          if (discard) discard.click();
          else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          return { eigenes: !!eigenes, discard: !!discard };
        `).catch(() => ({ eigenes: false, discard: false }));
        // Der Aufraeumschritt ist seit 679a9f5 auf das eigene Modal gescoped — ob er trifft, ist
        // aber nur am ERGEBNIS zu sehen: die Vorschau muss danach aus dem DOM sein. Ohne diesen
        // Punkt waere der Fix strukturell belegt („der Aufruf steht jetzt richtig"), nie
        // inhaltlich (LESSONS 2026-09-03, yijing-oracle: den reparierten Pfad einmal betreten).
        const previewGone = await pollUntil(main,
          `return !document.querySelector(".vault-rag-reformat-original, .vault-rag-reformat-result");`,
          5_000, 250).catch(() => false);
        record("Die Reformat-Vorschau ist nach dem Verwerfen geschlossen",
          previewGone === true,
          previewGone ? "kein .vault-rag-reformat-original/-result mehr im DOM" : "Vorschau steht noch — Verwerfen-Knopf nicht im eigenen Modal getroffen?");
      }

      // (4) Lab weg → der Chat laeuft VOLLSTAENDIG durch und meldet nichts. Die Reihenfolge ist
      // bedeutungstragend: erst das Ende des Streams belegen, dann die Abwesenheit pruefen.
      // Andersherum ist der Punkt trivial gruen, weil der Aufruf noch laeuft — genau so war er
      // beim ersten Anlauf falsch gruen (_docs/LESSONS.md, "Ein Pruefpunkt, der Abwesenheit misst").
      await main.evaluate(`
        delete app.plugins.plugins["llm-lab"];
        window.__vaultRagLabBaseline = window.__vaultRagLabSeen.length;
        await app.commands.executeCommandById("vault-retrieval:open-vault-chat");
        await new Promise(r => setTimeout(r, 800));
        document.querySelector(".vault-rag-chat-new").click();
        await new Promise(r => setTimeout(r, 400));
        const ta = document.querySelector(".vault-rag-chat-input");
        ta.value = "Antworte mit genau einem Wort: Tschuess.";
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector(".vault-rag-chat-send").click();
      `);
      const offDone = await pollUntil(main,
        `const w = document.querySelector(".vault-rag-chat-working"); return !!w && /✓/.test(w.textContent || "");`,
        CHAT_FRIST_MS, 1_000).catch(() => false);
      const offTrace = await main.evaluate<{ added: number }>(`
        return { added: window.__vaultRagLabSeen.length - window.__vaultRagLabBaseline };
      `);
      record("Ohne Lab läuft der Chat vollständig durch und meldet nichts",
        offDone === true && offTrace.added === 0,
        offDone ? `Antwort kam, ${offTrace.added} neue Zeilen` : "Antwort blieb aus — Abwesenheit der Zeile beweist hier NICHTS");
    }

    // --- 7c. Integrator: Vorschlag → Annehmen → Idempotenz → Ablehnen → Frontmatter ---
    // Spec 2026-09-07 §10. Misst die VERDRAHTUNG (main.ts) am laufenden Plugin: dass ein
    // Vorschlag entsteht, dass Annehmen wirklich in die Datei schreibt, dass ein zweites Anwenden
    // die Datei byte-identisch laesst, dass eine Ablehnung beim Neuberechnen haelt, und dass der
    // Frontmatter-Modus nur die `related:`-Zeilen anfasst. Die reinen Haelften sind unit-getestet;
    // ob `acceptLink` den richtigen Schreiber waehlt und der Store gespeichert wird, sieht nur
    // dieser Abschnitt. Der Integrator ist im Fixture eingeschaltet (`integratorEnabled`).
    {
      const PLAIN = "Notes/Integrator plain.md";
      const REL = "Notes/Integrator related.md";
      // Die Tab-Zahl ist KEINE Konstante: Smart Apply ist im Fixture aus, also stehen fuenf Tabs in
      // der Leiste, mit Smart Apply sechs. Gemessen wird deshalb die Tab-LISTE gegen die Panel-Liste
      // des Hubs — Lauf 1 am 2026-09-07 war an einer hart verdrahteten Sechs rot, ohne Befund.
      const intPre = await main.evaluate<{ enabled: boolean; tabs: string[]; panels: string[]; plain: string; rel: string }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const leaf = app.workspace.getLeavesOfType("vault-retrieval-hub")[0];
        return {
          enabled: !!p.settings.integratorEnabled,
          tabs: [...document.querySelectorAll(".okit-hub-tab")].map(t => t.textContent.trim()),
          panels: leaf ? (leaf.view.panels || []).map(x => x.id) : [],
          plain: await app.vault.adapter.read(${JSON.stringify(PLAIN)}),
          rel: await app.vault.adapter.read(${JSON.stringify(REL)}),
        };
      `);
      if (!intPre.enabled) {
        for (const n of INTEGRATOR_PRUEFPUNKTE) skipped(n, "integratorEnabled ist aus — Fixture-Einstellungen nicht geladen?");
      } else {
        integratorRestore = { plain: intPre.plain, rel: intPre.rel };
        record("Tab „Integrator“ steht in der Leiste, vor „Umformatieren“",
          intPre.panels.includes("integrator") && intPre.tabs.length === intPre.panels.length
            && intPre.panels.indexOf("integrator") === intPre.panels.indexOf("reformat") - 1,
          `${intPre.tabs.length} Tabs: ${intPre.tabs.join(" · ")}`);

        const proposed = await main.evaluate<{ kind: string; n: number; target: string | null }>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const r = await p.proposeFor(${JSON.stringify(PLAIN)});
          const links = r.kind === "proposal" ? r.proposal.links : [];
          return { kind: r.kind, n: links.length, target: links[0]?.path ?? null };
        `);
        record("Kommando-Pfad erzeugt einen Vorschlag für die Fixture-Notiz",
          proposed.kind === "proposal" && proposed.n > 0, `${proposed.kind} · ${proposed.n} Ziele · erstes: ${proposed.target ?? "—"}`);

        if (proposed.target) {
          const target = proposed.target;
          const expectLink = `[[${target.replace(/\.md$/, "")}|${(target.split("/").pop() ?? target).replace(/\.md$/, "")}]]`;
          // Annehmen ueber den Knopf im Panel — der Weg, den der Nutzer geht. Der Tab wird per
          // Kommando geoeffnet; der erste Accept-Knopf gehoert zur Karte der aktiven Notiz, also
          // erst PLAIN oeffnen, damit die Sortierung sie nach oben stellt.
          await main.evaluate(`
            await app.workspace.openLinkText(${JSON.stringify(PLAIN)}, "", false);
            await app.commands.executeCommandById("vault-retrieval:open-integrator");
          `);
          await pollUntil<number>(main, `const n = document.querySelectorAll(".vault-rag-int-accept").length; return n > 0 ? n : null;`, 5000, 250);
          const acceptedFirst = await main.evaluate<{ title: string | null }>(`
            const card = document.querySelector(".vault-rag-int-card");
            const btn = card ? card.querySelector(".vault-rag-int-accept") : null;
            const title = card ? card.querySelector(".vault-rag-int-card-title") : null;
            if (btn) btn.click();
            return { title: title ? title.textContent : null };
          `);
          const after1 = await pollUntil<string>(main, `
            const t = await app.vault.adapter.read(${JSON.stringify(PLAIN)});
            return t !== ${JSON.stringify(intPre.plain)} ? t : null;
          `, 5000, 250);
          const wroteSection = typeof after1 === "string" && after1.startsWith(intPre.plain.replace(/\n+$/, ""))
            && after1.includes("## Verwandte Notizen") && after1.includes(expectLink);
          record("Annehmen im Panel schreibt den Abschnitt mit dem Wikilink in die Datei",
            wroteSection && acceptedFirst.title === "Integrator plain",
            `Karte „${acceptedFirst.title ?? "—"}“ · +${(after1?.length ?? 0) - intPre.plain.length} Bytes · ${expectLink}`);

          const again = await main.evaluate<{ ok: boolean; changed?: boolean; reason?: string; text: string }>(`
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            const r = await p.applyLinkNow(${JSON.stringify(PLAIN)}, ${JSON.stringify(target)});
            return { ...r, text: await app.vault.adapter.read(${JSON.stringify(PLAIN)}) };
          `);
          record("Zweites Anwenden desselben Ziels lässt die Datei byte-identisch",
            again.ok && again.changed === false && again.text === after1,
            `changed=${String(again.changed)} · ${again.text === after1 ? "Bytes gleich" : "Bytes VERSCHIEDEN"}`);
        } else {
          record("Annehmen im Panel schreibt den Abschnitt mit dem Wikilink in die Datei", false, "kein Ziel vorgeschlagen");
          record("Zweites Anwenden desselben Ziels lässt die Datei byte-identisch", false, "kein Ziel vorgeschlagen");
        }

        // Ablehnen: das erste verbleibende Ziel ablehnen, neu berechnen, es darf nicht wiederkommen.
        const rejected = await main.evaluate<{ before: number; after: number; has: boolean; tgt: string | null }>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const cur = p.integratorStore.get(${JSON.stringify(PLAIN)});
          if (!cur || cur.links.length === 0) return { before: 0, after: 0, has: false, tgt: null };
          const tgt = cur.links[0].path;
          p.integratorStore.resolve(${JSON.stringify(PLAIN)}, tgt, "rejected");
          const r = await p.proposeFor(${JSON.stringify(PLAIN)});
          const links = r.kind === "proposal" ? r.proposal.links.map(l => l.path) : [];
          return { before: cur.links.length, after: links.length, has: links.includes(tgt), tgt };
        `);
        if (rejected.before === 0) skipped("Abgelehntes Ziel kommt beim Neuberechnen nicht wieder", "nach dem Annehmen blieb kein weiteres Ziel zum Ablehnen");
        else record("Abgelehntes Ziel kommt beim Neuberechnen nicht wieder", !rejected.has, `${rejected.tgt} · vorher ${rejected.before}, nachher ${rejected.after} Ziele`);

        // Frontmatter-Modus an der Notiz mit `related: []` — nur diese Zeilen duerfen sich aendern.
        const fm = await main.evaluate<{ ok: boolean; detail: string; text: string }>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const saved = p.settings.linkTarget;
          p.settings.linkTarget = "frontmatter"; await p.saveSettings();
          try {
            const r = await p.proposeFor(${JSON.stringify(REL)});
            if (r.kind !== "proposal") return { ok: false, detail: "proposeFor: " + r.kind, text: "" };
            const a = await p.acceptLink(${JSON.stringify(REL)}, r.proposal.links[0].path);
            return { ok: a.kind === "written", detail: "acceptLink: " + a.kind + (a.reason ? " " + a.reason : ""), text: await app.vault.adapter.read(${JSON.stringify(REL)}) };
          } finally { p.settings.linkTarget = saved; await p.saveSettings(); }
        `);
        const fmHead = fm.text.split("\n").slice(0, 6);
        const fmOk = fm.ok
          && fmHead[0] === "---" && fmHead[1] === "title: Integrator related" && fmHead[2] === "related:"
          && /^  - "\[\[[^\]]+\]\]"$/.test(fmHead[3] ?? "") && fmHead[4] === "tags: [fixture]" && fmHead[5] === "---"
          && fm.text.slice(fm.text.indexOf("\n---\n") + 5) === intPre.rel.slice(intPre.rel.indexOf("\n---\n") + 5);
        record("Frontmatter-Modus: related: [] wird zur Blockliste, Rest byte-identisch",
          fmOk, `${fm.detail} · ${fmHead.join(" ⏎ ")}`);
      }
    }

    // --- 8. Auto-Heal-Kaskade: defekter Container ohne Endpunkt ------------
    // Der einzige Prüfpunkt, der die VERDRAHTUNG misst statt der Entscheidung. `planAutoHeal`
    // ist unit-getestet — der Bug von 2026-08-14 lag aber in `attemptAutoHeal`: die
    // Backup-Übernahme hing hinter einem `if (!ready) return`, wer offline war blieb dauerhaft
    // auf dem defekten Container sitzen. Genau diese Kombination wird hier hergestellt:
    // Container kaputt UND kein erreichbarer Embedding-Endpunkt. Vor dem Fix bliebe der Index
    // dauerhaft weg — das ist die Gegenprobe, die den Punkt aussagekräftig macht.
    //
    // Der Prüfpunkt fasst echte Nutzerdaten an (`index.bin` liegt im gesyncten Vault). Er
    // sichert die Original-Bytes im Renderer, bevor er sie kippt, und das `finally` schreibt
    // sie zurück; die Auto-Heal-Kaskade selbst ist die zweite Absicherung.
    const healPre = await main.evaluate<{ ok: boolean; reason?: string; noteCount?: number; indexPath?: string; backups?: number }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const before = p.api.status();
      if (!before.indexed || !before.noteCount) return { ok: false, reason: "kein geladener Index" };
      const backups = await p.listBackups();
      if (!backups.length) return { ok: false, reason: "kein geräte-lokales Backup vorhanden" };
      const indexPath = p.settings.indexDir + "/index.bin";
      // Original-Bytes im Renderer parken statt 1,4 MB über die CDP-Grenze zu schieben.
      window.__vaultRagSmokeIndex = await app.vault.adapter.readBinary(indexPath);
      return { ok: true, noteCount: before.noteCount, indexPath, backups: backups.length };
    `);

    if (!healPre.ok) {
      console.log(`  – Auto-Heal-Kaskade: übersprungen — ${healPre.reason ?? "Voraussetzung fehlt"}`);
    } else {
      const indexPath = healPre.indexPath as string;
      // Ab hier ist Aufräumen Pflicht — Marke setzen, BEVOR irgendetwas verändert wird.
      healRestore = { indexPath, savedEndpoints: null };
      const saved = await main.evaluate<unknown>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const saved = JSON.parse(JSON.stringify(p.settings.embeddingEndpoints));
        // Notices MITSCHREIBEN statt am Ende nachsehen: sie blenden nach 10 s aus, die Kaskade
        // darf aber bis zu 90 s brauchen. Ein Blick danach misst nur, wer zufaellig noch steht.
        //
        // ACHTUNG: beobachtet wird activeDocument, NICHT document — an Obsidian 1.13.7 gemessen:
        // eine Notice landet im aktiven Fenster, und sobald ein Treiber app.setting.open()
        // gemacht hat, ist das Obsidians Einstellungs-FENSTER (eigenes Dokument im selben
        // Renderer). n.noticeEl.getRootNode() === document ist dann false und
        // document.querySelectorAll(".notice") bleibt leer — auch nach Page.bringToFront.
        // Wer hier document nimmt, misst "keine Notice", obwohl eine da war.
        // (Kein Backtick in diesem Block: der Renderer-Code steht selbst in einem Template-Literal.)
        // Beide Dokumente zu beobachten ist billiger als zu raten, welches gerade gilt.
        window.__vaultRagSmokeNotices = [];
        const collect = (records) => {
          for (const rec of records) {
            for (const node of rec.addedNodes) {
              if (node.nodeType !== 1) continue;
              const hit = node.classList.contains("notice") ? node : node.querySelector?.(".notice");
              if (hit) window.__vaultRagSmokeNotices.push(hit.textContent.trim());
            }
          }
        };
        window.__vaultRagSmokeObservers = [];
        const docs = new Set([document, typeof activeDocument !== "undefined" ? activeDocument : document]);
        for (const doc of docs) {
          const obs = new MutationObserver(collect);
          obs.observe(doc.body, { childList: true, subtree: true });
          window.__vaultRagSmokeObservers.push(obs);
        }
        // Endpunkt tot stellen — über die Einstellungen, nicht über das Netz: ein Port, auf dem
        // nichts lauscht, ist der einzige Weg, "kein Embedder" reproduzierbar herzustellen.
        p.settings.embeddingEndpoints = [{ url: "http://127.0.0.1:9" }];
        await p.saveSettings();
        // Container kippen: EIN Byte hinter dem Header genügt, die CRC32 des Payloads schlägt an.
        // Truncaten wäre der falsche Reiz — das ergibt "no-index", einen anderen Pfad.
        const bytes = new Uint8Array(window.__vaultRagSmokeIndex.slice(0));
        const at = Math.floor(bytes.length / 2);
        bytes[at] = bytes[at] ^ 0xff;
        await app.vault.adapter.writeBinary(${JSON.stringify("__PATH__")}, bytes.buffer);
        // Neu laden: der Reload ist der einzige Weg in loadIndex() → corrupt → attemptAutoHeal.
        await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
        await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
        return saved;
      `.replace("__PATH__", indexPath));
      healRestore.savedEndpoints = saved;

      // Warten auf der NODE-Seite: die Kaskade läuft detacht (Backup lesen, CRC prüfen,
      // persistieren) und braucht bei 1,4 MB spürbar länger als ein Renderer-Tick.
      const healed = await pollUntil<{ indexed: boolean; noteCount: number }>(main, `
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (!p || !p.api) return null;
        const s = p.api.status();
        return s.indexed ? s : null;
      `, 90_000, 2000);
      const healNotices = await main.evaluate<string[]>(`
        const seen = window.__vaultRagSmokeNotices || [];
        for (const obs of window.__vaultRagSmokeObservers || []) obs.disconnect();
        delete window.__vaultRagSmokeObservers;
        delete window.__vaultRagSmokeNotices;
        return seen;
      `);

      record("Defekter Container heilt sich ohne Endpunkt aus dem Backup",
        healed !== null && healed.noteCount > 0,
        healed
          ? `${healed.noteCount} Notizen wieder da (vorher ${healPre.noteCount ?? 0})`
          : "Index blieb weg — vor dem Fix von 0.24.0 war genau das das Verhalten");
      // Die Notice ist Teil der Zusage: das Backup kann älter sein, und der Nutzer muss das
      // erfahren, statt einen stillschweigend unvollständigen Index zu benutzen.
      //
      // NUR DIE EIGENEN NOTICES ZAEHLEN. `.notice` ist Obsidians GETEILTER Toast — jedes
      // installierte Plugin schreibt hinein. Ein Punkt, der bloss `length > 0` prueft, wird von
      // einer fremden Meldung gruen gemacht, die zufaellig in dieselben bis zu 90 Sekunden
      // faellt; er belegt dann nichts ueber unsere Heilung. (Dach-Messung 2026-08-30: sechs
      // Treiber lesen den geteilten Kanal, drei ungefiltert — dieser war einer davon. In
      // koda-agent war dieselbe Fehlerklasse an `.view-action`/`.modal-container` zweimal die
      // Ursache, einmal fuer einen gruenen Punkt, der seinen Gegenstand nie beruehrt hat.)
      // Erkannt am Plugin-Praefix, das unsere Notices tragen ("Vault Retrieval: " bzw.
      // "vault-rag: ") — beide Schreibweisen kommen in `src/i18n/strings.ts` vor.
      const ownNotice = /vault[-\s]?rag|vault retrieval/i;
      const healOwn = healNotices.filter(n => ownNotice.test(n));
      const healForeign = healNotices.filter(n => !ownNotice.test(n));
      record("Die Heilung meldet sich, statt still einen aelteren Stand zu benutzen",
        healOwn.length > 0,
        healOwn.length
          ? `„${healOwn.join(" | ").slice(0, 160)}“`
          : `keine EIGENE Notice waehrend des Laufs${healForeign.length ? ` (${healForeign.length} fremde gesehen und verworfen)` : ""}`);
    }

  } finally {
    if (labStubbed) {
      await main.evaluate(`
        delete app.plugins.plugins["llm-lab"];
        delete window.__vaultRagLabSeen;
        delete window.__vaultRagLabBaseline;
      `).catch(() => { console.log("  ! llm-lab-Stub konnte nicht entfernt werden — Obsidian neu laden (Cmd+R)"); });
    }
    if (healRestore) {
      // Reihenfolge zaehlt: erst die Original-Bytes zurueck, dann die Endpunkte, dann EIN
      // Reload — sonst laeuft die Kaskade auf dem Rueckweg noch einmal an.
      await main.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (window.__vaultRagSmokeIndex) {
          await app.vault.adapter.writeBinary(${JSON.stringify("__PATH__")}, window.__vaultRagSmokeIndex);
          delete window.__vaultRagSmokeIndex;
        }
        const saved = __ENDPOINTS__;
        if (saved) { p.settings.embeddingEndpoints = saved; await p.saveSettings(); }
        await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
        await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      `.replace("__PATH__", healRestore.indexPath).replace("__ENDPOINTS__", JSON.stringify(healRestore.savedEndpoints)))
        .catch(() => { console.log("  ! Index/Endpunkte konnten nicht zurückgeschrieben werden — Auto-Heal-Kaskade oder „Index-Backup wiederherstellen“ holt den Index zurück"); });
      console.log("\n  Index-Datei und Embedding-Endpunkte wiederhergestellt.");
    }
    if (integratorRestore) {
      await main.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        await app.vault.adapter.write("Notes/Integrator plain.md", ${JSON.stringify(integratorRestore.plain)});
        await app.vault.adapter.write("Notes/Integrator related.md", ${JSON.stringify(integratorRestore.rel)});
        p.integratorStore.remove("Notes/Integrator plain.md");
        p.integratorStore.remove("Notes/Integrator related.md");
        await p.saveIntegratorStore();
      `).catch(() => { console.log("  ! Integrator-Fixture-Notizen konnten nicht zurückgeschrieben werden — `npm run shots -- --setup` stellt sie her"); });
      console.log("\n  Integrator-Fixture-Notizen und Inbox zurückgesetzt.");
    }
    if (savedChatOrder && !keep) {
      // Reihenfolge zurückschreiben: der Smoke soll die Konfiguration des Nutzers nicht
      // verändern. Über die Plugin-API statt über die UI, damit auch ein Abbruch mitten
      // im Lauf sauber aufräumt.
      await main.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const order = ${JSON.stringify(savedChatOrder)};
        const byUrl = new Map(p.settings.chatEndpoints.map(e => [e.url, e]));
        p.settings.chatEndpoints = order.map(u => byUrl.get(u)).filter(Boolean);
        await p.saveSettings();
        await p.resolveAndReconnectChat();
      `).catch(() => { console.log("  ! Reihenfolge konnte nicht zurückgeschrieben werden"); });
      console.log("\n  Reihenfolge wiederhergestellt.");
    }
    settings?.close();
    main.close();
  }

  const failed = results.filter(r => !r.passed);
  // Die Bilanz nennt, was NICHT gelaufen ist — sonst liest sich „23/25 grün" wie ein
  // vollstaendiger Lauf, waehrend 15 Punkte nie erreicht wurden (2026-09-02).
  const skipNachsatz = uebersprungen.length
    ? ` · ${uebersprungen.length} übersprungen (weder grün noch rot)`
    : "";
  console.log(`\n${results.length - failed.length}/${results.length} Prüfpunkte grün${skipNachsatz}`);
  if (uebersprungen.length) {
    console.log("\nNicht gelaufen:");
    for (const u of uebersprungen) console.log(`  – ${u.name} — ${u.reason}`);
  }
  // Die Herkunfts-Warnung steht NACH der Bilanz, nicht davor: sie erscheint sonst am Anfang
  // eines mehrminütigen Laufs und ist beim Ablesen des Ergebnisses längst weggescrollt. Ein
  // „18/18 grün“ ohne diesen Zusatz hätte am 2026-08-30 workspace-weit 69 Prüfpunkte auf
  // nicht belegtem Code beglaubigt.
  if (herkunftsWarnung) {
    console.log(`\n⚠️  Herkunft des gemessenen Builds UNGEKLÄRT — die Bilanz oben belegt nicht,`);
    console.log(`   dass sie für den Repo-Stand gilt:\n   ${herkunftsWarnung}`);
  }
  if (failed.length) {
    console.log("\nOffen:");
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(`\nAbbruch: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
