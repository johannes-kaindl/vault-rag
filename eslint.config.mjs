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
  // http_server.ts importiert node:http statisch. Das landet in esbuilds __esm()-Lazy-Wrapper
  // (verifiziert: `require("node:http")` innerhalb `init_http_server`), läuft also erst beim
  // `await import("./mcp/http_server")` hinter dem Platform.isMobile-Return in main.ts — nie auf
  // Mobile. no-nodejs-modules kann diese strukturelle Gating nicht statisch sehen (der Guard
  // liegt im Aufrufer) und ist deshalb NUR für diese Datei aus; die Mobile-Sicherheit ist über
  // main.ts + den throw in startMcpServer garantiert, nicht über die Lint-Regel. Der statische
  // Import (statt require) hält den Store-Scan sauber — s. Kommentar in http_server.ts.
  // main.ts steht hier bewusst NICHT: node:fs/node:path sind dort restlos entfallen.
  {
    files: ["src/mcp/http_server.ts"],
    rules: { "obsidianmd/no-nodejs-modules": "off" },
  },
);
