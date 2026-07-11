import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Desktop-only Symlink-Escape-Schutz: liest eine vault-relative Datei nur, wenn ihr
 *  real aufgelöster Pfad unter dem Vault-Root bleibt (adapter.read folgt Symlinks). */
export function makeVaultReadGuard(basePath: string, read: (rel: string) => Promise<string>): (rel: string) => Promise<string> {
  return async (rel: string) => {
    const full = path.join(basePath, rel);
    const [realFull, realRoot] = await Promise.all([fs.realpath(full), fs.realpath(basePath)]);
    if (realFull !== realRoot && !realFull.startsWith(realRoot + path.sep)) {
      throw new Error(`Pfad verlässt den Vault (Symlink): "${rel}"`);
    }
    return read(rel);
  };
}
