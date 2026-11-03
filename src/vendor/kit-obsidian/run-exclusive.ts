// vendored from obsidian-kit@0.77.0, src/obsidian/run-exclusive.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Hintereinander je Schlüssel: der nächste Lauf startet, wenn der vorige fertig ist, auch wenn er fehlschlug.
 *
 *  Herkunft: dateiprivat in `share-export.ts` (je Export-Ordner), dort herausgelöst, als der Chat-Verlauf (`chat-archive`) dieselbe Zusage brauchte:
 *  Schreibzugriffe auf einen Ordner dürfen sich nicht überholen, sonst gewinnt der ältere Stand. Kein `obsidian`-Import; nach der ersten Frage der
 *  Kit-`AGENTS.md` gehört die Funktion nach code-kit (Task im Kit-Cockpit), bis dahin liegt sie hier neben den beiden Verwendern.
 *  Die Schlange gilt je Prozess und je Schlüssel, nicht über zwei Obsidian-Fenster oder zwei Geräte. */
const running = new Map<string, Promise<unknown>>();

export function runExclusive<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = running.get(key) ?? Promise.resolve();
  const next = prev.then(job, job);
  const tail = next.catch(() => undefined);
  running.set(key, tail);
  void tail.then(() => { if (running.get(key) === tail) running.delete(key); });
  return next;
}
