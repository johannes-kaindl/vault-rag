// vendored from code-kit@0.77.0, src/ts/pure/throttle-embedder.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: vault-rag task "Reindex drosseln — kurze Embedding-Anfragen warten hinter Batches bis zu 30 s auf dem geteilten Ollama" (2026-11-06; decision
// Breite-Master 2026-11-15, confirmed 2026-11-18: a kit wrapper, no local build in vault-rag). Sits next to `embeddings-client` (the `Embedder` interface).

import type { Embedder } from "./embeddings-client";

/** `throttleEmbedder(embedder, opts)`: the same `Embedder`, but with one call at a time and a rest after each call, so a runner that serves several clients
 *  (a shared Ollama: the embedding runner runs with `-np 1`, one request at a time, measured in llm-setup) keeps room for the short requests of the others.
 *
 *  ── What it does ────────────────────────────────────────────────────────────────────────
 *  - At most ONE `embed` call of the inner embedder at a time; the others wait in the order they came (FIFO).
 *  - After each call a pause of `faktor × duration of that call` (measured with `now`) before the next waiting one starts: `faktor: 1` leaves the
 *    runner free half of the time, `0.5` a third, `2` two thirds; `faktor: 0` is no pause. The pause comes after a failed call too (the runner was busy).
 *    The caller of a call does not wait for the pause after ITS call: its promise settles when the inner call has.
 *  - `slice`: a `texts` array longer than `slice` is cut into pieces of that size, each piece one inner call with the pause after it, the result put
 *    together in the order of the input. A piece does not hold the queue: after each piece the rest of the call goes to the BACK of the queue, so a short
 *    call that arrived meanwhile is served between two pieces (that is what slicing is for). Without `slice` one call is one inner call, whatever its
 *    size (the inner client may still send several requests for it, one after the other, without a pause between them).
 *  - `signal`: a call that is still waiting, or between two pieces, leaves the queue AT ONCE with an `Error` named `AbortError` and the inner embedder is
 *    not called for it (a call whose signal is already aborted does not even queue). A call that is running hands the signal to the inner embedder and
 *    settles as that does; the pause after it applies anyway.
 *  - An error of the inner embedder reaches only the call it belongs to (the rest of a sliced call is not run); the queue goes on.
 *
 *  ── What it asks of the caller ──────────────────────────────────────────────────────────
 *  - `faktor` is a finite number of at least 0, else the builder throws (a programming error, not a state to run in): `NaN`, a negative value and
 *    `Infinity` (a pause that never ends) are refused. `slice`, if given, is an integer of at least 1.
 *  - `sleep` is needed as soon as `faktor > 0`: this layer sets no timer of its own (as `createEmbeddingClient` with `timers`), so the builder throws
 *    without it. `now` defaults to `Date.now` (a clock that steps back counts as a duration of 0).
 *  - An empty `texts` array answers `[]` at once, without the queue and without the inner embedder (it takes no runner time).
 *
 *  Not here: a limit of the pause or a rule by load; the factor is the whole policy. */
export interface ThrottleOptions {
  /** Pause after a call as a multiple of the duration of that call. Finite, ≥ 0. */
  faktor: number;
  /** Texts per inner call; larger arrays are cut. Integer ≥ 1. Absent: no cutting. */
  slice?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Entry {
  texts: string[];
  /** Position in the original input of the first text of the piece still to do. */
  offset: number;
  piece: string[];
  signal: AbortSignal | undefined;
  results: Float32Array[];
  resolve(r: Float32Array[]): void;
  reject(e: unknown): void;
  onAbort?: () => void;
}

function abortError(): Error {
  const e = new Error("throttleEmbedder: aborted while waiting");
  e.name = "AbortError";
  return e;
}

export function throttleEmbedder(embedder: Embedder, opts: ThrottleOptions): Embedder {
  const { faktor, slice } = opts;
  if (typeof faktor !== "number" || !Number.isFinite(faktor) || faktor < 0) {
    throw new Error(`throttleEmbedder: faktor must be a finite number >= 0, got ${String(faktor)}`);
  }
  if (slice !== undefined && (!Number.isInteger(slice) || slice < 1)) {
    throw new Error(`throttleEmbedder: slice must be an integer >= 1, got ${String(slice)}`);
  }
  if (faktor > 0 && opts.sleep === undefined) {
    throw new Error("throttleEmbedder: faktor > 0 needs sleep (this layer sets no timer of its own)");
  }
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep;
  const queue: Entry[] = [];
  let draining = false;

  /** Takes `entry` out of the queue when it is in it. */
  function leave(entry: Entry): boolean {
    const i = queue.indexOf(entry);
    if (i === -1) return false;
    queue.splice(i, 1);
    return true;
  }

  function detach(entry: Entry): void {
    if (entry.onAbort) entry.signal?.removeEventListener("abort", entry.onAbort);
    entry.onAbort = undefined;
  }

  function enqueue(entry: Entry): void {
    if (entry.signal?.aborted) { detach(entry); entry.reject(abortError()); return; }
    if (entry.signal && !entry.onAbort) {
      entry.onAbort = () => {
        if (leave(entry)) { detach(entry); entry.reject(abortError()); }
      };
      entry.signal.addEventListener("abort", entry.onAbort, { once: true });
    }
    queue.push(entry);
    if (!draining) void drain();
  }

  function pieceOf(texts: string[], offset: number): string[] {
    return slice === undefined ? texts.slice(offset) : texts.slice(offset, offset + slice);
  }

  async function drain(): Promise<void> {
    draining = true;
    try {
      for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
        const started = now();
        let failed = false;
        let got: Float32Array[] = [];
        try {
          got = await embedder.embed(entry.piece, entry.signal ? { signal: entry.signal } : undefined);
        } catch (e) {
          failed = true;
          detach(entry);
          entry.reject(e);
        }
        const duration = Math.max(0, now() - started);
        if (!failed) {
          for (const v of got) entry.results.push(v);
          entry.offset += entry.piece.length;
          if (entry.offset >= entry.texts.length) {
            detach(entry);
            entry.resolve(entry.results);
          } else {
            // The rest goes to the back: whoever came meanwhile is served before the next piece.
            entry.piece = pieceOf(entry.texts, entry.offset);
            enqueue(entry);
          }
        }
        const pause = faktor * duration;
        if (pause > 0 && sleep !== undefined) {
          try {
            await sleep(pause);
          } catch {
            // A sleep that fails must not stop the queue; the next call starts without the rest.
          }
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    embed(texts: string[], callOpts?: { signal?: AbortSignal }): Promise<Float32Array[]> {
      const signal = callOpts?.signal;
      if (signal?.aborted) return Promise.reject(abortError());
      if (texts.length === 0) return Promise.resolve([]);
      return new Promise<Float32Array[]>((resolve, reject) => {
        enqueue({ texts, offset: 0, piece: pieceOf(texts, 0), signal, results: [], resolve, reject });
      });
    },
  };
}
