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
 * Obsidian muss mit offenem Debug-Port laufen — der einzige Handgriff, der Handarbeit
 * bleibt, weil die App dafür neu starten muss:
 *
 * ```bash
 * osascript -e 'quit app "Obsidian"'
 * open -a Obsidian --args --remote-debugging-port=9222
 * ```
 *
 * Dann:
 *
 * ```bash
 * npm run smoke:gui
 * npm run smoke:gui -- --port 9222 --vault 10_Pallas
 * ```
 *
 * `--vault` matcht seit der zentralen CDP-Brücke exakt gegen `app.vault.getName()`
 * (den Vault-**Ordnernamen**), nicht mehr als Teilstring des Fenstertitels — `Pallas`
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

import { Cdp, attachTo, pollUntil } from "../../tools/obsidian-cdp/cdp.js";

const PLUGIN_ID = "vault-retrieval";
/** Muss zu `setIcon(...)` in `buildEndpointList` passen. */
const PRIORITY_ICON = "arrow-up-to-line";
const FALLBACK_ICON = "chevrons-up";

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

/** Liest die sichtbaren Endpunkt-Zeilen der zuletzt geöffneten Einstellungs-Seite. */
const READ_ROWS = `
  const rows = [...document.querySelectorAll(".vault-rag-ep-row")];
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
    const state = row.querySelector(".vault-rag-ep-state");
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
        const warn = row.querySelector(".vault-rag-ep-warn, .vault-rag-ep-thirdparty");
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
  let savedChatOrder: string[] | null = null;
  let settings: Cdp | null = null;
  // Der Heal-Prüfpunkt zerstört absichtlich den Container und stellt die Endpunkt-Liste tot.
  // Beides wird im finally zurückgeschrieben — auch nach einem Abbruch mitten im Lauf.
  let healRestore: { indexPath: string; savedEndpoints: unknown } | null = null;
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
    record("Fläche ist auf status/search/related begrenzt",
      JSON.stringify(probe.keys) === JSON.stringify(["apiVersion", "related", "search", "status"]),
      (probe.keys ?? []).join(", "));
    record("status() ist synchron und meldet einen Index",
      probe.statusIsSync === true && probe.status?.indexed === true && (probe.status?.noteCount ?? 0) > 0,
      `indexed=${String(probe.status?.indexed)} · ${probe.status?.noteCount ?? 0} Notizen`);
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
      console.log("  – search(): übersprungen — Embedding-Endpunkt nicht erreichbar (korrekte Antwort, aber der Erfolgsfall bleibt ungeprüft)");
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
    const selfFind = await main.evaluate<SelfFindProbe>(`
      const api = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].api;
      if (!api) return { present: false, tried: [], offline: false };
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
      return { present: true, tried, offline };
    `);

    if (!selfFind.present) {
      record("Notizen finden sich ueber ihren eigenen Wortlaut", false, "Plugin-API nicht erreichbar");
    } else if (selfFind.offline || selfFind.tried.length === 0) {
      // Falle 16 der REGISTRY: ohne Embedding-Endpunkt ist "keine Antwort" die RICHTIGE
      // Antwort und kein Befund — dann uebersprungen statt falsch-gruen oder falsch-rot.
      console.log("  – Selbstfindung: uebersprungen — kein Embedding-Endpunkt oder keine kurze indexierte Notiz gefunden");
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
    const TAB_ROWS = `
      const tabs = [...document.querySelectorAll(".okit-hub-tab")];
      const boxen = tabs.map(t => t.getBoundingClientRect());
      return { zeilen: new Set(boxen.map(b => Math.round(b.top))).size,
               ueberlauf: boxen.some(b => b.right > document.querySelector(".okit-hub-tabs").getBoundingClientRect().right + 1) };
    `;
    const rowsAfter = async (px: number): Promise<{ zeilen: number; ueberlauf: boolean }> => {
      await main.evaluate(`app.workspace.rightSplit.setSize(${px}); return true;`);
      const r = await pollUntil<{ zeilen: number; ueberlauf: boolean }>(main, TAB_ROWS, 5000, 200);
      return r ?? { zeilen: 0, ueberlauf: false };
    };
    // Der Hub kann vom Nutzer auch links oder im Hauptbereich liegen — dann greift setSize
    // auf den falschen Split und der Punkt maesse Phantome. Lieber ueberspringen als luegen.
    const inRight = await main.evaluate<boolean>(`
      return !!app.workspace.rightSplit?.containerEl?.contains(document.querySelector(".okit-hub-root"));
    `);
    if (!inRight) {
      console.log("  – Umbruch der Tab-Leiste: übersprungen (Hub liegt nicht in der rechten Sidebar)");
    } else {
      // Die Breite ist eine Einstellung des Nutzers — vorher merken, im finally zurueckgeben.
      const userWidth = await main.evaluate<number>(`
        return Math.round(app.workspace.rightSplit.containerEl.getBoundingClientRect().width);
      `);
      let wide = { zeilen: 0, ueberlauf: false }, narrow = { zeilen: 0, ueberlauf: false };
      try {
        wide = await rowsAfter(WIDE);
        narrow = await rowsAfter(NARROW);
      } finally {
        await main.evaluate(`app.workspace.rightSplit.setSize(${userWidth}); return true;`)
          .catch(() => { console.log("  ! Sidebar-Breite konnte nicht zurückgesetzt werden"); });
      }
      record("Tab-Leiste bricht bei schmaler Sidebar um, statt zu stauchen",
        narrow.zeilen > wide.zeilen,
        `${WIDE}px → ${wide.zeilen} Zeile(n) · ${NARROW}px → ${narrow.zeilen} Zeile(n)`);
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
        const pending = last.filter(r => r.state === "prüfe…").length;
        if (pending === 0 || Date.now() > deadline) return last;
        await new Promise(r => setTimeout(r, 750));
      }
    };
    const rows = await readRowsSettled();
    record("Endpunkt-Zeilen gefunden", rows.length > 0, `${rows.length} Zeilen`);
    if (rows.length === 0) throw new Error("Keine .vault-rag-ep-row im DOM — falscher Tab?");

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
      record("Zeile 2 trägt den Prioritäts-Knopf", false, "nur eine Endpunkt-Zeile konfiguriert — nicht prüfbar");
    }

    // --- 4. Zustandstexte ---------------------------------------------------
    // PRO LISTE prüfen: Embedding und Chat haben je einen aktiven Endpunkt. Global gezählt
    // wären zwei „aktiv" ein Fehlalarm.
    for (const li of lists) {
      const inList = withState.filter(r => r.listIndex === li);
      const activeRows = inList.filter(r => r.state === "aktiv");
      const reachable = inList.filter(r => r.state !== "nicht erreichbar" && r.state !== "prüfe…");
      const name = listNames[li] ?? `Liste ${li}`;
      // Ist gar nichts erreichbar, ist „keine aktive Zeile" die ehrliche Anzeige, kein Fehler.
      const expected = reachable.length === 0 ? 0 : 1;
      record(
        `${name}: genau ${expected === 0 ? "keine" : "eine"} Zeile als aktiv markiert`,
        activeRows.length === expected,
        activeRows.length === 1 ? `„${activeRows[0].url}"` : `${activeRows.length} aktive Zeilen von ${inList.length}`,
      );
    }
    const known = /^(aktiv|erreichbar, aber Platz \d+|nicht erreichbar|übersprungen — Modell passt nicht zum Index|prüfe…)$/;
    const unknown = withState.filter(r => !known.test(r.state ?? ""));
    record("Alle Zustandstexte sind bekannte Formulierungen", unknown.length === 0,
      unknown.length ? unknown.map(r => `"${r.state}"`).join(", ") : `${withState.length} Zeilen geprüft`);
    const stillProbing = withState.filter(r => r.state === "prüfe…");
    if (stillProbing.length) {
      record("Alle Proben abgeschlossen", false, `${stillProbing.length} Zeilen noch bei „prüfe…" — Timeout zu kurz?`);
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
        const rows = [...document.querySelectorAll(".vault-rag-ep-row")];
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
        !!top && top.state !== null && top.state !== "prüfe…",
        `„${top?.state}"`);
      record("Die nach oben geholte Zeile trägt keinen Prioritäts-Knopf mehr",
        !!top && !top.hasPriorityButton,
        top?.hasPriorityButton ? "Knopf noch da" : "korrekt entfernt");
    } else {
      record("Klick setzt die Zeile an die Spitze", false,
        inChatList ? "übersprungen — kein zweiter Chat-Endpunkt mit Knopf" : "übersprungen — Chat-Liste hat weniger als zwei Einträge");
    }

    // --- 7. Rolle folgt dem Modell-Override --------------------------------
    // Regressionsschutz für eine Fehlerklasse, die zweimal auftrat: die Zustandszeile ist
    // ein Schnappschuss. Ein Modell-Commit ändert die Rolle (`skipped-model`), löst aber
    // bewusst kein Neuzeichnen aus — ohne Nachziehen behauptet die Zeile weiter, der
    // Endpunkt stünde nur hinten an, während der Guard ihn längst überspringt.
    const overrideRow = withState.find(r => r.listIndex === 0 && r.modelValue);
    if (overrideRow) {
      const original = overrideRow.modelValue as string;
      const rowIndex = overrideRow.index;
      const setModel = async (value: string): Promise<string | null> => {
        await settings!.evaluate(`
          const row = [...document.querySelectorAll(".vault-rag-ep-row")][${rowIndex}];
          const sel = row.querySelector("select");
          if (!sel) throw new Error("Kein Modell-Dropdown in der Zeile");
          sel.value = ${JSON.stringify("__V__")};
          sel.dispatchEvent(new Event("change"));
          await new Promise(r => setTimeout(r, 4000));
        `.replace("__V__", value));
        const rows2 = await readRowsSettled();
        return rows2[rowIndex]?.state ?? null;
      };
      const withoutOverride = await setModel("");
      const withOverride = await setModel(original);
      record(
        "Rolle folgt dem Modell-Override ohne Tab-Neuaufbau",
        withoutOverride !== withOverride && withOverride === "übersprungen — Modell passt nicht zum Index",
        `ohne Override „${withoutOverride}" · mit Override „${withOverride}"`,
      );
    } else {
      console.log("  – Rolle folgt dem Modell-Override: übersprungen (kein Embedding-Endpunkt mit Override konfiguriert)");
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
      console.log("  – llm-lab-Meldestrecke: übersprungen (echtes llm-lab installiert — der Smoke hängt kein Stub ein, um dessen Aufzeichnung nicht zu verfälschen)");
    } else {
      labStubbed = true;   // fuers finally
      // Die apiVersion hier ist eine VERTRAGSKOPIE — genau wie `lab_client.ts`s eigene
      // SUPPORTED_API_VERSION traegt sie den Stand von llm-labs LLM_LAB_API_VERSION
      // (src/plugin_api.ts) manuell nach und muss bei jedem Bump dort mitziehen. Aktueller
      // Stand: 2 (seit 431c23c, "feat(api)!: apiVersion 2 — secrets und contextPaths auf
      // LabLogInput"). Ein veralteter Wert hier faellt `readLabApi()`s strikten Vergleich
      // durch und laesst den Stub aussehen, als waere kein llm-lab installiert.
      await main.evaluate(`
        window.__vaultRagLabSeen = [];
        app.plugins.plugins["llm-lab"] = {
          api: {
            apiVersion: 2,
            status: () => ({ apiVersion: 2, recording: true }),
            log: (input) => { window.__vaultRagLabSeen.push(input); return "smoke-" + window.__vaultRagLabSeen.length; },
          },
        };
      `);

      // (1) Chat ueber die OBERFLAECHE — nicht ueber Plugin-Interna: der Punkt ist, dass der
      // trace-Parameter den ganzen Weg Panel → ChatSession → ChatClient uebersteht.
      await main.evaluate(`
        await app.commands.executeCommandById("vault-retrieval:open-vault-chat");
        await new Promise(r => setTimeout(r, 800));
        const ta = document.querySelector(".vault-rag-chat-input");
        ta.value = "Antworte mit genau einem Wort: Hallo.";
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector(".vault-rag-chat-send").click();
      `);
      // Auf das ERGEBNIS warten, nie auf den Sende-Knopf: der durchlaeuft im selben Turn
      // mehrere Uebergaenge (Senden→Stop→Senden) und meldet zu frueh "fertig"
      // (_docs/LESSONS.md 2026-08-23, n=2). Die Ergebniszeile stellt nur ein fertiger Lauf her.
      const chatDone = await pollUntil(main,
        `const w = document.querySelector(".vault-rag-chat-working"); return !!w && /✓/.test(w.textContent || "");`,
        180_000, 1_000).catch(() => false);
      const chatTrace = await main.evaluate<{ n: number; last: Record<string, unknown> | null }>(`
        const seen = window.__vaultRagLabSeen;
        return { n: seen.length, last: seen.length ? seen[seen.length - 1] : null };
      `);
      const ct = chatTrace.last as { plugin?: string; feature?: string; ttftMs?: number; model?: string; latencyMs?: number } | null;
      record("Ein Chat über die Oberfläche meldet sich beim Lab",
        chatDone === true && ct?.plugin === "vault-retrieval" && ct?.feature === "chat",
        chatDone ? `plugin=${String(ct?.plugin)} · feature=${String(ct?.feature)} · model=${String(ct?.model)}` : "Antwort blieb aus (Chat-Endpunkt erreichbar?)");
      // ttftMs trennt "Modell dachte lange" von "Verbindung stand nicht" — ohne den Wert ist
      // eine langsame Antwort in der Aufzeichnung nicht diagnostizierbar.
      record("Die Chat-Zeile trägt ttftMs und latencyMs",
        typeof ct?.ttftMs === "number" && typeof ct?.latencyMs === "number" && (ct.ttftMs ?? 0) <= (ct.latencyMs ?? 0),
        `ttftMs=${String(ct?.ttftMs)} · latencyMs=${String(ct?.latencyMs)}`);

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
        console.log("  – Endpunkt-Probe meldet sich unter eigenem feature: übersprungen (Testknopf in den Einstellungen nicht gefunden)");
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
        console.log("  – Reformat meldet sich mit Transform-ID: übersprungen (keine geeignete Notiz/Auswahl herstellbar)");
      } else {
        await pollUntil(main, `return window.__vaultRagLabSeen.length > ${rfBefore};`, 180_000, 1_000).catch(() => false);
        const rfTrace = await main.evaluate<{ features: string[] }>(`
          return { features: window.__vaultRagLabSeen.slice(${rfBefore}).map(x => x.feature) };
        `);
        const rf = rfTrace.features[rfTrace.features.length - 1] ?? "";
        record("Reformat meldet sich mit der Transform-ID im feature",
          /^reformat:.+/.test(rf), rf ? `feature=${rf}` : "keine Zeile — Transform lief nicht");
        // Modal schliessen, ohne anzuwenden: der Smoke veraendert keine Notiz.
        await main.evaluate(`
          const btns = [...document.querySelectorAll(".modal-container button")];
          const discard = btns.find(b => /verwerf|discard|abbrech|cancel/i.test(b.textContent || ""));
          if (discard) discard.click();
          else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        `).catch(() => {});
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
        180_000, 1_000).catch(() => false);
      const offTrace = await main.evaluate<{ added: number }>(`
        return { added: window.__vaultRagLabSeen.length - window.__vaultRagLabBaseline };
      `);
      record("Ohne Lab läuft der Chat vollständig durch und meldet nichts",
        offDone === true && offTrace.added === 0,
        offDone ? `Antwort kam, ${offTrace.added} neue Zeilen` : "Antwort blieb aus — Abwesenheit der Zeile beweist hier NICHTS");
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
  console.log(`\n${results.length - failed.length}/${results.length} Prüfpunkte grün`);
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
