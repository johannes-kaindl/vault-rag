import esbuild from "esbuild";
const prod = process.argv[2] === "production";
const common = { bundle: true, sourcemap: prod ? false : "inline", logLevel: "info" };
const plugin = await esbuild.context({
  ...common, entryPoints: ["src/main.ts"], format: "cjs",
  target: "es2020", external: ["obsidian", "electron"], outfile: "main.js",
});
// MCP-Server: ESM (package.json type:module), Node-Builtins bleiben external via platform:node.
// Banner-Shim, weil eingebündelte CJS-Deps unter ESM sonst an dynamischem require scheitern.
const mcp = await esbuild.context({
  ...common, entryPoints: ["src/mcp/server.ts"], format: "esm",
  platform: "node", target: "node18", outfile: "mcp-server.js",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
if (prod) { await plugin.rebuild(); await mcp.rebuild(); process.exit(0); }
else { await plugin.watch(); await mcp.watch(); }
