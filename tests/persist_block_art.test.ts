import { describe, it, expect, vi } from "vitest";
import VaultRagPlugin from "../src/main";
import { PersistBlockedError } from "../src/vendor/kit/index-guard";
import "../src/i18n/strings";

/** Die Art der Schreib-Blockade bleibt nachlesbar (Welle 34, iPhone-Meldung „Index wirkt beschädigt“: ohne die Art ist die Ursache am Gerät nicht zu benennen). */
function melde(fake: { lastPersistBlock: unknown }, e: unknown): string {
  const proto = VaultRagPlugin.prototype as unknown as { persistBlockedMessage(this: unknown, e: unknown, fallback: string): string; blockedMessage(kind: unknown, fb: string): string };
  return proto.persistBlockedMessage.call(Object.assign(fake, { blockedMessage: proto.blockedMessage }), e, "ALLGEMEIN");
}

describe("lastPersistBlock", () => {
  it("merkt sich die Art, die allgemeine Meldung bleibt für sie unverändert", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = { lastPersistBlock: null as { kind: string; at: number } | null };
    const text = melde(fake, new PersistBlockedError("unreadable", "x"));
    expect(text).toBe("ALLGEMEIN");
    expect(fake.lastPersistBlock?.kind).toBe("unreadable");
  });

  it("model-mismatch bekommt weiter seinen eigenen Text und wird ebenfalls gemerkt", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = { lastPersistBlock: null as { kind: string; at: number } | null };
    expect(melde(fake, new PersistBlockedError("model-mismatch", "x"))).not.toBe("ALLGEMEIN");
    expect(fake.lastPersistBlock?.kind).toBe("model-mismatch");
  });

  it("Gegenprobe: ein fremder Fehler wird nicht gemerkt", () => {
    const fake = { lastPersistBlock: null as { kind: string; at: number } | null };
    expect(melde(fake, new Error("anders"))).toBe("ALLGEMEIN");
    expect(fake.lastPersistBlock).toBeNull();
  });
});
