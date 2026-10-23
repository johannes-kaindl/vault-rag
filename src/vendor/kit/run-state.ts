// vendored from code-kit@0.34.0, src/ts/pure/run-state.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Zustandsautomat für abbrechbare Langläufer (Import, Vault-Umschreibung, Export, Download):
 *  eine diskriminierte Union `idle | running | done | aborted | failed` plus sechs **pure,
 *  totale** Übergänge. Jeder Übergang nimmt den vorigen Zustand und gibt den nächsten zurück;
 *  ist er nicht anwendbar, kommt `prev` **identisch** zurück (nicht als Kopie) — vier Tests
 *  über drei Quell-Repos nageln das mit `toBe` fest, und Renderer, die auf Referenzgleichheit
 *  prüfen, hängen daran.
 *
 *  Kanonische Quelle: `apple-health/src/core/import-state.ts` (2026-07-20). Von
 *  obsidian-transmute (`src/core/vault/state.ts`, 2026-08-14) und audio-interface
 *  (`src/core/run-state.ts`, 2026-08-15) mit Herkunftsstempel als *Muster* übernommen —
 *  nicht byte-identisch kopiert, sondern dreimal nachgebaut. Beim Heben ins Kit (2026-08-19)
 *  waren die fünf Varianten, ihre Reihenfolge und das `message: string` im Fehlerfall in
 *  allen dreien deckungsgleich; auseinandergelaufen waren nur die drei Punkte unten.
 *
 *  ── Die zwei tragenden Regeln (in allen drei Fassungen kommentiert, nirgends vollständig
 *     implementiert) ──────────────────────────────────────────────────────────────────────
 *  **Regel 1 — Abbruch überlebt Folgefehler.** Abbrechen reißt den Lauf mitten heraus und
 *  erzeugt fast immer noch einen Fehler. Der darf den Abbruch nicht überschreiben, sonst liest
 *  der Nutzer „fehlgeschlagen", wo er selbst gestoppt hat. Hier subsumiert von der Invariante
 *  unten.
 *  **Regel 2 — die Schreibphase ist der Punkt ohne Wiederkehr.** Ein Abbruch mittendrin
 *  hinterlässt einen halb geschriebenen Vault bzw. eine verwaiste Datei, während die UI
 *  „abgebrochen" meldet. Welche Phasen abbrechbar sind, ist plugin-eigen → `abortableIn`.
 *
 *  ── Invariante, die drei divergente Wächter ersetzt ─────────────────────────────────────
 *  **Nur ein laufender Zustand darf den Zustand verlassen; Endzustände sind endgültig.**
 *  `progress`/`finish`/`abort`/`fail` verlangen alle `status === "running"`. Das ist die
 *  transmute-Fassung (`state.ts:31`), nicht die Mehrheit: apple-health (`:31`) und
 *  audio-interface (`:39`) wächteln `finish` nur gegen `aborted` und erzeugen aus `idle`
 *  einen `done`-Zustand aus dem Nichts; und **alle drei** lassen `fail(done, msg)` ein
 *  fertiges Ergebnis mit `failed` überschreiben — die Symmetrie, die für `aborted` in drei
 *  Kommentarblöcken begründet wird, fehlt für `done` überall. Die strengere Fassung schließt
 *  beide Löcher und subsumiert Regel 1 vollständig. Geprüft: alle 22 heutigen Zusicherungen
 *  der drei Quell-Testdateien bleiben grün, und keine heutige Aufrufstelle ruft
 *  `finish`/`fail` aus einem nicht-laufenden Zustand (apple-health import-controller.ts:82/88,
 *  audio-interface exporter.ts:66/79/96 + main.ts:190/193, transmute view.ts:544/601/608).
 *
 *  ── Beim Übernehmen zu beachten ────────────────────────────────────────────────────────
 *  ⚠️ **Der Diskriminator heißt `status`.** audio-interface nannte ihn `kind`; der Rename ist
 *  Konsumenten-Arbeit (gezählt: 4 Stellen in `src`, 21 in Tests) und muss **gezielt**
 *  passieren — `status-bar.ts` trägt daneben ein `speaker.kind` eines anderen Typs, ein
 *  pauschales sed wäre falsch. Ein vierter Typparameter für den Tag-Namen wurde verworfen:
 *  er kostet jeden künftigen Leser Kopfsteuer, nur um eine Namens-Inkonsistenz zu erhalten.
 *
 *  ⚠️ **`abort()` respektiert `abortableIn` — nicht nur `canAbort()`.** Regel 2 lag in den
 *  drei Fassungen an drei verschiedenen Orten: im Übergang (audio-interface), nur im Renderer
 *  (transmute, strukturell abgesichert über einen genullten AbortController), gar nicht
 *  (apple-health, dort zweimal komplementär in die UI/Controller geschrieben). Hier sind
 *  UI-Guard und Übergangs-Guard **dasselbe Prädikat**. Für apple-health ist das eine echte
 *  Verhaltensänderung — `abort(running/writing)` liefert künftig `running/writing` statt
 *  `aborted` —, die das Modul mit seinen eigenen Aufrufern in Übereinstimmung bringt.
 *
 *  ⚠️ **`onPhaseChange` feuert nur, wenn die Phase sich wirklich ändert** (`patch.phase !==
 *  prev.phase`), nicht bei jedem `progress` mit gesetzter Phase. Das ist load-bearing:
 *  apple-health ruft seinen Phasenwechsel auf **jedem** Fortschritts-Tick mit derselben
 *  Phase auf (`import-controller.ts:60`) — mit der naiven Semantik würde ein dort später
 *  gesetztes `onPhaseChange` den Record-Zähler bei jedem Tick auf 0 zurücksetzen.
 *
 *  ⚠️ **Die Nutzlast wird intersektiert, nicht verschachtelt** (`& Running` statt
 *  `payload: Running`). Nur so bleiben die heutigen Lesestellen wörtlich stehen:
 *  `state.fileName`, `state.done`, `run.total`, `dl.message`. TS narrowt die Union über
 *  `status` auch als Intersektion korrekt — innerhalb der Fabrik wie beim konkret
 *  instanziierten Konsumenten.
 *
 *  Bewusst **nicht** ins Kit gezogen: die repo-eigenen Arities (`progressed(prev, records)`,
 *  `runProgressed(prev, done, path)`, `progress(s, phase, done, total)`). Das Kit hat EIN
 *  `progress(prev, patch)`; die alten Namen und Arities bleiben im dünnen Adapter, der die
 *  heutige Datei ersetzt — deshalb ändert sich keine einzige Aufrufstelle. */

/** Der Lauf-Zustand. `Running`/`Done` werden **flach in die jeweilige Variante
 *  intersektiert**, nicht unter einem `payload`-Feld verschachtelt — `s.done` statt
 *  `s.payload.done`.
 *
 *  @typeParam Phase   plugin-eigene Phasen-Union, z. B. `"reading" | "writing"`.
 *  @typeParam Running Nutzlast **während** des Laufs (Zähler, Dateiname, aktueller Pfad).
 *  @typeParam Done    Nutzlast des **Ergebnisses** (geschriebene Dateien, Treffer, Pfad). */
export type RunState<Phase extends string, Running extends object = object, Done extends object = object> =
  | { status: "idle" }
  | ({ status: "running"; phase: Phase } & Running)
  | ({ status: "done" } & Done)
  | { status: "aborted" }
  | { status: "failed"; message: string };

/** Die beiden Stellen, an denen sich die drei Quell-Fassungen sachlich unterschieden.
 *  Beides ist optional; ohne Konfiguration ist jede Phase abbrechbar und ein Phasenwechsel
 *  lässt die Nutzlast unangetastet. */
export interface RunStateConfig<Phase extends string, Running extends object> {
  /** Regel 2: welche Phasen dürfen abgebrochen werden. Default: alle.
   *  Gilt für `abort()` **und** `canAbort()` — der UI-Guard und der Übergangs-Guard sind
   *  per Konstruktion dasselbe Prädikat, damit die Regel nicht zweimal geschrieben wird.
   *  Beispiele: apple-health `(p) => p !== "writing"`, transmute
   *  `(p) => p === "reading" || p === "matching"`. */
  abortableIn?: (phase: Phase) => boolean;
  /** Was ein **echter** Phasenwechsel an der Nutzlast zurücksetzt. Default: nichts.
   *  Bekommt den laufenden Zustand (er ist strukturell die Nutzlast) und die neue Phase,
   *  gibt die zurückzusetzenden Felder. Wird **nur** aufgerufen, wenn `patch.phase` gesetzt
   *  ist **und** sich von `prev.phase` unterscheidet.
   *  Das Rückgabe-Patch wird **vor** dem übrigen Patch angewandt — ein explizit mitgegebener
   *  Wert schlägt den Reset. Beispiel transmute: `() => ({ done: 0, path: "" })`. */
  onPhaseChange?: (payload: Running, next: Phase) => Partial<Running>;
}

/** Die acht Operationen, die eine Fabrik-Instanz bereitstellt. Alle Übergänge sind pur und
 *  total: nicht anwendbar ⇒ `prev` kommt **identisch** zurück. */
export interface RunStateOps<Phase extends string, Running extends object, Done extends object> {
  /** Der Ruhezustand als **Singleton** — Identität ist Teil des Vertrags (`toBe(IDLE)`).
   *  Jeder `makeRunState`-Aufruf erzeugt genau einen; ein Modul exportiert ihn weiter,
   *  statt `{ status: "idle" }` neu zu bauen. */
  readonly IDLE: RunState<Phase, Running, Done>;
  /** Betritt den Lauf. **Bewusst ungewächtelt** — der Einstieg darf aus jedem Zustand
   *  erfolgen (ein zweiter Import nach einem Fehler startet neu). Wer „läuft schon" verbieten
   *  will, fragt vorher `isBusy()` (so macht es audio-interface main.ts:171). */
  begin(phase: Phase, payload: Running): RunState<Phase, Running, Done>;
  /** Aktualisiert Nutzlast und/oder Phase — **nur im Lauf**, sonst kommt `prev` identisch
   *  zurück. `patch.phase` wechselt die Phase; ein `phase: undefined` im Patch bedeutet
   *  „unverändert", nicht „lösche die Phase". Löst bei echtem Wechsel `onPhaseChange` aus. */
  progress(prev: RunState<Phase, Running, Done>, patch: Partial<Running> & { phase?: Phase }): RunState<Phase, Running, Done>;
  /** Beendet mit Ergebnis. Nur aus dem Lauf heraus — ein `done` aus `idle`, `aborted` oder
   *  einem bereits fertigen Zustand entsteht nicht. */
  finish(prev: RunState<Phase, Running, Done>, result: Done): RunState<Phase, Running, Done>;
  /** Bricht ab, wenn `canAbort(prev)` — sonst kommt `prev` identisch zurück. Damit ist der
   *  verweigerte Abbruch in der Schreibphase ein No-op, kein Zustandswechsel. */
  abort(prev: RunState<Phase, Running, Done>): RunState<Phase, Running, Done>;
  /** Meldet einen Fehler. Nur aus dem Lauf heraus — deshalb überschreibt ein Folgefehler
   *  weder einen Abbruch (Regel 1) noch ein fertiges Ergebnis. */
  fail(prev: RunState<Phase, Running, Done>, message: string): RunState<Phase, Running, Done>;
  /** Prädikat für den Abbrechen-Knopf: läuft der Lauf **und** ist die Phase abbrechbar.
   *  Dasselbe Prädikat, das `abort()` benutzt — die UI kann nicht anders urteilen als der
   *  Automat. */
  canAbort(state: RunState<Phase, Running, Done>): boolean;
  /** Läuft gerade ein Lauf? Für „nicht nochmal starten"-Guards und Knopf-Zustände. */
  isBusy(state: RunState<Phase, Running, Done>): boolean;
}

/** Baut einen Zustandsautomaten für einen abbrechbaren Langläufer.
 *
 *  Fabrik statt freier Funktionen, weil `abortableIn` und `onPhaseChange` sonst an jede
 *  Aufrufstelle mitgereicht werden müssten; so bindet das Plugin sie einmal.
 *
 *  @example
 *  ```ts
 *  type Phase = "reading" | "matching" | "writing" | "restoring";
 *  const run = makeRunState<Phase, { done: number; total: number; path: string },
 *                                  { files: number; hits: number }>({
 *    abortableIn: (p) => p === "reading" || p === "matching",
 *    onPhaseChange: () => ({ done: 0, path: "" }),
 *  });
 *  let s = run.begin("reading", { done: 0, total: 412, path: "" });
 *  s = run.progress(s, { done: 17, path: "a.md" });
 *  s = run.progress(s, { phase: "writing" });   // → done: 0, path: "" (onPhaseChange)
 *  run.canAbort(s);                              // → false (Punkt ohne Wiederkehr)
 *  s = run.finish(s, { files: 10, hits: 40 });
 *  ``` */
export function makeRunState<Phase extends string, Running extends object = object, Done extends object = object>(
  cfg: RunStateConfig<Phase, Running> = {},
): RunStateOps<Phase, Running, Done> {
  type S = RunState<Phase, Running, Done>;

  const IDLE: S = { status: "idle" };

  function canAbort(state: S): boolean {
    if (state.status !== "running") return false;
    return cfg.abortableIn === undefined || cfg.abortableIn(state.phase);
  }

  return {
    IDLE,

    begin(phase: Phase, payload: Running): S {
      // `status`/`phase` zuletzt: eine Nutzlast, die zufällig so heißende Felder trägt,
      // darf den Diskriminator nicht überschreiben.
      return { ...payload, status: "running", phase };
    },

    progress(prev: S, patch: Partial<Running> & { phase?: Phase }): S {
      if (prev.status !== "running") return prev;
      const next = patch.phase ?? prev.phase;
      // Nur ein ECHTER Wechsel setzt zurück — apple-health ruft den Phasenwechsel auf
      // jedem Fortschritts-Tick mit derselben Phase auf.
      const reset = next !== prev.phase && cfg.onPhaseChange !== undefined
        ? cfg.onPhaseChange(prev, next)
        : undefined;
      return { ...prev, ...reset, ...patch, status: "running", phase: next };
    },

    finish(prev: S, result: Done): S {
      if (prev.status !== "running") return prev;
      return { ...result, status: "done" };
    },

    abort(prev: S): S {
      return canAbort(prev) ? { status: "aborted" } : prev;
    },

    fail(prev: S, message: string): S {
      if (prev.status !== "running") return prev;
      return { status: "failed", message };
    },

    canAbort,

    isBusy(state: S): boolean {
      return state.status === "running";
    },
  };
}
