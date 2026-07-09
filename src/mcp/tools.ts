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
}
