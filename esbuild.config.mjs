import esbuild from "esbuild";
import { builtinModules } from "node:module";
// Node-builtins in beiden Formen abdecken (`http` UND `node:http`) — der eingebündelte
// MCP-Server importiert die `node:`-präfixierte Form, die muss explizit external sein.
const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];
const prod = process.argv[2] === "production";
const common = { bundle: true, sourcemap: prod ? false : "inline", logLevel: "info" };
const plugin = await esbuild.context({
  ...common, entryPoints: ["src/main.ts"], format: "cjs",
  target: "es2020", outfile: "main.js",
  // node-builtins external: der eingebündelte MCP-Server nutzt node:http u.a. (desktop-only,
  // in Electron zur Laufzeit vorhanden). obsidian/electron bleiben ebenfalls external.
  external: ["obsidian", "electron", ...builtins],
});
if (prod) { await plugin.rebuild(); process.exit(0); }
else { await plugin.watch(); }
