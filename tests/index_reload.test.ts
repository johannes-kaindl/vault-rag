import { describe, it, expect } from "vitest";
import { IndexReloadWatch } from "../src/index_reload";

/** Eine Platte mit steuerbarer mtime und ein Lauf-Zustand, den der Test umlegt. */
function makeWatch(initialMtime: number | null) {
  const disk = { mtime: initialMtime as number | null };
  const run = { busy: false };
  const watch = new IndexReloadWatch({ mtime: async () => disk.mtime, busy: () => run.busy });
  return { disk, run, watch };
}

describe("IndexReloadWatch — wann lädt maybeReload den Index neu?", () => {
  it("ein eigenes Schreiben löst keinen Reload aus, wenn es nachgezogen wurde", async () => {
    const { disk, watch } = makeWatch(100);
    watch.note(100);

    disk.mtime = 200;                  // eigener persist("live") schreibt index.bin
    await watch.adoptOwnWrite();

    expect(await watch.foreignChange()).toBe(false);
  });

  it("Gegenprobe: eine fremde Änderung (mtime ohne eigenes Schreiben) löst genau einen Reload aus", async () => {
    const { disk, watch } = makeWatch(100);
    watch.note(100);

    disk.mtime = 200;                  // Sync von einem anderen Gerät

    expect(await watch.foreignChange()).toBe(true);
    expect(await watch.foreignChange()).toBe(false);   // derselbe Stand löst nicht noch einmal aus
  });

  it("während ein eigener Lauf schreibt, löst auch eine neue mtime keinen Reload aus; nach dem Lauf und dem Nachziehen bleibt es still, eine spätere fremde Änderung gilt wieder", async () => {
    const { disk, run, watch } = makeWatch(100);
    watch.note(100);

    run.busy = true;
    disk.mtime = 150;                  // Zwischenstand von LiveIndexer.reindexAll (persistCheckpoint)
    expect(await watch.foreignChange()).toBe(false);
    disk.mtime = 175;                  // zweiter Zwischenstand
    expect(await watch.foreignChange()).toBe(false);

    disk.mtime = 190;                  // Endstand des Laufs
    run.busy = false;
    await watch.adoptOwnWrite();       // das Ende des Laufs zieht nach
    expect(await watch.foreignChange()).toBe(false);

    disk.mtime = 300;                  // jetzt schreibt jemand anderes
    expect(await watch.foreignChange()).toBe(true);
  });

  it("ohne Container-Datei gibt es nichts neu zu laden", async () => {
    const { watch } = makeWatch(null);
    expect(await watch.foreignChange()).toBe(false);
  });

  it("note() merkt den Stand eines Ladevorgangs; lastSeen gibt ihn weiter (Fallback für den Snapshot-Zeitstempel)", () => {
    const { watch } = makeWatch(100);
    expect(watch.lastSeen).toBe(0);
    watch.note(123);
    expect(watch.lastSeen).toBe(123);
  });
});
