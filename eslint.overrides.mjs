// Repo-eigene ESLint-Abweichungen — der EINZIGE Ort dafuer. Der Kern
// (eslint.config.mjs) ist template-verwaltet, Inline-disables blockt das Lint-Gate.
// Jeder Override braucht eine Begruendung im Kommentar.
//
// Zwei Klassen, zwei Preise (Details: _docs/docs/obsidian-plugin-publishing.md):
// - Kosmetik-/Benennungsregeln (z. B. ui/sentence-case bei Eigennamen/API-Namen):
//   Override ist die richtige Antwort und kostet nichts — der Scanner hat keinen
//   Mangel gefunden, sondern eine Konvention falsch angelegt.
// - Faehigkeitsregeln (z. B. settings-tab/prefer-setting-definitions): der Scanner
//   bewertet den Mangel, nicht die Begruendung — ein Override hier ist gestundete
//   Schuld und kostet die Store-Wertung ("Satisfactory" statt "Passed").
//   Marker fuer solche Faelle: `// STORE-SCHULD:` + wo die Abloesung geplant ist.
export default [
  {
    // Type-aware Linting braucht das Build-tsconfig des Repos. Achtung Falle
    // (json_viewer 1.9.0): ein obsidian→Mock-paths-Alias im referenzierten tsconfig
    // laesst die type-aware Regeln auf einen losen Mock aufloesen → no-unsafe-*-Kaskade.
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // obsidianmd/no-nodejs-modules ist auf severity "warning" in recommended konfiguriert.
    // Ein ungeguardeter Top-Level-import "node:fs" wuerde zur Laufzeit auf Obsidian Mobile
    // fehlschlagen — dieser Build-Fehler muss laut werden, nicht nur warnen.
    rules: {
      "obsidianmd/no-nodejs-modules": "error",
    },
  },
  {
    // Deutsche UI: Substantive werden grossgeschrieben. Die Regel erwartet englische
    // sentence-case ("Verwandte notizen") und ist hier sprachlich falsch — der offizielle
    // Obsidian-Review flaggt sie ebenfalls nicht.
    rules: {
      "obsidianmd/ui/sentence-case": "off",
    },
  },
  // In-Plugin MCP-HTTP-Server: nutzt node:-Builtins (desktop-only, lazy require() hinter
  // Platform.isDesktop-Guard) sowie das Node-Global Buffer beim Body-Parsing.
  {
    files: ["src/mcp/http_server.ts"],
    languageOptions: { globals: { Buffer: "readonly" } },
  },
  // Kein node:-Override mehr: http_server.ts laedt node:http ueber einen `Platform.isDesktop`-
  // guarded dynamic import (s. importNodeHttp dort), den obsidianmd/no-nodejs-modules AKZEPTIERT.
  // node:fs/node:path sind aus main.ts restlos entfallen. Der lokale Lint ist damit deckungs-
  // gleich mit dem Store-Scan (beide Regeln scharf) — kein Override kaschiert etwas.
];
