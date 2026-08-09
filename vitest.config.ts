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
    // (geprüft u.a. mit LC_ALL=C und einer leeren env).
    pool: "forks",
    env: { TZ: "Europe/Berlin", LC_ALL: "de-DE", LANG: "de-DE" },
    // Default-Excludes + .claude/ (Agent-Worktrees enthalten Repo-Kopien inkl. tests/ →
    // würden sonst jede Test-Datei doppelt einsammeln).
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
  resolve: { alias: { obsidian: path.resolve(__dirname, "./tests/__mocks__/obsidian.ts") } },
});
