import { describe, it, expect, vi } from "vitest";
import { LiveIndexer } from "../src/live_indexer";
import { VaultAdapter, parseIndex, VaultIndex } from "../src/index";
import { EmbeddingClient } from "../src/embedder";
import { PersistBlockedError } from "../src/index_guard";
import { CONTAINER_FILE, encodeContainer, decodeContainer } from "../src/index_container";

const DIM = 256;
const SCALE = 127;

function makeAdapter(): VaultAdapter & { written: Map<string, ArrayBuffer | string> } {
  const written = new Map<string, ArrayBuffer | string>();
  return {
    read: vi.fn(async (p: string) => {
      if (!written.has(p)) throw new Error("not found: " + p);
      return written.get(p) as string;
    }),
    readBinary: vi.fn(async (p: string) => {
      if (!written.has(p)) throw new Error("not found: " + p);
      return written.get(p) as ArrayBuffer;
    }),
    write: vi.fn(async (p: string, d: string) => { written.set(p, d); }),
    writeBinary: vi.fn(async (p: string, d: ArrayBuffer) => { written.set(p, d); }),
    mkdir: vi.fn(),
    exists: vi.fn(async (p: string) => written.has(p)),
    remove: vi.fn(async (p: string) => { written.delete(p); }),
    written,
  } as any;
}

function makeEmbedder(vec?: number[]): EmbeddingClient {
  const v = vec ?? [1, ...Array(DIM - 1).fill(0)];
  return {
    ping: vi.fn().mockResolvedValue(true),
    embed: vi.fn().mockResolvedValue([new Float32Array(v)]),
  } as unknown as EmbeddingClient;
}

/** Embedder, dessen Vektor vom INHALT abhaengt — noetig, wo „alter vs. neuer Vektor derselben
 *  Notiz" unterschieden werden muss (`makeEmbedder` liefert fuer jeden Inhalt denselben). */
function inhaltsEmbedder(): EmbeddingClient {
  return {
    ping: vi.fn().mockResolvedValue(true),
    embed: vi.fn(async (texts: string[]) => {
      let h = 0;
      for (const ch of texts.join("")) h = (h * 31 + ch.charCodeAt(0)) % (DIM - 1);
      const v = new Float32Array(DIM);
      v[h + 1] = 1;
      return [v];
    }),
  } as unknown as EmbeddingClient;
}

function emptyIndex(): VaultIndex {
  const manifest = { schema_version: 1, embedding_model: "qwen3-embedding:8b", index_dim: DIM, scale: SCALE, count: 0, granularity: "note", quant: "int8" };
  return parseIndex(manifest, [], new ArrayBuffer(0));
}

function oneNoteIndex(path: string): VaultIndex {
  const manifest = { schema_version: 1, embedding_model: "qwen3-embedding:8b", index_dim: DIM, scale: SCALE, count: 1, granularity: "note", quant: "int8" };
  const i8 = new Int8Array(DIM);
  i8[0] = SCALE; // [1, 0, 0, …] normalisiert
  return parseIndex(manifest, [path], i8.buffer);
}

/** Baut einen gültigen Container-Snapshot mit `count` Notizen — für readDiskCount-Tests
 *  (Diskzustand, den ein anderer Prozess/Gerät geschrieben haben könnte). */
function makeContainerBytes(count: number, model = "qwen3-embedding:8b"): ArrayBuffer {
  const manifest = { schema_version: 1, embedding_model: model, index_dim: DIM, scale: SCALE, count, granularity: "note", quant: "int8" };
  const paths = Array.from({ length: count }, (_, i) => `disk-note-${i}.md`);
  return encodeContainer(manifest, paths, new Uint8Array(count * DIM));
}

describe("LiveIndexer", () => {
  it("init befüllt noteVectors aus Index", () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    const idx = indexer.buildIndex();
    expect(idx.count).toBe(1);
    expect(idx.rowFor("a.md")).toBe(0);
  });

  it("update fügt neue Notiz zum Index hinzu", async () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(emptyIndex());
    await indexer.update("notes/new.md", "# Heading\nInhalt");
    const idx = indexer.buildIndex();
    expect(idx.count).toBe(1);
    expect(idx.rowFor("notes/new.md")).toBe(0);
  });

  it("update überschreibt bestehenden Vektor", async () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    await indexer.update("a.md", "neuer Inhalt");
    expect(indexer.buildIndex().count).toBe(1);
  });

  it("update mit leerem Inhalt entfernt Notiz", async () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    await indexer.update("a.md", "---\ntitle: x\n---\n   "); // nur Frontmatter
    expect(indexer.buildIndex().count).toBe(0);
  });

  it("remove entfernt Notiz aus Index", () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    indexer.remove("a.md");
    expect(indexer.buildIndex().count).toBe(0);
  });

  it("rename benennt Pfad um", () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("old.md"));
    indexer.rename("old.md", "new.md");
    const idx = indexer.buildIndex();
    expect(idx.rowFor("old.md")).toBe(-1);
    expect(idx.rowFor("new.md")).toBe(0);
  });

  it("persist schreibt GENAU EINE Datei: index.bin — kein Tripel mehr", async () => {
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(emptyIndex());
    await indexer.update("a.md", "Inhalt A");
    await indexer.update("b.md", "Inhalt B");
    await indexer.persist("reindex");

    expect(adapter.written.has(`_vaultrag/${CONTAINER_FILE}`)).toBe(true);
    expect(adapter.written.has("_vaultrag/notes.i8")).toBe(false);
    expect(adapter.written.has("_vaultrag/paths.json")).toBe(false);
    expect(adapter.written.has("_vaultrag/manifest.json")).toBe(false);
  });

  it("persist-Container round-trippt: decode liefert Count, Pfade sortiert, Matrix-Größe", async () => {
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(emptyIndex());
    await indexer.update("b.md", "Inhalt B");
    await indexer.update("a.md", "Inhalt A");
    await indexer.persist("reindex");

    const { manifest, paths, matrix } = decodeContainer(adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer);
    expect(manifest.count).toBe(2);
    expect(paths).toEqual([...paths].sort());
    expect(matrix.byteLength).toBe(2 * DIM);
  });

  it("persist schreibt korrektes int8-Format (Quantisierung)", async () => {
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(emptyIndex());
    await indexer.update("a.md", "Inhalt");
    await indexer.persist();

    const { matrix } = decodeContainer(adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer);
    expect(matrix.byteLength).toBe(DIM); // 1 Notiz × 256 Dims × 1 Byte
    const arr = new Int8Array(matrix);
    expect(arr[0]).toBe(SCALE); // erster Dim = 1.0 * 127 = 127
  });

  it("resultierender buildIndex liefert ähnliche Vektoren für identische Inhalte", async () => {
    const vec = Array(DIM).fill(0); vec[5] = 1;
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(vec), "qwen3-embedding:8b");
    indexer.init(emptyIndex());
    await indexer.update("a.md", "x");
    await indexer.update("b.md", "x");
    const idx = indexer.buildIndex();
    const a = idx.vectorFor("a.md")!;
    const b = idx.vectorFor("b.md")!;
    let dot = 0;
    for (let i = 0; i < DIM; i++) dot += a[i] * b[i];
    expect(dot).toBeGreaterThan(0.99);
  });

  it("noteCount gibt die Anzahl der bekannten Notizen zurück", async () => {
    const adapter = makeAdapter();
    const embedder = makeEmbedder();
    const indexer = new LiveIndexer(adapter, "_vaultrag", embedder, "qwen3-embedding:8b");
    expect(indexer.noteCount).toBe(0);
    await indexer.update("a.md", "Hallo Welt das ist ein langer Text für einen Chunk");
    expect(indexer.noteCount).toBe(1);
    indexer.remove("a.md");
    expect(indexer.noteCount).toBe(0);
  });

  describe("reindexAll", () => {
    it("indiziert alle übergebenen Pfade und buildIndex enthält genau diese Pfade", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      const read = vi.fn(async (p: string) => `# ${p}\nInhalt`);
      await indexer.reindexAll(["a.md", "b.md", "c.md"], read);
      expect(indexer.noteCount).toBe(3);
      const idx = indexer.buildIndex();
      expect(idx.paths).toEqual(["a.md", "b.md", "c.md"]);
    });

    it("ruft onProgress als (done,indexed,total) auf — (1,1,N)…(N,N,N)", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      const progress: Array<[number, number, number]> = [];
      const read = vi.fn(async (p: string) => `# ${p}\nInhalt`);
      await indexer.reindexAll(["x.md", "y.md", "z.md"], read, (done, indexed, total) => { progress.push([done, indexed, total]); });
      expect(progress).toEqual([[1, 1, 3], [2, 2, 3], [3, 3, 3]]);
    });

    // ⚠️ Diese Zusage gilt seit dem Etappen-Persist nur noch für den IN-MEMORY-Stand, und das
    // ist Absicht: die Suche liefert während eines Laufs weiterhin stabil den bisherigen Index
    // statt einer wandernden Mischung. Auf der PLATTE entstehen jetzt Zwischenstände (s. die
    // beiden Tests darüber) — sonst kostet jeder Abbruch den ganzen Lauf.
    it("reindexAll ersetzt den In-Memory-Index erst am Ende — der vorherige bleibt bis zum Abschluss abrufbar", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      // init with 3-note full index
      const idx0 = (() => {
        const manifest = { schema_version: 1, embedding_model: "qwen3-embedding:8b", index_dim: DIM, scale: SCALE, count: 3, granularity: "note", quant: "int8" };
        const i8 = new Int8Array(3 * DIM);
        i8[0] = SCALE; i8[DIM] = SCALE; i8[2 * DIM] = SCALE;
        return parseIndex(manifest, ["a.md", "b.md", "c.md"], i8.buffer);
      })();
      indexer.init(idx0);
      expect(indexer.noteCount).toBe(3);

      // capture snapshot of live noteVectors during first read() call
      let snapshotPaths: string[] = [];
      let firstRead = true;
      const read = vi.fn(async (p: string) => {
        if (firstRead) {
          firstRead = false;
          // At this point reindexAll is mid-flight — old index must still be visible
          snapshotPaths = indexer.buildIndex().paths;
        }
        return `# ${p}\nInhalt`;
      });

      await indexer.reindexAll(["neu1.md", "neu2.md"], read);

      // During reindexAll: old 3-note index was still intact
      expect(snapshotPaths).toEqual(["a.md", "b.md", "c.md"]);
      // After reindexAll: new 2-note index
      expect(indexer.buildIndex().paths).toEqual(["neu1.md", "neu2.md"]);
    });

    it("persistiert waehrend eines langen Laufs in Etappen, nicht erst am Ende", async () => {
      // Warum: bis 0.28.0 hing der ganze Lauf an einem einzigen Persist am Schluss. Am 2026-08-30
      // sind zwei Voll-Reindexe ueber ~6.700 Notizen kurz vor dem Ziel gestorben — beide Male war
      // die gesamte Rechenzeit (5 bzw. 6 Stunden) verloren, weil nichts geschrieben war.
      const adapter = makeAdapter();
      const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      indexer.markFresh();
      const paths = Array.from({ length: 600 }, (_, i) => `n${i}.md`);
      await indexer.reindexAll(paths, async (p: string) => `# ${p}\nInhalt`);
      // 600 Notizen ⇒ Zwischenstaende nach 250 und 500; der Schluss-Persist gehoert dem Aufrufer.
      const writes = (adapter.writeBinary as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      expect(writes).toBe(2);
    });

    it("der Zwischenstand auf der Platte ist VOLLSTAENDIG und traegt die schon erneuerten Vektoren", async () => {
      // Die eigentliche Zusage des Etappen-Persists: bricht der Lauf ab, ist der Fortschritt
      // nicht weg — und der Container bleibt trotzdem zu jedem Zeitpunkt komplett. Ein
      // Zwischenstand, dem Notizen fehlen, waere schlimmer als gar keiner: er saehe beim
      // naechsten Laden wie ein geschrumpfter Index aus.
      const ALT = [1, ...Array(DIM - 1).fill(0)];   // Vektor des bisherigen Index
      const NEU = [0, 1, ...Array(DIM - 2).fill(0)]; // was der Embedder jetzt liefert
      const N = 400;
      const paths = Array.from({ length: N }, (_, i) => `n${String(i).padStart(3, "0")}.md`);

      const adapter = makeAdapter();
      const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(NEU), "qwen3-embedding:8b");
      // Ausgangslage: alle N Notizen bereits im Index, alle mit dem ALTEN Vektor.
      const i8 = new Int8Array(N * DIM);
      for (let r = 0; r < N; r++) i8[r * DIM] = SCALE;
      indexer.init(parseIndex(
        { schema_version: 1, embedding_model: "qwen3-embedding:8b", index_dim: DIM, scale: SCALE, count: N, granularity: "note", quant: "int8" },
        paths, i8.buffer,
      ));

      // Mitten im Lauf (nach dem Zwischenstand bei 250) die PLATTE lesen — nicht den Speicher.
      let platte: { paths: string[]; ersterNeu: boolean; letzterAlt: boolean } | null = null;
      const read = vi.fn(async (pfad: string) => {
        if (pfad === "n300.md" && platte === null) {
          const roh = adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer | undefined;
          if (roh) {
            const d = decodeContainer(roh);
            const m = new Int8Array(d.matrix);
            const zeile = (name: string) => d.paths.indexOf(name);
            platte = {
              paths: d.paths,
              ersterNeu: m[zeile("n000.md") * DIM + 1] === SCALE,
              letzterAlt: m[zeile("n399.md") * DIM] === SCALE,
            };
          }
        }
        return `# ${pfad}\nInhalt`;
      });

      await indexer.reindexAll(paths, read);

      expect(platte).not.toBeNull();
      // vollstaendig: keine Notiz faellt zwischenzeitlich aus dem Index
      expect(platte!.paths.length).toBe(N);
      // schon erneuert: die erste Notiz traegt den neuen Vektor
      expect(platte!.ersterNeu).toBe(true);
      // noch nicht erreicht: die letzte traegt weiter den alten
      expect(platte!.letzterAlt).toBe(true);
    });

    it("bei MODELLWECHSEL werden keine Zwischenstaende geschrieben", async () => {
      // Die eine Einschraenkung des Etappen-Persists. Ein Zwischenstand mischt alte und neue
      // Vektoren — harmlos, solange beide aus demselben Modell stammen, aber bei einem
      // Modellwechsel entstuenden zwei inkommensurable Vektorraeume in einem Container.
      // Genau das verhindert `assertModelSafeToPersist` sonst; bei reason="reindex" ist der
      // Guard bewusst aus, weil ein Voll-Ersatz bisher gar nicht mischen konnte.
      // Bei Modellwechsel bleibt es deshalb beim Alles-oder-nichts: ein einziger Persist am
      // Ende, durch den Aufrufer.
      const adapter = makeAdapter();
      adapter.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(10, "ein-anderes-modell"));
      const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      indexer.markFresh();
      const paths = Array.from({ length: 600 }, (_, i) => `n${i}.md`);
      await indexer.reindexAll(paths, async (pfad: string) => `# ${pfad}\nInhalt`);
      const writes = (adapter.writeBinary as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      expect(writes).toBe(0);
      // Der Lauf selbst ist davon unberuehrt — nur das Zwischenspeichern entfaellt.
      expect(indexer.noteCount).toBe(600);
    });

    it("überspringt eine Notiz deren read wirft, andere werden trotzdem indiziert", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      const read = vi.fn(async (p: string) => {
        if (p === "fehler.md") throw new Error("unlesbar");
        return `# ${p}\nInhalt`;
      });
      await indexer.reindexAll(["a.md", "fehler.md", "c.md"], read);
      expect(indexer.noteCount).toBe(2);
      const idx = indexer.buildIndex();
      expect(idx.paths).toEqual(["a.md", "c.md"]);
    });

    it("löscht noteVectors vor dem Neuindizieren (veralteter Pfad wird entfernt)", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      // Alten Stand per init laden
      indexer.init(oneNoteIndex("alt.md"));
      expect(indexer.noteCount).toBe(1);
      const read = vi.fn(async (p: string) => `# ${p}\nInhalt`);
      await indexer.reindexAll(["neu.md"], read);
      expect(indexer.noteCount).toBe(1);
      const idx = indexer.buildIndex();
      expect(idx.paths).toEqual(["neu.md"]);
    });

    // --- Vault-Stand vom ENDE (2026-09-04) ---------------------------------------------
    // Entscheidung: ein Voll-Reindex bildet den Vault ab, wie er beim ABSCHLUSS aussieht, nicht
    // wie er beim Start aussah. `paths` ist ein Snapshot; alles, was waehrend des Laufs live
    // hereinkommt, muss den Lauf ueberleben statt von `this.noteVectors = fresh` verworfen zu
    // werden. Gemessen am 2026-09-04 (Task „Live-Update waehrend eines Reindex geht verloren").

    it("eine WAEHREND des Laufs neu angelegte Notiz ueberlebt den Reindex", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      indexer.init(oneNoteIndex("alt.md"));
      const read = async (p: string) => {
        // Live-Event mitten im Lauf: die Notiz steht NICHT im Start-Snapshot.
        if (p === "zwei.md") await indexer.update("waehrenddessen-neu.md", "# Neu\nangelegt waehrend des Laufs");
        return `# ${p}\nInhalt`;
      };

      await indexer.reindexAll(["alt.md", "zwei.md"], read);

      expect(indexer.buildIndex().rowFor("waehrenddessen-neu.md")).not.toBe(-1);
    });

    it("eine WAEHREND des Laufs geaenderte Notiz behaelt ihren NEUEN Vektor, nicht den beim Lauf gelesenen", async () => {
      // Der stumme Fall: der Pfad ist im Index, nur der Vektor ist veraltet. `diffIndexVsVault`
      // ist mengenbasiert und sieht das nie — deshalb muss es hier stimmen.
      const adapter = makeAdapter();
      const indexer = new LiveIndexer(adapter, "_vaultrag", inhaltsEmbedder(), "qwen3-embedding:8b");
      indexer.init(oneNoteIndex("a.md"));
      const NEU = "# A\nNEUER INHALT";
      const read = async (p: string) => {
        // a.md hat der Lauf schon gelesen; jetzt aendert der Nutzer sie.
        if (p === "b.md") await indexer.update("a.md", NEU);
        return `# ${p}\nalter Inhalt`;
      };

      await indexer.reindexAll(["a.md", "b.md"], read);

      const referenz = new LiveIndexer(makeAdapter(), "_vaultrag", inhaltsEmbedder(), "qwen3-embedding:8b");
      referenz.markFresh();
      await referenz.update("a.md", NEU);
      expect(Array.from(indexer.buildIndex().vectorFor("a.md")!))
        .toEqual(Array.from(referenz.buildIndex().vectorFor("a.md")!));
    });

    it("eine WAEHREND des Laufs geloeschte Notiz kommt nicht zurueck", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      indexer.init(oneNoteIndex("a.md"));
      const read = async (p: string) => {
        if (p === "b.md") indexer.remove("a.md");
        return `# ${p}\nInhalt`;
      };

      await indexer.reindexAll(["a.md", "b.md"], read);

      expect(indexer.buildIndex().rowFor("a.md")).toBe(-1);
    });

    it("ein Live-Update im Checkpoint-Fenster geht nicht verloren", async () => {
      // Loch B: `persistCheckpoint` tauschte `this.noteVectors` ueber ein await hinweg aus und
      // stellte im finally den alten Stand wieder her — ein Update in genau diesem Fenster
      // schrieb in die Map, die gleich darauf weggeworfen wurde.
      const adapter = makeAdapter();
      let freigabe: (() => void) | null = null;
      let angehalten: (() => void) | null = null;
      const checkpointErreicht = new Promise<void>((res) => { angehalten = res; });
      const origWriteBinary = adapter.writeBinary;
      let writes = 0;
      let checkpointFertig = false;
      (adapter as unknown as { writeBinary: unknown }).writeBinary = vi.fn(async (pfad: string, d: ArrayBuffer) => {
        if (++writes === 1) {
          angehalten!();
          await new Promise<void>((res) => { freigabe = res; });
          checkpointFertig = true;
        }
        return origWriteBinary(pfad, d);
      });

      const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      indexer.init(oneNoteIndex("bestand.md"));

      // Gemessen wird am ersten read NACH dem Checkpoint — dort ist das Fenster nachweislich
      // geschlossen, und `this.noteVectors = fresh` (Lauf-Ende) hat noch nicht stattgefunden.
      // Am Lauf-Ende gemessen wuerde dieser Test den vorigen mitmessen statt Loch B allein.
      //
      // ⚠️ Der Messpunkt haengt am FLAG, nicht an einer read-Zahl: seit der Reindex Chunks
      // ueber Notizgrenzen buendelt, liest er eine ganze Gruppe, bevor er embeddet — welcher
      // read der erste nach dem Checkpoint ist, haengt damit an der Gruppengroesse. Die
      // vorige Fassung nagelte ihn auf 251 fest und mass dadurch VOR dem Checkpoint.
      let imSpeicherNachCheckpoint: number | null = null;
      const paths = Array.from({ length: 260 }, (_, i) => `n${String(i).padStart(3, "0")}.md`);
      const lauf = indexer.reindexAll(paths, async (pfad) => {
        if (checkpointFertig && imSpeicherNachCheckpoint === null) {
          imSpeicherNachCheckpoint = indexer.buildIndex().rowFor("im-fenster.md");
        }
        return `# ${pfad}\nInhalt`;
      });

      await checkpointErreicht;
      await indexer.update("im-fenster.md", "# Fenster\nwaehrend des Checkpoint-Writes");
      freigabe!();
      await lauf;

      // Zuerst: es wurde ueberhaupt gemessen. Ohne diese Zeile bliebe der Wert `null`, wenn
      // nach dem Checkpoint gar kein read mehr kaeme — und `null !== -1` waere gruen, ohne
      // dass je etwas geprueft wurde (dieselbe Falle wie `rowFor`s -1 statt null).
      expect(imSpeicherNachCheckpoint).not.toBeNull();
      expect(imSpeicherNachCheckpoint).not.toBe(-1);
      expect(indexer.buildIndex().rowFor("im-fenster.md")).not.toBe(-1);
    });

    it("GEGENPROBE: ein Update VOR dem Lauf ueberlebt ihn nur, wenn sein Pfad im Snapshot steht", async () => {
      // Haelt die Grenze fest, die der Vertrag NICHT verschiebt: `reindexAll` bleibt ein
      // Voll-Ersatz. Eine Notiz, die vor dem Lauf im Index stand, aber nicht in `paths`, ist
      // danach zu Recht weg (sie existiert im Vault nicht mehr) — sonst waere der Reindex kein
      // Ersatz mehr und ein geloeschter Pfad kaeme nie aus dem Index.
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      indexer.markFresh();
      await indexer.update("verwaist.md", "# Verwaist\nnicht mehr im Vault");
      expect(indexer.buildIndex().rowFor("verwaist.md")).not.toBe(-1);

      await indexer.reindexAll(["a.md"], async (p) => `# ${p}\nInhalt`);

      expect(indexer.buildIndex().rowFor("verwaist.md")).toBe(-1);
    });

    it("leere Notiz wird übersprungen (kein Chunk → noteVectors bleibt leer)", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      // nur Frontmatter, kein Body → chunkMarkdown liefert []
      const read = vi.fn(async () => "---\ntitle: leer\n---\n   ");
      await indexer.reindexAll(["leer.md"], read);
      expect(indexer.noteCount).toBe(0);
    });
  });

  describe("LiveIndexer.healMissing", () => {
    it("behält vorhandene Vektoren und ergänzt nur fehlende", async () => {
      const a = makeAdapter();
      const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      await indexer.update("a.md", "#A");         // vorhanden
      const contents: Record<string, string> = { "b.md": "#B", "c.md": "#C" };
      const { added } = await indexer.healMissing(["b.md", "c.md"], async (p) => contents[p]);
      expect(added).toBe(2);
      const idx = indexer.buildIndex();
      expect(idx.count).toBe(3);
      expect(idx.rowFor("a.md")).toBeGreaterThanOrEqual(0);
      expect(idx.rowFor("b.md")).toBeGreaterThanOrEqual(0);
      expect(idx.rowFor("c.md")).toBeGreaterThanOrEqual(0);
    });

    it("überspringt unlesbare Dateien ohne Abbruch", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      const { added } = await indexer.healMissing(["x.md", "y.md"], async (p) => {
        if (p === "x.md") throw new Error("weg");
        return "#Y";
      });
      expect(added).toBe(1);
      expect(indexer.buildIndex().rowFor("y.md")).toBeGreaterThanOrEqual(0);
    });

    it("meldet Fortschritt", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      const seen: Array<[number, number, number]> = [];
      await indexer.healMissing(["a.md", "b.md"], async () => "#X", (d, i, t) => seen.push([d, i, t]));
      expect(seen[seen.length - 1]).toEqual([2, 2, 2]);
    });

    it("klassifiziert ergänzt / leer übersprungen / fehlgeschlagen", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      const contents: Record<string, string> = {
        "voll.md": "# A\nInhalt",
        "leer.md": "---\ntitle: leer\n---\n   ",
      };
      const result = await indexer.healMissing(["voll.md", "leer.md", "weg.md"], async (p) => {
        if (!(p in contents)) throw new Error("weg");
        return contents[p];
      });
      expect(result.added).toBe(1);
      expect(result.skippedEmpty).toEqual(["leer.md"]);
      expect(result.failed).toEqual(["weg.md"]);
      // leer.md darf NICHT im Index landen
      expect(indexer.buildIndex().paths).toEqual(["voll.md"]);
    });
  });

  describe("LiveIndexer.update Klassifikation", () => {
    it("meldet 'indexed' für Notiz mit Inhalt und 'empty' für chunk-lose", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.init(emptyIndex());
      expect(await indexer.update("a.md", "# Inhalt")).toBe("indexed");
      expect(await indexer.update("a.md", "---\ntitle: x\n---\n")).toBe("empty");
      expect(indexer.noteCount).toBe(0);
    });
  });

  describe("LiveIndexer.reindexAll Klassifikation", () => {
    it("meldet skippedEmpty und failed wie healMissing", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      const contents: Record<string, string> = {
        "voll.md": "# A\nInhalt",
        "leer.md": "---\ntitle: leer\n---\n",
      };
      const result = await indexer.reindexAll(["voll.md", "leer.md", "weg.md"], async (p) => {
        if (!(p in contents)) throw new Error("weg");
        return contents[p];
      });
      expect(result.added).toBe(1);
      expect(result.skippedEmpty).toEqual(["leer.md"]);
      expect(result.failed).toEqual(["weg.md"]);
    });
  });
});

describe("LiveIndexer persist-Guard", () => {
  it("frisch konstruiert ist NICHT ready → live-persist wirft not-ready", async () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
    await expect(indexer.persist("live")).rejects.toBeInstanceOf(PersistBlockedError);
    expect(indexer.isReady()).toBe(false);
  });

  it("markFresh macht ready → leerer Vault darf aufbauen (0→1)", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "# A");
    await expect(indexer.persist("live")).resolves.toBeUndefined();
    expect(a.written.has(`_vaultrag/${CONTAINER_FILE}`)).toBe(true);
  });

  it("readDiskCount: kein Container → 0 → frischer Aufbau erlaubt", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("live")).resolves.toBeUndefined();
    expect(a.written.has(`_vaultrag/${CONTAINER_FILE}`)).toBe(true);
  });

  it("readDiskCount (via persist-live-Guard): Container-Count zählt — Shrink von 100 auf 1 blockt", async () => {
    const a = makeAdapter();
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(100));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); // 1 Notiz im Speicher
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "shrink" });
  });

  it("readDiskCount: korrupter Container → PersistBlockedError kind 'unreadable'", async () => {
    const a = makeAdapter();
    const good = new Uint8Array(makeContainerBytes(3));
    good[10] ^= 0xff; // ein Byte im Header kippen → CRC-Mismatch beim decodeContainer
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, good.buffer);
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B"); await indexer.update("c.md", "#C");
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "unreadable" });
  });

  it("Clobber via In-Memory-Leerung wird gegen den echten Diskzustand geblockt (3→0)", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    // 3-Noten-Index simulieren via init
    const big = oneNoteIndex("a.md"); // count 1 – wir brauchen >1; baue 3 per reindex
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B"); await indexer.update("c.md", "#C");
    await indexer.persist("live");           // Diskzustand jetzt 3 (written-Store)
    // jetzt Map leeren (simuliert verwirrten Zustand) und live-persist → Sturz 3→0
    indexer.remove("a.md"); indexer.remove("b.md"); indexer.remove("c.md");
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "shrink" });
    void big;
  });

  it("reindex-Grund darf schrumpfen", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B");
    await indexer.persist("live");           // Diskzustand jetzt 2 (written-Store)
    indexer.remove("a.md"); indexer.remove("b.md");
    await expect(indexer.persist("reindex")).resolves.toBeUndefined(); // 2→0 erlaubt
  });

  it("heal-Grund darf schrumpfen — über welche Gründe der Shrink-Guard entscheidet, sagt allein assertSafeToPersist", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B");
    await indexer.persist("live");           // Diskzustand jetzt 2 (written-Store)
    indexer.remove("a.md"); indexer.remove("b.md");
    await expect(indexer.persist("heal")).resolves.toBeUndefined(); // 2→0 erlaubt
  });

  it("nach erfolgreichem persist erlaubt der (jetzt aktuelle) Diskzustand eine Ein-Schritt-Löschung", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B");
    await indexer.persist("live");           // Diskzustand jetzt 2 (written-Store)
    indexer.remove("b.md");
    await expect(indexer.persist("live")).resolves.toBeUndefined(); // 2→1 (-1) erlaubt
  });

  it("markUnready blockt live-persist mid-session, auch wenn der Indexer zuvor schon ready war", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A");
    await indexer.persist("live"); // ready war true, persist erfolgreich
    expect(indexer.isReady()).toBe(true);

    indexer.markUnready(); // Gefahrenzustand mid-session (z.B. maybeReload → load-failed-index-present)
    expect(indexer.isReady()).toBe(false);
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "not-ready" });
  });

  it("nach markUnready stellt ein erneutes init() den ready-Zustand wieder her", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A");
    await indexer.persist("live");

    indexer.markUnready();
    await expect(indexer.persist("live")).rejects.toBeInstanceOf(PersistBlockedError);

    indexer.init(oneNoteIndex("a.md")); // z.B. erfolgreicher Reload/Recovery
    expect(indexer.isReady()).toBe(true);
    await expect(indexer.persist("live")).resolves.toBeUndefined();
  });

  it("Sync-Race: markFresh (kein sichtbares Manifest) + später erscheinender großer Index auf Platte blockt live-persist (kein Clobber)", async () => {
    const a = makeAdapter();
    // Simuliert: der echte Index kommt gerade erst per Obsidian Sync an (z. B. iPhone-Start,
    // Manifest war beim eigenen loadIndex() noch nicht da) — DIESES LiveIndexer-Objekt hat ihn
    // nie über init() gesehen, sondern wurde per markFresh() als "frisch" eingestuft.
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(4700));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); // 1 Notiz im Speicher
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "shrink" });
    // Der echte Index auf Platte bleibt unangetastet:
    expect(decodeContainer(a.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer).manifest.count).toBe(4700);
  });

  it("Container vorhanden, aber gerade unlesbar/korrupt (Race mit fremdem Schreibvorgang) → blockt mit 'unreadable'", async () => {
    const a = makeAdapter();
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, new TextEncoder().encode("das ist kein gültiger Container").buffer);
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "unreadable" });
  });
});

describe("LiveIndexer persist-Guard: Embedding-Modell", () => {
  /** Ein Indexer, dessen Modell NICHT zum Modell des Containers auf Platte passt. */
  function mismatched() {
    const a = makeAdapter();
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(1, "qwen3-embedding:8b"));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    indexer.markFresh();
    return { a, indexer };
  }

  it("live blockt bei fremdem Modell auf Platte (kind model-mismatch)", async () => {
    const { a, indexer } = mismatched();
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "model-mismatch" });
    // der Container auf Platte ist unangetastet geblieben
    expect(a.written.get(`_vaultrag/${CONTAINER_FILE}`)!.byteLength).toBe(makeContainerBytes(1).byteLength);
  });

  it("heal blockt ebenfalls — additives Einmischen fremder Vektoren", async () => {
    const { indexer } = mismatched();
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("heal")).rejects.toMatchObject({ kind: "model-mismatch" });
  });

  it("reindex bleibt erlaubt — Voll-Ersatz ist der dokumentierte Ausweg", async () => {
    const { a, indexer } = mismatched();
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("reindex")).resolves.toBeUndefined();
    expect(a.written.has(`_vaultrag/${CONTAINER_FILE}`)).toBe(true);
  });

  it("passendes Modell schreibt normal", async () => {
    const a = makeAdapter();
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(1, "qwen3-embedding:8b"));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.markFresh();
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("live")).resolves.toBeUndefined();
  });

  it("Disk-Wahrheit schlägt den In-Memory-Stand: init mit fremdem Manifest ändert nichts", async () => {
    // Entwaffnungspfad 2: ein vergifteter In-Memory-Manifest (buildIndex vor blockiertem persist)
    // darf den Guard nicht umstimmen — verglichen wird IMMER gegen die Platte.
    const a = makeAdapter();
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(1, "qwen3-embedding:8b"));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    const poisoned = parseIndex(
      { schema_version: 1, embedding_model: "text-embedding-3-small", index_dim: DIM, scale: SCALE, count: 1, granularity: "note", quant: "int8" },
      ["a.md"], new Int8Array(DIM).buffer,
    );
    indexer.init(poisoned);   // setzt ready UND loadedManifest auf das fremde Modell
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "model-mismatch" });
  });

  it("korrupter Container + heal: keine Disk-Wahrheit → Auto-Heal-Kaskade darf schreiben", async () => {
    const a = makeAdapter();
    const bytes = new Uint8Array(makeContainerBytes(3, "qwen3-embedding:8b"));
    bytes[10] ^= 0xff;   // CRC kaputt
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, bytes.buffer);
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    indexer.markFresh();
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("heal")).resolves.toBeUndefined();
  });
});

describe("LiveIndexer.checkModelAgainstDisk (Vorabprüfung vor additiven Läufen)", () => {
  it("fremdes Modell auf Platte → nicht erlaubt (model-mismatch), ohne etwas zu verändern", async () => {
    const a = makeAdapter();
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(1, "qwen3-embedding:8b"));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    indexer.init(oneNoteIndex("a.md"));
    const before = indexer.noteCount;
    expect(await indexer.checkModelAgainstDisk("heal")).toMatchObject({ allowed: false, kind: "model-mismatch" });
    // reine Frage, keine Mutation: der Aufrufer darf danach gefahrlos abbrechen
    expect(indexer.noteCount).toBe(before);
    expect(a.writeBinary).not.toHaveBeenCalled();
  });

  it("passendes Modell → erlaubt", async () => {
    const a = makeAdapter();
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(1, "qwen3-embedding:8b"));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    expect(await indexer.checkModelAgainstDisk("heal")).toMatchObject({ allowed: true });
  });

  it("kein Container auf Platte (frische Installation) → erlaubt", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    indexer.markFresh();
    expect(await indexer.checkModelAgainstDisk("heal")).toMatchObject({ allowed: true });
  });

  it("Container unlesbar/korrupt → nicht erlaubt (unreadable): ohne Disk-Wahrheit kein additiver Lauf", async () => {
    const a = makeAdapter();
    const bytes = new Uint8Array(makeContainerBytes(3, "qwen3-embedding:8b"));
    bytes[10] ^= 0xff;   // CRC kaputt
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, bytes.buffer);
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    expect(await indexer.checkModelAgainstDisk("heal")).toMatchObject({ allowed: false, kind: "unreadable" });
  });

  it("Disk-Wahrheit schlägt den In-Memory-Stand: init mit fremdem Manifest ändert nichts", async () => {
    const a = makeAdapter();
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(1, "qwen3-embedding:8b"));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    const poisoned = parseIndex(
      { schema_version: 1, embedding_model: "text-embedding-3-small", index_dim: DIM, scale: SCALE, count: 1, granularity: "note", quant: "int8" },
      ["a.md"], new Int8Array(DIM).buffer,
    );
    indexer.init(poisoned);
    expect(await indexer.checkModelAgainstDisk("heal")).toMatchObject({ allowed: false, kind: "model-mismatch" });
  });

  it("buildIndex stempelt IMMER das Modell dieses Indexers ins Manifest — auch nach init aus einem fremden Index", () => {
    // Der Grund, warum `main.ts` `this.index = li.buildIndex()` erst NACH einem erfolgreichen
    // persist zuweisen darf: das Ergebnis trägt das Modell des Indexers, nicht das des geladenen
    // Index. Vor einem geblockten Persist zugewiesen, wäre der In-Memory-Index fremd gestempelt —
    // und der Resolver zöge daraus sein `indexModel`.
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    indexer.init(oneNoteIndex("a.md"));   // Index-Manifest sagt qwen3-embedding:8b
    expect(indexer.buildIndex().manifest.embedding_model).toBe("text-embedding-3-small");
  });

  // Auto-Heal `restore-only`: die Vektoren stammen SAMT UND SONDERS aus dem Backup, kein
  // einziger wurde vom aktiven Modell erzeugt. Stempelte der Container trotzdem das aktive,
  // behauptete er eine Herkunft, die nicht stimmt — und der Modell-Guard, der beim nächsten
  // Live-Persist genau dieses Feld gegen das aktive Modell hält, winkte das Mischen zweier
  // Modelle durch. Der Stempel ist hier die Wahrheit über die Vektoren, nicht über den Endpunkt.
  it("persist stempelt auf Wunsch ein fremdes Modell — die Herkunft der Vektoren, nicht den aktiven Endpunkt", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    indexer.init(oneNoteIndex("a.md")); // Backup-Manifest sagt qwen3-embedding:8b

    await indexer.persist("heal", "qwen3-embedding:8b");

    const geschrieben = a.written.get(`_vaultrag/${CONTAINER_FILE}`)!;
    expect(decodeContainer(geschrieben).manifest.embedding_model).toBe("qwen3-embedding:8b");
  });

  it("persist ohne Stempel-Angabe bleibt beim Modell des Indexers", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    indexer.init(oneNoteIndex("a.md"));

    await indexer.persist("reindex");

    const geschrieben = a.written.get(`_vaultrag/${CONTAINER_FILE}`)!;
    expect(decodeContainer(geschrieben).manifest.embedding_model).toBe("text-embedding-3-small");
  });

  // `vault` ist ein rein informatives Manifest-Feld, das niemand ausliest — aber sein Default
  // war der Vault-NAME des Maintainers, und der landete so im Index jedes fremden Nutzers
  // (AGENTS.md §Memory: „Nie im Repo: Vault-Pfade"). Der Indexer ist obsidian-frei und kennt
  // den echten Namen nicht; leer ist ehrlicher als fremd.
  it("persist erfindet keinen Vault-Namen, wenn das geladene Manifest keinen trägt", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));

    await indexer.persist("reindex");

    const manifest = decodeContainer(a.written.get(`_vaultrag/${CONTAINER_FILE}`)!).manifest as { vault?: string };
    expect(manifest.vault).toBe("");
  });

  it("reindex fragt gar nicht erst — Voll-Ersatz bleibt der Ausweg", async () => {
    const a = makeAdapter();
    a.written.set(`_vaultrag/${CONTAINER_FILE}`, makeContainerBytes(1, "qwen3-embedding:8b"));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "text-embedding-3-small");
    indexer.init(oneNoteIndex("a.md"));
    expect(await indexer.checkModelAgainstDisk("reindex")).toMatchObject({ allowed: true });
  });
});

describe("LiveIndexer — Datei-Stempel", () => {
  it("persist schreibt die Stempel in Zeilenreihenfolge der sortierten Pfade", async () => {
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.markFresh();
    await indexer.update("b.md", "# B\nInhalt", [2000, 20]);
    await indexer.update("a.md", "# A\nInhalt", [1000, 10]);
    await indexer.persist("reindex");

    const d = decodeContainer(adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer);
    expect(d.paths).toEqual(["a.md", "b.md"]);          // persist sortiert
    expect(d.stamps).toEqual([[1000, 10], [2000, 20]]);  // Stempel ziehen mit
  });

  it("ohne Stempel bleibt der Container stempellos — kein Halb-Zustand", async () => {
    // Ein teilweise gestempelter Container waere schlimmer als gar keiner: der Waechter
    // meldete die ungestempelten Zeilen als unauffaellig, obwohl sie ungeprueft sind.
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.markFresh();
    await indexer.update("a.md", "# A\nInhalt", [1000, 10]);
    await indexer.update("b.md", "# B\nInhalt");   // ohne Stempel
    await indexer.persist("reindex");

    expect(decodeContainer(adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer).stamps).toBeUndefined();
  });

  it("reindexAll nimmt die Stempel über den stampFor-Callback mit", async () => {
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.markFresh();
    await indexer.reindexAll(["a.md", "b.md"], async (p) => `# ${p}\nInhalt`,
      undefined, (p) => (p === "a.md" ? [1000, 10] : [2000, 20]));
    await indexer.persist("reindex");

    expect(decodeContainer(adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer).stamps)
      .toEqual([[1000, 10], [2000, 20]]);
  });

  it("ein geloeschter Pfad nimmt seinen Stempel mit (keine Leiche in der Map)", async () => {
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.markFresh();
    await indexer.update("a.md", "# A\nInhalt", [1000, 10]);
    await indexer.update("b.md", "# B\nInhalt", [2000, 20]);
    indexer.remove("a.md");
    await indexer.persist("reindex");

    const d = decodeContainer(adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer);
    expect(d.paths).toEqual(["b.md"]);
    expect(d.stamps).toEqual([[2000, 20]]);
  });

  it("rename traegt den Stempel auf den neuen Pfad um", async () => {
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.markFresh();
    await indexer.update("alt.md", "# A\nInhalt", [1000, 10]);
    indexer.rename("alt.md", "neu.md");
    await indexer.persist("reindex");

    const d = decodeContainer(adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer);
    expect(d.paths).toEqual(["neu.md"]);
    expect(d.stamps).toEqual([[1000, 10]]);
  });

  it("init uebernimmt Stempel aus dem geladenen Index", async () => {
    // Sonst verlaeren sie beim ersten Live-Persist nach einem Neustart — der Container
    // wuerde stempellos zurueckgeschrieben und der Waechter waere nach jedem Start blind.
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"), [[1000, 10]]);
    await indexer.update("b.md", "# B\nInhalt", [2000, 20]);
    await indexer.persist("reindex");

    const d = decodeContainer(adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer);
    expect(d.stamps).toEqual([[1000, 10], [2000, 20]]);
  });
});

describe("LiveIndexer — Stempel im Zwischenstand", () => {
  it("ein Checkpoint stempelt die bereits neu berechneten Zeilen NEU, nicht mit dem Altstand", async () => {
    // Der Zwischenstand mischt frische und alte Vektoren. Nimmt er die Stempel pauschal aus dem
    // Altbestand, traegt eine frisch berechnete Zeile den Stempel ihres VORIGEN Embeddens —
    // also genau die Vektor/Stempel-Fehlzuordnung, gegen die der Waechter gebaut ist.
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    const paths = Array.from({ length: 260 }, (_, i) => `n${String(i).padStart(3, "0")}.md`);

    // Altbestand: alle Zeilen mit Stempel "1000"
    indexer.markFresh();
    for (const p of paths) await indexer.update(p, `# ${p}\nalt`, [1000, 10]);
    await indexer.persist("reindex");
    const writesVorher = (adapter.writeBinary as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    let checkpoint: ArrayBuffer | null = null;
    const orig = adapter.writeBinary;
    (adapter as unknown as { writeBinary: unknown }).writeBinary = vi.fn(async (pf: string, d: ArrayBuffer) => {
      if ((adapter.writeBinary as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1) checkpoint = d;
      return orig(pf, d);
    });

    // Reindex mit NEUEN Stempeln (2000)
    await indexer.reindexAll(paths, async (p) => `# ${p}\nneu`, undefined, () => [2000, 20]);

    expect(writesVorher).toBe(1);
    expect(checkpoint).not.toBeNull();
    const d = decodeContainer(checkpoint!);
    expect(d.stamps).not.toBeUndefined();
    // Zeile 0 ist im Checkpoint bereits neu berechnet → sie muss den NEUEN Stempel tragen.
    const zeile0 = d.paths.indexOf("n000.md");
    expect(d.stamps![zeile0]).toEqual([2000, 20]);
    // Die letzte Zeile ist noch nicht erreicht → sie traegt weiter den alten.
    const zeileLetzte = d.paths.indexOf("n259.md");
    expect(d.stamps![zeileLetzte]).toEqual([1000, 10]);
  });
});

/**
 * Embedder, der JE TEXT einen unterscheidbaren Vektor liefert — anders als `makeEmbedder`,
 * das fuer jede Eingabe genau EINEN Vektor zurueckgibt. Fuer das Buendeln ist das der
 * entscheidende Unterschied: sobald die Chunks mehrerer Notizen in einem Aufruf stecken,
 * ist die Aufteilung der Antwort auf die Notizen die Stelle, an der eine Fehlzuordnung
 * entsteht — und die sieht man nur, wenn sich die Vektoren ueberhaupt unterscheiden.
 */
function proTextEmbedder(): EmbeddingClient {
  return {
    ping: vi.fn().mockResolvedValue(true),
    embed: vi.fn(async (texts: string[]) =>
      texts.map((t) => {
        let h = 0;
        for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) % (DIM - 1);
        const v = new Float32Array(DIM);
        v[h + 1] = 1;
        return v;
      })),
  } as unknown as EmbeddingClient;
}

describe("LiveIndexer — Buendelung ueber Notizgrenzen", () => {
  it("schickt die Chunks mehrerer Notizen in EINEM embed-Aufruf", async () => {
    // Warum: `embed()` batcht intern zu 32, aber `reindexAll` rief es bisher pro Notiz auf —
    // eine typische Notiz hat 1-5 Chunks, der Batch griff also nie. Am echten Endpunkt
    // gemessen (2026-09-05): 1 Chunk kostet 3,62 s, 32 Chunks kosten 4,68 s. Der Aufruf-
    // Overhead dominiert, nicht die Arbeit.
    const adapter = makeAdapter();
    const embedder = proTextEmbedder();
    const indexer = new LiveIndexer(adapter, "_vaultrag", embedder, "qwen3-embedding:8b");
    indexer.markFresh();
    const paths = Array.from({ length: 10 }, (_, i) => `n${i}.md`);

    await indexer.reindexAll(paths, async (p: string) => `# ${p}\nInhalt von ${p}`);

    const calls = (embedder.embed as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(calls).toBe(1);
  });

  it("liefert gebuendelt exakt dieselben Vektoren wie der Einzelpfad", async () => {
    // DIE Invariante des Umbaus: die Antwort auf einen Gruppen-Aufruf wird nach Chunk-Zahl
    // auf die Notizen aufgeteilt. Ein Versatz von EINS ordnet ab dort jeder Notiz den Vektor
    // ihrer Nachbarin zu — treppenfoermig, unauffaellig, und von CRC32 mitbeglaubigt. Genau
    // dieser Schaden lag am 2026-08-30 auf ~79 % des Arbeitsvaults.
    //
    // Referenz ist `update()`: der Einzel-Embed-Pfad, den dieser Umbau nicht anfasst.
    const paths = Array.from({ length: 12 }, (_, i) => `n${i}.md`);
    const text = (p: string) => `# ${p}\nGanz eigener Inhalt fuer ${p}`;

    const gebuendelt = new LiveIndexer(makeAdapter(), "_vaultrag", proTextEmbedder(), "qwen3-embedding:8b");
    gebuendelt.markFresh();
    await gebuendelt.reindexAll(paths, async (p: string) => text(p));

    const einzeln = new LiveIndexer(makeAdapter(), "_vaultrag", proTextEmbedder(), "qwen3-embedding:8b");
    einzeln.markFresh();
    for (const p of paths) await einzeln.update(p, text(p));

    const a = gebuendelt.buildIndex();
    const b = einzeln.buildIndex();
    for (const p of paths) {
      expect(a.vectorFor(p)).not.toBeNull();
      expect(Array.from(a.vectorFor(p)!)).toEqual(Array.from(b.vectorFor(p)!));
    }
    // Und die Vektoren sind ueberhaupt unterscheidbar — sonst waere die Gleichheit oben
    // wertlos, weil eine Fehlzuordnung zwischen identischen Vektoren nicht auffiele.
    expect(Array.from(a.vectorFor("n0.md")!)).not.toEqual(Array.from(a.vectorFor("n1.md")!));
  });

  it("eine Notiz, deren Embedding scheitert, reisst ihre Gruppe nicht mit", async () => {
    // Vorher scheiterte immer nur genau eine Notiz, weil jede ihren eigenen Aufruf hatte.
    // Mit einem Aufruf je Gruppe wuerde ein einziger Fehler bis zu 32 Notizen als `failed`
    // melden — der Rueckfall auf Einzelverarbeitung haelt den alten Zuschnitt.
    const adapter = makeAdapter();
    const embedder = proTextEmbedder();
    const echt = embedder.embed as unknown as (t: string[]) => Promise<Float32Array[]>;
    (embedder as unknown as { embed: unknown }).embed = vi.fn(async (texte: string[]) => {
      if (texte.some(t => t.includes("kaputt"))) throw new Error("Embedding HTTP 500");
      return echt(texte);
    });

    const indexer = new LiveIndexer(adapter, "_vaultrag", embedder, "qwen3-embedding:8b");
    indexer.markFresh();
    const paths = ["a.md", "kaputt.md", "c.md"];
    const report = await indexer.reindexAll(paths, async (p: string) => `# ${p}\nInhalt von ${p}`);

    expect(report.failed).toEqual(["kaputt.md"]);
    expect(report.added).toBe(2);
    expect(indexer.buildIndex().rowFor("a.md")).not.toBe(-1);
    expect(indexer.buildIndex().rowFor("c.md")).not.toBe(-1);
  });
});

describe("LiveIndexer — Stempel erreichen die Platte", () => {
  it("nach einem Voll-Reindex traegt der geschriebene Container die Stempel", async () => {
    // Gemessen am 2026-09-05 im Arbeitsvault: ein Voll-Reindex ueber 7.210 Notizen lief zehn
    // Stunden durch und hinterliess einen Container OHNE `stamps` — der Waechter gegen veraltete
    // Vektoren war damit wirkungslos, obwohl er gebaut und in den Tests gruen war.
    //
    // Der Grund ist eine vergessene Durchreichung: `persistVectors` nimmt `stamps` als vierten
    // Parameter, `persist()` gab ihn nicht mit. Nur `persistCheckpoint` tat es — und genau den
    // pruefen die vorhandenen Stempel-Tests. Der Schluss-Persist eines Laufs (und jeder
    // Live-Persist) blieb deshalb ungeprueft.
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", proTextEmbedder(), "qwen3-embedding:8b");
    indexer.markFresh();
    const paths = ["a.md", "b.md", "c.md"];

    await indexer.reindexAll(paths, async (p: string) => `# ${p}\nInhalt von ${p}`, undefined,
      (p) => [p === "a.md" ? 1000 : 2000, 42]);
    await indexer.persist("reindex");

    const roh = adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer | undefined;
    expect(roh).not.toBeUndefined();
    const d = decodeContainer(roh!);
    expect(d.stamps).not.toBeUndefined();
    expect(d.stamps![d.paths.indexOf("a.md")]).toEqual([1000, 42]);
    expect(d.stamps![d.paths.indexOf("b.md")]).toEqual([2000, 42]);
  });

  it("ein Live-Persist erhaelt die Stempel, statt sie aus dem Container zu loeschen", async () => {
    // Zweite Haelfte derselben Luecke: `update()` fuehrt seinen Stempel korrekt mit, aber der
    // anschliessende `persist("live")` schrieb ihn nicht — ein einziger Live-Persist nach einem
    // sauberen Reindex haette also alle Stempel wieder von der Platte genommen.
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", proTextEmbedder(), "qwen3-embedding:8b");
    indexer.markFresh();
    await indexer.reindexAll(["a.md"], async (p: string) => `# ${p}\nInhalt`, undefined, () => [1000, 10]);
    await indexer.persist("reindex");

    await indexer.update("b.md", "# b\nneu", [3000, 20]);
    await indexer.persist("live");

    const d = decodeContainer(adapter.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer);
    expect(d.stamps).not.toBeUndefined();
    expect(d.stamps![d.paths.indexOf("a.md")]).toEqual([1000, 10]);
    expect(d.stamps![d.paths.indexOf("b.md")]).toEqual([3000, 20]);
  });
});
