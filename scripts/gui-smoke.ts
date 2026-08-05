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
 * npm run smoke:gui -- --port 9222 --vault Pallas
 * ```
 *
 * Der Klick-Prüfpunkt verändert die Endpunkt-Reihenfolge in den Einstellungen. Der Treiber
 * sichert sie vorher und schreibt sie im `finally` zurück — auch nach einem Abbruch mitten
 * im Lauf. Mit `--keep` bleibt die geänderte Reihenfolge stehen.
 *
 * Die CDP-Brücke ist verbatim aus `3d-codeblocks/scripts/gui-smoke.ts` übernommen
 * (REGISTRY: GUI-Smoke via CDP, dort erstes Exemplar) — bewusst vendored statt importiert,
 * solange die Abstraktionsgrenze nicht an einem dritten Repo bestätigt ist.
 */

const PLUGIN_ID = "vault-retrieval";
/** Muss zu `setIcon(...)` in `buildEndpointList` passen. */
const PRIORITY_ICON = "arrow-up-to-line";
const FALLBACK_ICON = "chevrons-up";

// --- CDP-Minimalbrücke ------------------------------------------------------
// Node ≥21 bringt `WebSocket` global mit — keine Dependency nötig.

interface CdpTarget {
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CdpResponse {
  id?: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  error?: { message?: string };
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, { ok: (v: CdpResponse) => void; fail: (e: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (message.id === undefined) return;   // Event, kein Antwort-Frame
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.fail(new Error(message.error.message ?? "CDP-Fehler"));
      else waiter.ok(message);
    });
  }

  static async listTargets(port: number): Promise<CdpTarget[]> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      return (await response.json()) as CdpTarget[];
    } catch {
      throw new Error(
        `Kein Debug-Port auf ${port}. Obsidian mit --remote-debugging-port=${port} neu starten ` +
          `(siehe Kopfkommentar).`,
      );
    }
  }

  /** Verbindet sich mit dem ersten Target, auf das `pick` passt.
   *
   *  Es gibt hier ZWEI relevante Fenster, und sie können verschiedene Dinge:
   *  - das **Hauptfenster** (`app://obsidian.md`) hat `app` und damit die Plugin-API,
   *  - das **Einstellungs-Fenster** hat seit Obsidian 1.13 ein eigenes Target
   *    (Titel „Einstellungen"/„Settings", URL `about:blank`) und trägt das Settings-DOM,
   *    aber **kein** `app` (`ReferenceError`).
   *  Wer nur auf `app://obsidian.md` filtert — wie die Referenz in 3d-codeblocks —, findet
   *  die Einstellungen nie und hält das für einen Plugin-Defekt (gemessen 2026-08-05, 1.13.4). */
  static async attach(port: number, pick: (t: CdpTarget) => boolean, label: string, vault?: string): Promise<Cdp> {
    const targets = await Cdp.listTargets(port);
    const pages = targets.filter(t => t.type === "page" && t.webSocketDebuggerUrl && pick(t));
    if (pages.length === 0) {
      const seen = targets.filter(t => t.type === "page").map(t => `${t.title} — ${t.url}`).join("\n  ") || "(keine)";
      throw new Error(`Kein Target für ${label} gefunden. Offene Seiten:\n  ${seen}`);
    }
    // Mehrere offene Vaults sind der Normalfall. Blind das erste Fenster zu nehmen hieße,
    // den Smoke im falschen Vault zu fahren — der Fehlschlag sähe aus wie ein Plugin-Defekt.
    const matching = vault ? pages.filter(t => t.title.toLowerCase().includes(vault.toLowerCase())) : pages;
    if (matching.length === 0) {
      throw new Error(`Kein ${label} passt zu --vault ${vault}. Offen:\n  ${pages.map(t => t.title).join("\n  ")}`);
    }
    if (matching.length > 1) {
      throw new Error(
        `Mehrere ${label}-Fenster offen — mit --vault <name> eines wählen:\n  ` +
          matching.map(t => t.title).join("\n  "),
      );
    }
    const page = matching[0];
    if (!page.webSocketDebuggerUrl) throw new Error(`Fenster ohne Debugger-URL: ${page.title}`);
    console.log(`${label}: ${page.title}`);

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket-Verbindung fehlgeschlagen")), { once: true });
    });
    return new Cdp(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail });
      setTimeout(() => {
        if (!this.pending.delete(id)) return;
        fail(new Error(`Zeitüberschreitung: ${method}`));
      }, 30_000);
    });
  }

  /** Ausdruck im Renderer auswerten. Wirft die Renderer-Ausnahme weiter, statt sie als
   *  `undefined` zu verschlucken — sonst liest sich ein kaputter Ausdruck wie ein
   *  fehlgeschlagener Prüfpunkt. */
  async evaluate<T>(expression: string): Promise<T> {
    const message = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const details = message.result?.exceptionDetails;
    if (details) throw new Error(`Renderer: ${details.text ?? "Ausnahme"}`);
    return message.result?.result?.value as T;
  }

  close(): void { this.socket.close(); }
}

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

/** Muss im HAUPTfenster laufen — nur dort existiert `app`. */
async function openSettings(main: Cdp): Promise<void> {
  await main.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise(r => setTimeout(r, 1500));
  `);
}

const isMainWindow = (t: CdpTarget): boolean => t.url.startsWith("app://obsidian.md");
const isSettingsWindow = (t: CdpTarget): boolean => /Einstellungen|Settings/.test(t.title ?? "");

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const port = Number(flag("port") ?? 9222);
  const vault = flag("vault");
  const keep = argv.includes("--keep");

  console.log(`GUI-Smoke Endpunkt-Priorität — Obsidian auf Port ${port}\n`);
  const main = await Cdp.attach(port, isMainWindow, "Hauptfenster", vault);
  // Außerhalb des try, damit das finally die Reihenfolge auch nach einem Abbruch
  // mitten im Lauf zurückschreiben kann.
  let savedChatOrder: string[] | null = null;
  let settings: Cdp | null = null;

  try {
    // Chromium drosselt nicht-fokussierte Fenster — ohne bringToFront misst man Phantome.
    await main.send("Page.bringToFront");

    const active = await main.evaluate<boolean>(
      `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`,
    );
    if (!active) throw new Error(`Plugin ${PLUGIN_ID} ist nicht aktiv — Obsidian neu laden (Cmd+R)?`);

    // --- 1./2. Einstellungen öffnen, Zeilen lesen ---------------------------
    // Öffnen über das Hauptfenster (dort lebt `app`), lesen im Einstellungs-Fenster
    // (dort lebt das DOM). Seit 1.13 sind das zwei getrennte Targets.
    await openSettings(main);
    settings = await Cdp.attach(port, isSettingsWindow, "Einstellungs-Fenster", vault);
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
    // Die Chat-Liste ist die zweite gerenderte Gruppe. Sie traegt den Klick-Test, weil
    // nur fuer sie die Reihenfolge gesichert und zurueckgeschrieben wird (savedChatOrder).
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
  } finally {
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
