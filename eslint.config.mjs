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
  // src/mcp/ ist ein Node-Programm (MCP-Server): die Obsidian-Kontext-Verbote
  // (obsidianmd/*, fetch via no-restricted-globals, node:-Importe, console) gelten
  // dort nicht — alle Qualitätsregeln (tseslint recommendedTypeChecked + typed-Regeln
  // aus dem recommended-Set) bleiben aktiv.
  {
    files: ["src/mcp/**/*.ts"],
    // `process` kommt aus @types/node (tsconfig "types"), das die typescript-eslint-
    // Scope-Analyse (anders als "lib"-Globals wie DOM/console) nicht automatisch sieht.
    languageOptions: { globals: { process: "readonly" } },
    rules: {
      ...Object.fromEntries(Object.keys(obsidianmd.rules ?? {}).map(r => [`obsidianmd/${r}`, "off"])),
      "no-restricted-globals": "off",
      "no-restricted-imports": ["error", {
        paths: [{ name: "obsidian", message: "src/mcp ist ein headless Node-Programm — nie obsidian importieren." }],
        patterns: [{ group: ["*/http", "../http"], message: "src/mcp spricht Netz nur über node_embed (fetch), nie über obsidians requestUrl-Wrapper." }],
      }],
      "import/no-nodejs-modules": "off",
      "no-console": "off",
    },
  },
  {
    rules: {
      // Deutsche UI: Substantive werden großgeschrieben. Die Regel erwartet englische
      // sentence-case ("Verwandte notizen") und ist hier sprachlich falsch — der offizielle
      // Obsidian-Review flaggt sie ebenfalls nicht.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
  // settings.display() ist seit 1.13 deprecated, aber der Render-Pfad für minAppVersion 1.7.2 nötig.
  // (kein Inline-eslint-disable, weil der Obsidian-Review das verbietet.)
  { files: ["src/settings.ts"], rules: { "@typescript-eslint/no-deprecated": "off" } },
);
