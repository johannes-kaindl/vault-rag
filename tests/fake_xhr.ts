import { vi } from "vitest";

/** Stubt XMLHttpRequest und gibt Treiber-Helfer zurück:
 *  feed() spielt onprogress-Chunks + onload ein, error() simuliert onerror, body liest den Request-Body. */
export function installFakeXHR(): { readonly body: string; feed(chunks: string[], status?: number): void; error(): void } {
  const state: { inst: any } = { inst: null };
  vi.stubGlobal("XMLHttpRequest", class {
    status = 200;
    responseText = "";
    body = "";
    onprogress: (() => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    constructor() { state.inst = this; }
    open(): void {}
    setRequestHeader(): void {}
    send(b?: string): void { this.body = b ?? ""; }
    abort(): void { this.onabort?.(); }
  });
  return {
    get body(): string { return state.inst.body as string; },
    feed(chunks: string[], status = 200): void {
      state.inst.status = status;
      for (const c of chunks) { state.inst.responseText += c; state.inst.onprogress?.(); }
      state.inst.onload?.();
    },
    error(): void { state.inst.onerror?.(); },
  };
}
