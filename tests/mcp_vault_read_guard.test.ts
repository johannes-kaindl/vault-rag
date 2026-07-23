import { describe, it, expect } from "vitest";
import { makeVaultReadGuard } from "../src/mcp/vault_read_guard";

// Der Guard laesst nur Pfade durch, die Obsidian selbst als Vault-Datei kennt. Die
// Vault-Mitgliedschaft wird injiziert, damit diese Datei ohne obsidian und ohne node:fs
// auskommt (siehe Spec 2026-07-23: Direct-Filesystem-Access-Warning).
const KNOWN = new Set(["a.md", "sub/b.md"]);
const isKnownVaultFile = (rel: string) => KNOWN.has(rel);
const read = async (rel: string) => `Inhalt von ${rel}`;

describe("makeVaultReadGuard", () => {
  it("liest eine bekannte Vault-Datei", async () => {
    const guard = makeVaultReadGuard(isKnownVaultFile, read);
    await expect(guard("a.md")).resolves.toBe("Inhalt von a.md");
  });

  it("liest eine bekannte Datei in einem Unterordner", async () => {
    const guard = makeVaultReadGuard(isKnownVaultFile, read);
    await expect(guard("sub/b.md")).resolves.toBe("Inhalt von sub/b.md");
  });

  it("wirft fuer einen Pfad, den der Vault nicht kennt", async () => {
    const guard = makeVaultReadGuard(isKnownVaultFile, read);
    await expect(guard("unbekannt.md")).rejects.toThrow(/Vault-Datei/);
  });

  it("wirft fuer einen Path-Traversal-Versuch aus dem Vault heraus", async () => {
    const guard = makeVaultReadGuard(isKnownVaultFile, read);
    await expect(guard("../outside/secret.md")).rejects.toThrow(/Vault-Datei/);
  });

  it("ruft read gar nicht erst auf, wenn der Pfad unbekannt ist", async () => {
    // Kein Leak durch einen read, der die Whitelist umgeht.
    let calls = 0;
    const countingRead = async (rel: string) => { calls++; return rel; };
    const guard = makeVaultReadGuard(isKnownVaultFile, countingRead);
    await expect(guard("unbekannt.md")).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("nennt den abgewiesenen Pfad in der Fehlermeldung", async () => {
    const guard = makeVaultReadGuard(isKnownVaultFile, read);
    await expect(guard("geheim.md")).rejects.toThrow(/geheim\.md/);
  });
});
