/** Was das Plugin von Obsidians Vault-Adapter braucht: Text lesen/schreiben (Warteschlange, Migration) zusätzlich zu
 *  dem, was der Index-Kern aus code-kit verlangt (`IndexStorage`: exists, readBinary, writeBinary, mkdir, remove).
 *  Index, Container, Chunker, Wächter, Indexer und Suche selbst liegen seit Welle 17 in code-kit
 *  (`src/vendor/kit/`: vector-index, index-container, chunker, index-guard, live-indexer, retrieval-facade). */
export type { IndexManifest, IndexStorage, VectorIndex } from "./vendor/kit/vector-index";

export interface VaultAdapter {
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}
