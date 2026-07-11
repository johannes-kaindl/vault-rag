// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeVaultReadGuard } from "../src/mcp/vault_read_guard";

describe("makeVaultReadGuard", () => {
  let vaultDir: string;
  let outsideDir: string;
  let read: (rel: string) => Promise<string>;

  beforeAll(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-rag-guard-"));
    vaultDir = path.join(root, "vault");
    outsideDir = path.join(root, "outside");
    await fs.mkdir(vaultDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    await fs.writeFile(path.join(vaultDir, "a.md"), "innerhalb des vaults");
    await fs.mkdir(path.join(vaultDir, "sub"), { recursive: true });
    await fs.writeFile(path.join(vaultDir, "sub", "b.md"), "auch innerhalb");

    await fs.writeFile(path.join(outsideDir, "secret.md"), "geheim ausserhalb");
    // Symlink INSIDE the vault pointing to a file OUTSIDE the vault.
    fssync.symlinkSync(path.join(outsideDir, "secret.md"), path.join(vaultDir, "leak.md"));

    read = (rel: string) => fs.readFile(path.join(vaultDir, rel), "utf-8");
  });

  afterAll(async () => {
    await fs.rm(path.dirname(vaultDir), { recursive: true, force: true });
  });

  it("returns content for a normal in-vault file", async () => {
    const guard = makeVaultReadGuard(vaultDir, read);
    await expect(guard("a.md")).resolves.toBe("innerhalb des vaults");
  });

  it("returns content for a nested in-vault path that resolves inside", async () => {
    const guard = makeVaultReadGuard(vaultDir, read);
    await expect(guard("sub/b.md")).resolves.toBe("auch innerhalb");
  });

  it("throws for a symlink escaping the vault", async () => {
    const guard = makeVaultReadGuard(vaultDir, read);
    await expect(guard("leak.md")).rejects.toThrow(/Symlink|Vault/);
  });
});
