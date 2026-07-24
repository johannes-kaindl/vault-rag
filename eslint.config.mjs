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
  // Kein node:-Override mehr: http_server.ts lädt node:http über einen `Platform.isDesktop`-
  // guarded dynamic import (s. importNodeHttp dort), den obsidianmd/no-nodejs-modules AKZEPTIERT.
  // node:fs/node:path sind aus main.ts restlos entfallen. Der lokale Lint ist damit deckungs-
  // gleich mit dem Store-Scan (beide Regeln scharf) — kein Override kaschiert etwas.
);
