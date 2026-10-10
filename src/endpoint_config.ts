/** Obsidian-freie Wahrheit für Endpunkt-Einträge: Struktur, Auth-Header, Modellwahl,
 *  Migration alter String-Listen und Listen-Bearbeitung. */

import type { EndpointConfig, EndpointRole } from "./vendor/kit/endpoint_config";

// Die Struktur, Migration und Listen-Bearbeitung kommen aus dem Kit. Eine eigene Kopie von
// `toConfig` verwarf `id` und `secretId` — nach dem Schlüsselbund-Umzug wäre der Verweis beim
// zweiten Start weg gewesen (MIGRATION § 0.48.0 Nachtrag 1).
export type { EndpointConfig, EndpointRole };
export {
  authHeaders,
  carriesApiKey,
  migrateEndpointList,
  applyEndpointEdit,
  moveEndpointToFront,
  endpointRole,
  rowModel,
} from "./vendor/kit/endpoint_config";
