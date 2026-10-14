/** Pause-Schalter für Embeddings (Spec 2026-09-17/18, Entscheidungen E2–E7): gilt pro Rechner (localStorage, alle Vaults),
 *  überlebt Neustarts und hält JEDEN Embedding-Aufruf an. Obsidian-frei; der Speicher wird injiziert, damit der Kern in Node
 *  testbar bleibt. Pause ist eine Entscheidung, kein Fehler: Aufrufer zeigen `paused`, nie `offline`. */

import type { Embedder } from "./vendor/kit/embeddings-client";

export const EMBEDDING_PAUSE_KEY = "vault-retrieval:embedding-paused";

export type PauseStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Schreiben in den gesperrten Speicher. Lesen wirft nie (gilt als nicht pausiert), Schreiben meldet sich typisiert. */
export class EmbeddingPauseStorageError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "EmbeddingPauseStorageError";
  }
}

/** Ein Embedding-Aufruf ist an der Pause gescheitert, bevor eine Anfrage hinausging. */
export class EmbeddingPausedError extends Error {
  constructor() { super("Embedding is paused"); this.name = "EmbeddingPausedError"; }
}

export class EmbeddingPause {
  private readonly listeners = new Set<(paused: boolean) => void>();
  private last: boolean;

  constructor(private readonly storage: PauseStorage | null) { this.last = this.read(); }

  private read(): boolean {
    try { return this.storage?.getItem(EMBEDDING_PAUSE_KEY) === "1"; } catch { return false; }
  }

  isPaused(): boolean { return this.read(); }

  /** Setzt oder löscht die Pause und meldet Änderungen an die Abonnenten. */
  setPaused(value: boolean): void {
    if (!this.storage) throw new EmbeddingPauseStorageError("no storage");
    try {
      if (value) this.storage.setItem(EMBEDDING_PAUSE_KEY, "1"); else this.storage.removeItem(EMBEDDING_PAUSE_KEY);
    } catch (e) { throw new EmbeddingPauseStorageError(e); }
    this.refresh();
  }

  /** Liest den Speicher neu (z. B. nach einem `storage`-Event eines anderen Fensters) und meldet eine Änderung. */
  refresh(): void {
    const now = this.read();
    if (now === this.last) return;
    this.last = now;
    for (const fn of [...this.listeners]) {
      try { fn(now); } catch (e) { console.error("[vault-rag] embedding pause listener", e); }
    }
  }

  subscribe(fn: (paused: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Löst sich auf, sobald nicht (mehr) pausiert ist — sofort, wenn es nicht pausiert ist. */
  whenResumed(): Promise<void> {
    if (!this.read()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const off = this.subscribe((paused) => { if (!paused) { off(); resolve(); } });
    });
  }

  /** Die Garantie am Engpass (Spec 2026-09-17 §3.2 a): bei Pause geht KEINE Anfrage hinaus. `wait` hält den Aufruf an, bis es
   *  weitergeht (Indexer: ein Reindex steht an der Gruppengrenze, das Ergebnis ist danach Zeile für Zeile dasselbe wie ohne Pause);
   *  `throw` scheitert sofort mit `EmbeddingPausedError` (Abfragen, die eine Antwort brauchen). `beforeCall` läuft erst, wenn der
   *  Aufruf wirklich hinausgeht (Zähler). Methode statt freier Funktion: das Gate gehört zum Pause-Zustand, kein anderes Plugin hat einen. */
  gate(inner: () => Embedder, whenPaused: "wait" | "throw", beforeCall?: (texts: number) => void): Embedder {
    return {
      embed: async (texts, opts) => {
        if (this.isPaused()) {
          if (whenPaused === "throw") throw new EmbeddingPausedError();
          await this.whenResumed();
        }
        beforeCall?.(texts.length);
        return inner().embed(texts, opts);
      },
    };
  }
}
