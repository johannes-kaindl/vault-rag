import { VaultAdapter, VaultIndex, IndexManifest } from "./index";
import { EmbeddingClient } from "./embedder";
import { chunkMarkdown } from "./chunker";
import { toIndexVector } from "./embed_vector";
import { assertSafeToPersist, assertModelSafeToPersist, PersistDecision, PersistReason, PersistBlockedError } from "./index_guard";
import { CONTAINER_FILE, encodeContainer, decodeContainer, FileStamp } from "./index_container";

const INDEX_DIM = 256;
/** Notizen je Zwischenstand. 250 ist klein genug, dass ein Abbruch wenig kostet, und gross
 *  genug, dass das Schreiben des Containers (~2 MB) den Lauf nicht dominiert. */
const CHECKPOINT_EVERY = 250;
/** Chunks je Embedding-Anfrage beim Voll-Reindex. Deckungsgleich mit der internen Batchgroesse
 *  von `EmbeddingClient.embed` — die batchte schon immer zu 32, bekam aber bis 2026-09-05 nur
 *  die Chunks EINER Notiz auf einmal (typisch 1-5), lief also fast immer im Leerlauf. Am echten
 *  Endpunkt gemessen: 1 Chunk kostet 3,62 s, 32 Chunks kosten 4,68 s — der Aufruf-Overhead
 *  dominiert, nicht die Arbeit. */
const EMBED_BATCH = 32;
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
  /**
   * `[mtime, size]` der Notiz zum Zeitpunkt ihres Embeddens, je Pfad. Traegt der Waechter gegen
   * veraltete Vektoren (`findStaleVectorPaths`). Wird **parallel** zu `noteVectors` gepflegt —
   * jede Mutation dort muss hier mitziehen, sonst zeigt ein Stempel auf einen fremden Vektor.
   *
   * Bewusst KEINE Pflicht: wer ohne Stempel updatet (Aufrufer ohne `TFile`, Tests, Altpfade),
   * bekommt einen ungestempelten Eintrag — und `persist` schreibt dann fuer den GANZEN Container
   * keine Stempel. Ein teilweise gestempelter Container waere schlimmer als gar keiner: der
   * Waechter hielte die ungestempelten Zeilen fuer unauffaellig, obwohl sie ungeprueft sind.
   */
  private noteStamps = new Map<string, FileStamp>();
  private loadedManifest: IndexManifest | null = null;
  private ready = false;
  /**
   * Pfade, die WAEHREND eines laufenden `reindexAll` von einem Live-Handler beruehrt wurden
   * (update/remove/rename). `null`, solange kein Reindex laeuft.
   *
   * Warum ein Mitschrieb noetig ist: `reindexAll` arbeitet eine beim Start gesnapshottete
   * Pfadliste ab und ersetzt am Ende den ganzen Bestand. Ohne diese Liste faellt alles heraus,
   * was erst waehrend des Laufs entsteht oder sich aendert — der Index bildete dann den Vault
   * vom START ab. Entscheidung vom 2026-09-04: er bildet ihn vom ENDE ab.
   *
   * Gespeichert werden nur die PFADE, nicht die Vektoren: nachgeschlagen wird beim Anwenden in
   * `this.noteVectors`, und das ist zu jedem Zeitpunkt der aktuellste Stand. Ein Pfad, der dort
   * fehlt, war ein `remove` und wird entsprechend aus dem Ergebnis entfernt.
   *
   * ⓘ Bekannte Grenze, unveraendert gegenueber vorher: ZWEI gleichzeitig laufende `reindexAll`
   * teilen sich dieses Feld, und der zweite raeumt es im `finally` fuer beide ab. Das ist keine
   * neue Schwaeche — schon vorher gewann bei parallelen Laeufen schlicht der letzte mit seinem
   * eigenen `fresh`. Wer das schliessen will, serialisiert den Reindex (er laeuft heute nicht
   * unter `runIndexOp`), nicht dieses Feld.
   */
  private liveWaehrendReindex: Set<string> | null = null;

  constructor(
    private adapter: VaultAdapter,
    private indexDir: string,
    private embedder: EmbeddingClient,
    private embeddingModel: string,
  ) {}

  init(index: VaultIndex, stamps?: readonly FileStamp[]): void {
    this.loadedManifest = index.manifest;
    this.noteVectors.clear();
    this.noteStamps.clear();
    for (const path of index.paths) {
      const v = index.vectorFor(path);
      if (v) this.noteVectors.set(path, v.slice());
    }
    // Ohne diese Uebernahme waere der Waechter nach jedem Neustart blind: der erste
    // Live-Persist schriebe den Container stempellos zurueck.
    if (stamps && stamps.length === index.paths.length) {
      index.paths.forEach((p, i) => { if (this.noteVectors.has(p)) this.noteStamps.set(p, stamps[i]); });
    }
    this.ready = true;
  }

  private async embedNote(content: string): Promise<Float32Array | null> {
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) return null;
    const vecs = await this.embedder.embed(chunks.map(c => c.text));
    return toIndexVector(vecs, INDEX_DIM);
  }

  async update(path: string, content: string, stamp?: FileStamp): Promise<UpdateResult> {
    const v = await this.embedNote(content);
    this.merkeLiveAenderung(path);
    if (v) {
      this.noteVectors.set(path, v);
      if (stamp) this.noteStamps.set(path, stamp); else this.noteStamps.delete(path);
      return "indexed";
    }
    this.noteVectors.delete(path);
    this.noteStamps.delete(path);
    return "empty";
  }

  remove(path: string): void {
    this.merkeLiveAenderung(path);
    this.noteVectors.delete(path);
    this.noteStamps.delete(path);
  }

  rename(oldPath: string, newPath: string): void {
    this.merkeLiveAenderung(oldPath);
    this.merkeLiveAenderung(newPath);
    const v = this.noteVectors.get(oldPath);
    if (v) { this.noteVectors.set(newPath, v); this.noteVectors.delete(oldPath); }
    const st = this.noteStamps.get(oldPath);
    if (st) { this.noteStamps.set(newPath, st); this.noteStamps.delete(oldPath); }
  }

  /** Stempel in Zeilenreihenfolge — oder `undefined`, sobald auch nur eine Zeile keinen hat
   *  (Begruendung im Feld-Docblock: kein Halb-Zustand). */
  private stampsFor(paths: string[], quelle?: Map<string, FileStamp>): FileStamp[] | undefined {
    const q = quelle ?? this.noteStamps;
    const out: FileStamp[] = [];
    for (const p of paths) {
      const st = q.get(p);
      if (!st) return undefined;
      out.push(st);
    }
    return out;
  }

  /** No-op ausserhalb eines Reindex — der Normalfall kostet dann eine Nullpruefung. */
  private merkeLiveAenderung(path: string): void {
    this.liveWaehrendReindex?.add(path);
  }

  /**
   * Traegt die waehrend des Laufs live geaenderten Pfade in ein Reindex-Ergebnis nach.
   * Der Live-Stand gewinnt: er stammt aus einem `modify`-Event, das der Nutzer ausgeloest hat,
   * waehrend der Reindex-Wert aus einem Lesevorgang stammt, der vor diesem Event lag.
   *
   * ⓘ Der Grenzfall, in dem der Reindex-Lesevorgang der juengere ist (Debounce: Event um 10:03,
   * Zustellung um 10:06, Lesevorgang dazwischen um 10:05), ist bewusst nicht behandelt — beide
   * Werte stammen dann aus derselben Dateifassung, denn eine weitere Aenderung haette ein
   * weiteres Event erzeugt. Reihenfolge-Tracking waere Aufwand ohne Unterschied.
   */
  private wendeLiveAenderungenAn(
    ergebnis: Map<string, Float32Array>,
    stempel?: Map<string, FileStamp>,
  ): void {
    if (!this.liveWaehrendReindex) return;
    for (const path of this.liveWaehrendReindex) {
      const aktuell = this.noteVectors.get(path);
      if (aktuell) {
        ergebnis.set(path, aktuell);
        // Vektor und Stempel wandern IMMER zusammen — ein Stempel ohne seinen Vektor (oder
        // umgekehrt) ist genau die Fehlzuordnung, gegen die der Waechter gebaut wird.
        const st = this.noteStamps.get(path);
        if (st) stempel?.set(path, st); else stempel?.delete(path);
      } else {
        ergebnis.delete(path); // remove() oder eine leer gewordene Notiz
        stempel?.delete(path);
      }
    }
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
    stampFor?: (p: string) => FileStamp | undefined,
  ): Promise<HealReport> {
    const fresh = new Map<string, Float32Array>();
    const freshStamps = new Map<string, FileStamp>();
    const report: HealReport = { added: 0, skippedEmpty: [], failed: [] };
    // Etappen-Persist: darf NUR laufen, wenn das Modell auf der Platte zum aktuellen passt.
    // Sonst stuende zwischenzeitlich ein Container aus zwei Vektorraeumen auf der Platte — genau
    // der Schaden, den `assertModelSafeToPersist` sonst verhindert und der bei reason="reindex"
    // bewusst NICHT geprueft wird (ein Voll-Ersatz konnte bisher nicht mischen).
    const etappenErlaubt = await this.checkpointsAllowed();
    let seitLetztem = 0;
    // Ab hier zeichnen die Live-Handler ihre Pfade mit (s. Feld-Docblock).
    this.liveWaehrendReindex = new Set();
    try {
      let erledigt = 0;
      let i = 0;
      while (i < paths.length) {
        // (a) Gruppe fuellen: lesen + chunken, bis EMBED_BATCH Chunks beisammen sind. Eine
        //     einzelne Notiz darf die Grenze ueberschreiten — `embed` teilt intern weiter.
        const gruppe: { path: string; chunks: string[]; stamp: FileStamp | undefined }[] = [];
        let chunkZahl = 0;
        let ohneEmbedding = 0;  // in dieser Gruppe erledigt, aber nicht embeddet (leer/Lesefehler)
        while (i < paths.length && chunkZahl < EMBED_BATCH) {
          const p = paths[i];
          i++;
          let text: string;
          try { text = await read(p); }
          catch { report.failed.push(p); ohneEmbedding++; onProgress?.(++erledigt, report.added, paths.length); continue; }
          // Stempel NACH dem Lesen holen: waere er vorher genommen worden und die Notiz
          // aendert sich dazwischen, stuende ein zu alter Stempel auf einem neuen Vektor —
          // die Aenderung waere damit fuer immer unsichtbar.
          const stamp = stampFor?.(p);
          const chunks = chunkMarkdown(text).map(c => c.text);
          if (chunks.length === 0) {
            report.skippedEmpty.push(p); ohneEmbedding++;
            onProgress?.(++erledigt, report.added, paths.length);
            continue;
          }
          gruppe.push({ path: p, chunks, stamp });
          chunkZahl += chunks.length;
        }

        // (b) EIN Aufruf fuer die ganze Gruppe.
        if (gruppe.length > 0) {
          let vektoren: Float32Array[] | null = null;
          try { vektoren = await this.embedder.embed(gruppe.flatMap(g => g.chunks)); }
          catch { vektoren = null; }
          // ⚠️ Die Laengenpruefung ist der Sicherheitsgurt, nicht Vorsicht: die Antwort wird
          // NACH CHUNK-ZAHL auf die Notizen aufgeteilt. Liefert ein Endpunkt weniger (oder
          // mehr) Vektoren als Chunks, verschiebt sich ab dort JEDE Zuordnung um denselben
          // Betrag — genau die treppenfoermige Fehlzuordnung, die 2026-08-30 ~79 % des
          // Arbeitsvaults betraf und die CRC32 nicht sehen kann. Im Zweifel lieber langsam
          // einzeln als schnell falsch.
          if (vektoren && vektoren.length === chunkZahl) {
            let off = 0;
            for (const g of gruppe) {
              const v = toIndexVector(vektoren.slice(off, off + g.chunks.length), INDEX_DIM);
              off += g.chunks.length;
              fresh.set(g.path, v); report.added++;
              if (g.stamp) freshStamps.set(g.path, g.stamp);
              onProgress?.(++erledigt, report.added, paths.length);
            }
          } else {
            // Rueckfall Notiz fuer Notiz: eine kaputte Notiz darf die anderen der Gruppe
            // nicht mitreissen — vorher scheiterte immer nur genau die eine.
            for (const g of gruppe) {
              try {
                const einzeln = await this.embedder.embed(g.chunks);
                fresh.set(g.path, toIndexVector(einzeln, INDEX_DIM)); report.added++;
                if (g.stamp) freshStamps.set(g.path, g.stamp);
              } catch { report.failed.push(g.path); }
              onProgress?.(++erledigt, report.added, paths.length);
            }
          }
        }

        seitLetztem += gruppe.length + ohneEmbedding;
        if (etappenErlaubt && seitLetztem >= CHECKPOINT_EVERY && i < paths.length) {
          seitLetztem = 0;
          await this.persistCheckpoint(fresh, freshStamps, paths);
        }
      }
      // Vault-Stand vom ENDE: was waehrend des Laufs hereinkam, gewinnt gegen den Snapshot.
      this.wendeLiveAenderungenAn(fresh, freshStamps);
    } finally {
      this.liveWaehrendReindex = null;
    }
    this.noteVectors = fresh;
    this.noteStamps = freshStamps;
    this.ready = true;
    return report;
  }

  /**
   * Schreibt einen Zwischenstand: die bereits neu berechneten Vektoren, ergaenzt um die noch
   * nicht erreichten aus dem bisherigen Bestand. Der Container ist damit zu jedem Zeitpunkt
   * VOLLSTAENDIG — er wird nur schrittweise frischer.
   *
   * Der In-Memory-Stand (`this.noteVectors`) bleibt absichtlich unberuehrt: die Zusage
   * "waehrend eines Laufs bleibt der bisherige Index abrufbar" (eigener Test) gilt weiter, und
   * die Suche liefert waehrenddessen stabil den alten Stand statt einer wandernden Mischung.
   * Bricht der Lauf ab, ueberlebt der Fortschritt trotzdem — er steht auf der Platte und wird
   * beim naechsten Laden uebernommen.
   *
   * Ein Fehlschlag hier bricht den Lauf NICHT ab: der Zwischenstand ist eine Zugabe, nicht die
   * Zusage. Er wird gemeldet, der Lauf geht weiter.
   *
   * ⚠️ Diese Methode tauschte bis 2026-09-04 `this.noteVectors` gegen `gemischt` aus und stellte
   * den alten Stand im `finally` wieder her. Weil `persist` dazwischen awaitet und `reindexAll`
   * NICHT unter `runIndexOp` laeuft, schrieb ein Live-Update in genau diesem Fenster in eine Map,
   * die unmittelbar darauf verworfen wurde (gemessen, Loch B). Der Swap ist deshalb ersatzlos
   * entfallen: `persistVectors` bekommt die zu schreibende Map als Argument, `this.noteVectors`
   * wird nie umgehaengt — das Fenster existiert nicht mehr, statt bewacht zu werden.
   */
  private async persistCheckpoint(
    fresh: Map<string, Float32Array>,
    freshStamps: Map<string, FileStamp>,
    paths: string[],
  ): Promise<void> {
    const gemischt = new Map<string, Float32Array>();
    const gemischteStempel = new Map<string, FileStamp>();
    for (const p of paths) {
      // Vektor und Stempel IMMER aus derselben Quelle ziehen: eine bereits neu berechnete Zeile
      // mit dem Stempel ihres vorigen Embeddens zu schreiben waere exakt die Fehlzuordnung,
      // gegen die der Waechter gebaut ist — er hielte die Zeile dann fuer veraltet, obwohl sie
      // frisch ist, oder (schlimmer) fuer frisch, weil der alte Stempel zufaellig noch passt.
      const frisch = fresh.get(p);
      const v = frisch ?? this.noteVectors.get(p);
      if (!v) continue;
      gemischt.set(p, v);
      const st = frisch ? freshStamps.get(p) : this.noteStamps.get(p);
      if (st) gemischteStempel.set(p, st);
    }
    // Auch der Zwischenstand ist vollstaendig nur MIT dem, was live hereinkam: sonst fehlten die
    // neuen Notizen bis zum Lauf-Ende auf der Platte — und beim Abbruch dauerhaft.
    //
    // Nebeneffekt, der hier festgehalten gehoert, weil er einen zweiten Race entschaerft: ein
    // `handleModify` kann parallel `persist("live")` fahren, also schreiben BEIDE auf dieselbe
    // Datei. Zerreissen kann das nichts (Obsidians `writeBinary` queued intern), aber die
    // Reihenfolge ist unbestimmt. Seit der Zwischenstand die Live-Aenderungen mittraegt, ist sie
    // auch egal: schreibt der Live-Persist zuletzt, gewinnt sein Stand; schreibt der Checkpoint
    // zuletzt, enthaelt er denselben. Vorher war „Checkpoint zuletzt" ein stiller Verlust.
    this.wendeLiveAenderungenAn(gemischt, gemischteStempel);
    try {
      await this.persistVectors(gemischt, "reindex", undefined, gemischteStempel);
    } catch (e) {
      console.warn("vault-rag: Zwischenstand konnte nicht geschrieben werden - Lauf geht weiter", e);
    }
  }

  /** Etappen-Persists nur bei unveraendertem Embedding-Modell (Begruendung in reindexAll). */
  private async checkpointsAllowed(): Promise<boolean> {
    try {
      // Bewusst mit "heal" gefragt, nicht mit "reindex": fuer reindex antwortet der Guard
      // pauschal `allowed` (Voll-Ersatz darf jedes Modell stempeln) — genau die Auskunft, die
      // hier nicht taugt. "heal" stellt die Frage, um die es geht: passt das Modell auf der
      // Platte zum aktuellen? Ein leerer/fehlender Container gilt dabei als unbedenklich.
      return (await this.checkModelAgainstDisk("heal")).allowed;
    } catch {
      return false;
    }
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
    stampFor?: (p: string) => FileStamp | undefined,
  ): Promise<HealReport> {
    const report: HealReport = { added: 0, skippedEmpty: [], failed: [] };
    for (let i = 0; i < missing.length; i++) {
      try {
        const v = await this.embedNote(await read(missing[i]));
        if (v) {
          this.noteVectors.set(missing[i], v); report.added++;
          const st = stampFor?.(missing[i]);
          if (st) this.noteStamps.set(missing[i], st);
        }
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

  /**
   * @param stampModel Modell, das ins Container-Manifest geschrieben wird, wenn es NICHT das
   *   des Indexers ist. Genau ein Aufrufer braucht das: der `restore-only`-Zweig der
   *   Auto-Heal-Kaskade, dessen Vektoren vollständig aus einem Backup stammen. Der Stempel
   *   beschreibt die Herkunft der VEKTOREN; ihn auf den gerade konfigurierten Endpunkt zu
   *   setzen, entwaffnete den Modell-Guard beim nächsten Live-Persist.
   */
  async persist(reason: PersistReason = "live", stampModel?: string): Promise<void> {
    return this.persistVectors(this.noteVectors, reason, stampModel);
  }

  /**
   * Schreibt eine BELIEBIGE Vektor-Map als Container. Der Umweg ueber ein Argument statt ueber
   * `this.noteVectors` existiert wegen `persistCheckpoint`: dort ist die zu schreibende Map eine
   * andere als der In-Memory-Stand, und sie dafuer kurzzeitig ins Feld zu haengen war der Grund
   * fuer Loch B (s. dort). Wer eine Map schreiben will, die nicht der aktuelle Stand ist, nimmt
   * diese Methode — er haengt nichts um.
   */
  private async persistVectors(
    vectors: Map<string, Float32Array>,
    reason: PersistReason,
    stampModel?: string,
    stamps?: Map<string, FileStamp>,
  ): Promise<void> {
    const nextCount = vectors.size;
    if (!this.ready && reason === "live") {
      throw new PersistBlockedError("not-ready", "Persist verweigert: Index ist nicht initialisiert (Load-Fehler) — der gute Index auf Platte bleibt erhalten.");
    }
    if (reason !== "reindex") {
      // Live-Wahrheit statt gecachtem Zustand prüfen: verhindert, dass ein veralteter
      // In-Memory-Stand (z. B. nach markFresh() während ein Sync-Download noch lief) einen
      // inzwischen echten, größeren Index auf Platte überschreibt.
      const disk = await this.readDiskState();
      // `disk === null` heißt: keine Disk-Wahrheit (korrupter Container/laufender Sync). Für
      // `live` ist das ein Abbruch; für `heal` bleibt es erlaubt, sonst könnte die
      // Auto-Heal-Kaskade einen defekten Container nie mehr überschreiben.
      if (disk === null) {
        if (reason === "live") {
          throw new PersistBlockedError("unreadable", "Persist verweigert: Der Index auf Platte ist gerade nicht lesbar (z. B. laufender Sync/Parallel-Schreibvorgang) — der gute Index bleibt unangetastet, ein erneuter Versuch folgt automatisch.");
        }
      } else {
        // Beide Guards bekommen `reason` und entscheiden SELBST, für wen sie gelten — hier wird
        // die Regel „reindex/heal sind explizit gewollt" nicht noch einmal formuliert. Der
        // Vergleich läuft gegen den Container, nie gegen `loadedManifest`/`buildIndex()` (die
        // können ein fremdes Modell tragen, sobald ein blockierter Persist den In-Memory-Stand
        // bereits umgeschrieben hat).
        const decision = assertSafeToPersist(disk.count, nextCount, reason);
        if (!decision.allowed) {
          throw new PersistBlockedError(decision.kind ?? "shrink", decision.message ?? "Persist verweigert.");
        }
        const modelDecision = assertModelSafeToPersist(disk.model, this.embeddingModel, reason);
        if (!modelDecision.allowed) {
          throw new PersistBlockedError(modelDecision.kind ?? "model-mismatch", modelDecision.message ?? "Persist verweigert.");
        }
      }
    }
    const paths = [...vectors.keys()].sort();
    const n = paths.length;
    const i8 = new Int8Array(n * INDEX_DIM);
    for (let r = 0; r < n; r++) {
      const v = vectors.get(paths[r])!;
      for (let c = 0; c < INDEX_DIM; c++) {
        i8[r * INDEX_DIM + c] = Math.max(-INT8_SCALE, Math.min(INT8_SCALE, Math.round((v[c] ?? 0) * INT8_SCALE)));
      }
    }
    await this.adapter.mkdir(this.indexDir);
    const manifest = {
      schema_version: 1, // wird von encodeContainer auf CONTAINER_SCHEMA_VERSION gesetzt
      // Rein informativ, wird nirgends ausgewertet. Der Default war der Vault-Name des
      // Maintainers und landete so im Index jedes fremden Nutzers; der Indexer ist
      // obsidian-frei und kennt den echten Namen nicht — leer ist ehrlicher als fremd.
      vault: (this.loadedManifest as { vault?: string } | null)?.vault ?? "",
      embedding_model: stampModel ?? this.embeddingModel,
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
    await this.adapter.writeBinary(`${this.indexDir}/${CONTAINER_FILE}`,
      encodeContainer(manifest, paths, new Uint8Array(i8.buffer), this.stampsFor(paths, stamps)));
    this.ready = true;
  }

  /**
   * Vorabprüfung für **additive** Läufe, die erst embedden und dann persistieren
   * (`healVault` → `healMissing` → `persist("heal")`). Dieselbe Regel und dieselbe Disk-Wahrheit
   * wie in `persist()`, nur eben **vorher** gefragt: ein am Ende blockierter Heal ließe sonst die
   * fremden Vektoren in `noteVectors` zurück (nichts macht sie rückgängig), und ein späterer,
   * regulär erlaubter Persist schriebe sie in den Container. Nicht embedden ist billiger als
   * zurückrollen — deshalb fragt der Aufrufer, bevor er mutiert.
   *
   * Reine Frage, keine Mutation. `reindex` fragt gar nicht erst (Voll-Ersatz ist der Ausweg).
   *
   * **Strenger als `persist()` in genau einem Punkt:** kein lesbarer Container (`unreadable`)
   * verbietet hier den Lauf, während `persist("heal")` ihn durchlässt. Das ist Absicht: dort
   * ist der Fall der Auto-Heal-Kaskade vorbehalten, die auf einer CRC-bewiesenen Backup-Basis
   * arbeitet und ihre Modell-Frage an dieser Basis stellt (`main.ts` → `attemptAutoHeal`).
   * Ein nutzergetriggertes „Index vervollständigen" hat keine solche Basis — ohne Disk-Wahrheit
   * gibt es nichts, gegen das sich additives Einmischen prüfen ließe.
   */
  async checkModelAgainstDisk(reason: PersistReason): Promise<PersistDecision> {
    if (reason === "reindex") return { allowed: true };
    const disk = await this.readDiskState();
    if (disk === null) {
      return {
        allowed: false,
        kind: "unreadable",
        message: "Der Index auf Platte ist gerade nicht lesbar (z. B. laufender Sync oder beschädigter Container) — ohne diese Wahrheit ist ein additiver Lauf nicht abzusichern.",
      };
    }
    return assertModelSafeToPersist(disk.model, this.embeddingModel, reason);
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
