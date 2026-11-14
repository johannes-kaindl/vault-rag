/** Die sechs Methoden der Modellzeile, die seit Kit 0.87.0 Pflicht sind (Gruppen je Endpunkt). Ein Fake ohne Manager: `endpoints()` leer, also eine Liste ohne Gruppen. */
export const OHNE_GRUPPEN = {
  endpoints: () => [] as never[],
  activeEndpointId: () => undefined,
  modelsOf: async () => ({ models: [] as string[], reachable: false }),
  choice: () => ({}),
  setChoice: async (_c: unknown) => {},
  subscribe: (_cb: () => void) => () => {},
};
