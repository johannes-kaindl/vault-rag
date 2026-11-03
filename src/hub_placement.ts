/** Wo steht ein offener Hub: gar nicht offen, im Hauptbereich oder in einer Seitenleiste (am Handy die Schublade). */
export type HubLocation = "none" | "main" | "side";

/** Wo öffnet der Hub (reine Wahl, ohne `obsidian`-Import — `main.ts` steht an der Kante und ist nicht getestet)?
 *  - `existing`: ein Hub ist schon offen und bleibt, wo er ist (Hauptbereich überall, Seitenleiste am Desktop).
 *  - `tab`: kein Hub offen, Mobilgerät (Handy und Tablet): Tab im Hauptbereich. In der Schublade hängt Obsidians eigene Tab-Auswahl, und der Chat
 *    endet gemessen rund 155 px über der Tastatur (390 × 844 und 390 × 508, Welle 29); im Hauptbereich reicht er bis an den Rand des Geräts
 *    (Entscheidung Johannes 2026-11-02).
 *  - `move-to-tab`: Mobilgerät, der Hub steht noch in der Schublade (das Layout bleibt über das Update hinaus gespeichert): schließen, als Tab öffnen.
 *  - `sidebar`: kein Hub offen, Desktop: rechte Seitenleiste wie bisher. */
export type HubPlacement = "existing" | "tab" | "move-to-tab" | "sidebar";

export function hubPlacement(open: HubLocation, isMobile: boolean): HubPlacement {
  if (open === "main") return "existing";
  if (open === "side") return isMobile ? "move-to-tab" : "existing";
  return isMobile ? "tab" : "sidebar";
}
