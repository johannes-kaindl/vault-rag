/** Normalisiert eine Endpoint-Eingabe: trailing Slashes + ein trailing `/v1` strippen.
 *  Die Clients hängen `/v1/...` selbst an — enthielte der konfigurierte Endpoint bereits
 *  ein `/v1`, entstünde `…/v1/v1/...` (manche Server, z.B. LM Studio, antworten darauf mit
 *  HTTP 200 + Fehler-Body statt einem echten Fehler → still falsche/leere Ergebnisse).
 *  So funktioniert sowohl `http://host:1234` als auch `http://host:1234/v1`. */
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/+$/, "");
}
