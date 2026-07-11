# Index-Robustheit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Vektor-Index gegen Datenverlust härten — verhindern, dass ein nicht-initialisierter oder beschädigter Index den guten überschreibt, und günstige Recovery (Delta-Heal + geräte-lokale Backups) bereitstellen.

**Architecture:** Datenverlust-kritische Entscheidungen in einem neuen pure-core-Modul `index_guard.ts` (obsidian-frei, Node-getestet) bündeln; `LiveIndexer.persist` erhält einen `reason` + Shrink-Guard; `parseIndex` erhält einen Byte-Längen-Guard; `main.ts` klassifiziert das Load-Ergebnis und blockt im Gefahrenzustand; Self-Heal (additiv) + geräte-lokale Backup-Rotation (Wiederverwendung von `migrateIndex`) obendrauf; laute Sichtbarkeit in Statusleiste + Settings.

**Tech Stack:** TypeScript (strict), vitest + happy-dom, Obsidian Plugin API, esbuild.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Index-Format unverändert:** `notes.i8` (Int8) · `paths.json` · `manifest.json`; Dim **256**, `INT8_SCALE = 127`, mean-Aggregation, `manifest.json` wird **zuletzt** geschrieben (Reload-Trigger). **Kein `schema_version`-Bump.**
- **`VaultAdapter`-Interface (`src/index.ts`) nicht ändern** — Tests und `LiveIndexer` hängen daran. Backup/Restore nutzt Datei-I/O über die reale Obsidian-`this.app.vault.adapter` (hat zusätzlich `stat`/`exists`/`list`/`remove`/`rmdir`) in der Obsidian-Schicht, die reine Logik im pure-core-Modul.
- **Obsidian-Import-Grenze:** nur `main.ts`, `hub_view.ts`, `settings.ts`, `http.ts` importieren `obsidian`. Neue pure-core-Module (`index_guard.ts`, `index_backup.ts`) importieren **nie** `obsidian`.
- **Tests:** vitest, `describe/it/expect`, kein `.only`/`.skip` im Commit. Mock-Adapter-Muster wie `tests/index_migrate.test.ts` (`makeMemAdapter`). Nach jeder Änderung **alle Tests grün** (Basis: 538).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verifikation pro Task:** `npx vitest run tests/<datei>` (Task-Test) + am Task-Ende `npm test`, `npm run typecheck`, `npm run lint` grün.

---

### Task 1: pure-core `index_guard.ts`

**Files:**
- Create: `src/index_guard.ts`
- Test: `tests/index_guard.test.ts`

**Interfaces:**
- Produces:
  - `type LoadState = "no-index" | "loaded-ok" | "load-failed-index-present"`
  - `classifyLoadResult(manifestExists: boolean, parseThrew: boolean): LoadState`
  - `type PersistReason = "live" | "reindex" | "heal"`
  - `interface PersistDecision { allowed: boolean; kind?: "shrink"; message?: string }`
  - `assertSafeToPersist(diskCount: number, nextCount: number, reason: PersistReason): PersistDecision`
  - `isSuspiciousShrink(currentCount: number, incomingCount: number, ratio?: number): boolean`
  - `diffIndexVsVault(indexPaths: string[], vaultPaths: string[]): { missing: string[]; stale: string[] }`
  - `class PersistBlockedError extends Error { readonly kind: "not-ready" | "shrink" }`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/index_guard.test.ts
import { describe, it, expect } from "vitest";
import {
  classifyLoadResult, assertSafeToPersist, isSuspiciousShrink,
  diffIndexVsVault, PersistBlockedError,
} from "../src/index_guard";

describe("classifyLoadResult", () => {
  it("kein Manifest → no-index (frische Installation)", () => {
    expect(classifyLoadResult(false, false)).toBe("no-index");
  });
  it("Manifest da + Load ok → loaded-ok", () => {
    expect(classifyLoadResult(true, false)).toBe("loaded-ok");
  });
  it("Manifest da + Parse wirft → Gefahrenzustand", () => {
    expect(classifyLoadResult(true, true)).toBe("load-failed-index-present");
  });
  it("kein Manifest aber parseThrew (inkonsistent) → no-index (nichts zu schützen)", () => {
    expect(classifyLoadResult(false, true)).toBe("no-index");
  });
});

describe("assertSafeToPersist", () => {
  it("live: Wachstum erlaubt", () => {
    expect(assertSafeToPersist(100, 101, "live").allowed).toBe(true);
  });
  it("live: gleich erlaubt (Rename/Modify ohne Count-Änderung)", () => {
    expect(assertSafeToPersist(100, 100, "live").allowed).toBe(true);
  });
  it("live: Einzel-Löschung (-1) erlaubt", () => {
    expect(assertSafeToPersist(100, 99, "live").allowed).toBe(true);
  });
  it("live: Sturz um mehr als 1 verweigert (Clobber)", () => {
    const d = assertSafeToPersist(4700, 1, "live");
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe("shrink");
    expect(d.message).toMatch(/4700/);
  });
  it("live: -2 in einem Schritt verweigert (Live-Op ändert nur ±1)", () => {
    expect(assertSafeToPersist(10, 8, "live").allowed).toBe(false);
  });
  it("live: letzte Notiz löschen 1→0 erlaubt", () => {
    expect(assertSafeToPersist(1, 0, "live").allowed).toBe(true);
  });
  it("live: leerer Indexer über guten Index (0-Basis diskCount) — 4700→1 bleibt geblockt", () => {
    expect(assertSafeToPersist(4700, 1, "live").allowed).toBe(false);
  });
  it("reindex: darf beliebig schrumpfen (explizit)", () => {
    expect(assertSafeToPersist(4700, 10, "reindex").allowed).toBe(true);
  });
  it("heal: darf beliebig (wächst faktisch nur)", () => {
    expect(assertSafeToPersist(4700, 4701, "heal").allowed).toBe(true);
  });
});

describe("isSuspiciousShrink", () => {
  it("Einbruch unter 50% ist verdächtig (cross-device)", () => {
    expect(isSuspiciousShrink(4700, 3)).toBe(true);
    expect(isSuspiciousShrink(4700, 2000)).toBe(true);
  });
  it("moderat kleiner ist NICHT verdächtig (legitimes Fremd-Gerät)", () => {
    expect(isSuspiciousShrink(4700, 4000)).toBe(false);
  });
  it("Wachstum ist nie verdächtig", () => {
    expect(isSuspiciousShrink(100, 200)).toBe(false);
  });
  it("aktueller Count 0 → nie verdächtig (nichts zu verlieren)", () => {
    expect(isSuspiciousShrink(0, 0)).toBe(false);
  });
});

describe("diffIndexVsVault", () => {
  it("missing = im Vault, nicht im Index; stale = im Index, nicht im Vault", () => {
    const r = diffIndexVsVault(["a.md", "b.md"], ["a.md", "c.md", "d.md"]);
    expect(r.missing.sort()).toEqual(["c.md", "d.md"]);
    expect(r.stale).toEqual(["b.md"]);
  });
  it("deckungsgleich → leer", () => {
    const r = diffIndexVsVault(["a.md"], ["a.md"]);
    expect(r.missing).toEqual([]);
    expect(r.stale).toEqual([]);
  });
});

describe("PersistBlockedError", () => {
  it("trägt kind", () => {
    const e = new PersistBlockedError("shrink", "x");
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("shrink");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index_guard.test.ts`
Expected: FAIL — `Cannot find module '../src/index_guard'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/index_guard.ts
// Pure-core (obsidian-frei): datenverlust-kritische Entscheidungen an einer Stelle,
// isoliert testbar. Siehe docs/superpowers/specs/2026-07-10-index-robustheit-design.md.

export type LoadState = "no-index" | "loaded-ok" | "load-failed-index-present";

/**
 * Klassifiziert das Ergebnis eines Index-Ladeversuchs.
 * - Kein Manifest auf Platte → frische Installation; ein leerer Indexer darf aufbauen.
 * - Manifest da + Parse-Fehler → GEFAHRENZUSTAND: ein guter Index liegt beschädigt vor und
 *   darf NICHT überschrieben werden.
 */
export function classifyLoadResult(manifestExists: boolean, parseThrew: boolean): LoadState {
  if (!manifestExists) return "no-index";
  return parseThrew ? "load-failed-index-present" : "loaded-ok";
}

export type PersistReason = "live" | "reindex" | "heal";

export interface PersistDecision {
  allowed: boolean;
  kind?: "shrink";
  message?: string;
}

/**
 * Entscheidet, ob ein persist den Index gefahrlos ersetzen darf.
 * `reindex`/`heal` sind explizit vom Nutzer ausgelöst → immer erlaubt (dürfen legitim schrumpfen).
 * `live` (jede Notiz-Änderung) ändert den Count invariant um höchstens ±1 → ein Sturz um mehr als 1
 * ist Datenverlust (leerer/verwirrter Indexer plättet den guten Bestand) und wird verweigert.
 */
export function assertSafeToPersist(diskCount: number, nextCount: number, reason: PersistReason): PersistDecision {
  if (reason !== "live") return { allowed: true };
  if (nextCount >= diskCount - 1) return { allowed: true };
  return {
    allowed: false,
    kind: "shrink",
    message: `Persist verweigert: Index würde von ${diskCount} auf ${nextCount} Notizen fallen (Live-Änderung ändert nur ±1) — vermutlich beschädigter/leerer Index.`,
  };
}

/**
 * True, wenn ein von Platte nachgeladener Index drastisch kleiner ist als der aktuelle
 * In-Memory-Bestand (cross-device-Clobber-Verdacht). Moderat kleinere Fremd-Indizes gelten
 * als legitim und werden übernommen.
 */
export function isSuspiciousShrink(currentCount: number, incomingCount: number, ratio = 0.5): boolean {
  if (currentCount <= 0) return false;
  return incomingCount < currentCount * ratio;
}

/**
 * Mengendifferenz Vault↔Index. `missing` = im Vault, aber nicht im Index (Self-Heal-Kandidaten);
 * `stale` = im Index, aber nicht mehr im Vault (informativ; Live-Delete räumt sie normal ab).
 */
export function diffIndexVsVault(indexPaths: string[], vaultPaths: string[]): { missing: string[]; stale: string[] } {
  const inIndex = new Set(indexPaths);
  const inVault = new Set(vaultPaths);
  return {
    missing: vaultPaths.filter(p => !inIndex.has(p)),
    stale: indexPaths.filter(p => !inVault.has(p)),
  };
}

export class PersistBlockedError extends Error {
  constructor(readonly kind: "not-ready" | "shrink", message: string) {
    super(message);
    this.name = "PersistBlockedError";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/index_guard.test.ts`
Expected: PASS (alle Fälle)

- [ ] **Step 5: Commit**

```bash
git add src/index_guard.ts tests/index_guard.test.ts
git commit -m "feat(index): pure-core index_guard — Load-Klassifikation + persist-Guard + Diff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Byte-Längen-Guard in `parseIndex`

**Files:**
- Modify: `src/index.ts` (Funktion `parseIndex`, ~Zeile 34)
- Test: `tests/index.test.ts` (ergänzen)

**Interfaces:**
- Consumes: nichts Neues.
- Produces: `parseIndex` wirft jetzt zusätzlich bei `matrix.byteLength !== count * index_dim`.

- [ ] **Step 1: Write the failing test**

Ergänze in `tests/index.test.ts` innerhalb `describe("parseIndex", …)`:

```typescript
  it("zu kurzer notes.i8 → wirft (statt still NaN-Vektoren)", () => {
    const manifest = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 2, granularity: "note", quant: "int8" };
    const paths = ["a.md", "b.md"];
    const bytes = new Int8Array([127, 0, 0]); // 3 bytes statt 2*2=4
    expect(() => parseIndex(manifest, paths, bytes.buffer)).toThrow(/byteLength|Länge|3.*4|4.*3/i);
  });
  it("zu langer notes.i8 → wirft", () => {
    const manifest = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 1, granularity: "note", quant: "int8" };
    const paths = ["a.md"];
    const bytes = new Int8Array([127, 0, 0, 0]); // 4 bytes statt 1*2=2
    expect(() => parseIndex(manifest, paths, bytes.buffer)).toThrow(/byteLength|Länge/i);
  });
  it("korrekte Länge lädt normal", () => {
    const manifest = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 1, granularity: "note", quant: "int8" };
    const paths = ["a.md"];
    const bytes = new Int8Array([127, 0]);
    expect(() => parseIndex(manifest, paths, bytes.buffer)).not.toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index.test.ts`
Expected: FAIL — „zu kurzer notes.i8" erwartet throw, bekommt aber keinen (aktuell NaN-Werte).

- [ ] **Step 3: Write minimal implementation**

In `src/index.ts`, in `parseIndex`, direkt nach dem `manifest.count`-Check und vor `const i8 = new Int8Array(matrix);`:

```typescript
  const expectedBytes = n * dim;
  if (matrix.byteLength !== expectedBytes) {
    throw new Error(`vault-rag index korrupt: notes.i8 byteLength ${matrix.byteLength} != erwartet ${expectedBytes} (count ${n} × dim ${dim})`);
  }
```

(`n` und `dim` sind in der Funktion bereits definiert: `const dim = manifest.index_dim, scale = manifest.scale, n = paths.length;`)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/index.test.ts`
Expected: PASS (inkl. der bestehenden parseIndex-Tests)

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat(index): Byte-Längen-Guard in parseIndex — abgeschnittener notes.i8 wirft laut

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `LiveIndexer` — ready/diskCount + `persist(reason)`-Guard

**Files:**
- Modify: `src/live_indexer.ts`
- Test: `tests/live_indexer.test.ts` (ergänzen)

**Interfaces:**
- Consumes: `assertSafeToPersist`, `PersistReason`, `PersistBlockedError` aus `./index_guard`.
- Produces:
  - `LiveIndexer.persist(reason: PersistReason = "live"): Promise<void>` — wirft `PersistBlockedError` bei nicht-ready (live) oder Shrink.
  - `LiveIndexer.markFresh(): void` — setzt ready=true, diskCount=0 (no-index-Pfad).
  - `LiveIndexer.isReady(): boolean`
  - `init` setzt intern `ready=true` und `diskCount = index.count`.
  - `reindexAll`/`healMissing` setzen intern `ready=true`.

- [ ] **Step 1: Write the failing test**

Ergänze in `tests/live_indexer.test.ts` (nutzt vorhandene `makeAdapter`/`makeEmbedder`/`oneNoteIndex`; `PersistBlockedError` importieren):

```typescript
import { PersistBlockedError } from "../src/index_guard";

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
    expect(a.written.has("_vaultrag/manifest.json")).toBe(true);
  });

  it("init setzt diskCount → Clobber (großer Index, dann leer) wird geblockt", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    // 3-Noten-Index simulieren via init
    const big = oneNoteIndex("a.md"); // count 1 – wir brauchen >1; baue 3 per reindex
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B"); await indexer.update("c.md", "#C");
    await indexer.persist("live");           // diskCount = 3
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
    await indexer.persist("live");           // diskCount = 2
    indexer.remove("a.md"); indexer.remove("b.md");
    await expect(indexer.persist("reindex")).resolves.toBeUndefined(); // 2→0 erlaubt
  });

  it("erfolgreicher persist aktualisiert diskCount (Löschungen bleiben möglich)", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B");
    await indexer.persist("live");           // diskCount = 2
    indexer.remove("b.md");
    await expect(indexer.persist("live")).resolves.toBeUndefined(); // 2→1 (-1) erlaubt
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/live_indexer.test.ts`
Expected: FAIL — `isReady`/`markFresh` existieren nicht; `persist` nimmt kein Argument / wirft nicht.

- [ ] **Step 3: Write minimal implementation**

In `src/live_indexer.ts`:

1. Import ergänzen (oben):
```typescript
import { assertSafeToPersist, PersistReason, PersistBlockedError } from "./index_guard";
```

2. Felder in der Klasse (nach `private loadedManifest`):
```typescript
  private ready = false;
  private diskCount = 0;
```

3. `init` erweitern — am Ende von `init(index)` ergänzen:
```typescript
    this.ready = true;
    this.diskCount = index.count;
```

4. Neue Methoden (z.B. nach `get noteCount`):
```typescript
  isReady(): boolean { return this.ready; }

  /** No-Index-Pfad: kein Index auf Platte → leerer Indexer darf gefahrlos aufbauen. */
  markFresh(): void { this.ready = true; this.diskCount = 0; }
```

5. In `reindexAll`, nach `this.noteVectors = fresh;` ergänzen:
```typescript
    this.ready = true;
```

6. `persist()`-Signatur + Guard. Ersetze `async persist(): Promise<void> {` durch:
```typescript
  async persist(reason: PersistReason = "live"): Promise<void> {
    const nextCount = this.noteVectors.size;
    if (!this.ready && reason === "live") {
      throw new PersistBlockedError("not-ready", "Persist verweigert: Index ist nicht initialisiert (Load-Fehler) — der gute Index auf Platte bleibt erhalten.");
    }
    const decision = assertSafeToPersist(this.diskCount, nextCount, reason);
    if (!decision.allowed) {
      throw new PersistBlockedError(decision.kind ?? "shrink", decision.message ?? "Persist verweigert.");
    }
```
   und am **Ende** von `persist` (nach dem `manifest.json`-Write) ergänzen:
```typescript
    this.ready = true;
    this.diskCount = nextCount;
```
   (Die `const paths = …`/`const n = paths.length;`-Zeilen bleiben; `n` und `nextCount` sind identisch — `nextCount` steht bereits oben, entferne die redundante lokale Neuberechnung nicht nötigerweise, aber nutze `nextCount` NICHT für die i8-Schleife, dort bleibt `n`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/live_indexer.test.ts`
Expected: PASS (inkl. der bestehenden LiveIndexer-Tests — bestehende `persist()`-Aufrufe ohne Argument nutzen jetzt Default `"live"`; da diese Tests init/markFresh nutzen oder wachsen, bleiben sie grün).

- [ ] **Step 5: Commit**

```bash
git add src/live_indexer.ts tests/live_indexer.test.ts
git commit -m "feat(indexer): ready/diskCount + persist(reason)-Guard gegen Clobber

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `LiveIndexer.healMissing` (additiver Delta-Reindex)

**Files:**
- Modify: `src/live_indexer.ts`
- Test: `tests/live_indexer.test.ts` (ergänzen)

**Interfaces:**
- Produces: `LiveIndexer.healMissing(missing: string[], read: (p: string) => Promise<string>, onProgress?: (done: number, indexed: number, total: number) => void): Promise<number>` — embeddet nur die übergebenen Pfade **additiv** (bestehende Vektoren bleiben), gibt die Zahl neu indizierter Notizen zurück.

- [ ] **Step 1: Write the failing test**

```typescript
describe("LiveIndexer.healMissing", () => {
  it("behält vorhandene Vektoren und ergänzt nur fehlende", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A");         // vorhanden
    const contents: Record<string, string> = { "b.md": "#B", "c.md": "#C" };
    const added = await indexer.healMissing(["b.md", "c.md"], async (p) => contents[p]);
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
    const added = await indexer.healMissing(["x.md", "y.md"], async (p) => {
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/live_indexer.test.ts`
Expected: FAIL — `healMissing` existiert nicht.

- [ ] **Step 3: Write minimal implementation**

In `src/live_indexer.ts`, neue Methode (z.B. nach `reindexAll`):

```typescript
  /**
   * Additiver Delta-Reindex: embeddet nur die fehlenden Pfade und fügt sie zur bestehenden
   * Vektor-Map hinzu (KEIN Reset). Dient als „Index vervollständigen" und als Resume für
   * abgebrochene Voll-Reindexe. Gibt die Zahl neu indizierter Notizen zurück.
   */
  async healMissing(
    missing: string[],
    read: (p: string) => Promise<string>,
    onProgress?: (done: number, indexed: number, total: number) => void,
  ): Promise<number> {
    let indexed = 0;
    for (let i = 0; i < missing.length; i++) {
      try {
        const v = await this.embedNote(await read(missing[i]));
        if (v) { this.noteVectors.set(missing[i], v); indexed++; }
      } catch { /* unlesbar/Embed-Fehler überspringen */ }
      onProgress?.(i + 1, indexed, missing.length);
    }
    this.ready = true;
    return indexed;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/live_indexer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/live_indexer.ts tests/live_indexer.test.ts
git commit -m "feat(indexer): healMissing — additiver Delta-Reindex (Vervollständigen/Resume)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: pure-core `index_backup.ts` (Rotations-/Auswahl-Logik)

**Files:**
- Create: `src/index_backup.ts`
- Test: `tests/index_backup.test.ts`

**Interfaces:**
- Produces:
  - `BACKUP_SUBDIR = "index-backups"` (Konstante)
  - `backupDirName(builtAt: string): string` — dateisystem-sicherer Verzeichnisname aus ISO-Zeitstempel (`:`/`.` → `-`).
  - `selectBackupsToDelete(existing: string[], keep: number): string[]` — nimmt Backup-Verzeichnisnamen, gibt die zu löschenden (ältesten) zurück, sodass `keep` neueste bleiben. Sortierung lexikografisch (ISO-basierte Namen sortieren chronologisch).
  - `interface BackupEntry { name: string; count: number }`
  - `sortBackupsNewestFirst(entries: BackupEntry[]): BackupEntry[]`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/index_backup.test.ts
import { describe, it, expect } from "vitest";
import { backupDirName, selectBackupsToDelete, sortBackupsNewestFirst, BACKUP_SUBDIR } from "../src/index_backup";

describe("backupDirName", () => {
  it("ersetzt : und . für dateisystem-sichere Namen", () => {
    expect(backupDirName("2026-07-09T17:10:05.123Z")).toBe("2026-07-09T17-10-05-123Z");
  });
});

describe("selectBackupsToDelete", () => {
  it("behält die keep neuesten, löscht den Rest (ältestzuerst)", () => {
    const names = ["2026-07-01T00-00-00-000Z", "2026-07-03T00-00-00-000Z", "2026-07-02T00-00-00-000Z", "2026-07-04T00-00-00-000Z"];
    const del = selectBackupsToDelete(names, 3);
    expect(del).toEqual(["2026-07-01T00-00-00-000Z"]);
  });
  it("weniger als keep → nichts löschen", () => {
    expect(selectBackupsToDelete(["a", "b"], 3)).toEqual([]);
  });
  it("genau keep → nichts löschen", () => {
    const names = ["2026-07-01T00-00-00-000Z", "2026-07-02T00-00-00-000Z", "2026-07-03T00-00-00-000Z"];
    expect(selectBackupsToDelete(names, 3)).toEqual([]);
  });
});

describe("sortBackupsNewestFirst", () => {
  it("neueste zuerst (lexikografisch absteigend über ISO-Namen)", () => {
    const r = sortBackupsNewestFirst([
      { name: "2026-07-01T00-00-00-000Z", count: 10 },
      { name: "2026-07-03T00-00-00-000Z", count: 30 },
      { name: "2026-07-02T00-00-00-000Z", count: 20 },
    ]);
    expect(r.map(e => e.count)).toEqual([30, 20, 10]);
  });
});

describe("BACKUP_SUBDIR", () => {
  it("ist index-backups", () => { expect(BACKUP_SUBDIR).toBe("index-backups"); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index_backup.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/index_backup.ts
// Pure-core (obsidian-frei): Namens-/Rotations-/Sortier-Logik für geräte-lokale Index-Backups.
// Die eigentliche Datei-I/O passiert in der Obsidian-Schicht (main.ts) via migrateIndex.

export const BACKUP_SUBDIR = "index-backups";

/** Dateisystem-sicherer Verzeichnisname aus einem ISO-Zeitstempel (`:` und `.` → `-`). */
export function backupDirName(builtAt: string): string {
  return builtAt.replace(/[:.]/g, "-");
}

/**
 * Gibt die zu löschenden Backup-Verzeichnisnamen zurück, sodass die `keep` neuesten bleiben.
 * Namen sind ISO-basiert → lexikografische Sortierung == chronologisch.
 */
export function selectBackupsToDelete(existing: string[], keep: number): string[] {
  if (existing.length <= keep) return [];
  const sorted = [...existing].sort(); // aufsteigend: ältestes zuerst
  return sorted.slice(0, existing.length - keep);
}

export interface BackupEntry { name: string; count: number }

/** Neueste zuerst — für die Restore-Auswahl. */
export function sortBackupsNewestFirst(entries: BackupEntry[]): BackupEntry[] {
  return [...entries].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/index_backup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index_backup.ts tests/index_backup.test.ts
git commit -m "feat(index): pure-core index_backup — Namens-/Rotations-/Sortier-Logik

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `loadIndex`-Gefahrenzustand + degradierte Statusleiste

**Files:**
- Modify: `src/main.ts` (`loadIndex` ~393, `updateStatusBar` ~592, Klassenfelder ~48)
- Test: manuelle Verifikation (main.ts ist obsidian-verdrahtet; die Kern-Logik ist bereits in Task 1 getestet). Kein neuer Unit-Test — stattdessen Typecheck + bestehende Suite grün + Smoke im Finishing.

**Interfaces:**
- Consumes: `classifyLoadResult`, `LoadState` aus `./index_guard`; `LiveIndexer.markFresh`.
- Produces: Feld `private indexHealthy = true;` auf der Plugin-Klasse; `loadIndex` klassifiziert und setzt es; `updateStatusBar` zeigt degradierten Zustand.

- [ ] **Step 1: Feld + Import ergänzen**

Import oben in `main.ts` erweitern:
```typescript
import { classifyLoadResult } from "./index_guard";
```
Klassenfeld (bei den anderen privaten Feldern, z.B. nach `private statusBarEl`):
```typescript
  private indexHealthy = true;
```

- [ ] **Step 2: `loadIndex` umbauen**

Ersetze den Body von `async loadIndex()` (Zeilen ~393–406) durch:
```typescript
  async loadIndex() {
    const manifestPath = `${this.settings.indexDir}/manifest.json`;
    const manifestExists = await this.app.vault.adapter.exists(manifestPath);
    let parseThrew = false;
    let loaded: VaultIndex | null = null;
    try {
      loaded = await new IndexLoader(this.app.vault.adapter, this.settings.indexDir).load();
    } catch (e) {
      parseThrew = true;
      console.warn("vault-rag: loadIndex failed", e);
    }
    const state = classifyLoadResult(manifestExists, parseThrew);
    if (state === "loaded-ok" && loaded) {
      this.index = loaded;
      this.retriever = new Retriever(this.index);
      this.liveIndexer.init(this.index);
      const st = await this.app.vault.adapter.stat(manifestPath);
      if (st) this.lastMtime = st.mtime;
      this.indexHealthy = true;
      this.refresh();
      this.syncProgress();
      // Self-Heal-Check + Load-Snapshot folgen in Task 8/9 (hier bewusst noch nicht).
    } else if (state === "no-index") {
      // Frische Installation: leerer Indexer darf gefahrlos aufbauen.
      this.index = null; this.retriever = null;
      this.liveIndexer.markFresh();
      this.indexHealthy = true;
      this.syncProgress();
    } else {
      // GEFAHRENZUSTAND: Index liegt vor, ließ sich aber nicht laden. liveIndexer NICHT init'en
      // (bleibt not-ready → persist-Guard blockt live-Overwrites). Laut anzeigen.
      this.index = null; this.retriever = null;
      this.indexHealthy = false;
      this.syncProgress();
      new Notice("⚠ vault-rag: Index beschädigt/nicht ladbar — Schreibschutz aktiv. Über die Einstellungen wiederherstellen oder neu indizieren.", 10000);
    }
  }
```

- [ ] **Step 3: `updateStatusBar` um degradierten Zustand erweitern**

In `updateStatusBar()` als **erste** Verzweigung (vor `if (p.reindex)`) einfügen:
```typescript
    if (!this.indexHealthy) {
      this.statusBarEl.setText("⚠ Index beschädigt");
      return;
    }
```

- [ ] **Step 4: Verifikation**

Run: `npm run typecheck && npx vitest run` 
Expected: typecheck 0 Fehler; alle Tests grün (keine bestehende Logik gebrochen — `loadIndex`-Verhalten für den Normalfall `loaded-ok` bleibt identisch).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): loadIndex-Gefahrenzustand (classifyLoadResult) + degradierte Statusleiste

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: persist-Verweigerung in den Live-Handlern abfangen

**Files:**
- Modify: `src/main.ts` (`handleModify` ~426, `handleDelete` ~459, `handleRename` ~471, `drainPending` ~494, `reindexVault` ~522)
- Test: manuelle/Typecheck-Verifikation (Guard-Logik in Task 1/3 getestet).

**Interfaces:**
- Consumes: `PersistBlockedError` aus `./index_guard`; `LiveIndexer.persist(reason)`.
- Produces: Live-Handler fangen `PersistBlockedError` → Notiz in pending statt Clobber; `reindexVault` nutzt `persist("reindex")`.

- [ ] **Step 1: Import ergänzen**

```typescript
import { classifyLoadResult, PersistBlockedError } from "./index_guard";
```
(erweitert den Import aus Task 6).

- [ ] **Step 2: `handleModify` — Guard-Fehler behandeln**

Der bestehende `try/catch` in `handleModify` (um `li.update`/`buildIndex`/`persist`) fängt bereits alles und routet nach pending. Ergänze eine **explizite** Behandlung, damit der Guard-Fall sichtbar ist. Ersetze den `catch {` -Block (Zeilen ~447–449) durch:
```typescript
      } catch (e) {
        if (e instanceof PersistBlockedError) {
          this.indexHealthy = false;
          new Notice("⚠ vault-rag: Schreibschutz — Index wirkt beschädigt, Änderung vorgemerkt statt überschrieben.", 8000);
        }
        await this.pendingQueue.add(path);
        this.syncProgress();
```
(Der `finally { this.embeddingProgress.isEmbedding = false; }` bleibt.)

- [ ] **Step 3: `handleDelete` / `handleRename` absichern**

`handleDelete` (kein try/catch aktuell): umschließe den Block ab `this.liveIndexer.remove(path);` bis `this.refresh();` mit:
```typescript
    try {
      this.liveIndexer.remove(path);
      this.index = this.liveIndexer.buildIndex();
      this.retriever = new Retriever(this.index);
      await this.liveIndexer.persist("live");
      this.syncProgress();
      this.refresh();
    } catch (e) {
      if (e instanceof PersistBlockedError) { this.indexHealthy = false; new Notice("⚠ vault-rag: Löschung nicht persistiert (Schreibschutz).", 8000); }
    }
```
`handleRename` analog: den `if (await this.embedderReady()) { … }`-Zweig-Inhalt (rename/build/persist) in `try/catch (e)` klammern mit gleichem `PersistBlockedError`-Handling; `await this.liveIndexer.persist("live");`.

- [ ] **Step 4: `drainPending` + `reindexVault` — reason setzen**

In `drainPending`: `await li.persist();` → `await li.persist("live");`. Der bestehende `catch` bleibt (drain wächst nur, Guard greift dort praktisch nie).
In `reindexVault`: `await this.liveIndexer.persist();` → `await this.liveIndexer.persist("reindex");`.

- [ ] **Step 5: Verifikation + Commit**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck 0; alle Tests grün.
```bash
git add src/main.ts
git commit -m "feat(main): PersistBlockedError in Live-Handlern abfangen — Vormerken statt Clobber

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Self-Heal — Diff auf Load, Auto-Erkennung + Bestätigung, Command

**Files:**
- Modify: `src/main.ts` (`loadIndex` `loaded-ok`-Zweig; neue Methode `healVault`; neuer Command; ~onload Command-Registrierung ~154), `src/settings.ts` (Modal `HealConfirmModal`; Host-Interface)
- Test: manuelle/Typecheck-Verifikation.

**Interfaces:**
- Consumes: `diffIndexVsVault` aus `./index_guard`; `LiveIndexer.healMissing`.
- Produces:
  - `VaultRagPluginHost.healVault(): Promise<void>` (Interface in settings.ts erweitern)
  - `main.ts`-Methoden: `private vaultMarkdownPaths(): string[]`, `async healVault(): Promise<void>`, `private missingCount(): number` (Helfer)
  - Command `id: "heal-index"`, Name „Index vervollständigen (fehlende Notizen)"

- [ ] **Step 1: Helfer `vaultMarkdownPaths` extrahieren (DRY mit reindexVault-Filter)**

In `main.ts` neue private Methode (die Filterlogik aus `reindexVault` wiederverwenden):
```typescript
  private vaultMarkdownPaths(): string[] {
    return this.app.vault.getMarkdownFiles().map(f => f.path).filter(p => {
      if (p.startsWith(".")) return false;
      if (this.settings.exclude.some(e => p.startsWith(e))) return false;
      if (p.startsWith(this.settings.indexDir + "/")) return false;
      return true;
    });
  }
```
Und in `reindexVault` die inline-Filterzeile durch `const allPaths = this.vaultMarkdownPaths();` ersetzen.

- [ ] **Step 2: `healVault`-Methode**

```typescript
  /** Delta-Reindex: nur im Vault vorhandene, aber nicht indizierte Notizen nachziehen. */
  async healVault(): Promise<void> {
    if (!(await this.embedderReady())) {
      new Notice("Embedding-Endpoint nicht erreichbar — Vervollständigen abgebrochen.");
      return;
    }
    if (!this.liveIndexer.isReady()) {
      new Notice("Kein Basis-Index geladen — bitte „Aus Backup wiederherstellen" oder „Vault neu indizieren".");
      return;
    }
    const vaultPaths = this.vaultMarkdownPaths();
    const indexPaths = [...(this.index ? this.index.paths : [])];
    const { missing } = diffIndexVsVault(indexPaths, vaultPaths);
    if (missing.length === 0) { new Notice("Index ist vollständig — nichts zu tun."); return; }
    const notice = new Notice(`Vervollständige Index… 0/${missing.length}`, 0);
    const statusReveal = !this.statusBarEl;
    if (statusReveal) this.setStatusBarVisible(true);
    this.embeddingProgress.isEmbedding = true;
    this.embeddingProgress.reindex = { done: 0, total: missing.length };
    this.updateStatusBar();
    try {
      const added = await this.liveIndexer.healMissing(
        missing,
        (p) => this.app.vault.adapter.read(p),
        (done, _indexed, tot) => {
          this.embeddingProgress.reindex = { done, total: tot };
          this.updateStatusBar();
          notice.setMessage(`Vervollständige Index… ${done}/${tot}`);
        },
      );
      this.index = this.liveIndexer.buildIndex();
      this.retriever = new Retriever(this.index);
      await this.liveIndexer.persist("heal");
      this.refresh();
      notice.setMessage(`Index vervollständigt: ${added} Notizen ergänzt.`);
    } catch (e) {
      console.warn("vault-rag: healVault failed", e);
      notice.setMessage("Vervollständigen fehlgeschlagen.");
    } finally {
      this.embeddingProgress.reindex = null;
      this.embeddingProgress.isEmbedding = false;
      this.syncProgress();
      if (statusReveal) this.setStatusBarVisible(this.settings.showStatusBar);
      window.setTimeout(() => notice.hide(), 4000);
    }
  }
```
Import in main.ts erweitern: `import { classifyLoadResult, PersistBlockedError, diffIndexVsVault } from "./index_guard";`

- [ ] **Step 3: Auto-Erkennung im `loaded-ok`-Zweig von `loadIndex`**

An der in Task 6 markierten Stelle („Self-Heal-Check … folgen in Task 8") einfügen:
```typescript
      const vaultPaths = this.vaultMarkdownPaths();
      const { missing } = diffIndexVsVault([...this.index.paths], vaultPaths);
      // Konservativ: nur bei substanzieller Lücke laut werden (>5% UND >20 Notizen),
      // und nur wenn der Embedder erreichbar ist (sonst ist die Lücke evtl. temporär).
      if (missing.length > 20 && missing.length > vaultPaths.length * 0.05 && await this.embedderReady()) {
        new Notice(`vault-rag: ${missing.length} von ${vaultPaths.length} Notizen fehlen im Index.`, 8000);
        new HealConfirmModal(this.app, missing.length, vaultPaths.length, () => { void this.healVault(); }).open();
      }
```

- [ ] **Step 4: Command registrieren**

In `onload`, bei den anderen `addCommand`-Aufrufen (~154):
```typescript
    this.addCommand({
      id: "heal-index",
      name: "Index vervollständigen (fehlende Notizen)",
      callback: () => void this.healVault(),
    });
```

- [ ] **Step 5: `HealConfirmModal` in settings.ts + Host-Interface**

In `src/settings.ts` nach `ReindexConfirmModal` ergänzen:
```typescript
class HealConfirmModal extends Modal {
  constructor(app: App, private missing: number, private total: number, private onConfirm: () => void) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Index vervollständigen?" });
    contentEl.createEl("p", { text: `${this.missing} von ${this.total} Notizen fehlen im Index. Nur die fehlenden werden neu eingebettet (Delta) — der bestehende Index bleibt erhalten.` });
    const btnRow = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btnRow).setButtonText("Später").onClick(() => this.close());
    new ButtonComponent(btnRow).setButtonText("Jetzt vervollständigen").setCta().onClick(() => { this.close(); this.onConfirm(); });
  }
  onClose(): void { this.contentEl.empty(); }
}
```
Und `HealConfirmModal` in `main.ts` importieren: die bestehende `import { … } from "./settings";`-Zeile um `HealConfirmModal` erweitern (prüfen, ob `ReindexConfirmModal` exportiert wird — falls Modals bisher modul-privat sind, `export` vor `class HealConfirmModal` setzen und in main.ts importieren).
Host-Interface `VaultRagPluginHost` (settings.ts) um `healVault(): Promise<void>;` erweitern.

- [ ] **Step 6: Verifikation + Commit**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: alle grün.
```bash
git add src/main.ts src/settings.ts
git commit -m "feat(main): Self-Heal — Delta-Reindex + Auto-Erkennung mit Bestätigung + Command

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Geräte-lokale Backups — Snapshot, Rotation, Restore

**Files:**
- Modify: `src/main.ts` (Backup-Snapshot in `loadIndex` loaded-ok + vor riskantem persist; `restoreBackup`; `listBackups`; Command), `src/settings.ts` (`RestoreBackupModal`; Host-Interface)
- Test: manuelle/Typecheck-Verifikation (Rotationslogik in Task 5 getestet).

**Interfaces:**
- Consumes: `BACKUP_SUBDIR`, `backupDirName`, `selectBackupsToDelete`, `sortBackupsNewestFirst`, `BackupEntry` aus `./index_backup`; `migrateIndex`, `INDEX_REQUIRED_FILES` aus `./index_migrate`.
- Produces:
  - `main.ts`: `private backupsRoot(): string` (= `${this.manifest.dir}/${BACKUP_SUBDIR}`), `async snapshotIndex(): Promise<void>`, `async listBackups(): Promise<BackupEntry[]>`, `async restoreBackup(name: string): Promise<void>`
  - `VaultRagPluginHost.listBackups()`, `.restoreBackup(name)` (Interface)
  - Command `id: "restore-index-backup"`

- [ ] **Step 1: `backupsRoot` + `snapshotIndex` (mit Rotation)**

```typescript
  private backupsRoot(): string { return `${this.manifest.dir}/${BACKUP_SUBDIR}`; }

  /** Kopiert den aktuellen Index geräte-lokal (Plugin-Ordner, synct nicht) und rotiert auf 3. */
  async snapshotIndex(): Promise<void> {
    try {
      const root = this.backupsRoot();
      // Zeitstempel aus dem Manifest (fällt sonst auf lastMtime zurück).
      let builtAt = "";
      try { const m = JSON.parse(await this.app.vault.adapter.read(`${this.settings.indexDir}/manifest.json`)) as { built_at?: string }; builtAt = m.built_at ?? ""; } catch { /* ignore */ }
      if (!builtAt) builtAt = new Date(this.lastMtime || Date.now()).toISOString();
      const name = backupDirName(builtAt);
      const dest = `${root}/${name}`;
      if (await this.app.vault.adapter.exists(`${dest}/manifest.json`)) return; // schon gesichert
      await migrateIndex(this.app.vault.adapter, this.settings.indexDir, dest);
      // Rotation: vorhandene Backup-Verzeichnisse listen → älteste über 3 löschen.
      const existing = await this.backupNames();
      for (const del of selectBackupsToDelete(existing, 3)) {
        try {
          const listing = await this.app.vault.adapter.list(`${root}/${del}`);
          for (const f of listing.files ?? []) await this.app.vault.adapter.remove(f);
          await this.app.vault.adapter.rmdir(`${root}/${del}`, false);
        } catch { /* Rotations-Fehler nicht fatal */ }
      }
    } catch (e) { console.warn("vault-rag: snapshotIndex failed", e); }
  }

  private async backupNames(): Promise<string[]> {
    try {
      const listing = await this.app.vault.adapter.list(this.backupsRoot());
      return (listing.folders ?? []).map(p => p.split("/").pop() ?? p);
    } catch { return []; }
  }
```
Imports in main.ts: `import { BACKUP_SUBDIR, backupDirName, selectBackupsToDelete, sortBackupsNewestFirst, BackupEntry } from "./index_backup";` und `migrateIndex` aus `"./index_migrate"` (prüfen, ob bereits importiert — `changeIndexDir` nutzt es evtl. schon).

- [ ] **Step 2: Snapshot-Auslöser einbauen**

Im `loaded-ok`-Zweig von `loadIndex` (nach `this.indexHealthy = true;`, vor dem Self-Heal-Check): `void this.snapshotIndex();` (fire-and-forget, blockiert das Laden nicht).
In `LiveIndexer` kann der „vor riskantem persist"-Trigger nicht direkt Backups schreiben (pure-core). Stattdessen: in `handleModify`s `catch (e instanceof PersistBlockedError)` (Task 7) zusätzlich `void this.snapshotIndex();` — sichert den *noch auf Platte liegenden guten* Index, bevor weitere Versuche kommen.

- [ ] **Step 3: `listBackups` + `restoreBackup`**

```typescript
  async listBackups(): Promise<BackupEntry[]> {
    const names = await this.backupNames();
    const entries: BackupEntry[] = [];
    for (const name of names) {
      let count = 0;
      try { const m = JSON.parse(await this.app.vault.adapter.read(`${this.backupsRoot()}/${name}/manifest.json`)) as { count?: number }; count = m.count ?? 0; } catch { /* ignore */ }
      entries.push({ name, count });
    }
    return sortBackupsNewestFirst(entries);
  }

  async restoreBackup(name: string): Promise<void> {
    const src = `${this.backupsRoot()}/${name}`;
    // Vollständigkeit prüfen, bevor wir den aktiven Index ersetzen.
    for (const f of INDEX_REQUIRED_FILES) {
      if (!(await this.app.vault.adapter.exists(`${src}/${f}`))) { new Notice(`Backup „${name}" unvollständig — Wiederherstellung abgebrochen.`); return; }
    }
    await migrateIndex(this.app.vault.adapter, src, this.settings.indexDir);
    await this.loadIndex();
    new Notice(this.indexHealthy ? "Index aus Backup wiederhergestellt." : "Wiederhergestellter Index ließ sich nicht laden.");
  }
```
Import erweitern: `import { migrateIndex, INDEX_REQUIRED_FILES } from "./index_migrate";`

- [ ] **Step 4: `RestoreBackupModal` + Command + Host-Interface**

In `settings.ts`:
```typescript
export class RestoreBackupModal extends Modal {
  constructor(app: App, private entries: { name: string; count: number }[], private onPick: (name: string) => void) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Aus Backup wiederherstellen" });
    if (this.entries.length === 0) { contentEl.createEl("p", { text: "Keine Backups vorhanden." }); return; }
    for (const e of this.entries) {
      const row = new Setting(contentEl).setName(`${e.count.toLocaleString("de-DE")} Notizen`).setDesc(e.name);
      row.addButton(b => b.setButtonText("Wiederherstellen").setWarning().onClick(() => { this.close(); this.onPick(e.name); }));
    }
  }
  onClose(): void { this.contentEl.empty(); }
}
```
Command in `main.ts` onload:
```typescript
    this.addCommand({
      id: "restore-index-backup",
      name: "Index aus Backup wiederherstellen",
      callback: () => void (async () => { new RestoreBackupModal(this.app, await this.listBackups(), (n) => void this.restoreBackup(n)).open(); })(),
    });
```
`RestoreBackupModal` in main.ts importieren; Host-Interface um `listBackups(): Promise<{ name: string; count: number }[]>;` und `restoreBackup(name: string): Promise<void>;` erweitern.

- [ ] **Step 5: Verifikation + Commit**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: alle grün.
```bash
git add src/main.ts src/settings.ts
git commit -m "feat(main): geräte-lokale Index-Backups — Snapshot, Rotation (N=3), Restore

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Settings-Sektion „Index-Robustheit"

**Files:**
- Modify: `src/settings.ts` (`display()` nach der Index-Sektion ~166; neue `build*`-Methoden)
- Test: `tests/settings.test.ts` (falls vorhanden ein Host-Mock existiert, um die neuen Buttons zu smoke-testen) — sonst Typecheck/Lint.

**Interfaces:**
- Consumes: Host-Methoden `reindexVault`, `healVault`, `listBackups`, `restoreBackup`; Feld-Zugriff auf Index-Gesundheit über einen neuen Host-Getter `indexHealthReadout(): string`.
- Produces: `VaultRagSettingTab.buildRobustnessSection()`; Host-Interface `indexHealthReadout(): string`.

- [ ] **Step 1: Host-Getter in main.ts**

```typescript
  indexHealthReadout(): string {
    if (!this.indexHealthy) return "⚠ Laden fehlgeschlagen — beschädigter Index erkannt (Schreibschutz aktiv)";
    const n = this.liveIndexer.noteCount;
    return `${n.toLocaleString("de-DE")} Notizen · gesund`;
  }
```
Host-Interface (settings.ts) um `indexHealthReadout(): string;` erweitern.

- [ ] **Step 2: Sektion rendern**

In `display()`, nach `this.buildHideIndexFolder(...)` (~166):
```typescript
    sec("Index-Robustheit");
    this.buildRobustnessSection(containerEl);
```
Neue Methode:
```typescript
  private buildRobustnessSection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Index-Zustand")
      .setDesc(this.plugin.indexHealthReadout());
    new Setting(containerEl)
      .setName("Index vervollständigen")
      .setDesc("Nur fehlende Notizen nachträglich einbetten (Delta) — schnell, ohne Voll-Reindex.")
      .addButton(b => b.setButtonText("Vervollständigen").onClick(() => { void this.plugin.healVault(); }));
    new Setting(containerEl)
      .setName("Aus Backup wiederherstellen")
      .setDesc("Geräte-lokale Sicherungen des Index (letzte 3). Ersetzt den aktuellen Index.")
      .addButton(b => b.setButtonText("Backups…").onClick(() => { void (async () => {
        new RestoreBackupModal(this.app, await this.plugin.listBackups(), (n) => void this.plugin.restoreBackup(n)).open();
      })(); }));
    new Setting(containerEl)
      .setName("Vault neu indizieren")
      .setDesc("Baut den kompletten Index von Grund auf neu — der letzte Ausweg.")
      .addButton(b => b.setButtonText("Neu indizieren").setWarning().onClick(() => {
        new ReindexConfirmModal(this.app, () => { void this.plugin.reindexVault(); }).open();
      }));
  }
```
(Falls der bestehende „Vault neu indizieren"-Button schon in einer anderen Sektion steht — Zeile ~729 —, dort belassen und hier NICHT duplizieren; stattdessen nur Zustand + Vervollständigen + Backup in dieser Sektion. Beim Umsetzen prüfen und DRY halten.)

- [ ] **Step 3: Verifikation + Commit**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: alle grün.
```bash
git add src/settings.ts src/main.ts
git commit -m "feat(settings): Sektion Index-Robustheit — Zustand + Vervollständigen + Restore

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Integration, Full-Build, AGENTS.md-Nachzug

**Files:**
- Modify: `AGENTS.md` (Modul-Layout + Gotchas), ggf. `src/main.ts` (mcp-Server unberührt lassen — nur prüfen)
- Test: volle Suite + Build beider Targets.

- [ ] **Step 1: Voller Testlauf**

Run: `npm test`
Expected: alle Tests grün (Basis 538 + neue: index_guard, index_backup, live_indexer-Ergänzungen, index-Byte-Guard).

- [ ] **Step 2: Typecheck + Lint + Build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 Fehler; `main.js` UND `mcp-server.js` bauen sauber (der MCP-Server nutzt `parseIndex` mit — der neue Byte-Guard ist dort ein reiner Zugewinn; prüfen, dass keine mcp-Tests brechen).

- [ ] **Step 3: AGENTS.md nachziehen**

- Modul-Layout (`src/`) um `index_guard.ts` (classifyLoadResult/assertSafeToPersist/isSuspiciousShrink/diffIndexVsVault) und `index_backup.ts` (Namens-/Rotationslogik) ergänzen.
- Gotcha „`parseIndex` validiert `count == paths`, aber **nicht** `byteLength`" → aktualisieren: Byte-Guard jetzt vorhanden; abgeschnittener `notes.i8` wirft laut → Gefahrenzustand statt Clobber.
- Neuen Gotcha: „persist ist gegen Clobber/Shrink geguarded (`reason`-Parameter); Live-Änderungen dürfen den Count nur um ±1 senken; Backups liegen geräte-lokal unter `<plugin-dir>/index-backups/` (synct nicht)."

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): Index-Robustheit — index_guard/index_backup, Byte-Guard, Backup-Ort

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (vom Plan-Autor)

**Spec-Coverage:**
- Threat „In-Process-Clobber" → Task 3 (persist-Guard) + Task 6 (Gefahrenzustand). ✓
- Threat „Stiller Garbage" → Task 2 (Byte-Guard). ✓
- Threat „Cross-Device-Clobber" → `isSuspiciousShrink` (Task 1) + Reload-Guard. **Lücke:** der Plan verdrahtet `isSuspiciousShrink` noch nicht in `maybeReload`. **Nachtrag unten (Task 6b)** ergänzt das. ✓ nach Nachtrag.
- Threat „Unbemerkter Teilverlust" → Task 6 (laut) + Task 8 (Auto-Erkennung). ✓
- Self-Heal (Variante C: Auto-Erkennung + Bestätigung + Command) → Task 8. ✓
- Backup-Rotation (geräte-lokal, N=3, Load-Snapshot + vor riskantem persist, Restore) → Task 5 + Task 9. ✓
- Sichtbarkeit (Statusleiste + Settings-Sektion) → Task 6 + Task 10. ✓
- Tests → jede pure-core-Einheit hat eigene Tests. ✓

**Nachtrag Task 6b (Reload-Shrink-Guard) — in die Umsetzung von Task 6 integrieren:**
In `maybeReload`, bevor `await this.loadIndex()` bei mtime-Änderung aufgerufen wird, den nachzuladenden Count gegen den aktuellen In-Memory-Count prüfen. Da der Count erst nach dem Laden bekannt ist, lädt man in eine **temporäre** Prüfung: einfacher Ansatz — nach dem `loadIndex()` prüfen, ob der frisch geladene Index via `isSuspiciousShrink(vorherCount, this.index.count)` verdächtig kleiner ist als der vorherige; falls ja, den vorherigen In-Memory-Index NICHT verwerfen, sondern Meldung + Heal-Angebot. Konkret:
```typescript
  async maybeReload() {
    if (this.isSwitchingIndexDir) return;
    try {
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/manifest.json`);
      if (st && st.mtime !== this.lastMtime) {
        const prevCount = this.index?.count ?? 0;
        const prevIndex = this.index, prevRetriever = this.retriever;
        this.lastMtime = st.mtime;
        await this.loadIndex();
        if (this.index && isSuspiciousShrink(prevCount, this.index.count)) {
          // Fremd-Gerät hat einen drastisch kleineren Index gesynct → guten Bestand behalten.
          this.index = prevIndex; this.retriever = prevRetriever;
          if (prevIndex) this.liveIndexer.init(prevIndex);
          new Notice(`vault-rag: Ein anderes Gerät hat einen kleineren Index gesynct (${this.index?.count ?? 0} statt ${prevCount}). Guter Index behalten — „Index vervollständigen", um zu vereinen.`, 10000);
        }
      }
    } catch { /* noch kein Index */ }
  }
```
`isSuspiciousShrink` in den main.ts-Import aufnehmen. Dieser Nachtrag ist Teil von Task 6.

**Placeholder-Scan:** Kein TBD/TODO; jeder Code-Schritt zeigt konkreten Code. ✓
**Typ-Konsistenz:** `persist(reason)`, `PersistReason`, `PersistBlockedError.kind`, `healMissing`-Rückgabe `number`, `BackupEntry {name,count}` durchgängig konsistent zwischen den Tasks. ✓

## Execution Handoff

Plan gespeichert. Umsetzung über **subagent-driven-development** (vom User autonom gewünscht).
