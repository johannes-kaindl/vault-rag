// Der Lab-Client selbst kommt aus dem Kit (src/vendor/kit-obsidian/lab-client.ts, obsidian-kit 0.42.0+).
// Lokal bleibt genau eine Funktion — das Rezept (obsidian-kit/MIGRATION.md § 0.42.0 lab-client) nennt sie ausdruecklich.

/** Frische id fuer eine Nutzer-Handlung; ein Aufrufer vergibt sie EINMAL je Handlung.
 *  apiVersion 4 (turnId) klammert mehrere Aufrufe, die zu EINER Handlung gehoeren; hier ist jede
 *  Handlung genau ein Aufruf — eine Nachricht, ein Lauf, eine Umformung. */
export function newTurnId(): string {
  return crypto.randomUUID();
}
