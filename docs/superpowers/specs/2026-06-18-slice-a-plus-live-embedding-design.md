# Spec: Vault RAG Slice A+ — Live-Embedding via Ollama-Endpoint

**Datum:** 2026-06-18  
**Repo:** `/Users/Shared/code/vault-rag`  
**Status:** approved

---

## Ziel

Bei jedem Speichern einer Notiz werden die geänderten Chunks neu vektorisiert und der Index inkrementell aktualisiert. Embedding-Backend ist ein konfigurierbarer HTTP-Endpoint (Ollama, MLX oder kompatibel). Offline-Edits landen in einer Dirty-List und werden bei Reconnect nachgezogen. Das iPhone liest den statischen Index (Obsidian-Sync), ohne selbst zu embedden.

---

## Nicht in Scope

- Kein transformers.js / ONNX im Plugin-Prozess
- Kein HyperForge-Dependency für täglichen Betrieb (HyperForge bleibt für initialen Bulk-Reindex)
- Keine Änderung am Index-Format (Slice A bleibt kompatibel)
- Kein Chat / Inline-Composer (Slices B/C)

---

## Neue Module

### `src/chunker.ts`

TypeScript-Port von `hyperforge_mcp/chunker.py`.

```
chunkMarkdown(text: string, maxChars?: number, overlap?: number): Chunk[]
```

- `Chunk = { text: string; startOffset: number; endOffset: number }`
- Strip YAML-Frontmatter (`/^---\s*\n.*?\n---\s*\n/s`)
- Heading-aware Split an `#{1,6}` — Heading-Grenzen bevorzugt
- Fallback: Hard-Split mit `overlap=150`
- Default: `maxChars=800`, `overlap=150`
- Termination-Guard: `min_chunk_size = max(maxChars - overlap, maxChars / 2)`

### `src/embedder.ts`

```
class EmbeddingClient {
  constructor(endpoint: string, model: string)
  ping(): Promise<boolean>            // GET {endpoint}/v1/models → true wenn 200
  embed(texts: string[]): Promise<Float32Array[]>  // POST /v1/embeddings
}
```

- `embed` wirft bei HTTP-Fehler oder Netzwerkfehler
- `ping` gibt `false` statt zu werfen (für Connectivity-Check)
- Batch-Limit: maximal 32 Chunks pro Request (Ollama-Kompatibilität)

### `src/live_indexer.ts`

```
class LiveIndexer {
  constructor(adapter: VaultAdapter, settings: VaultRagSettings, embedder: EmbeddingClient)
  async init(index: VaultIndex): void         // Initialisiert noteVectors aus geladenem Index
  async update(path: string, content: string): Promise<void>
  async remove(path: string): Promise<void>
  async rename(oldPath: string, newPath: string): Promise<void>
  async persist(): Promise<void>              // Schreibt notes.i8 + paths.json + manifest.json
  buildIndex(): VaultIndex                   // Gibt aktuellen Stand als VaultIndex zurück
}
```

**Interner Zustand:** `noteVectors: Map<string, Float32Array>` (float32, 256-dim, L2-normalisiert)

**`update`-Ablauf:**
1. `chunkMarkdown(content)` → Chunks
2. `embedder.embed(chunks.map(c => c.text))` → `Float32Array[]`
3. Mean aller Chunk-Vektoren → note vector (float32, 256-dim, erste 256 Dims)
4. L2-Normalisieren
5. In `noteVectors` speichern
6. `persist()` aufrufen

**`persist`-Ablauf (Write-Order wichtig):**
1. Paths alphabetisch sortieren
2. Float32 → int8-Quantisieren (×127, clip, round)
3. `writeBinary(notes.i8)` → `write(paths.json)` → `write(manifest.json)` (letztes = reload-Trigger)

### `src/pending_queue.ts`

```
class PendingQueue {
  constructor(adapter: VaultAdapter, dir: string)
  async load(): Promise<void>
  async add(path: string): Promise<void>       // Schreibt sofort nach pending.json
  drain(): string[]                            // Gibt pending-Paths zurück + leert in-memory
  async clear(): Promise<void>                 // Löscht pending.json
  get size(): number
}
```

Persistenz: `{indexDir}/pending.json` = `string[]` (Pfad-Liste, dedupliziert).

---

## Geänderte Module

### `src/settings.ts`

Neue Felder in `VaultRagSettings`:

```typescript
embeddingEndpoint: string   // default: "http://localhost:11434"
embeddingModel: string      // default: "qwen3-embedding:8b"
```

Settings-Tab-Ergänzungen:
- Text-Input "Embedding Endpoint" (Änderung → `saveSettings` + Reconnect-Check)
- Text-Input "Embedding Modell" (Änderung → `saveSettings`)
- Readonly-Status-Badge: "● Verbunden" (grün) / "○ Offline" (grau)

### `src/main.ts`

**Neue Instanzen:** `EmbeddingClient`, `LiveIndexer`, `PendingQueue`

**`onload`-Erweiterung:**
1. `PendingQueue.load()` — pending.json lesen
2. `LiveIndexer.init(this.index)` — noteVectors aus geladenem Index befüllen
3. `file:modify` Event (debounce 3s):
   - Skip wenn Pfad `exclude`-Prefix matcht
   - Skip wenn Pfad in `_vaultrag/`
   - `embedder.ping()` → online: `liveIndexer.update(path, content)` → `loadIndex()` → `refresh()`
   - offline: `pendingQueue.add(path)`
4. `file:delete` Event: `liveIndexer.remove(path)` oder `pendingQueue.add(path)` mit Sondermarker (→ simple: nur wenn online, sonst ignorieren — gelöschte Notizen stören Related-Notes nicht kritisch)
5. `file:rename` Event: online → `liveIndexer.rename(old, new)`, offline → beide in pending
6. Interval 60s: `pendingQueue.size > 0 && embedder.ping()` → drain → für jeden Pfad `liveIndexer.update` → `loadIndex()` → `refresh()`

**Debounce-Implementierung:** Map `path → timeoutId`, clearTimeout bei erneutem Event.

---

## Datenfluss (Übersicht)

```
file:modify (debounce 3s)
  → skip wenn excluded / _vaultrag/
  → embedder.ping()
    ├── online:  liveIndexer.update(path, content)
    │            → persist() → loadIndex() → refresh()
    └── offline: pendingQueue.add(path)

plugin:load + alle 60s (pending > 0):
  → embedder.ping() → online?
  → paths = pendingQueue.drain()
  → für jeden: file lesen → liveIndexer.update(path, content)
  → pendingQueue.clear() → loadIndex() → refresh()
```

---

## Tests

| Datei | Was wird getestet |
|---|---|
| `tests/chunker.test.ts` | Strip Frontmatter, Heading-Split, Hard-Split, Overlap, Edge-Cases (leer, kurz) |
| `tests/embedder.test.ts` | `ping` (200/500/Netzwerkfehler), `embed` (happy path, HTTP-Fehler, Batch-Split) |
| `tests/live_indexer.test.ts` | `update` (neu, update, Normalisierung), `remove`, `rename`, `persist` (Write-Order, Format) |
| `tests/pending_queue.test.ts` | `add` (dedup), `drain` (leert in-memory), `clear`, Persistenz |

Mock-Strategie: `fetch` via `vi.stubGlobal`, `VaultAdapter` als einfaches Mock-Objekt.

---

## Offene Punkte (bewusst zurückgestellt)

- **file:delete offline:** Gelöschte Notizen bleiben im Index bis nächster HyperForge-Reindex — akzeptierter Trade-off für Slice A+.
- **Batch-Größe Ollama:** 32 Chunks/Request als Startwert; kein Setting, intern konstant.
- **Index-Rebuild-Performance:** Bei 4.459 Notizen × 256 × 4 Bytes ≈ 4,5 MB Matrix — Rebuild pro Note-Update ist in <1ms, kein Batching nötig.
- **Fehlerbehandlung embed-Fehler:** Bei API-Fehler → Note in pending schieben, nicht crash.
