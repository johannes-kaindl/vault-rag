import type { EndpointConfig } from "./endpoint_config";
import { embeddingModelMatchesIndex } from "./index_guard";
import {
  resolveEndpointSource, type ApiErrorCode, type EndpointChoice, type LlmEndpointManagerApi,
} from "./vendor/kit/endpoint-source";

/** Endpunkt-Wahl ueber den LLM Endpoint Manager — obsidian-frei, damit die Regeln in Node
 *  testbar sind. Nur der Manager-Pfad: ohne Manager bleibt die lokale Liste in `main.ts` der
 *  Weg (Rueckfall), dort liegen die Listen-Regeln (Modell-Guard, Rang) seit jeher.
 *
 *  Der Kit-Vertrag gilt hier unveraendert: ist der Manager da, entscheidet er — auch ueber
 *  „kein Endpunkt". Ein Rueckfall auf die lokale Liste waere eine zweite Wahrheit. */

const CALLER = "vault-retrieval";

export interface ManagedChat {
  /** null = der Manager kennt keinen Chat-Endpunkt (`reason` sagt warum). `model` traegt die
   *  Schreibweise, die tatsaechlich gesendet wird (Alias aufgeloest). */
  config: EndpointConfig | null;
  reason?: ApiErrorCode;
  /** erreichbar — nur dann gilt der Endpunkt als aktiv markiert. */
  active: boolean;
}

/** Ein Manager-Ergebnis als Zeile im Format, das der Rest des Plugins kennt. Der Schluessel
 *  kommt aus dem Schluesselbund und bleibt im Speicher: diese Zeile wird nie gespeichert. */
function asRow(config: EndpointConfig, sentModel: string, model: string): EndpointConfig {
  const m = sentModel || model;
  return m ? { ...config, model: m } : { ...config };
}

export async function resolveManagedChat(
  manager: LlmEndpointManagerApi,
  choice: EndpointChoice,
  ping: (cfg: EndpointConfig) => Promise<boolean>,
): Promise<ManagedChat> {
  const r = await resolveEndpointSource(
    { manager, local: [], capability: "chat", choice, caller: CALLER }, ping);
  if (!r.config) return { config: null, ...(r.reason ? { reason: r.reason } : {}), active: false };
  const config = asRow(r.config, r.sentModel, r.model);
  return { config, ...(r.reason ? { reason: r.reason } : {}), active: await safePing(ping, config) };
}

export interface ManagedEmbedding {
  config: EndpointConfig | null;
  reason?: ApiErrorCode;
  /** Erreichbar UND das Modell passt zum geladenen Index — nur dann aktiv markiert. */
  active: boolean;
  /** Modell passt nicht zum Index (der Endpunkt bleibt fuer die Suche verdrahtet, der
   *  Schreibschutz haengt am Persist, nicht hier — wie bei der lokalen Liste). */
  mismatch: boolean;
  /** Der Manager lieferte keinen Modellnamen — ein Reindex wuerde `embedding_model: ""`
   *  stempeln und den Modell-Guard dauerhaft ausschalten (leer passt auf alles). */
  noModel: boolean;
}

export async function resolveManagedEmbedding(
  manager: LlmEndpointManagerApi,
  choice: EndpointChoice,
  indexModel: string | undefined,
  ping: (cfg: EndpointConfig) => Promise<boolean>,
): Promise<ManagedEmbedding> {
  const r = await resolveEndpointSource(
    { manager, local: [], capability: "embedding", choice, caller: CALLER }, ping);
  if (!r.config) return { config: null, ...(r.reason ? { reason: r.reason } : {}), active: false, mismatch: false, noModel: false };
  const config = asRow(r.config, r.sentModel, r.model);
  const model = config.model?.trim() ?? "";
  // Dieselbe Regel wie `fits` der lokalen Liste: ein leeres Modell passt nie, auch wenn
  // `embeddingModelMatchesIndex("", undefined)` wahr waere.
  const noModel = model === "";
  const mismatch = !noModel && !embeddingModelMatchesIndex(model, indexModel);
  const active = !noModel && !mismatch && await safePing(ping, config);
  return { config, ...(r.reason ? { reason: r.reason } : {}), active, mismatch, noModel };
}

async function safePing(ping: (cfg: EndpointConfig) => Promise<boolean>, cfg: EndpointConfig): Promise<boolean> {
  try { return await ping(cfg); } catch { return false; }
}
