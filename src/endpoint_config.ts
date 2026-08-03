/** Obsidian-freie Wahrheit für Endpunkt-Einträge: Struktur, Auth-Header, Modellwahl.
 *  (Migration und Listen-Bearbeitung kommen in Task 7 dazu.) */

export interface EndpointConfig {
  url: string;
  /** Leer/fehlend = kein Authorization-Header (lokaler Server). */
  apiKey?: string;
  /** Leer/fehlend = das globale Modell gilt. */
  model?: string;
}

/** Auth-Header für einen Endpunkt — die EINZIGE Stelle, an der ein Bearer gebaut wird. */
export function authHeaders(apiKey?: string): Record<string, string> {
  const k = apiKey?.trim();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

/** Modell-Override des Endpunkts, sonst das globale Modell. */
export function effectiveModel(cfg: EndpointConfig, globalModel: string): string {
  const m = cfg.model?.trim();
  return m ? m : globalModel;
}
