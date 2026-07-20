/** Die Node-Operationen, die der Guard braucht. Wird von aussen injiziert, damit diese
 *  Datei keinen node:-Import enthaelt (Obsidian-Mobile laedt keine Node-Builtins). */
export interface GuardIo {
  realpath(p: string): Promise<string>;
  join(...parts: string[]): string;
  sep: string;
}

/** Desktop-only Symlink-Escape-Schutz: liest eine vault-relative Datei nur, wenn ihr
 *  real aufgelöster Pfad unter dem Vault-Root bleibt (adapter.read folgt Symlinks). */
export function makeVaultReadGuard(
  basePath: string,
  read: (rel: string) => Promise<string>,
  io: GuardIo,
): (rel: string) => Promise<string> {
  return async (rel: string) => {
    const full = io.join(basePath, rel);
    const [realFull, realRoot] = await Promise.all([io.realpath(full), io.realpath(basePath)]);
    if (realFull !== realRoot && !realFull.startsWith(realRoot + io.sep)) {
      throw new Error(`Pfad verlässt den Vault (Symlink): "${rel}"`);
    }
    return read(rel);
  };
}
