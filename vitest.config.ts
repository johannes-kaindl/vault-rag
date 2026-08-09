import { defineConfig, configDefaults } from "vitest/config";
import path from "path";
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    // Locale für Tests pinnen (de-DE-Tausendertrennzeichen in index_delta.test.ts).
    // Gemessen: mit dem Default-Pool ("threads", worker_threads) liest Node/ICU die
    // Default-Locale beim Prozessstart des Vitest-CLI-Hauptprozesses; ein späteres
    // process.env-Update (egal ob via `env` hier oder ein setupFiles-Modul) ändert
    // Intl.NumberFormat().resolvedOptions().locale danach nicht mehr — die Prüfung bliebe
    // vom Host abhängig. `pool: "forks"` spawnt echte Kindprozesse, die LC_ALL/LANG beim
    // eigenen Start lesen — dort verfängt das Pinnen nachweislich, host-unabhängig
    // (geprüft u.a. mit LC_ALL=C und einer leeren env). Per `poolMatchGlobs` nur für
    // `tests/index_delta.test.ts` erzwungen — die restlichen 60 Testdateien brauchen keine
    // gepinnte Locale und behalten das Default-Isolationsmodell (threads); ein globaler
    // Pool-Wechsel wäre breiter als das Problem. `poolMatchGlobs` matcht in vitest 1.6
    // gegen den absoluten Dateipfad, ohne ihn relativ zu `root` aufzulösen — ein relativer
    // Glob wie "tests/index_delta.test.ts" oder "**/index_delta.test.ts" trifft daher NIE
    // (mit micromatch direkt gegen dieses Verhalten verifiziert); der Glob muss deshalb
    // selbst absolut sein, hier portabel über `path.resolve(__dirname, …)` gebaut statt
    // hart codiert. Achtung bei einem künftigen vitest-Major-Update: `poolMatchGlobs`
    // entfällt ab vitest 2 zugunsten von projekt-/workspace-basierter Pool-Konfiguration —
    // dieser Override muss beim Upgrade migriert werden, sonst verstummt die
    // Locale-Bindung lautlos und die Assertion in `tests/index_delta.test.ts` wird wieder
    // tautologisch, ohne dass ein Test rot wird.
    poolMatchGlobs: [[path.resolve(__dirname, "tests/index_delta.test.ts"), "forks"]],
    env: { TZ: "Europe/Berlin", LC_ALL: "de-DE", LANG: "de-DE" },
    // Default-Excludes + .claude/ (Agent-Worktrees enthalten Repo-Kopien inkl. tests/ →
    // würden sonst jede Test-Datei doppelt einsammeln).
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
  resolve: { alias: { obsidian: path.resolve(__dirname, "./tests/__mocks__/obsidian.ts") } },
});
