export type TabId = "related" | "search" | "chat" | "smart-apply" | "reformat" | "integrator";

/** Ein Panel im Vault-Retrieval-Hub. Kein ItemView — bekommt seinen Container injiziert,
 *  bleibt gemountet (State-Persistenz), wird nur per display:none aus-/eingeblendet. */
export interface HubPanel {
  readonly id: TabId;
  /** Tab-Beschriftung. Implementierungen liefern sie als Getter (`get label()`), damit
   *  die Sprachwahl aus dem onload greift und nicht der Import-Zeitpunkt gewinnt. */
  readonly label: string;
  readonly icon: string;
  /** Einmaliger Aufbau in den übergebenen Container. Synchron; async-Init intern via void. */
  mount(container: HTMLElement): void;
  /** Tab wird sichtbar — kontextsensitive Panels holen hier ausstehende Updates nach. */
  onShow?(): void;
  /** Tab wird versteckt. */
  onHide?(): void;
  /** Aktive Notiz gewechselt (zentral vom Hub gerufen). Nur kontextsensitive Panels. */
  onFileOpen?(path: string | null): void;
  /** Der Pause-Zustand des Embeddings hat sich geändert (Spec 2026-09-17). Nur Panels, die Embeddings brauchen oder anzeigen. */
  onEmbeddingPause?(paused: boolean): void;
  /** Modell, Endpunkt oder Denkstufe haben sich außerhalb des Panels geändert (Einstellungen, Endpunkt-Manager): die Modellzeile zeichnet sich neu;
   *  `models: true` lädt zusätzlich die Liste der Modelle neu. Nur Panels mit Modellzeile. */
  refreshModelBar?(opts?: { models?: boolean }): void;
  /** Cleanup: Timer/Intervalle/Streams abbrechen. */
  destroy(): void;
}
