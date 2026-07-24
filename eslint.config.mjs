import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  { ignores: ["main.js", "node_modules/**", "tests/**", "*.mjs", "*.config.*"] },
  {
    files: ["src/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    rules: {
      // obsidianmd/no-nodejs-modules ist auf severity "warning" in recommended konfiguriert.
      // Ein ungeguardeter Top-Level-import "node:fs" würde zur Laufzeit auf Obsidian Mobile
      // fehlschlagen — dieser Build-Fehler muss laut werden, nicht nur warnen.
      "obsidianmd/no-nodejs-modules": "error",
      // Deutsche UI: Substantive werden großgeschrieben. Die Regel erwartet englische
      // sentence-case ("Verwandte notizen") und ist hier sprachlich falsch — der offizielle
      // Obsidian-Review flaggt sie ebenfalls nicht.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
  // In-Plugin MCP-HTTP-Server: nutzt node:-Builtins (desktop-only, lazy require() hinter
  // Platform.isDesktop-Guard) sowie das Node-Global Buffer beim Body-Parsing.
  {
    files: ["src/mcp/http_server.ts"],
    languageOptions: { globals: { Buffer: "readonly" } },
  },
  // http_server.ts lädt node:http bewusst über require() hinter Platform.isDesktop — die
  // einzige Variante, die läuft: ein statischer Import verstößt gegen
  // obsidianmd/no-nodejs-modules, und `await import()` bleibt von esbuild untransformiert im
  // Bundle und schlägt in Electron als Netzwerk-Fetch fehl (2026-07-23 durchgemessen, s.
  // Kommentar in http_server.ts). Die obsidianmd-Regel verlangt genau diesen require-Guard;
  // nur @typescript-eslint/no-require-imports — eine reine TS-Stilregel — muss dafür aus.
  // main.ts steht hier bewusst NICHT mehr: node:fs/node:path sind dort restlos entfallen.
  {
    files: ["src/mcp/http_server.ts"],
    languageOptions: { globals: { require: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
