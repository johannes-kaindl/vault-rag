/** Wo öffnet der Hub (reine Wahl, ohne `obsidian`-Import — `main.ts` steht an der Kante und ist nicht getestet)?
 *  - `existing`: ein Hub ist schon offen, er wird wiederverwendet (überall).
 *  - `tab`: Mobilgerät (Handy und Tablet), Tab im Hauptbereich. In der Schublade hängt Obsidians eigene Tab-Auswahl, und der Chat endet
 *    gemessen rund 155 px über der Tastatur (390 × 844 und 390 × 508, Welle 29); im Hauptbereich reicht er bis an den Rand des Geräts
 *    (Entscheidung Johannes 2026-11-02).
 *  - `sidebar`: Desktop, rechte Seitenleiste wie bisher. */
export type HubPlacement = "existing" | "tab" | "sidebar";

export function hubPlacement(hasOpenHub: boolean, isMobile: boolean): HubPlacement {
  if (hasOpenHub) return "existing";
  return isMobile ? "tab" : "sidebar";
}
