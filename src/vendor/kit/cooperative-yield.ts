// vendored from code-kit@0.21.0, src/ts/pure/cooperative-yield.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Kooperatives Zeittor für CPU-lange Schleifen im Renderer — obsidian-frei, timer-frei,
 *  in Node testbar (PROF-OBS-03/04).
 *
 *  Eine Schleife, die ohne Pause durchläuft, friert Obsidians Oberfläche ein: nichts wird
 *  neu gezeichnet, kein Klick wird zugestellt — ein „Abbrechen"-Knopf ist dann Dekoration.
 *  Dieses Modul ist der Takt, der beides periodisch zulässt: es meldet zeitgetaktet
 *  Fortschritt **und** reicht zeitgetaktet eine Makrotask-Pause an den Aufrufer durch —
 *  auf derselben Schrittweite, aber auf zwei **getrennten** Barrieren.
 *
 *  Kanonische Quelle: `apple-health/src/core/pipeline.ts` (`aggregateStream`, 2026-07-20).
 *  Zweite Fassung: `obsidian-transmute/src/core/vault/run.ts` (`runOverFiles`, 2026-08-16),
 *  die das Muster laut `obsidian-transmute/AGENTS.md` von dort geerbt hat — ohne
 *  Herkunftsstempel in der Datei, weshalb `tools/kit-dupscan.py` sie nie sah. Beim Heben ins
 *  Kit (2026-08-19) waren die beiden if-Blöcke nach Normalisierung von Uhr-Variablenname,
 *  Fortschritts-Payload und Truthiness-Idiom byte-identisch (im Extraktions-Entwurf gemessen,
 *  md5 `0457bea0dc9d650942b2b142bf394ac8`); der Kern ist deshalb unverändert übernommen.
 *  Fünf Randunterschiede wurden zu Optionen statt zu einem stillen Verlust: injizierbare Uhr,
 *  pro-Runde übergebener Fortschritts-Payload, `boolean`-Rückgabe für die Abbruch-Nachprüfung,
 *  strikte `!== undefined`-Prüfung, **eine** Uhr-Lesung beim Setzen beider Barrieren.
 *
 *  ## Was beim Übernehmen zu beachten ist
 *
 *  1. **`tick()` gehört ans ENDE JEDER Schleifeniteration — nie hinter ein `continue`.**
 *     In obsidian-transmute standen Fortschritt und Freigabe hinter dem `continue` für „zu
 *     viele Treffer"; ein Muster wie `[a-z]` reißt diese Grenze in *jeder* Datei, also gab
 *     ausgerechnet der teuerste Ausgang die Oberfläche nie frei. Gefunden erst im GUI-Smoke
 *     2026-08-16, nachdem 403 grüne Unit-Tests es übersehen hatten.
 *  2. **Die Fortschritts-Schranke hängt NICHT an `yieldToUi`.** In apple-health hing
 *     `onProgress` am `yieldToUi`-Guard, sodass ein Aufrufer ohne Renderer (CLI/Batch) null
 *     Fortschritt bekam. `onDue` feuert auf einer eigenen Barriere, auch ohne `yieldToUi`.
 *  3. **Beide Barrieren starten aus EINER Uhr-Lesung, und `tick()` liest genau einmal.**
 *     Nur so feuern beide Schranken bei einem Aufrufer, der beides setzt, synchron — die
 *     Eigenschaft, die `apple-health/src/core/pipeline.ts` ausdrücklich zusagt.
 *     obsidian-transmute hatte sie beim Übernehmen verloren (zwei `now()`-Lesungen), was
 *     unter der Wanduhr ~0 ms und unsichtbar ist, unter seiner eigenen injizierten Test-Uhr
 *     aber die Barrieren dauerhaft gegeneinander verschiebt. Das Kit stellt sie wieder her.
 *  4. **Die Yield-Barriere wird VOR dem `await` gestempelt**, nicht danach: das Fenster misst
 *     ab dem Beginn der Pause. Beide Quellfassungen tun das; eine Umstellung würde die
 *     Kadenz bei langsamem `yieldToUi` still verändern.
 *  5. **Die Abbruch-Semantik bleibt beim Aufrufer.** apple-health wirft `ImportAbortedError`,
 *     obsidian-transmute setzt ein `aborted`-Feld im Ergebnis — zwei legitime, verschiedene
 *     Verträge. `tick()` liefert nur „habe ich in dieser Runde tatsächlich geyieldet?", damit
 *     der Aufrufer seine Nachprüfung genau dort anhängen kann, wo sie heute steht:
 *     `if (await pacer.tick(onDue) && signal?.aborted) throw new ImportAbortedError();`
 *  6. **Timer-frei mit Absicht.** Die Makrotask-Pause reicht der Aufrufer als `yieldToUi`
 *     herein (`() => new Promise<void>((r) => { window.setTimeout(r, 0); })`), weil
 *     `obsidianmd/prefer-window-timers` `window.setTimeout` in der obsidian-Schicht des
 *     Consumers verlangt — vendorierter Kit-Code wird von dessen Lint miterfasst. Deshalb
 *     auch `NowPort` statt `ClockPort` (`obsidian/clock`): der große Port bringt
 *     `setTimeout`/`clearTimeout` mit und lüde genau die Kopplung ein, die dieser Entwurf
 *     vermeidet. Dieselbe Bauform hat `pure/timeout.ts` mit `TimeoutTimers` schon gewählt.
 *  7. **`everyMs` ist load-bearing für die Kadenz-Tests der Konsumenten** (Default 250, in
 *     beiden Quellen identisch). `0` heißt „jede Runde" — `ts - last >= 0` ist immer wahr;
 *     apple-healths Verdrahtungstest nutzt genau das.
 *  8. **Nicht-monotone Uhr, übernommen statt repariert:** `Date.now()` kann rückwärts
 *     springen (Systemzeit-Korrektur). Dann steht das Tor still, bis die Uhr aufgeholt hat.
 *     Beide Quellfassungen verhalten sich so; ein Clamp wäre eine neue Semantik, die keine
 *     der beiden je hatte, und würde beim Vendoren still von ihnen abweichen. */

/** Uhr-Port: nur `now()`. Strukturell erfüllt von `ClockPort` (`obsidian/clock`), von
 *  `realClock`, von `Date` selbst (der Default) und von jedem Fake im Test. Bewusst ein
 *  Objekt statt einer baren `() => number`: so ist `Date` unverändert einsetzbar und ein
 *  bestehendes `vi.spyOn(Date, "now")` im Konsumenten-Test funktioniert weiter, weil
 *  `now` bei jedem Aufruf frisch auf dem Objekt nachgeschlagen wird. Eine bare Funktion
 *  (obsidian-transmutes `RunOptions.now`) wird an der Repo-Grenze mit `{ now }` adaptiert. */
export interface NowPort {
  now(): number;
}

/** Konstruktions-Optionen. Alles optional: ohne Optionen ist `tick()` ein No-op, das
 *  `false` liefert — genau der Fall „Aufrufer will weder Fortschritt noch Freigabe". */
export interface CooperativeYieldOptions {
  /** Echter Makrotask-Break, vom Aufrufer gestellt (s. Punkt 6 im Modulkopf). Läuft auf
   *  einer von `onDue` **unabhängigen** Zeitschranke. Fehlt er, wird nie geyieldet und
   *  `tick()` liefert immer `false` — Fortschritt läuft trotzdem. */
  yieldToUi?: () => Promise<void>;
  /** Gemeinsame Schrittweite **beider** Schranken in Millisekunden. Default 250 (~4 Meldungen
   *  pro Sekunde). `0` = jede Runde. Nicht getrennt parametrisierbar: beide Quellfassungen
   *  teilen sich eine Schrittweite, und die Synchronität der Schranken (Punkt 3) hängt daran. */
  everyMs?: number;
  /** Uhr. Default `Date`, also das heutige Verhalten von `apple-health`. */
  clock?: NowPort;
}

/** Das Zeittor. Zustandsbehaftet (zwei Barrieren) — pro Schleifenlauf eines anlegen, nicht
 *  über mehrere Läufe wiederverwenden. */
export interface CooperativeYield {
  /** Ans **Ende jeder** Schleifeniteration, in **jedem** Ausgang (Punkt 1 im Modulkopf).
   *
   *  `onDue` wird **pro Runde** übergeben, nicht bei der Konstruktion: der
   *  Fortschritts-Payload hängt an Schleifenvariablen (obsidian-transmute meldet das je
   *  Iteration gebundene `path`). Der Callback ist nullstellig — jedes Repo schließt über
   *  seine eigenen Variablen und behält seine eigene Payload-Form.
   *
   *  Die Fortschritts-Barriere rückt nur vor, wenn `onDue` gesetzt ist. Ob der Aufrufer
   *  `undefined` übergibt oder eine Hülle wie `() => onProgress?.(x)`, ist deshalb
   *  beobachtungsgleich, solange sein Guard schleifeninvariant ist (beide Konsumenten
   *  binden `onProgress` einmal aus den Optionen).
   *
   *  @returns `true`, wenn in dieser Runde tatsächlich `yieldToUi` awaited wurde — der
   *  Anker für eine Abbruch-Nachprüfung nach der Pause. `false` sonst, insbesondere immer,
   *  wenn kein `yieldToUi` gesetzt ist. Wer die Nachprüfung nicht braucht, ignoriert ihn. */
  tick(onDue?: () => void): Promise<boolean>;
}

/** Legt ein Zeittor an und liest die Uhr **einmal** als gemeinsamen Startpunkt beider
 *  Barrieren (Punkt 3 im Modulkopf). */
export function createCooperativeYield(
  opts: CooperativeYieldOptions = {},
): CooperativeYield {
  const { yieldToUi, everyMs = 250, clock = Date } = opts;

  // EINE Lesung für beide Barrieren — die Synchronitäts-Zusage aus apple-health.
  const start = clock.now();
  let lastDue = start;
  let lastYield = start;

  return {
    async tick(onDue?: () => void): Promise<boolean> {
      // EINE Lesung pro Runde: zwei Lesungen ließen die Schranken auseinanderlaufen.
      const ts = clock.now();

      if (onDue !== undefined && ts - lastDue >= everyMs) {
        lastDue = ts;
        onDue();
      }

      if (yieldToUi !== undefined && ts - lastYield >= everyMs) {
        // Stempel VOR dem await: das Fenster misst ab Beginn der Pause (Punkt 4).
        lastYield = ts;
        await yieldToUi();
        return true;
      }

      return false;
    },
  };
}
