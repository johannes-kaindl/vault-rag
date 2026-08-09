/**
 * Pure Auswahl-Logik für Modellnamen — EINE Wahrheit für alle vier Stellen der Einstellungen
 * (Embedding-Modell, Chat-Modell, Smart-Apply-Modell, Modell-Override je Endpunkt-Zeile).
 * Obsidian-frei: entscheidet nur, WAS gezeigt wird, nie WIE. Das Zeichnen liegt im Host
 * (`renderModelPicker` in settings.ts).
 */

import { t } from "./vendor/kit/i18n";

export type ModelChoiceMode = "dropdown" | "locked" | "freetext";

export interface ModelOption {
  /** Wert, der gespeichert wird ("" = Leer-Option). */
  value: string;
  /** Beschriftung im Dropdown. */
  label: string;
}

export interface ModelChoice {
  mode: ModelChoiceMode;
  /** Bei "dropdown"/"locked" gefüllt; enthält IMMER `value` (siehe Invariante unten). */
  options: ModelOption[];
  value: string;
  /** Erklärender Text unter der Zeile; "" = keiner. */
  hint: string;
}

export interface ModelChoiceInput {
  /** Endpunkt erreichbar? Eine nicht leere `models`-Liste beweist das bereits. */
  reachable: boolean;
  /** Vom Endpunkt gemeldete Modelle; leer = keine Liste erhalten. */
  models: string[];
  /** Aktuell gespeicherter Wert ("" = nicht gesetzt). */
  current: string;
  /** Ist der leere Wert bedeutungstragend? */
  allowEmpty: boolean;
  /** Beschriftung der Leer-Option, z.B. "globales Modell". */
  emptyLabel?: string;
}

/**
 * INVARIANTE: In den Modi "dropdown" und "locked" enthält `options` immer `value`.
 * Ein <select>, dessen Wert nicht unter seinen Optionen steht, fällt still auf die erste
 * zurück — und das nächste Speichern schriebe dann diesen fremden Wert. Genau so verliert
 * man einen konfigurierten Modellnamen, ohne dass irgendetwas fehlschlägt.
 */
export function resolveModelChoice(input: ModelChoiceInput): ModelChoice {
  const current = input.current.trim();
  const emptyOption: ModelOption = { value: "", label: input.emptyLabel ?? "" };

  if (!input.reachable) {
    const options: ModelOption[] = current
      ? [{ value: current, label: current }]
      : [input.allowEmpty ? emptyOption : { value: "", label: "—" }];
    return { mode: "locked", options, value: current, hint: t("modelChoice.hintUnreachable") };
  }

  if (input.models.length === 0) {
    return { mode: "freetext", options: [], value: current, hint: t("modelChoice.hintNoList") };
  }

  const options: ModelOption[] = [];
  if (input.allowEmpty) options.push(emptyOption);
  if (current && !input.models.includes(current)) {
    // Nicht gelistet, aber gespeichert: sichtbar machen statt still verlieren.
    options.push({ value: current, label: t("modelChoice.savedLabel", current) });
  } else if (!current && !input.allowEmpty) {
    // Sicherung der Invariante: Ist der Wert leer und nicht bedeutungstragend,
    // ein <select> ohne diese Option würde still auf das erste Modell fallen.
    options.push({ value: "", label: "—" });
  }
  for (const m of input.models) options.push({ value: m, label: m });

  return { mode: "dropdown", options, value: current, hint: "" };
}
