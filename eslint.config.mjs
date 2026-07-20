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
  // settings.display() ist seit 1.13 deprecated, bleibt aber der Render-Pfad, bis die
  // deklarative Settings-API in einem eigenen späteren Slice kommt.
  // (kein Inline-eslint-disable, weil der Obsidian-Review das verbietet.)
  { files: ["src/settings.ts"], rules: { "@typescript-eslint/no-deprecated": "off" } },
  // In-Plugin MCP-HTTP-Server: nutzt node:-Builtins (desktop-only, lazy require() hinter
  // Platform.isDesktop-Guard) sowie das Node-Global Buffer beim Body-Parsing.
  {
    files: ["src/mcp/http_server.ts"],
    languageOptions: { globals: { Buffer: "readonly" } },
  },
  // main.ts und http_server.ts laden node:-Builtins bewusst über require(), nicht
  // await import(): Obsidian lädt main.js als CommonJS, dort löst Electron/Chromium ein
  // dynamisches import() eines node:-Builtins als Netzwerk-Fetch auf statt über den
  // require-Mechanismus — für node:-Builtins schlägt das zur Laufzeit fehl ("Failed to fetch
  // dynamically imported module: node:fs/promises" / "…: node:http"). Das ist kein Verstoß
  // gegen obsidianmd/no-nodejs-modules (die Regel ist require-guard-aware, s. isGuardedByPlatformIsDesktop
  // in noNodejsModules.js), lediglich @typescript-eslint/no-require-imports — eine reine
  // TS-Stilregel ohne Bezug zum Obsidian-Store-Review — muss dafür hier lokal aus sein.
  {
    files: ["src/main.ts", "src/mcp/http_server.ts"],
    languageOptions: { globals: { require: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
