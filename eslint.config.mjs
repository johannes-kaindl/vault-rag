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
  // In-Plugin MCP-HTTP-Server: nutzt node:-Builtins (desktop-only, lazy require) sowie
  // die Node-Globals Buffer/require. Nur diese zwei Regeln sind hier abgeschaltet — alle
  // anderen Regeln (inkl. obsidianmd/*) gelten weiterhin für diese Dateien.
  {
    files: ["src/mcp/http_server.ts", "src/mcp/vault_read_guard.ts"],
    languageOptions: { globals: { Buffer: "readonly", require: "readonly" } },
    rules: { "import/no-nodejs-modules": "off" },
  },
);
