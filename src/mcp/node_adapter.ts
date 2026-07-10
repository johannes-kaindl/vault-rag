import * as fs from "node:fs/promises";
import * as path from "node:path";
import { VaultAdapter } from "../index";

/** Read-only VaultAdapter über node:fs — der MCP-Server liest nur, per Konstruktion.
 *  Schreib-Methoden werfen, damit versehentliche Writes sofort auffallen. */
export class NodeVaultAdapter implements VaultAdapter {
  constructor(private root: string) {}
  private abs(p: string): string { return path.join(this.root, p); }
  async read(p: string): Promise<string> { return fs.readFile(this.abs(p), "utf-8"); }
  async readBinary(p: string): Promise<ArrayBuffer> {
    const b = await fs.readFile(this.abs(p));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  // Nicht async (throw statt await) — sonst schlägt @typescript-eslint/require-await an.
  write(): Promise<void> { return Promise.reject(new Error("NodeVaultAdapter ist read-only")); }
  writeBinary(): Promise<void> { return Promise.reject(new Error("NodeVaultAdapter ist read-only")); }
  mkdir(): Promise<void> { return Promise.reject(new Error("NodeVaultAdapter ist read-only")); }
}
