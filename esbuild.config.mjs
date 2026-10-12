import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { nodeBuiltinRequire } from "./scripts/vendor/node-builtin-require.mjs";
// Node-builtins in beiden Formen abdecken (`http` UND `node:http`) — der eingebündelte
// MCP-Server importiert die `node:`-präfixierte Form, die muss explizit external sein.
const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];
const prod = process.argv[2] === "production";
const common = { bundle: true, sourcemap: prod ? false : "inline", logLevel: "info" };

// http_server.ts lädt node:http über einen `Platform.isDesktop`-guarded `await import()` —
// die einzige Source-Form, die BEIDE obsidianmd-Store-Regeln besteht (no-nodejs-modules +
// no-require-imports). esbuild ließe ein dynamic `import("node:http")` aber UNtransformiert im
// Bundle, und Electron löst es dann als Netzwerk-Fetch auf; `nodeBuiltinRequire` (Kit-Baustein,
// vendort nach scripts/vendor/) schreibt es auf ein CJS-Shim mit `require()` um.

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
