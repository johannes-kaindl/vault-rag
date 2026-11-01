import { describe, expect, it } from "vitest";
import { chatConnectionOptions } from "../src/connection_options";
import { DEFAULT_SETTINGS } from "../src/settings_core";

// Seit Kit 0.73.0 zeigt die Modellzeile die Stufen immer als Dropdown und ignoriert `levelPicker`. Übergibt die Verbindung `levelPicker: true`, zeichnet der Abschnitt „Anfrage“
// weiter den Schalter „Stufenwahl im Chat“, der nichts mehr bewirkt (Befund lt-w29, an vault-rag am Anfrage-Abschnitt gemessen).
describe("chatConnectionOptions", () => {
  const host = { app: {} as never, pluginId: "vault-retrieval", settings: () => structuredClone(DEFAULT_SETTINGS), save: async () => {}, lang: () => "en" };
  it("reicht levelPicker nicht durch: der Abschnitt Anfrage zeigt den wirkungslosen Schalter „Stufenwahl im Chat“ nicht", () => {
    expect(chatConnectionOptions(host as never).levelPicker).not.toBe(true);
  });
});
