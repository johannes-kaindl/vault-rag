/** Obsidian-freie Wahrheit für Endpunkt-Einträge: Struktur, Auth-Header, Modellwahl,
 *  Migration alter String-Listen und Listen-Bearbeitung. */

import { t } from "./vendor/kit/i18n";
import { validateEndpointInput } from "./vendor/kit/endpoint_diagnostics";
import type { EndpointStatus, EndpointWarning } from "./vendor/kit/endpoint_diagnostics";

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

/** Modell für EINE Chat-Anfrage an den gerade aktiven Endpunkt. Vorrang, absteigend:
 *  Zeilen-Override des aktiven Endpunkts → feature-eigenes Modell (z. B. `smartApplyModel`)
 *  → globales Chat-Modell.
 *
 *  Warum das Override auch das feature-eigene Modell schlägt: ein Modellname ist nur bei dem
 *  Anbieter gültig, von dessen Liste er stammt. Fällt die Kette auf einen gehosteten Anbieter
 *  zurück, wäre ein lokal gewählter Name dort schlicht unbekannt (HTTP 400) — das Override ist
 *  die einzige Angabe, die zum aktiven Endpunkt gehört. */
export function chatRequestModel(
  active: EndpointConfig,
  featureModel: string | undefined,
  globalModel: string,
): string {
  return effectiveModel(active, featureModel?.trim() || globalModel);
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

/** Neue Liste mit dem Eintrag an `index` an der Spitze — die Liste IST die Priorität
 *  (`resolveAndReconnect*` nimmt den ersten erreichbaren), also ist Umsortieren die
 *  einzige Wahrheit darüber, welcher Endpunkt bevorzugt wird. Index 0 oder außerhalb:
 *  unveränderte Kopie, kein Fehler — der Aufrufer muss nicht vorher prüfen. */
export function moveEndpointToFront(eps: EndpointConfig[], index: number): EndpointConfig[] {
  if (index <= 0 || index >= eps.length) return [...eps];
  const next = [...eps];
  const [moved] = next.splice(index, 1);
  next.unshift(moved);
  return next;
}

/** Welche Rolle ein Endpunkt in der Liste gerade spielt. Reine Ableitung — kein eigener
 *  Zustand, keine Resolver-Änderung: die Einstellungs-UI kennt alle vier Zutaten bereits. */
export type EndpointRole =
  | { kind: "active" }
  | { kind: "standby"; position: number }   // 1-basiert, wie angezeigt
  | { kind: "unreachable" }
  | { kind: "skipped-model" };

/** Reihenfolge der Prüfung ist bedeutungstragend: „aktiv" schlägt alles; danach gewinnt der
 *  offensichtlichere Grund (nicht erreichbar) vor dem subtileren (Modell passt nicht).
 *  `modelFits` ist für Chat-Listen immer true — dort hängt kein Index am Modell. */
export function endpointRole(input: {
  isActive: boolean;
  reachable: boolean;
  modelFits: boolean;
  position: number;
}): EndpointRole {
  if (input.isActive) return { kind: "active" };
  if (!input.reachable) return { kind: "unreachable" };
  if (!input.modelFits) return { kind: "skipped-model" };
  return { kind: "standby", position: input.position };
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
