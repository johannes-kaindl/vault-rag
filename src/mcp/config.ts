import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_SETTINGS, migrateEndpointList, type VaultRagSettings } from "../settings_core";
import { mergeSettings } from "../vendor/kit/settings";

export interface McpConfig {
  vaultPath: string;
  settings: VaultRagSettings;
}

export const DATA_JSON_REL = ".obsidian/plugins/vault-retrieval/data.json";

/** Liest die Plugin-Konfig des Vaults (data.json) und merged sie über die Defaults —
 *  dieselbe Semantik wie main.ts onload (mergeSettings + Endpoint-Listen-Migration).
 *  Fehlende/korrupte data.json → Defaults (related/read_note bleiben nutzbar).
 *  Env-Overrides als Escape-Hatch: VAULT_RAG_EMBEDDING_ENDPOINT/_EMBEDDING_MODEL/_INDEX_DIR. */
export async function loadConfig(vaultPath: string, env: Record<string, string | undefined>): Promise<McpConfig> {
  type LoadedData = Partial<VaultRagSettings> & { embeddingEndpoint?: string };
  let loaded: LoadedData | null = null;
  try {
    loaded = JSON.parse(await fs.readFile(path.join(vaultPath, DATA_JSON_REL), "utf-8")) as LoadedData;
  } catch {
    loaded = null; // fehlt oder unlesbar/korrupt → Defaults
  }
  const settings = mergeSettings(DEFAULT_SETTINGS, loaded);
  const loadedData = loaded ?? {};
  settings.embeddingEndpoints = migrateEndpointList(loadedData.embeddingEndpoint, loadedData.embeddingEndpoints);
  if (!settings.embeddingEndpoints.length) settings.embeddingEndpoints = [...DEFAULT_SETTINGS.embeddingEndpoints];
  if (env.VAULT_RAG_EMBEDDING_ENDPOINT) settings.embeddingEndpoints = [env.VAULT_RAG_EMBEDDING_ENDPOINT];
  if (env.VAULT_RAG_EMBEDDING_MODEL) settings.embeddingModel = env.VAULT_RAG_EMBEDDING_MODEL;
  if (env.VAULT_RAG_INDEX_DIR) settings.indexDir = env.VAULT_RAG_INDEX_DIR;
  return { vaultPath, settings };
}
