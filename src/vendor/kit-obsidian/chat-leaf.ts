// vendored from obsidian-kit@0.77.0, src/obsidian/chat-leaf.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { Platform, type Workspace, type WorkspaceLeaf } from "obsidian";

/** Wo ein Chat-Blatt öffnet (seit 0.77.0). Eine Wahl für alle Chat-Plugins: vorher baute jedes seine eigene Fassung (settings-assistant `openChat`, vault-rag `hubPlacement`, koda-agent `chatPlacement`,
 *  kuro-gamification `activateSidebar`), und drei von vier ließen ein in der Schublade gespeichertes Blatt für immer dort.
 *
 *  Entscheidung Johannes 2026-11-02: auf jedem Mobilgerät (Handy und Tablet, `Platform.isMobile`) öffnet die Chat-Ansicht als Tab im Hauptbereich, der Desktop bleibt in der rechten Seitenleiste. Unter der Schublade
 *  hängt Obsidians eigene Tab-Auswahl, und der Chat endet gemessen rund 155 px über der Tastatur (390 × 844 und 390 × 508, Welle 29); im Hauptbereich reicht er bis an den Rand des Geräts.
 *
 *  Die Wahl ist rein (`chatPlacement`), die Umsetzung steht in `openChatLeaf`. */

/** Wo ein schon offenes Chat-Blatt steht: gar keines, im Hauptbereich (`getRoot() === rootSplit`) oder anderswo (Seitenleiste, am Handy die Schublade). */
export type ChatLocation = "none" | "main" | "side";

/** - `existing`: ein Blatt ist offen und bleibt, wo es ist (Hauptbereich überall, Seitenleiste am Desktop).
 *  - `move-to-tab`: Mobilgerät, das Blatt steht noch in der Schublade (das Layout bleibt über Updates hinaus gespeichert): schließen, als Tab im Hauptbereich öffnen.
 *  - `tab`: kein Blatt offen, Mobilgerät: Tab im Hauptbereich.
 *  - `sidebar`: kein Blatt offen, Desktop: rechte Seitenleiste wie bisher. */
export type ChatPlacement = "existing" | "move-to-tab" | "tab" | "sidebar";

/** Die Platzierungswahl ohne `obsidian` und ohne Workspace (testbar mit einer Tabelle).
 *  @example chatPlacement("side", true) // "move-to-tab" */
export function chatPlacement(location: ChatLocation, isMobile: boolean): ChatPlacement {
  if (location === "main") return "existing";
  if (location === "side") return isMobile ? "move-to-tab" : "existing";
  return isMobile ? "tab" : "sidebar";
}

export interface OpenChatLeafOptions {
  /** Überschreibt `Platform.isMobile` (Tests, Piloten). */
  isMobile?: boolean;
}

/** Neuer Tab im Hauptbereich. Hat der Hauptbereich keine Tab-Gruppe, wirft Obsidian „No tab group found“ (kuro-gamification hat es so gemessen): dann geht die Ansicht in die Schublade,
 *  statt gar nicht aufzugehen. */
function tabLeaf(workspace: Workspace): WorkspaceLeaf | null {
  try {
    return workspace.getLeaf("tab");
  } catch {
    return workspace.getRightLeaf(false);
  }
}

/** Öffnet (oder findet) das Chat-Blatt der Ansicht `viewType` nach `chatPlacement`, setzt die Ansicht (nur an einem neuen Blatt), zeigt es und gibt es zurück; `null`, wenn Obsidian kein Blatt liefert.
 *  Ein Aufruf genügt dem Plugin: Befehl, Ribbon-Knopf und `activateView` rufen diese eine Funktion.
 *
 *  - Desktop: ein vorhandenes Blatt (in jeder Seitenleiste oder im Hauptbereich) bleibt, sonst `getRightLeaf(false)`.
 *  - Mobilgerät: ein vorhandenes Blatt im Hauptbereich bleibt; **alle** vorhandenen Blätter außerhalb davon werden geschlossen, und die Ansicht öffnet als Tab im Hauptbereich (vault-rag: `move-to-tab`);
 *    sonst ein neuer Tab. Die Ansicht muss ihren Zustand beim Schließen verlieren können (der Chat hält ihn im Plugin, nicht im Blatt).
 *
 *  @example const leaf = await openChatLeaf(this.app.workspace, VIEW_TYPE_CHAT); */
export async function openChatLeaf(workspace: Workspace, viewType: string, opts: OpenChatLeafOptions = {}): Promise<WorkspaceLeaf | null> {
  const isMobile = opts.isMobile ?? Platform.isMobile;
  const existing = workspace.getLeavesOfType(viewType);
  const first = existing[0];
  const location: ChatLocation = first === undefined ? "none" : first.getRoot() === workspace.rootSplit ? "main" : "side";
  const place = chatPlacement(location, isMobile);
  if (place === "move-to-tab") for (const leaf of existing) leaf.detach();
  const leaf = place === "existing" ? (first ?? null) : place === "sidebar" ? workspace.getRightLeaf(false) : tabLeaf(workspace);
  if (leaf === null) return null;
  if (place !== "existing") await leaf.setViewState({ type: viewType, active: true });
  await workspace.revealLeaf(leaf);
  return leaf;
}
