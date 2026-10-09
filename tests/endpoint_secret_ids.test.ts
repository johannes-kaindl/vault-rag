import { describe, it, expect } from "vitest";
import { migrateEndpointList } from "../src/endpoint_config";

// Datenverlust-Pfad (Welle 15): Nach dem Schlüsselbund-Umzug steht in data.json nur noch
// `id`/`secretId`. Verwirft das Laden diese Felder, ist der Verweis beim zweiten Start weg,
// der Schlüssel aber schon aus data.json gelöscht.
describe("migrateEndpointList behält die Schlüsselbund-Verweise", () => {
  it("reicht id und secretId durch", () => {
    const list = migrateEndpointList(undefined, [
      { url: "http://localhost:1234", id: "ep-1", secretId: "vault-retrieval-ep-ep-1", model: "m" },
    ]);
    expect(list).toEqual([
      { url: "http://localhost:1234", id: "ep-1", secretId: "vault-retrieval-ep-ep-1", model: "m" },
    ]);
  });

  it("überlebt zwei Lade-Durchläufe (zweiter Start)", () => {
    const stored = [{ url: "http://localhost:1234", id: "ep-1", secretId: "vault-retrieval-ep-ep-1" }];
    const once = migrateEndpointList(undefined, stored);
    const twice = migrateEndpointList(undefined, JSON.parse(JSON.stringify(once)));
    expect(twice[0]?.secretId).toBe("vault-retrieval-ep-ep-1");
    expect(twice[0]?.id).toBe("ep-1");
  });
});
