import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NodeVaultAdapter } from "../src/mcp/node_adapter";

describe("NodeVaultAdapter", () => {
  let root: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-adapter-"));
    await fs.mkdir(path.join(root, "sub"));
    await fs.writeFile(path.join(root, "sub", "note.md"), "# Hallo");
    await fs.writeFile(path.join(root, "bytes.bin"), Buffer.from([1, 2, 3]));
  });
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("liest Text relativ zum Root", async () => {
    expect(await new NodeVaultAdapter(root).read("sub/note.md")).toBe("# Hallo");
  });
  it("liest Binärdaten als ArrayBuffer", async () => {
    const buf = await new NodeVaultAdapter(root).readBinary("bytes.bin");
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("wirft bei fehlender Datei", async () => {
    await expect(new NodeVaultAdapter(root).read("gibts-nicht.md")).rejects.toThrow();
  });
  it("ist read-only: write/writeBinary/mkdir werfen", async () => {
    const a = new NodeVaultAdapter(root);
    await expect(a.write("x.md", "y")).rejects.toThrow(/read-only/);
    await expect(a.writeBinary("x.bin", new ArrayBuffer(1))).rejects.toThrow(/read-only/);
    await expect(a.mkdir("neu")).rejects.toThrow(/read-only/);
  });
});
