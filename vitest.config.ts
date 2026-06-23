import { defineConfig, configDefaults } from "vitest/config";
import path from "path";
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    // Default-Excludes + .claude/ (Agent-Worktrees enthalten Repo-Kopien inkl. tests/ →
    // würden sonst jede Test-Datei doppelt einsammeln).
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
  resolve: { alias: { obsidian: path.resolve(__dirname, "./tests/__mocks__/obsidian.ts") } },
});
