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
  // Unvermeidbare Fälle (kein Inline-eslint-disable, weil der Obsidian-Review das verbietet):
  // ChatClient.stream braucht fetch (SSE-Streaming); settings.display() ist für minAppVersion 1.7.2 nötig.
  { files: ["src/chat_client.ts"], rules: { "no-restricted-globals": "off" } },
  { files: ["src/settings.ts"], rules: { "@typescript-eslint/no-deprecated": "off" } },
);
