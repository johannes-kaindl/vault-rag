export type TabId = "related" | "search" | "chat" | "smart-apply";

/** Ein Panel im Vault-Retrieval-Hub. Kein ItemView — bekommt seinen Container injiziert,
 *  bleibt gemountet (State-Persistenz), wird nur per display:none aus-/eingeblendet. */
export interface HubPanel {
  readonly id: TabId;
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
  /** Cleanup: Timer/Intervalle/Streams abbrechen. */
  destroy(): void;
}
