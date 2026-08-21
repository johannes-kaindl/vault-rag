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
        window.__vaultRagSmokeNotices = [];
        window.__vaultRagSmokeObserver = new MutationObserver((records) => {
          for (const rec of records) {
            for (const node of rec.addedNodes) {
              if (node.nodeType === 1 && node.classList.contains("notice")) {
                window.__vaultRagSmokeNotices.push(node.textContent.trim());
              }
            }
          }
        });
        window.__vaultRagSmokeObserver.observe(document.body, { childList: true, subtree: true });
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
        window.__vaultRagSmokeObserver?.disconnect();
        delete window.__vaultRagSmokeObserver;
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
      record("Die Heilung meldet sich, statt still einen aelteren Stand zu benutzen",
        healNotices.length > 0,
        healNotices.length ? `„${healNotices.join(" | ").slice(0, 160)}“` : "keine Notice waehrend des Laufs");
    }

  } finally {
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
