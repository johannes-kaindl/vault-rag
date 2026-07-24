/** Schutz für den MCP-Lesezugriff: es passieren nur Pfade, die Obsidian selbst als
 *  Vault-Datei kennt. Die Vault-Mitgliedschaft wird injiziert, damit diese Datei weder
 *  `obsidian` noch ein node:-Builtin importiert (Mobile lädt keine Node-Builtins, und der
 *  Store-Scan flaggt jeden direkten fs-Zugriff als "Direct Filesystem Access").
 *
 *  Bewusster Trade-off (Spec 2026-07-23): Der frühere realpath-Check erkannte zusätzlich
 *  Symlinks, die aus dem Vault herausführen. Das ist entfallen — ein Symlink, den Obsidian
 *  selbst als Vault-Datei listet, wird gelesen. Das entspricht dem Verhalten von Obsidian
 *  und vergleichbaren Plugins; Path-Traversal ist dafür strenger abgedeckt als zuvor, weil
 *  nur real existierende Vault-Dateien durchkommen. */
export function makeVaultReadGuard(
  isKnownVaultFile: (rel: string) => boolean,
  read: (rel: string) => Promise<string>,
): (rel: string) => Promise<string> {
  return async (rel: string) => {
    if (!isKnownVaultFile(rel)) {
      throw new Error(`Keine bekannte Vault-Datei: "${rel}"`);
    }
    return read(rel);
  };
}
