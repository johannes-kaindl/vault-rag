import type { VaultIndex } from "../index";

/** Die Live-Plugin-Anschlüsse, die McpTools konsumiert — vom Plugin (main.ts) injiziert.
 *  Ersetzt die alten Node-Adapter (data.json/fs/fetch): der Server läuft in Obsidian und
 *  nutzt den In-Memory-Index, den schon endpoint-aufgelösten Embedder und den VaultAdapter. */
export interface McpDeps {
  /** Der aktuell im Plugin geladene Index (oder null im Gefahrenzustand / vor dem ersten Build). */
  getIndex(): VaultIndex | null;
  /** Query-Text → Vektor im Index-Raum (ready-check + embed + toIndexVector; wirft bei offline). */
  embedQuery(text: string, dim: number): Promise<Float32Array>;
  /** Volltext einer bereits als sicher validierten, vault-relativen .md-Notiz (via VaultAdapter). */
  readNote(relPath: string): Promise<string>;
  /** Retrieval-Parameter aus den Plugin-Settings. */
  settings(): { k: number; minSim: number; exclude: string[] };
}
