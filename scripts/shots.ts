/**
 * Aufnahme-Treiber fuer die README-Bilder — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian, statt die Bilder von Hand zu klicken.
 *
 * Warum getrackt: ein Werkzeug, das nur einmal im Scratchpad existiert, ist keine Praxis.
 * Dieselbe Begruendung wie bei `scripts/gui-smoke.ts`, mit dem sich dieser Treiber die
 * CDP-Bruecke teilt. Bruecke, Aufnahme-Primitive und Fixture→Vault liegen zentral im Dach
 * (`obsidian-plugins/tools/obsidian-cdp/`); dieser Treiber importiert sie von dort und
 * vendort nichts.
 *
 * ## Ablauf
 *
 * ```bash
 * export STAGING_VAULTS_DIR="$HOME/StagingVaults"   # einmalig
 * npm run build && npm run shots -- --setup         # Vault aus dem Fixture bauen
 *
 * osascript -e 'quit app "Obsidian"'                # Handarbeit: Debug-Port
 * open -a Obsidian --args --remote-debugging-port=9222
 * #   ... Aufnahme-Vault oeffnen, als vertrauenswuerdig markieren, Reindex laufen lassen
 *
 * npm run shots                                     # alles aufnehmen
 * npm run shots -- --only hero.png                  # ein Bild nachziehen
 * ```
 *
 * ## Was dieses Plugin von den Nachbarn unterscheidet
 *
 * 1. **Ohne Index ist jedes Panel leer.** Vier der acht Bilder haengen an einem gebauten
 *    Embedding-Index. Der Treiber prueft ihn VOR dem ersten Bild und bricht mit Klartext
 *    ab — sonst entstuenden acht formal einwandfreie Bilder von leeren Kaesten.
 * 2. **Streaming braucht CORS.** `ChatClient.stream` laeuft als `XMLHttpRequest` im
 *    Renderer und sendet `Origin: app://obsidian.md`. Ein Chat-Server ohne CORS weist den
 *    Preflight ab, waehrend der Verbindungstest der Einstellungen gruen meldet (der nimmt
 *    `requestUrl` im Hauptprozess). Der Treiber misst das aktiv, statt in einen Timeout zu
 *    laufen, der wie ein Aufnahme-Fehler aussieht.
 * 3. **Ein Sidebar-Panel ist von Natur aus hochformatig.** Die `feature`-Klasse erlaubt
 *    H/B ≤ 1.6; ein 350 px breites Panel in einem 900 px hohen Fenster liegt bei 2.5. Der
 *    Treiber verbreitert die Sidebar deshalb auf `SIDEBAR_BREITE` und kappt die Hoehe am
 *    Seitenverhaeltnis — die Kante gehoert dorthin, wo der Ausschnitt entsteht, nicht in
 *    ein Nachschneiden hinterher.
 */

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { argv, cwd, exit } from "node:process";

import {
  attachTo,
  Cdp,
  closeExtraLeaves,
  openExisting,
  pollUntil,
  setAppConfig,
  setPluginSetting,
} from "../../tools/obsidian-cdp/cdp.js";
import {
  boxOf,
  capture,
  setWindowSize,
  withMetrics,
  writeShot,
  type Rect,
  type ShotOptions,
} from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "vault-retrieval";
const REPO_NAME = "vault-rag";
const OUT_DIR = "docs/images";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const PADDING = 10;
const FENSTER_BREITE = 1440;
const FENSTER_HOEHE = 900;
/** Breite der rechten Sidebar waehrend der Aufnahme — siehe Kopfkommentar (3). */
const SIDEBAR_BREITE = 560;
const MAX_RATIO_FEATURE = 1.6;

const HERO_NOTIZ = "Notes/Zettelkasten method.md";
const MESSY_NOTIZ = "Notes/Team sync 2026-03-12.md";
const REFORMAT_NOTIZ = "Notes/Reading workflow.md";

/** Anfrage fuer `search.png`. Teilt mit KEINEM Treffertitel ein Wort — genau das ist die
 *  Aussage des Bildes. Wer sie aendert, pruefe das nach, sonst zeigt das Bild eine
 *  Volltextsuche. */
const SUCHANFRAGE = "how do I stop forgetting what I read";
/** Chat-Modell der Aufnahme. Als Argument, nicht als Konstante: nicht jede Maschine laedt
 *  jedes Modell, und `thinking.png` braucht ein **denkendes** — ein zu schnelles Modell hat
 *  keinen "mitten im Strom"-Moment (Befund aus vault-crews). */
const CHAT_MODELL_DEFAULT = "qwen/qwen3.6-27b";
const CHATFRAGE = "What does my vault say about keeping an index small enough to sync?";
/** Frage fuer `thinking.png` — bewusst eine ABWAEGUNG, keine Faktenfrage: nur dann hat das
 *  Modell etwas zu denken, und nur dann traegt der aufgeklappte Block eine Aussage. */
const DENKFRAGE = "Should I split long notes before embedding them, or keep them whole?";

// --- Rezept ------------------------------------------------------------------

/**
 * Was ein Rezept liefert.
 *
 * Die drei Faelle sind bewusst UNTERSCHEIDBAR. Ein frueher Entwurf liess `run` bei Erfolg
 * ohne Ausschnitt und bei Fehlschlag je `null` zurueckgeben — und `capture(undefined)`
 * nimmt dann das ganze Fenster auf. Ein gescheitertes Rezept haette damit klaglos ein
 * Vollbild geschrieben und der Lauf Erfolg gemeldet: genau die Fehlerklasse, vor der der
 * halbe Skill warnt. Der Typ macht sie jetzt unmoeglich.
 */
type Ausschnitt =
  /** Dieser Bildausschnitt. */
  | { art: "box"; box: Rect }
  /** Das ganze Fenster — die Aussage besteht aus mehreren Bereichen. */
  | { art: "fenster" }
  /** Das ganze Fenster, in dieser simulierten Hoehe (fuer Inhalte hoeher als das Fenster). */
  | { art: "hoch"; hoehe: number; selektor: string }
  /** Nicht zustande gekommen. Kein Bild schreiben. */
  | null;

interface Shot {
  name: string;
  /** Klasse nach dem Bild-Standard — steuert, ob ein Vorschaubild entsteht. */
  klasse: "hero" | "feature" | "detail";
  /** Aus welchem Fenster: der Workspace oder das eigene Einstellungs-Fenster. */
  fenster?: "workspace" | "settings";
  /**
   * Zustand herstellen — laeuft IMMER im Workspace-Fenster, auch bei `fenster: "settings"`.
   *
   * Notwendig, weil Obsidians Einstellungen ein eigenes Dokument sind: dort existiert
   * `app` nicht, und jeder Versuch, von dort aus eine Einstellung zu setzen, endet in
   * "ReferenceError: app is not defined" (gemessen). Wer den Zustand braucht, stellt ihn
   * drueben her und laesst `run` nur noch messen und zuschneiden.
   */
  vorher?(cdp: Cdp): Promise<void>;
  /** Stellt den Zustand her und liefert den Bildausschnitt. */
  run(cdp: Cdp): Promise<Ausschnitt>;
}

/** Kurzform fuer den haeufigsten Fall: Box oder Fehlschlag. */
function box(r: Rect | null): Ausschnitt {
  return r ? { art: "box", box: r } : null;
}

/** Hub oeffnen und auf einen Tab schalten.
 *
 *  Ueber `data-tab` statt ueber die Beschriftung: die Beschriftung ist uebersetzt, und ein
 *  Selektor, der ins Leere greift, faellt nicht auf — der Klick geht dann ins Nichts und
 *  das Bild zeigt den vorigen Tab. */
async function hubTab(cdp: Cdp, tab: string): Promise<boolean> {
  const da = await pollUntil<boolean>(cdp, `
    const cmd = app.commands.commands[${JSON.stringify(`${PLUGIN_ID}:open-related`)}];
    if (cmd) app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-related`)});
    return !!document.querySelector(".vault-rag-hub-root");
  `, 10_000, 300);
  if (!da) return false;

  return Boolean(await pollUntil<boolean>(cdp, `
    const btn = [...document.querySelectorAll(".vault-rag-hub-tab")]
      .find((e) => e.dataset.tab === ${JSON.stringify(tab)} && e.getBoundingClientRect().width > 1);
    if (!btn) return false;
    btn.click();
    await new Promise((r) => setTimeout(r, 300));
    return true;
  `, 8_000, 300));
}

/** Rechte Sidebar verbreitern und auf RUHE warten.
 *
 *  `setSize` wirkt asynchron: eine Box, die waehrend der Layout-Animation gemessen wird,
 *  hat die richtige Groesse an der falschen Stelle. Zwei gleiche Messungen statt einer
 *  Sekundenzahl (Befund aus dem local-image-generator-Durchlauf). */
async function sidebarBreit(cdp: Cdp, breite = SIDEBAR_BREITE): Promise<void> {
  await cdp.evaluate(`
    const rs = app.workspace.rightSplit;
    if (rs) { rs.expand?.(); rs.setSize(${breite}); }
    return true;
  `);
  let vorher = -1;
  for (let i = 0; i < 20; i++) {
    const jetzt = Number(await cdp.evaluate<number>(`
      const el = document.querySelector(".vault-rag-hub-root");
      return el ? Math.round(el.getBoundingClientRect().width) : 0;
    `));
    if (jetzt > 1 && jetzt === vorher) return;
    vorher = jetzt;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Zeigerspuren beseitigen: Tooltip wegnehmen und die Maus aus dem Panel bewegen.
 *
 *  Im ersten `smart-apply.png` klebte "Re-check Smart Apply LLM connection" mitten im Bild,
 *  weil der Zeiger zufaellig ueber dem Aktualisieren-Symbol stand. Das dokumentiert die
 *  Aufnahme, nicht das Produkt. */
async function zeigerWeg(cdp: Cdp): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await cdp.evaluate(`
    for (const el of document.querySelectorAll(".tooltip")) el.remove();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 200));
}

/** Obsidians Statusleiste ausblenden.
 *
 *  Zwei Gruende, und der zweite wiegt schwerer als der erste. Sie schwebt ueber der rechten
 *  Sidebar und klebt sonst als fremdes Symbol in jeder Panel-Ecke — das ist Kosmetik. Und
 *  sie zeigt hier den Sync-Status der **Aufnahme-Maschine** ("Uninitialized", rot): ein
 *  Zustand, der dem Wirt gehoert, nicht dem Produkt, und der im Bild wie ein Fehler des
 *  Plugins aussieht. Die Frage dahinter (local-image-generator, 2026-08-17): zeigt das Bild
 *  das Produkt oder die Maschine, auf der es aufgenommen wurde? */
async function statusleisteAus(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    let s = document.getElementById("shots-hide-statusbar");
    if (!s) {
      s = document.createElement("style");
      s.id = "shots-hide-statusbar";
      s.textContent = ".status-bar { display: none !important; }";
      document.head.appendChild(s);
    }
    return true;
  `);
}

/** Den Ordner `Notes` im Datei-Explorer aufklappen.
 *
 *  Ein zugeklappter Baum laesst ein Drittel des Hero-Bildes leer und verschweigt, dass hier
 *  ein Vault mit Notizen steht — die Voraussetzung, ueber die das ganze Plugin spricht. */
async function baumAufklappen(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const ex = app.workspace.getLeavesOfType("file-explorer")[0]?.view;
    if (!ex) return false;
    for (const [pfad, eintrag] of Object.entries(ex.fileItems ?? {})) {
      if (pfad === "Notes" && eintrag.setCollapsed) await eintrag.setCollapsed(false);
    }
    await new Promise((r) => setTimeout(r, 300));
    return true;
  `);
}

/**
 * Ausschnitt des Hub-Panels — auf den INHALT gekappt, nicht auf den Container.
 *
 * Ein Sidebar-Panel ist immer so hoch wie das Fenster; was darin steht, meist nicht. Wer
 * die Container-Box nimmt, bekommt unter dem letzten Treffer ein Drittel tote Flaeche —
 * und das Bild besteht dabei jeden Check, weil Klasse, Budget und Seitenverhaeltnis
 * stimmen. Das **letzte sichtbare Kind** entscheidet ueber die Unterkante, nicht die Hoehe
 * des Kastens; danach greift zusaetzlich die Kappung am Seitenverhaeltnis der Klasse.
 */
async function panelBox(cdp: Cdp, ratio = MAX_RATIO_FEATURE): Promise<Ausschnitt> {
  const b = await boxOf(cdp, ".vault-rag-hub-root", PADDING);
  if (!b) return null;

  const unterkante = Number(await cdp.evaluate<number>(`
    const wurzel = [...document.querySelectorAll(".vault-rag-hub-root")]
      .find((e) => e.getBoundingClientRect().width > 1);
    if (!wurzel) return 0;
    let unten = 0;
    for (const el of wurzel.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      // Nur BLATT-Elemente. Ein Container zaehlt nicht: die Trefferliste
      // (.vault-rag-search-results) traegt den Text aller Treffer UND reicht bis zum
      // unteren Fensterrand — mit ihr in der Messung blieb die Kappung wirkungslos und
      // das Bild behielt 29 % tote Flaeche (gemessen, erster Anlauf).
      if (el.children.length === 0
          && r.width > 1 && r.height > 1 && (el.textContent ?? "").trim().length > 0) {
        unten = Math.max(unten, r.bottom);
      }
    }
    return Math.ceil(unten);
  `));

  const hoehe = unterkante > b.y
    ? Math.min(b.height, unterkante - b.y + PADDING)
    : b.height;
  const maxHoehe = b.width * ratio;
  if (hoehe <= maxHoehe) return box({ ...b, height: Math.floor(hoehe) });

  // Muss gekappt werden: dann an einer ELEMENTGRENZE, nicht auf dem Millimeter.
  // Eine harte Kappung endet mitten in einem Satz, und ein halber Satz am Bildrand liest
  // sich als Schnittfehler, nicht als "hier geht es weiter" (gemessen an `thinking.png`).
  // Gesucht ist die groesste Unterkante eines sichtbaren Blattelements, die noch unter die
  // Grenze passt; gibt es keine, bleibt die harte Kappung als Rueckfall.
  const grenze = b.y + maxHoehe;
  const sauber = Number(await cdp.evaluate<number>(`
    const wurzel = [...document.querySelectorAll(".vault-rag-hub-root")]
      .find((e) => e.getBoundingClientRect().width > 1);
    if (!wurzel) return 0;
    let beste = 0;
    for (const el of wurzel.querySelectorAll("*")) {
      if (el.children.length !== 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1 && (el.textContent ?? "").trim().length > 0
          && r.bottom <= ${grenze}) {
        beste = Math.max(beste, r.bottom);
      }
    }
    return Math.floor(beste);
  `));
  const ende = sauber > b.y ? sauber + PADDING : b.y + maxHoehe;
  return box({ ...b, height: Math.floor(Math.min(ende - b.y, maxHoehe)) });
}

/**
 * Warten, bis ein Zustand zur RUHE kommt — zwei gleiche Signaturen hintereinander.
 *
 * Nicht auf eine Sekundenzahl: ein schnelles Modell ist fertig, bevor die Frist ablaeuft,
 * ein langsames noch mitten im Satz. Zwei Fallen stecken in der scheinbar einfachen
 * Messung, beide hier gemessen (2026-08-21):
 *
 * 1. **Die Laenge ist das falsche Mass.** Die Arbeitszeile zaehlt Sekunden hoch —
 *    "2.4 s" und "2.5 s" sind gleich lang. Verglichen wird deshalb der INHALT.
 * 2. **Das letzte Element ist nicht die Antwort.** Solange keine Antwort begonnen hat,
 *    ist die letzte `.vault-rag-chat-msg` die FRAGE — und deren Text aendert sich nie.
 *    Der erste Anlauf hielt das fuer Ruhe und fotografierte ein leeres Panel mit
 *    "generating… 2.4 s". Die Signatur nimmt deshalb die tickende Arbeitszeile MIT auf:
 *    solange gearbeitet wird, kann sie nicht zweimal gleich sein.
 */
async function ruht(cdp: Cdp, signaturAusdruck: string, timeoutMs = 300_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let vorher: string | null = null;
  let gleich = 0;
  while (Date.now() < deadline) {
    const jetzt = await cdp.evaluate<string>(signaturAusdruck);
    if (jetzt && jetzt === vorher) {
      if (++gleich >= 2) return true;
    } else {
      gleich = 0;
    }
    vorher = jetzt;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Signatur eines Panels: sichtbarer Text der genannten Selektoren, zusammengefasst.
 *
 * Findet sich NICHTS, ist das Ergebnis `null` und nicht etwa ein Platzhalter — denn leer
 * heisst nicht ruhig. Ein Zustand, den es nicht gibt, ist perfekt stabil: mit einem
 * Rueckfallwert meldete `ruht` sofort Erfolg, und `smart-apply.png` fotografierte den
 * Vorher-Zustand, obwohl gar kein Lauf stattgefunden hatte (gemessen 2026-08-21). `null`
 * laesst `ruht` weiterwarten, statt Abwesenheit als Ergebnis zu verkaufen.
 *
 * (Keine Backticks im Rumpf unten — er steht in einem Template-Literal.)
 */
function signatur(...selektoren: string[]): string {
  return `
    const teile = [];
    for (const sel of ${JSON.stringify(selektoren)}) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.getBoundingClientRect().width > 1) teile.push((el.textContent ?? "").trim());
      }
    }
    return teile.length ? teile.join("\u0001") : null;
  `;
}

/** Zustandsbericht fuer Fehlschlaege. Diese eine Zeile ersetzt das Raten: der Skill haelt
 *  fest, dass ohne sie jede Stufe wie ein Renderer-Problem aussieht — und dass der Blick
 *  aufs Bild sie trotzdem nicht ersetzt. */
async function lage(cdp: Cdp): Promise<string> {
  return cdp.evaluate<string>(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    return JSON.stringify({
      vault: app.vault.getName(),
      datei: app.workspace.getActiveFile()?.path ?? null,
      pluginAn: !!p,
      smartApply: p?.settings?.smartApplyEnabled ?? null,
      tabs: [...document.querySelectorAll(".vault-rag-hub-tab")].map((e) => e.dataset.tab),
      knopf: [...document.querySelectorAll(".vault-rag-sa-run")]
        .map((e) => ({ sichtbar: e.getBoundingClientRect().width > 1, gesperrt: e.disabled })),
      status: (document.querySelector(".vault-rag-sa-scan-status-label")?.textContent ?? "").slice(0, 80),
      runGesperrt: document.querySelector(".vault-rag-sa-run")?.classList.contains("is-disabled") ?? null,
      fehler: (document.querySelector(".vault-rag-sa-error, .vault-rag-chat-state")?.textContent ?? "").slice(0, 160),
      stream: (document.querySelector(".vault-rag-sa-stream")?.textContent ?? "").slice(0, 160),
    });
  `);
}

const SHOTS: Shot[] = [
  {
    name: "hero.png",
    klasse: "hero",
    async run(cdp) {
      await setAppConfig(cdp, "livePreview", true);
      if (!(await openExisting(cdp, HERO_NOTIZ, "preview"))) return null;
      await closeExtraLeaves(cdp);
      if (!(await hubTab(cdp, "related"))) return null;
      await sidebarBreit(cdp, 420);
      await baumAufklappen(cdp);
      await statusleisteAus(cdp);
      // Auf echte Treffer warten — ein leeres Related-Panel ist das Bild, das dieses
      // Plugin am meisten missversteht.
      const treffer = await pollUntil<number>(cdp, `
        return document.querySelectorAll(".vault-rag-hit").length;
      `, 20_000, 500);
      if (!treffer) {
        console.log("      · Related-Panel bleibt leer — Index gebaut? (Reindex-Befehl)");
        return null;
      }
      // Ganzes Fenster: Notiz UND verwandte Notizen nebeneinander sind die Aussage.
      return { art: "fenster" };
    },
  },
  {
    name: "search.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await openExisting(cdp, HERO_NOTIZ, "preview"))) return null;
      await closeExtraLeaves(cdp);
      if (!(await hubTab(cdp, "search"))) return null;
      await sidebarBreit(cdp);
      await statusleisteAus(cdp);
      await zeigerWeg(cdp);
      const getippt = await cdp.evaluate<boolean>(`
        const input = [...document.querySelectorAll(".vault-rag-search-input")]
          .find((e) => e.getBoundingClientRect().width > 1);
        if (!input) return false;
        input.value = ${JSON.stringify(SUCHANFRAGE)};
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      `);
      if (!getippt) return null;
      // Debounce 400 ms + Embedding der Anfrage.
      const treffer = await pollUntil<number>(cdp, `
        return document.querySelectorAll(".vault-rag-search-results .vault-rag-hit").length;
      `, 30_000, 500);
      if (!treffer) {
        const lage = await cdp.evaluate<string>(`
          const st = document.querySelector(".vault-rag-search-state");
          return st ? st.textContent : "(keine Statuszeile)";
        `);
        console.log(`      · keine Suchtreffer — Panel sagt: ${lage}`);
        return null;
      }
      return panelBox(cdp);
    },
  },
  {
    name: "chat.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await openExisting(cdp, HERO_NOTIZ, "preview"))) return null;
      await closeExtraLeaves(cdp);
      if (!(await hubTab(cdp, "chat"))) return null;
      await sidebarBreit(cdp);
      await statusleisteAus(cdp);
      if (!(await frageStellen(cdp, CHATFRAGE))) return null;
      if (!(await chatFertig(cdp))) {
        console.log("      · Antwort wurde nicht fertig — Chat-Endpunkt erreichbar? CORS an?");
        return null;
      }
      return panelBox(cdp);
    },
  },
  {
    name: "thinking.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await hubTab(cdp, "chat"))) return null;
      await sidebarBreit(cdp);
      await statusleisteAus(cdp);
      // Eigene Frage statt Nachnutzung der Chat-Session: `--only thinking.png` nach
      // frischem Obsidian-Start faende sonst ein leeres Panel und klappte nichts auf.
      // Jeder Shot stellt seine Voraussetzungen selbst her.
      if (!(await frageStellen(cdp, DENKFRAGE))) return null;
      if (!(await chatFertig(cdp))) {
        console.log("      · Antwort wurde nicht fertig — Chat-Endpunkt erreichbar?");
        return null;
      }
      // Aufgeklappt messen: ein zugeklapptes <details> hat unsichtbare Kinder, und der
      // sonst richtige Sichtbarkeitsfilter zaehlt sie als nicht vorhanden (vault-crews).
      const auf = await cdp.evaluate<boolean>(`
        const d = [...document.querySelectorAll(".vault-rag-chat-reasoning")]
          .filter((e) => e.getBoundingClientRect().width > 1).pop();
        if (!d) return false;
        d.open = true;
        return true;
      `);
      if (!auf) {
        console.log("      · kein Reasoning-Block — denkendes Modell gewaehlt? (--modell)");
        return null;
      }
      // An den ANFANG des Denkblocks scrollen, nicht ans Ende.
      //
      // Ein aufgeklappter Denkblock ist regelmaessig hoeher als das erlaubte
      // Seitenverhaeltnis — beides, Gedanken UND Antwort, passt nicht ins selbe Bild. Der
      // erste Versuch scrollte deshalb zur Antwort und schnitt oben mitten in die Gedanken:
      // ohne das Label "Thoughts" ist grauer Kursivtext nicht als Denken erkennbar, und das
      // Bild verlor genau die Aussage, fuer die es da ist.
      //
      // Die Aufteilung ist jetzt sauber: `chat.png` traegt Antwort und Quellen,
      // `thinking.png` den Denkprozess samt Schalter. Zwei Bilder, zwei Aussagen, keine
      // Dopplung — statt zweimal dieselbe halbe Geschichte.
      await cdp.evaluate(`
        const det = [...document.querySelectorAll(".vault-rag-chat-reasoning")]
          .filter((e) => e.getBoundingClientRect().width > 1).pop();
        if (det) det.scrollIntoView({ block: "start" });
        await new Promise((r) => setTimeout(r, 500));
        return true;
      `);
      return panelBox(cdp);
    },
  },
  {
    name: "smart-apply.png",
    klasse: "feature",
    async run(cdp) {
      // Smart Apply ist opt-in UND greift erst beim naechsten Laden des Plugins — der
      // Tab, der Befehl und das Ranking entstehen in `onload` (main.ts:253). Die
      // Einstellungs-Beschreibung sagt das ausdruecklich ("Applies the next time the plugin
      // reloads"), es ist also kein Befund, sondern eine Voraussetzung: setzen allein
      // genuegt nicht, der Zustand muss hergestellt werden.
      await setPluginSetting(cdp, PLUGIN_ID, "smartApplyEnabled", true);
      // Eigenes Modell fuer Smart Apply: das ist ein ERGEBNIS-Bild, kein Strom-Bild — hier
      // zaehlt, dass ein sauberes Zuordnungs-JSON herauskommt, nicht dass man beim Denken
      // zusehen kann. Ueberschreibbar per `--sa-modell`.
      const saModell = arg("sa-modell");
      if (saModell) {
        await setPluginSetting(cdp, PLUGIN_ID, "smartApplyModel", saModell);
        console.log(`      · Smart-Apply-Modell: ${saModell}`);
      }
      await cdp.evaluate(`
        await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
        await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
        await new Promise((r) => setTimeout(r, 1500));
        return true;
      `);
      if (!(await openExisting(cdp, MESSY_NOTIZ, "preview"))) {
        console.log(`      · ${MESSY_NOTIZ} liess sich nicht oeffnen — ${await lage(cdp)}`);
        return null;
      }
      await closeExtraLeaves(cdp);
      if (!(await hubTab(cdp, "smart-apply"))) {
        console.log("      · Smart-Apply-Tab fehlt — Einstellung gesetzt und Plugin neu geladen?");
        return null;
      }
      await sidebarBreit(cdp);
      await statusleisteAus(cdp);
      // Gesperrt ist der Knopf ueber eine CSS-KLASSE, nicht ueber das disabled-Attribut
      // (smart_apply_view.ts: toggleClass("is-disabled", running)). Ein Test auf
      // `!btn.disabled` ist deshalb immer wahr, der Klick geht auf einen gesperrten Knopf
      // und verpufft — der Lauf startet nie, und nichts meldet einen Fehler. Genau so
      // entstand ein Bild des Vorher-Zustands, das jeden Check bestand.
      const gestartet = await pollUntil<boolean>(cdp, `
        const btn = [...document.querySelectorAll(".vault-rag-sa-run")]
          .find((e) => e.getBoundingClientRect().width > 1
                    && !e.classList.contains("is-disabled"));
        if (!btn) return false;
        btn.click();
        return true;
      `, 30_000, 500);
      if (!gestartet) {
        console.log("      · Smart-Apply-Knopf blieb gesperrt — Vorlage erkannt? Endpunkt an?");
        return null;
      }
      // POSITIV auf das Diff-Gate warten: erst wenn Oberflaechen da sind, hat ein Lauf
      // stattgefunden. Eine reine Ruhe-Messung kann das nicht leisten — siehe `signatur`.
      const diff = await pollUntil<number>(cdp, `
        return document.querySelectorAll(".vault-rag-sa-surface").length;
      `, 300_000, 2000);
      if (!diff) {
        console.log(`      · kein Diff-Gate — ${await lage(cdp)}`);
        return null;
      }
      if (!(await ruht(cdp, signatur(".vault-rag-sa-surfaces", ".vault-rag-sa-stream")))) {
        console.log(`      · Lauf kam nicht zur Ruhe — ${await lage(cdp)}`);
        return null;
      }
      await zeigerWeg(cdp);
      return panelBox(cdp);
    },
  },
  {
    name: "reformat.png",
    klasse: "feature",
    async run(cdp) {
      // Quelltext-Modus: im Lesemodus stellt Obsidian keinen Editor-State bereit, die
      // sichtbare Markierung ist dort eine reine DOM-Selektion (siehe AGENTS.md).
      if (!(await openExisting(cdp, REFORMAT_NOTIZ, "source"))) return null;
      await closeExtraLeaves(cdp);
      const markiert = await cdp.evaluate<boolean>(`
        const ed = app.workspace.activeEditor?.editor;
        if (!ed) return false;
        const text = ed.getValue();
        const start = text.indexOf("A workable order");
        if (start < 0) return false;
        const ende = text.indexOf("\\n\\n", start);
        ed.setSelection(ed.offsetToPos(start), ed.offsetToPos(ende < 0 ? text.length : ende));
        return true;
      `);
      if (!markiert) {
        console.log("      · keine Auswahl setzbar — Editor im Quelltext-Modus?");
        return null;
      }
      if (!(await hubTab(cdp, "reformat"))) return null;
      await sidebarBreit(cdp);
      const geklickt = await pollUntil<boolean>(cdp, `
        const btn = [...document.querySelectorAll(".vault-rag-reformat-btn")]
          .find((e) => e.textContent.trim() === "\\u2192 Table"
            && e.getBoundingClientRect().width > 1 && !e.disabled);
        if (!btn) return false;
        btn.click();
        return true;
      `, 15_000, 500);
      if (!geklickt) {
        const grund = await cdp.evaluate<string>(`
          const b = document.querySelector(".vault-rag-reformat-blocked");
          return b ? b.textContent : "(Knopf nicht gefunden)";
        `);
        console.log(`      · Transform nicht ausloesbar — Panel sagt: ${grund}`);
        return null;
      }
      if (!(await ruht(cdp, signatur(".vault-rag-reformat-result")))) {
        console.log("      · Vorschau blieb leer — Chat-Endpunkt erreichbar? CORS an?");
        return null;
      }
      return box(await boxOf(cdp, ".modal", PADDING));
    },
  },
  {
    name: "endpoints.png",
    klasse: "feature",
    fenster: "settings",
    // Zwei Zeilen mit UNTERSCHIEDLICHER Rolle herstellen — sonst zeigt das Bild die
    // Aussage nicht. Sie lautet: erreichbar und verwendet sind zwei verschiedene Dinge,
    // und die Reihenfolge der Liste entscheidet. Bei nur einer Zeile ist das unsichtbar.
    //
    // Kein vorgetaeuschter Zustand: ein zweiter, toter Endpunkt ist genau die
    // Fallback-Liste, die das Feature beschreibt — der Port ist bewusst einer, auf dem
    // nichts lauscht, damit die Rolle "unreachable" ECHT gemessen wird und nicht behauptet.
    async vorher(cdp) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        p.settings.embeddingEndpoints = [
          { url: "http://localhost:11434" },
          { url: "http://localhost:11435" },
        ];
        await p.saveSettings?.();
        return true;
      `);
    },
    async run(cdp) {
      // Die Rollen-Zeilen werden asynchron nach der Probe befuellt — auf Text warten,
      // nicht auf die Zeile.
      await pollUntil<boolean>(cdp, `
        const zeilen = [...document.querySelectorAll(".vault-rag-ep-state")]
          .filter((e) => (e.textContent ?? "").trim().length > 0);
        return zeilen.length >= 2;
      `, 30_000, 500);
      // Alle Endpunkt-Zeilen zusammen, plus ihre Rollen-Zeilen: die Aussage ist der
      // Unterschied zwischen den Rollen, nicht eine einzelne Zeile.
      // NUR die Embedding-Liste, nicht jede Endpunkt-Zeile des Tabs.
      //
      // Ein min/max ueber alle `.vault-rag-ep-row` umspannt auch die Chat-Endpunkte weit
      // weiter unten — die Box war 3720 px hoch, und weil `captureBeyondViewport` die Seite
      // verlaengert, aber keinen scrollenden Container, bestand das Ergebnis zu vier
      // Fuenfteln aus schwarzer Flaeche. Genommen werden deshalb die ersten vier Zeilen in
      // Dokumentreihenfolge (Zeile + Rollen-Zeile, zweimal), und vorher wird an den Anfang
      // gescrollt, damit sie ueberhaupt im Viewport liegen.
      const raw = await cdp.evaluate<string | null>(`
        const alle = [...document.querySelectorAll(".vault-rag-ep-row, .vault-rag-ep-state")]
          .filter((e) => e.getBoundingClientRect().width > 1);
        if (alle.length < 2) return null;
        alle[0].scrollIntoView({ block: "start" });
        await new Promise((r) => setTimeout(r, 400));
        const rows = alle.slice(0, 4);
        const boxes = rows.map((e) => e.getBoundingClientRect());
        const x = Math.min(...boxes.map((b) => b.x));
        const y = Math.min(...boxes.map((b) => b.y));
        const r = Math.max(...boxes.map((b) => b.right));
        const bo = Math.max(...boxes.map((b) => b.bottom));
        // Am Fensterrand kappen: was darunter liegt, ist im Bild weisse Flaeche.
        const unten = Math.min(bo, window.innerHeight - 2);
        return JSON.stringify({ x, y, width: r - x, height: unten - y });
      `);
      if (!raw) return null;
      const b = JSON.parse(raw) as Rect;
      return box({
        x: Math.max(0, b.x - PADDING),
        y: Math.max(0, b.y - PADDING),
        width: b.width + PADDING * 2,
        height: b.height + PADDING * 2,
      });
    },
  },
  {
    name: "settings.png",
    klasse: "detail",
    fenster: "settings",
    async run(cdp) {
      // Erst die Hoehe MESSEN, dann so hoch simulieren. Eine feste Simulationshoehe
      // schneidet ab und faellt den Rest schwarz — die haeufigste Falle des Skills.
      const hoehe = Number(await cdp.evaluate<number>(`
        const el = document.querySelector(".vertical-tab-content");
        return el ? Math.ceil(el.scrollHeight) + 40 : 0;
      `));
      if (!hoehe) return null;
      return { art: "hoch", hoehe, selektor: ".vertical-tab-content" };
    },
  },
];

/**
 * Chat-Frage stellen — auf dem Weg, den auch ein Mensch geht.
 *
 * Drei Schritte, und der mittlere ist der, den der erste Anlauf uebersprungen hat:
 *
 * 1. **Vorigen Lauf verwerfen.** Der Panel-Zustand ueberlebt jeden Aufnahme-Lauf; ohne
 *    Reset standen zwei Fragen und die Antwort eines frueheren Versuchs im Bild.
 * 2. **Nach dem Tippen auf den KONTEXT warten.** `ContextPanel.setQuery` embeddet die
 *    Anfrage asynchron und fuellt erst danach die Auto-Auswahl. Wer 200 ms nach dem Tippen
 *    sendet, sendet mit `Context (0)` — das Modell bekommt keine Notizen und antwortet
 *    wahrheitsgemaess, es habe keine bekommen. Das sah wie ein Produktfehler aus und war
 *    einer im Rezept: eine gesetzte Eingabe ist kein hergestellter Zustand.
 * 3. Erst dann senden.
 */
async function frageStellen(cdp: Cdp, frage: string): Promise<boolean> {
  await cdp.evaluate(`
    const neu = [...document.querySelectorAll(".vault-rag-chat-new")]
      .find((e) => e.getBoundingClientRect().width > 1);
    if (neu) neu.click();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);

  // Kontext nachweislich LEEREN, bevor die Frage getippt wird.
  //
  // "New" leert die Chip-Liste nicht, und ein Vergleich "Chips haben sich geaendert" taugt
  // auch nicht: bei derselben Frage sind dieselben Chips voellig richtig, und der Lauf
  // bricht dann grundlos ab (gemessen). Stattdessen der dokumentierte Weg — eine Eingabe
  // unterhalb `MIN_QUERY` setzt `ranked = []` (context_panel.ts) und leert die Auswahl.
  // Danach ist "Chips vorhanden" wieder eine ehrliche Aussage ueber DIESE Frage.
  await cdp.evaluate(`
    const input = [...document.querySelectorAll(".vault-rag-chat-input")]
      .find((e) => e.getBoundingClientRect().width > 1);
    if (input) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  `);
  const geleert = await pollUntil<boolean>(cdp, `
    return document.querySelectorAll(".vault-rag-ctx-chip").length === 0 ? true : null;
  `, 20_000, 400);
  if (!geleert) console.log("      · Kontext liess sich nicht leeren — Messung unsicher");

  const getippt = await pollUntil<boolean>(cdp, `
    const input = [...document.querySelectorAll(".vault-rag-chat-input")]
      .find((e) => e.getBoundingClientRect().width > 1);
    if (!input) return false;
    input.value = ${JSON.stringify(frage)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  `, 15_000, 400);
  if (!getippt) return false;

  // Auf den Kontext DIESER Frage warten. Weil oben nachweislich geleert wurde, ist
  // "Chips vorhanden" jetzt ein Beweis, dass Retrieval fuer diese Frage gelaufen ist —
  // vorher fand dieselbe Pruefung die Chips des vorigen Laufs und sendete sofort los
  // (gemessen an `thinking.png`: dieselben fuenf Quellen wie bei `chat.png`, bei voellig
  // anderer Frage — das Bild sah plausibel aus und war falsch).
  const neuerKontext = await pollUntil<number>(cdp, `
    return document.querySelectorAll(".vault-rag-ctx-chip").length;
  `, 60_000, 500);
  if (!neuerKontext) {
    console.log("      · Kontext wurde nicht neu berechnet — Embedding-Endpunkt erreichbar?");
    return false;
  }

  return Boolean(await cdp.evaluate<boolean>(`
    const send = [...document.querySelectorAll(".vault-rag-chat-send")]
      .find((e) => e.getBoundingClientRect().width > 1);
    if (!send) return false;
    send.click();
    return true;
  `));
}

/**
 * Warten, bis der Chat FERTIG ist — positiver Nachweis statt Abwesenheit von Aenderung.
 *
 * Der Sende-Knopf heisst waehrend des Laufs "Stop" und danach wieder "Send"; das ist
 * derselbe Zustand, den auch der Nutzer sieht. Eine reine Ruhe-Messung ist hier untauglich,
 * weil zwischen "abgeschickt" und "Antwort beginnt" eine Phase liegt, in der sich
 * nachweislich nichts aendert — der erste Anlauf hielt genau die fuer das Ende und
 * fotografierte ein leeres Panel.
 */
async function chatFertig(cdp: Cdp, timeoutMs = 300_000): Promise<boolean> {
  const fertig = await pollUntil<boolean>(cdp, `
    const send = [...document.querySelectorAll(".vault-rag-chat-send")]
      .find((e) => e.getBoundingClientRect().width > 1);
    if (!send) return false;
    const laeuft = send.textContent.trim() === "Stop";
    const msgs = [...document.querySelectorAll(".vault-rag-chat-msg")];
    const antwort = msgs.length >= 2 && (msgs[msgs.length - 1].textContent ?? "").trim().length > 0;
    return !laeuft && antwort;
  `, timeoutMs, 1500);
  return Boolean(fertig);
}

// --- Vorbedingungen ----------------------------------------------------------

const PLUGIN_DATEIEN = ["main.js", "manifest.json", "styles.css"];

function hash(pfad: string): string {
  return createHash("sha256").update(readFileSync(pfad)).digest("hex").slice(0, 12);
}

function pluginDir(vaultDir: string): string {
  return join(vaultDir, ".obsidian", "plugins", PLUGIN_ID);
}

/**
 * Prueft, ob im Aufnahme-Vault derselbe Code liegt wie im Arbeitsbaum.
 *
 * Der Skill nennt das die teuerste Falle, und sie ist unsichtbar: `npm run shots` nimmt auf,
 * was im Vault INSTALLIERT ist, nicht was im Repo liegt. Der Lauf ist gruen, `shots:check`
 * meldet keine Befunde — und die Bilder zeigen den Stand von vor der Aenderung. Die beiden
 * Staende laufen genau dann auseinander, wenn man gerade etwas geaendert hat, also immer,
 * wenn man Bilder neu aufnimmt. Ein Hash-Vergleich kostet Millisekunden und macht aus einer
 * Disziplinfrage eine Zusicherung.
 */
function codeStandVergleichen(repoRoot: string, vaultDir: string): string[] {
  const ziel = pluginDir(vaultDir);
  const abweichend: string[] = [];
  for (const datei of PLUGIN_DATEIEN) {
    const a = join(repoRoot, datei);
    const b = join(ziel, datei);
    if (!existsSync(a) || !existsSync(b) || hash(a) !== hash(b)) abweichend.push(datei);
  }
  return abweichend;
}

/** Gebautes Plugin in den Aufnahme-Vault legen und dort neu laden. */
async function ausliefern(repoRoot: string, vaultDir: string, cdp: Cdp): Promise<void> {
  const ziel = pluginDir(vaultDir);
  for (const datei of PLUGIN_DATEIEN) copyFileSync(join(repoRoot, datei), join(ziel, datei));
  await cdp.evaluate(`
    await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
    await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  `);
  console.log("   Plugin ausgeliefert und neu geladen");
}

/** Ohne Index ist jedes Retrieval-Panel leer — und ein leeres Panel besteht jeden
 *  Groessen-Check. Deshalb VOR dem ersten Bild pruefen, nicht hinterher deuten. */
async function indexPruefen(cdp: Cdp): Promise<string | null> {
  const lage = await cdp.evaluate<string>(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    if (!p) return JSON.stringify({ fehler: "Plugin nicht geladen" });
    const n = p.index?.manifest?.count ?? p.index?.paths?.length ?? 0;
    return JSON.stringify({ notizen: n, modell: p.index?.manifest?.embedding_model ?? null });
  `);
  const d = JSON.parse(lage) as { fehler?: string; notizen?: number; modell?: string | null };
  if (d.fehler) return d.fehler;
  if (!d.notizen) {
    return "Kein Index im Aufnahme-Vault. Befehlspalette → \"Reindex vault\" einmal laufen "
      + "lassen (achtzehn Notizen, Sekunden), dann erneut aufnehmen.";
  }
  console.log(`   Index: ${d.notizen} Notizen, Modell ${d.modell ?? "?"}`);
  return null;
}

/** Streaming-Vorbedingung aktiv messen statt in einen Timeout zu laufen.
 *  Ein Chat-Server ohne CORS weist den Preflight ab, waehrend der Verbindungstest der
 *  Einstellungen gruen meldet — siehe Kopfkommentar (2). */
async function corsPruefen(cdp: Cdp): Promise<string | null> {
  const url = await cdp.evaluate<string>(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const eps = p?.settings?.chatEndpoints ?? [];
    return eps.length ? (eps[0].url ?? "") : "";
  `);
  if (!url) return "Kein Chat-Endpunkt konfiguriert.";
  const status = await cdp.evaluate<string>(`
    try {
      const res = await fetch(${JSON.stringify(url.replace(/\/+$/, ""))} + "/v1/models", { method: "GET" });
      return String(res.status);
    } catch (e) {
      return "blockiert:" + (e && e.message ? e.message : e);
    }
  `);
  if (status.startsWith("blockiert")) {
    return `Chat-Endpunkt ${url} beantwortet keine Anfrage aus dem Renderer (${status}).\n`
      + "   Das ist fast immer CORS. Server mit `lms server start --cors` neu starten —\n"
      + "   der Verbindungstest der Einstellungen bleibt davon unberuehrt gruen.";
  }
  return null;
}

/**
 * Einmalige Vorbereitung im laufenden Vault: Chat-Modell setzen und den Index bauen.
 *
 * Das gehoert ins Rezept und nicht in eine Handarbeits-Zeile des Vertrags — ein Index, den
 * jemand von Hand baut, ist bei der naechsten Aufnahme ein Index unbekannter Herkunft. Und
 * das Chat-Modell muss gesetzt werden, weil der Auslieferungs-Default (`qwen3`) ein
 * generischer Name ist, den kein Server unter genau diesem Namen fuehrt.
 */
async function vorbereiten(cdp: Cdp, modell: string): Promise<void> {
  await setPluginSetting(cdp, PLUGIN_ID, "chatModel", modell);
  console.log(`   Chat-Modell: ${modell}`);

  const start = await cdp.evaluate<boolean>(`
    return app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:reindex-vault`)});
  `);
  if (!start) {
    console.error("Reindex-Befehl nicht ausfuehrbar — Plugin geladen?");
    exit(1);
  }
  console.log("   Reindex laeuft…");

  // Auf ein Ergebnis warten, nicht auf eine Frist: achtzehn Notizen sind schnell, ein
  // kaltes Modell nicht.
  const fertig = await pollUntil<string>(cdp, `
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const n = p?.index?.manifest?.count ?? 0;
    return n > 0 ? JSON.stringify({ n, modell: p.index.manifest.embedding_model }) : null;
  `, 300_000, 2000);
  if (!fertig) {
    console.error("Index kam nicht zustande — Embedding-Endpunkt erreichbar? Modell geladen?");
    exit(1);
  }
  const d = JSON.parse(fertig) as { n: number; modell: string };
  console.log(`   Index steht: ${d.n} Notizen, Modell ${d.modell}`);
}

// --- Rahmen ------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

async function aufnehmen(shot: Shot, cdp: Cdp, opts: ShotOptions): Promise<boolean> {
  console.log(`   → ${shot.name}`);
  const ziel = await shot.run(cdp);
  if (ziel === null) {
    console.log("      · nicht zustande gekommen — kein Bild geschrieben");
    return false;
  }

  const thumb = shot.klasse === "detail";
  let png: Buffer;

  if (ziel.art === "hoch") {
    // Erst MESSEN, dann so hoch simulieren. Eine feste Simulationshoehe schneidet ab und
    // faellt den Rest schwarz; `captureBeyondViewport` verlaengert die Seite, nicht einen
    // scrollenden Container. Haeufigste Falle des Skills.
    png = await withMetrics(cdp, FENSTER_BREITE, ziel.hoehe, async () => {
      await new Promise((r) => setTimeout(r, 600));
      const b = await boxOf(cdp, ziel.selektor, 0);
      return capture(cdp, b ?? undefined, 1);
    });
  } else if (ziel.art === "fenster") {
    png = await capture(cdp, undefined, 1);
  } else {
    // Ausschnitte schmaler als die Aufnahmebreite mit doppelter Dichte: sonst begrenzt der
    // Lint die Anzeigebreite auf Dateibreite/2, obwohl das Motiv die volle Klassenbreite
    // verdient haette — und auf Retina saehe es weich aus.
    png = await capture(cdp, ziel.box, ziel.box.width < CAPTURE_WIDTH ? 2 : 1);
  }

  console.log(`      ${await writeShot(cdp, shot.name, png, { ...opts, thumb })}`);
  return true;
}

async function main(): Promise<void> {
  const repoRoot = cwd();
  const vaultDir = stagingVaultDir(REPO_NAME);

  if (argv.includes("--list")) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(20)} ${s.klasse}`);
    return;
  }

  if (argv.includes("--setup")) {
    for (const zeile of buildVault({
      repoRoot,
      vaultDir,
      fixtureDir: join(repoRoot, "docs/images/fixture"),
      pluginId: PLUGIN_ID,
    })) console.log(`   ${zeile}`);
    console.log(`\nVault steht: ${vaultDir}`);
    console.log("Jetzt Obsidian mit Debug-Port starten, den Vault oeffnen, als");
    console.log("vertrauenswuerdig markieren und einmal \"Reindex vault\" laufen lassen.");
    return;
  }

  const port = Number(arg("port", "9222"));
  const vaultName = arg("vault", basename(vaultDir)) as string;
  const nur = arg("only");

  const cdp = await attachTo("workspace", port, vaultName);
  if (!cdp) {
    console.error(`Kein Obsidian-Fenster fuer Vault »${vaultName}« auf Port ${port}.`);
    console.error("Laeuft Obsidian mit --remote-debugging-port? Ist der Aufnahme-Vault offen?");
    exit(1);
  }

  try {
    // Sprache pruefen, was GERENDERT ist — nicht, was gespeichert wurde. Beides weicht ab,
    // sobald jemand nach einer Aufnahme zurueckstellt und ohne Neustart weiterarbeitet
    // (Befund aus apple-health).
    const lang = await cdp.evaluate<string>("return document.documentElement.lang || 'en';");
    if (lang && !lang.startsWith("en")) {
      console.error(`Obsidian laeuft auf »${lang}«. Die README-Bilder sind englisch.`);
      console.error("Sprache umstellen (obsidian.json UND localStorage.language), dann neu starten.");
      exit(1);
    }

    await setWindowSize(cdp, FENSTER_BREITE, FENSTER_HOEHE);

    if (argv.includes("--deploy")) {
      await ausliefern(repoRoot, vaultDir, cdp);
      return;
    }

    if (argv.includes("--prepare")) {
      await vorbereiten(cdp, arg("modell", CHAT_MODELL_DEFAULT) as string);
      return;
    }

    const veraltet = codeStandVergleichen(repoRoot, vaultDir);
    if (veraltet.length) {
      console.error(`\nAufnahme nicht moeglich: der Aufnahme-Vault traegt anderen Code als`);
      console.error(`der Arbeitsbaum (${veraltet.join(", ")}).`);
      console.error("Die Bilder wuerden den vorigen Stand zeigen, ohne dass etwas fehlschlaegt.");
      console.error("   npm run build && npm run shots -- --deploy");
      exit(1);
    }

    const indexFehler = await indexPruefen(cdp);
    if (indexFehler) {
      console.error(`\nAufnahme nicht moeglich: ${indexFehler}`);
      exit(1);
    }

    const zuTun = SHOTS.filter((s) => !nur || s.name === nur);
    if (!zuTun.length) {
      console.error(`Kein Bild namens »${nur ?? ""}« im Vertrag. --list zeigt alle.`);
      exit(1);
    }

    const brauchtChat = zuTun.some((s) =>
      ["chat.png", "thinking.png", "smart-apply.png", "reformat.png"].includes(s.name));
    if (brauchtChat) {
      const corsFehler = await corsPruefen(cdp);
      if (corsFehler) {
        console.error(`\nAufnahme nicht moeglich: ${corsFehler}`);
        exit(1);
      }
    }

    const opts: ShotOptions = {
      outDir: join(repoRoot, OUT_DIR),
      captureWidth: CAPTURE_WIDTH,
      thumbWidth: THUMB_WIDTH,
    };

    for (const shot of zuTun) {
      const fenster = shot.fenster ?? "workspace";
      if (shot.vorher) await shot.vorher(cdp);
      if (fenster === "settings") {
        await cdp.evaluate(`
          app.setting.open();
          app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
          await new Promise((r) => setTimeout(r, 900));
          return true;
        `);
        const sCdp = await attachTo("settings", port);
        if (!sCdp) {
          console.log(`   → ${shot.name}\n      · Einstellungs-Fenster nicht gefunden`);
          continue;
        }
        try {
          await aufnehmen(shot, sCdp, opts);
        } finally {
          sCdp.close();
        }
        await cdp.evaluate("app.setting.close(); return true;");
        continue;
      }
      await aufnehmen(shot, cdp, opts);
    }
  } finally {
    cdp.close();
  }
}

if (!existsSync(join(cwd(), "manifest.json"))) {
  console.error("Bitte aus dem Repo-Wurzelverzeichnis starten.");
  exit(1);
}
void main();
