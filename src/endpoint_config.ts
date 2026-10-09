/** Obsidian-freie Wahrheit für Endpunkt-Einträge: Struktur, Auth-Header, Modellwahl,
 *  Migration alter String-Listen und Listen-Bearbeitung. */

import { t } from "./vendor/kit/i18n";
import type { EndpointConfig, EndpointRole } from "./vendor/kit/endpoint_config";
import { validateEndpointInput } from "./vendor/kit/endpoint_diagnostics";
import type { EndpointStatus, EndpointWarning } from "./vendor/kit/endpoint_diagnostics";

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
} from "./vendor/kit/endpoint_config";

/** Modell der Zeile, getrimmt; "" = noch nichts gewählt. Seit 0.31.0 die EINZIGE Quelle für
 *  das Modell eines Endpunkts — ein Modellname existiert nur auf dem Endpunkt, der ihn in
 *  `/v1/models` meldet (Kit-Entscheidung obsidian-kit 0.29.0; das frühere globale Feld war
 *  dieselbe Information an zwei Orten plus Vorrangregel). */
export function rowModel(cfg: EndpointConfig): string {
  return cfg.model?.trim() ?? "";
}

/** EINE Wahrheit für Zeilentext und Tooltip. */
export function describeEndpointRole(role: EndpointRole): string {
  switch (role.kind) {
    case "active": return t("endpointRole.active");
    case "standby": return t("endpointRole.standby", role.position);
    case "unreachable": return t("endpointRole.unreachable");
    case "skipped-model": return t("endpointRole.skippedModel");
  }
}

/** Anzeigetext für eine Erreichbarkeits-Diagnose des Kits.
 *
 *  Die EINZIGE Stelle, an der aus einem `EndpointStatus` Anzeigetext wird — und sie liest
 *  bewusst `kind`, nie `klartext`: Letzteres ist im Kit fest deutsch, ersteres eine
 *  sprachneutrale Union. `kind` ist erschöpfend abgedeckt, ein Kit-Update mit neuem Code
 *  bricht daher hier den Compiler statt still deutschen Text durchzulassen. */
export function endpointStatusText(status: EndpointStatus): string {
  switch (status.kind) {
    case "ok": return t("endpointStatus.ok");
    case "refused": return t("endpointStatus.refused");
    case "unknown-host": return t("endpointStatus.unknownHost");
    case "timeout": return t("endpointStatus.timeout");
    case "not-an-llm-api": return t("endpointStatus.notAnLlmApi");
    case "unauthorized": return t("endpointStatus.unauthorized");
    // Nicht klassifizierbar — die rohe Meldung ist die einzige Spur, die bleibt, und
    // gehört deshalb angehängt (untranslatierbar, kommt vom Netz-Stack).
    case "unknown": return status.raw
      ? t("endpointStatus.unknownWithRaw", status.raw)
      : t("endpointStatus.unknown");
  }
}

/** Eingabe-Hinweise zu einer Endpunkt-Adresse, fertig als Anzeigetext.
 *
 *  Die EINZIGE Stelle, die `validateEndpointInput` aufruft — bewusst gekapselt: dessen
 *  `EndpointWarning` trägt neben der Regel auch eine fest deutsche `message`, und solange
 *  ein Aufrufer das Rohobjekt in der Hand hält, kann er daran vorbeigreifen. Ein Wächter
 *  könnte das nur raten; hier gibt es schlicht nichts zu greifen. */
export function endpointInputWarnings(url: string): string[] {
  return validateEndpointInput(url).map(endpointWarningText);
}

/** Anzeigetext für einen Eingabe-Hinweis des Kits — Gegenstück zu `endpointStatusText`.
 *
 *  Anders als `EndpointStatusKind` ist `rule` im Kit ein `string`, keine Union: ein
 *  Kit-Update kann jederzeit eine neue Regel mitbringen, ohne dass es hier auffällt.
 *  Eine unbekannte Regel fällt deshalb auf den mitgelieferten Kit-Text zurück — deutsch
 *  in einer englischen Oberfläche ist hässlich, aber einen Befund zu verschlucken wäre
 *  schlimmer. Kommt eine Regel dazu, gehört sie hier ergänzt. */
export function endpointWarningText(warning: EndpointWarning): string {
  switch (warning.rule) {
    case "scheme": return t("endpointWarning.scheme");
    case "malformed": return t("endpointWarning.malformed");
    case "port": return t("endpointWarning.port");
    case "placeholder-ip": return t("endpointWarning.placeholderIp");
    default: return warning.message;
  }
}
