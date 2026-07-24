import esbuild from "esbuild";
import { builtinModules } from "node:module";
// Node-builtins in beiden Formen abdecken (`http` UND `node:http`) — der eingebündelte
// MCP-Server importiert die `node:`-präfixierte Form, die muss explizit external sein.
const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];
const prod = process.argv[2] === "production";
const common = { bundle: true, sourcemap: prod ? false : "inline", logLevel: "info" };

// http_server.ts lädt node:http über einen `Platform.isDesktop`-guarded `await import()` —
// die einzige Source-Form, die BEIDE obsidianmd-Store-Regeln besteht (no-nodejs-modules +
// no-require-imports). Nur: esbuild ließe ein dynamic `import("node:http")` UNtransformiert im
// Bundle, und Electron löst es dann als Netzwerk-Fetch auf ("Failed to fetch dynamically
// imported module"). Dieses Plugin schreibt genau den dynamic node:-Import auf ein CJS-Shim um,
// das intern `require()` nutzt (require ist in Electrons CJS-Runtime vorhanden, nur import()
// bricht). Ergebnis: Source store-sauber (import), Bundle runtime-sicher (require).
const nodeBuiltinRequire = {
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

const plugin = await esbuild.context({
  ...common, entryPoints: ["src/main.ts"], format: "cjs",
  target: "es2020", outfile: "main.js",
  plugins: [nodeBuiltinRequire],
  // node-builtins external: der eingebündelte MCP-Server nutzt node:http u.a. (desktop-only,
  // in Electron zur Laufzeit vorhanden). obsidian/electron bleiben ebenfalls external.
  external: ["obsidian", "electron", ...builtins],
});
if (prod) { await plugin.rebuild(); process.exit(0); }
else { await plugin.watch(); }
