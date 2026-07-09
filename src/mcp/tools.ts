import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IndexLoader, VaultIndex } from "../index";
import { Retriever, Hit } from "../retriever";
import type { EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { NodeVaultAdapter } from "./node_adapter";
import type { McpConfig } from "./config";

/** Netz-Zugriffe injiziert (Node-fetch in node_embed.ts) → Handler bleiben ohne Netz testbar. */
export interface ToolIo {
  probe(endpoint: string): Promise<EndpointStatus>;
  embedQuery(endpoint: string, model: string, text: string, dim: number): Promise<Float32Array>;
}

export interface HitList { hits: { path: string; score: number }[] }

/** Path-Guard für read_note: vault-relativ, kein Traversal, nur .md, exclude respektiert.
 *  Was vom Index ausgeschlossen ist, gibt der Server auch nicht als Volltext heraus. */
export function resolveNotePath(vaultRoot: string, rel: string, exclude: string[]): string {
  if (path.isAbsolute(rel)) throw new Error(`Nur vault-relative Pfade erlaubt: "${rel}"`);
  const norm = path.normalize(rel).split(path.sep).join("/");
  if (norm === ".." || norm.startsWith("../")) throw new Error(`Pfad verlässt den Vault: "${rel}"`);
  if (!norm.endsWith(".md")) throw new Error(`Nur Markdown-Notizen (.md) lesbar: "${rel}"`);
  const normLower = norm.toLowerCase();
  const hit = exclude.find(e => e && normLower.startsWith(e.toLowerCase()));
  if (hit) throw new Error(`Pfad liegt unter Ausschluss-Präfix "${hit}": "${rel}"`);
  return path.join(vaultRoot, norm);
}

/** Transport-freie Tool-Handler des MCP-Servers — server.ts ist nur die dünne SDK-Schale. */
export class McpTools {
  private index: VaultIndex | null = null;
  private manifestMtimeMs = 0;
  private adapter: NodeVaultAdapter;

  constructor(private cfg: McpConfig, private io: ToolIo) {
    this.adapter = new NodeVaultAdapter(cfg.vaultPath);
  }

  /** Index lazy laden + bei manifest.json-mtime-Änderung neu (das Plugin schreibt
   *  manifest.json als Letztes = fertiger Stand; derselbe Reload-Trigger wie im Plugin). */
  private async currentIndex(): Promise<VaultIndex> {
    const manifestPath = path.join(this.cfg.vaultPath, this.cfg.settings.indexDir, "manifest.json");
    let mtime: number;
    try {
      mtime = (await fs.stat(manifestPath)).mtimeMs;
    } catch {
      throw new Error(`Kein Index unter "${this.cfg.settings.indexDir}/" gefunden — Index im Plugin (neu) aufbauen.`);
    }
    if (!this.index || mtime !== this.manifestMtimeMs) {
      try {
        this.index = await new IndexLoader(this.adapter, this.cfg.settings.indexDir).load();
      } catch (e) {
        throw new Error(`Index unlesbar: ${String((e as Error).message ?? e)} — Index im Plugin (neu) aufbauen.`);
      }
      this.manifestMtimeMs = mtime;
    }
    return this.index;
  }

  private opts(k: number | undefined, minSim: number | undefined) {
    return {
      k: k ?? this.cfg.settings.k,
      minSim: minSim ?? this.cfg.settings.minSim,
      exclude: this.cfg.settings.exclude,
    };
  }

  private static toHitList(hits: Hit[]): HitList {
    return { hits: hits.map(h => ({ path: h.path, score: Math.round(h.score * 1000) / 1000 })) };
  }

  async related(a: { path: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const index = await this.currentIndex();
    if (index.rowFor(a.path) < 0) {
      throw new Error(`Notiz nicht im Index: "${a.path}" — nicht indexiert (exclude-Regel?) oder noch nicht embedded.`);
    }
    return McpTools.toHitList(new Retriever(index).related(a.path, this.opts(a.k, a.min_similarity)));
  }

  async readNote(a: { path: string }): Promise<{ path: string; content: string }> {
    const abs = resolveNotePath(this.cfg.vaultPath, a.path, this.cfg.settings.exclude);
    try {
      const [realAbs, realRoot] = await Promise.all([fs.realpath(abs), fs.realpath(this.cfg.vaultPath)]);
      if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
        throw new Error("__outside__");
      }
      return { path: a.path, content: await fs.readFile(realAbs, "utf-8") };
    } catch (e) {
      if ((e as Error).message === "__outside__") throw new Error(`Pfad verlässt den Vault (Symlink): "${a.path}"`);
      throw new Error(`Notiz nicht gefunden: "${a.path}"`);
    }
  }
}
