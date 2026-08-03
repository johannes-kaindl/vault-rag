import { VaultAdapter, VaultIndex, IndexManifest } from "./index";
import { EmbeddingClient } from "./embedder";
import { chunkMarkdown } from "./chunker";
import { toIndexVector } from "./embed_vector";
import { assertSafeToPersist, assertModelSafeToPersist, PersistReason, PersistBlockedError } from "./index_guard";
import { CONTAINER_FILE, encodeContainer, decodeContainer } from "./index_container";

const INDEX_DIM = 256;
const INT8_SCALE = 127;

/** Ergebnis eines (Delta-)Reindex-Laufs: ergänzte Notizen, chunk-lose (leer / nur
 *  Frontmatter → nie indexierbar) und fehlgeschlagene (Lese-/Embed-Fehler → beim
 *  nächsten Lauf erneut versuchen). */
export interface HealReport {
  added: number;
  skippedEmpty: string[];
  failed: string[];
}

/** Klassifikation eines Live-Updates: "empty" = Notiz ist chunk-los und wurde aus dem
 *  Index entfernt statt embeddet. */
export type UpdateResult = "indexed" | "empty";

export class LiveIndexer {
  private noteVectors = new Map<string, Float32Array>();
  private loadedManifest: IndexManifest | null = null;
  private ready = false;

  constructor(
    private adapter: VaultAdapter,
    private indexDir: string,
    private embedder: EmbeddingClient,
    private embeddingModel: string,
  ) {}

  init(index: VaultIndex): void {
    this.loadedManifest = index.manifest;
    this.noteVectors.clear();
    for (const path of index.paths) {
      const v = index.vectorFor(path);
      if (v) this.noteVectors.set(path, v.slice());
    }
    this.ready = true;
  }

  private async embedNote(content: string): Promise<Float32Array | null> {
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) return null;
    const vecs = await this.embedder.embed(chunks.map(c => c.text));
    return toIndexVector(vecs, INDEX_DIM);
  }

  async update(path: string, content: string): Promise<UpdateResult> {
    const v = await this.embedNote(content);
    if (v) { this.noteVectors.set(path, v); return "indexed"; }
    this.noteVectors.delete(path);
    return "empty";
  }

  remove(path: string): void { this.noteVectors.delete(path); }

  rename(oldPath: string, newPath: string): void {
    const v = this.noteVectors.get(oldPath);
    if (v) { this.noteVectors.set(newPath, v); this.noteVectors.delete(oldPath); }
  }

  get noteCount(): number { return this.noteVectors.size; }

  isReady(): boolean { return this.ready; }

  /** No-Index-Pfad: kein Index auf Platte → leerer Indexer darf gefahrlos aufbauen. */
  markFresh(): void { this.ready = true; }

  /** Setzt den Indexer in den Nicht-bereit-Zustand (Gefahrenzustand mid-session) → live-persist blockt. */
  markUnready(): void { this.ready = false; }

  async reindexAll(
    paths: string[],
    read: (p: string) => Promise<string>,
    onProgress?: (done: number, indexed: number, total: number) => void,
  ): Promise<HealReport> {
    const fresh = new Map<string, Float32Array>();
    const report: HealReport = { added: 0, skippedEmpty: [], failed: [] };
    for (let i = 0; i < paths.length; i++) {
      try {
        const v = await this.embedNote(await read(paths[i]));
        if (v) { fresh.set(paths[i], v); report.added++; }
        else report.skippedEmpty.push(paths[i]);
      } catch { report.failed.push(paths[i]); }
      onProgress?.(i + 1, report.added, paths.length);
    }
    this.noteVectors = fresh;
    this.ready = true;
    return report;
  }

  /**
   * Additiver Delta-Reindex: embeddet nur die fehlenden Pfade und fügt sie zur bestehenden
   * Vektor-Map hinzu (KEIN Reset). Dient als „Index vervollständigen" und als Resume für
   * abgebrochene Voll-Reindexe. Gibt die Zahl neu indizierter Notizen zurück.
   */
  async healMissing(
    missing: string[],
    read: (p: string) => Promise<string>,
    onProgress?: (done: number, indexed: number, total: number) => void,
  ): Promise<HealReport> {
    const report: HealReport = { added: 0, skippedEmpty: [], failed: [] };
    for (let i = 0; i < missing.length; i++) {
      try {
        const v = await this.embedNote(await read(missing[i]));
        if (v) { this.noteVectors.set(missing[i], v); report.added++; }
        else report.skippedEmpty.push(missing[i]);
      } catch { report.failed.push(missing[i]); }
      onProgress?.(i + 1, report.added, missing.length);
    }
    this.ready = true;
    return report;
  }

  buildIndex(): VaultIndex {
    const paths = [...this.noteVectors.keys()].sort();
    const n = paths.length;
    const f = new Float32Array(n * INDEX_DIM);
    for (let r = 0; r < n; r++) {
      const v = this.noteVectors.get(paths[r])!;
      for (let c = 0; c < INDEX_DIM; c++) f[r * INDEX_DIM + c] = v[c] ?? 0;
    }
    const manifest: IndexManifest = {
      schema_version: 1,
      embedding_model: this.embeddingModel,
      index_dim: INDEX_DIM,
      scale: INT8_SCALE,
      count: n,
      granularity: "note",
      quant: "int8",
    };
    return new VaultIndex(manifest, paths, f);
  }

  async persist(reason: PersistReason = "live"): Promise<void> {
    const nextCount = this.noteVectors.size;
    if (!this.ready && reason === "live") {
      throw new PersistBlockedError("not-ready", "Persist verweigert: Index ist nicht initialisiert (Load-Fehler) — der gute Index auf Platte bleibt erhalten.");
    }
    if (reason !== "reindex") {
      // Live-Wahrheit statt gecachtem Zustand prüfen: verhindert, dass ein veralteter
      // In-Memory-Stand (z. B. nach markFresh() während ein Sync-Download noch lief) einen
      // inzwischen echten, größeren Index auf Platte überschreibt.
      const disk = await this.readDiskState();
      if (reason === "live") {
        if (disk === null) {
          throw new PersistBlockedError("unreadable", "Persist verweigert: Der Index auf Platte ist gerade nicht lesbar (z. B. laufender Sync/Parallel-Schreibvorgang) — der gute Index bleibt unangetastet, ein erneuter Versuch folgt automatisch.");
        }
        const decision = assertSafeToPersist(disk.count, nextCount, reason);
        if (!decision.allowed) {
          throw new PersistBlockedError(decision.kind ?? "shrink", decision.message ?? "Persist verweigert.");
        }
      }
      // Modell-Guard für live UND heal, aus derselben Disk-Lesung — der Vergleich läuft gegen den
      // Container, nie gegen `loadedManifest`/`buildIndex()` (die können ein fremdes Modell tragen,
      // sobald ein blockierter Persist den In-Memory-Stand bereits umgeschrieben hat).
      // `disk === null` heißt: keine Disk-Wahrheit (korrupter Container). Für `live` ist das oben
      // schon geblockt; für `heal` bleibt es erlaubt, sonst könnte die Auto-Heal-Kaskade einen
      // defekten Container nie mehr überschreiben.
      if (disk) {
        const modelDecision = assertModelSafeToPersist(disk.model, this.embeddingModel, reason);
        if (!modelDecision.allowed) {
          throw new PersistBlockedError(modelDecision.kind ?? "model-mismatch", modelDecision.message ?? "Persist verweigert.");
        }
      }
    }
    const paths = [...this.noteVectors.keys()].sort();
    const n = paths.length;
    const i8 = new Int8Array(n * INDEX_DIM);
    for (let r = 0; r < n; r++) {
      const v = this.noteVectors.get(paths[r])!;
      for (let c = 0; c < INDEX_DIM; c++) {
        i8[r * INDEX_DIM + c] = Math.max(-INT8_SCALE, Math.min(INT8_SCALE, Math.round((v[c] ?? 0) * INT8_SCALE)));
      }
    }
    await this.adapter.mkdir(this.indexDir);
    const manifest = {
      schema_version: 1, // wird von encodeContainer auf CONTAINER_SCHEMA_VERSION gesetzt
      vault: (this.loadedManifest as { vault?: string } | null)?.vault ?? "10_Pallas",
      embedding_model: this.embeddingModel,
      source_dim: INDEX_DIM,
      index_dim: INDEX_DIM,
      granularity: "note",
      aggregation: "mean",
      quant: "int8",
      scale: INT8_SCALE,
      count: n,
      source_commit: "",
      built_at: new Date().toISOString(),
    };
    // EIN Container statt drei Dateien — Sync kann keine Generationen mehr mischen (Spec 2026-07-29).
    await this.adapter.writeBinary(`${this.indexDir}/${CONTAINER_FILE}`, encodeContainer(manifest, paths, new Uint8Array(i8.buffer)));
    this.ready = true;
  }

  /** Liest Notiz-Count UND Embedding-Modell direkt aus der Platte (nicht aus dem In-Memory-
   *  Zustand) — EINE Lesung für beide Guards.
   *  `null` = "Zustand unbekannt, sicherheitshalber blocken" (Container da, aber nicht lesbar/
   *  dekodierbar — z. B. während ein fremder Prozess/Sync ihn gerade neu schreibt, oder CRC/Magic
   *  nicht passt). Kein Container vorhanden gilt hingegen als legitim frisch (`count 0`, Modell
   *  leer = „nichts zu schützen") — `loadIndexStore` migriert Legacy-Tripel, bevor im
   *  Plugin-Lebenszyklus der erste Live-Persist laufen kann. */
  private async readDiskState(): Promise<{ count: number; model: string } | null> {
    const containerPath = `${this.indexDir}/${CONTAINER_FILE}`;
    let exists: boolean;
    try { exists = await this.adapter.exists(containerPath); } catch { return null; }
    if (!exists) return { count: 0, model: "" };
    try {
      const { manifest } = decodeContainer(await this.adapter.readBinary(containerPath));
      if (typeof manifest.count !== "number") return null;
      const model = (manifest as { embedding_model?: unknown }).embedding_model;
      return { count: manifest.count, model: typeof model === "string" ? model : "" };
    } catch { return null; }
  }
}
