import { describe, it, expect, vi } from "vitest";
import { EmbeddingPause, EmbeddingPauseStorageError, EMBEDDING_PAUSE_KEY, type PauseStorage } from "../src/embedding_pause";

function memStorage(): PauseStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

describe("EmbeddingPause", () => {
  it("startet nicht pausiert; setPaused schreibt \"1\" unter dem festen Schlüssel und löscht beim Fortsetzen", () => {
    const st = memStorage(); const p = new EmbeddingPause(st);
    expect(p.isPaused()).toBe(false);
    p.setPaused(true);
    expect(st.data.get(EMBEDDING_PAUSE_KEY)).toBe("1");
    expect(p.isPaused()).toBe(true);
    p.setPaused(false);
    expect(st.data.has(EMBEDDING_PAUSE_KEY)).toBe(false);
    expect(p.isPaused()).toBe(false);
  });
  it("überlebt einen Neustart: eine neue Instanz auf demselben Speicher liest die Pause", () => {
    const st = memStorage(); new EmbeddingPause(st).setPaused(true);
    expect(new EmbeddingPause(st).isPaused()).toBe(true);
  });
  it("nur der Wert \"1\" pausiert", () => {
    const st = memStorage(); st.data.set(EMBEDDING_PAUSE_KEY, "true");
    expect(new EmbeddingPause(st).isPaused()).toBe(false);
  });
  it("Abonnenten bekommen jede Änderung genau einmal; abgemeldete nicht mehr", () => {
    const p = new EmbeddingPause(memStorage()); const fn = vi.fn();
    const off = p.subscribe(fn);
    p.setPaused(true); p.setPaused(true); p.setPaused(false);
    expect(fn.mock.calls).toEqual([[true], [false]]);
    off(); p.setPaused(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("refresh() nach einem storage-Event eines anderen Fensters meldet die Änderung", () => {
    const st = memStorage(); const a = new EmbeddingPause(st); const b = new EmbeddingPause(st);
    const fn = vi.fn(); b.subscribe(fn);
    a.setPaused(true);                 // Fenster A
    expect(fn).not.toHaveBeenCalled(); // B weiß es noch nicht
    b.refresh();                       // storage-Event in B
    expect(fn).toHaveBeenCalledWith(true);
  });
  it("gesperrter Speicher: Lesen gilt als nicht pausiert, Schreiben wirft den typisierten Fehler", () => {
    const kaputt: PauseStorage = { getItem: () => { throw new Error("gesperrt"); }, setItem: () => { throw new Error("gesperrt"); }, removeItem: () => { throw new Error("gesperrt"); } };
    const p = new EmbeddingPause(kaputt);
    expect(p.isPaused()).toBe(false);
    expect(() => p.setPaused(true)).toThrow(EmbeddingPauseStorageError);
    expect(() => new EmbeddingPause(null).setPaused(true)).toThrow(EmbeddingPauseStorageError);
  });
  it("whenResumed löst sofort auf, wenn nicht pausiert, und erst beim Fortsetzen, wenn pausiert", async () => {
    const p = new EmbeddingPause(memStorage());
    await p.whenResumed();
    p.setPaused(true);
    let done = false; const w = p.whenResumed().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    p.setPaused(false);
    await w;
    expect(done).toBe(true);
  });
});
