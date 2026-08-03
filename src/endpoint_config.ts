/** Obsidian-freie Wahrheit für Endpunkt-Einträge: Struktur, Auth-Header, Modellwahl,
 *  Migration alter String-Listen und Listen-Bearbeitung. */

export interface EndpointConfig {
  url: string;
  /** Leer/fehlend = kein Authorization-Header (lokaler Server). */
  apiKey?: string;
  /** Leer/fehlend = das globale Modell gilt. */
  model?: string;
}

/** Auth-Header für einen Endpunkt — die EINZIGE Stelle, an der ein Bearer aus einem
 *  Endpunkt-/Anbieter-Schlüssel gebaut wird. (Der plugin-eigene MCP-Server baut seinen
 *  Loopback-Token-Bearer separat — anderes Subsystem, kein Anbieter-Schlüssel.) */
export function authHeaders(apiKey?: string): Record<string, string> {
  const k = apiKey?.trim();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

/** Modell-Override des Endpunkts, sonst das globale Modell. */
export function effectiveModel(cfg: EndpointConfig, globalModel: string): string {
  const m = cfg.model?.trim();
  return m ? m : globalModel;
}

/** Verlässlicher Indikator für "geht an einen Drittanbieter": der Schlüssel, NICHT die URL —
 *  eine URL-Heuristik ("sieht das nach Cloud aus?") wäre unzuverlässig (ein eigener Server im
 *  LAN/VPN braucht ebenfalls keinen Schlüssel, ist aber kein Drittanbieter, und umgekehrt). */
export function carriesApiKey(cfg: EndpointConfig): boolean {
  return !!cfg.apiKey?.trim();
}

/** Ein Listen-Eintrag (alt: blanke URL, neu: Config) → normalisierte Config.
 *  null = unbrauchbar (leere URL) und fliegt aus der Liste. */
function toConfig(entry: string | EndpointConfig): EndpointConfig | null {
  if (typeof entry === "string") {
    const url = entry.trim();
    return url ? { url } : null;
  }
  const url = entry?.url?.trim();
  if (!url) return null;
  const key = entry.apiKey?.trim();
  const model = entry.model?.trim();
  return { url, ...(key ? { apiKey: key } : {}), ...(model ? { model } : {}) };
}

/** Migriert alte Einzel-/String-Listen-Settings auf EndpointConfig[]. Reiner Helfer. */
export function migrateEndpointList(
  single: string | undefined,
  list: (string | EndpointConfig)[] | undefined,
): EndpointConfig[] {
  if (list && list.length) {
    const out = list.map(toConfig).filter((c): c is EndpointConfig => c !== null);
    if (out.length) return out;
  }
  const s = single?.trim();
  return s ? [{ url: s }] : [];
}

/** Wendet die Bearbeitung EINES Feldes an (bei blur, nicht pro Tastendruck).
 *  Leere URL entfernt den Eintrag; ein geleerter Schlüssel/Modell entfernt nur das Feld. */
export function applyEndpointEdit(
  eps: EndpointConfig[],
  index: number,
  field: "url" | "apiKey" | "model",
  value: string,
  isAdder: boolean,
): EndpointConfig[] {
  const v = value.trim();
  const next = [...eps];
  if (isAdder) {
    if (field === "url" && v) next.push({ url: v });
    return next;
  }
  const cur = next[index];
  if (!cur) return next;
  if (field === "url") {
    if (!v) { next.splice(index, 1); return next; }
    next[index] = { ...cur, url: v };
    return next;
  }
  const updated = { ...cur };
  if (v) updated[field] = v;
  else delete updated[field];
  next[index] = updated;
  return next;
}
