// vendored from obsidian-kit@0.60.1, src/build/node-builtin-require.mjs — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/esbuild.config.mjs:16-30, 2026-10-12 (Welle 19; mailstone/esbuild.config.mjs:9-24 ist eine Kopie davon)
// Build-Baustein für `esbuild.config.mjs` eines Plugins mit `format: "cjs"` — kein Laufzeitcode, nie im Bundle.
// Konsumiert per kit-sync: `{ "dir": "scripts/vendor", "from": "src/build", "modules": ["node-builtin-require.mjs"] }`,
// danach `import { nodeBuiltinRequire } from "./scripts/vendor/node-builtin-require.mjs"` und `plugins: [nodeBuiltinRequire]`.

/** esbuild-Plugin: schreibt `import("node:x")` auf ein CJS-Shim um, das intern `require()` nutzt.
 *
 *  Warum: Ein Plugin lädt einen Node-Builtin (`node:http`, `node:fs` …) in einem `Platform.isDesktop`-geschützten
 *  `await import()` — die einzige Source-Form, die BEIDE obsidianmd-Store-Regeln besteht (`no-nodejs-modules` und
 *  `no-require-imports`). Nur lässt esbuild ein dynamisches `import("node:http")` bei `format: "cjs"` UNtransformiert im
 *  Bundle stehen, und Electron löst es dann als Netzwerk-Fetch auf („Failed to fetch dynamically imported module").
 *  `require` ist in Electrons CJS-Runtime vorhanden, nur `import()` bricht. Ergebnis: Source store-sauber (import),
 *  Bundle runtime-sicher (require).
 *
 *  Form: **vault-rag**. Nicht-dynamische `node:`-Importe gibt das Plugin selbst als `{ path, external: true }` zurück —
 *  der Konsument braucht dafür weder `external: ["node:*"]` noch eine Builtin-Liste. (mailstone gab `undefined` zurück
 *  und verließ sich auf `external` in der Konfig; das war dieselbe Logik in der Kopie, kein eigener Grund.)
 *
 *  ⚠️ Der Filter ist `^node:`. Die unpräfixierte Form (`import("child_process")`) fängt der Baustein NICHT — im Source
 *  `node:` schreiben. Das `require` IM Shim (`kind "require-call"`) und statische Importe bleiben `external`, sonst
 *  löste sich das Shim endlos selbst auf. Eine Liste von Builtins für `external:` (vault-rag führt beide Formen,
 *  `http` und `node:http`) ist Konfiguration des Plugins, nicht Teil des Bausteins. */
export const nodeBuiltinRequire = {
  name: "node-builtin-require",
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => {
      // Nur den dynamic import umleiten; das require IM Shim (kind "require-call") und
      // statische Imports bleiben normal external — verhindert eine Auflösungs-Endlosschleife.
      if (args.kind === "dynamic-import") return { path: args.path, namespace: "node-builtin" };
      return { path: args.path, external: true };
    });
    build.onLoad({ filter: /.*/, namespace: "node-builtin" }, (args) => ({
      contents: `module.exports = require(${JSON.stringify(args.path)});`,
      loader: "js",
    }));
  },
};
