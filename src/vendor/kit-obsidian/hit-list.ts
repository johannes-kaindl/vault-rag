// vendored from obsidian-kit@0.54.0, src/obsidian/hit-list.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/view.ts (renderHits) und vault-rag/styles.css (vault-rag-hit*), 2026-10-11
import type { Hit } from "../kit/vector-index";

/**
 * Trefferliste einer Ähnlichkeits- oder Volltextsuche: pro Treffer eine Zeile mit dem Dateinamen (ohne `.md`) und dem
 * Wert (`score.toFixed(2)`). Ohne `actions` ist die GANZE Zeile klickbar und öffnet den Pfad. Mit `actions` öffnet nur
 * der Titel; der Slot bekommt Zeile und Treffer und hängt seine Knöpfe selbst an die Zeile, sonst träfe ein Klick auf
 * „Ablehnen“ auch `openPath`. Die Zeile trägt dann den Modifier `okit-hit-split`, damit nur der Titel den Zeiger-Cursor zeigt.
 *
 * Das CSS (`HIT_LIST_CSS`) kopiert der Consumer in seine `styles.css` (Kit-Vertrag, Muster `ENDPOINT_LIST_CSS`).
 *
 * Origin: vault-rag `renderHits` (drei Aufrufer: Ähnlich, Suche, Integrator). Gleiche Darstellung, Klassen `vault-rag-hit*`
 * heißen jetzt `okit-hit*`; neu nur der Modifier `okit-hit-split`.
 */
export function renderHitList(
  el: HTMLElement, hits: readonly Hit[], openPath: (path: string) => void,
  actions?: (row: HTMLElement, hit: Hit) => void,
): void {
  for (const h of hits) {
    const row = el.createDiv({ cls: actions ? "okit-hit okit-hit-split" : "okit-hit" });
    const name = h.path.split("/").pop()?.replace(/\.md$/, "") ?? h.path;
    const title = row.createSpan({ cls: "okit-hit-title", text: name });
    row.createSpan({ cls: "okit-hit-score", text: h.score.toFixed(2) });
    if (actions) { title.addEventListener("click", () => openPath(h.path)); actions(row, h); }
    else row.addEventListener("click", () => openPath(h.path));
  }
}

/** Kopieren in die `styles.css` des Plugins. Nur Theme-Variablen. */
export const HIT_LIST_CSS = `
.okit-hit { display: flex; justify-content: space-between; padding: 4px 8px; cursor: pointer; border-radius: 4px; }
.okit-hit:hover { background: var(--background-modifier-hover); }
.okit-hit-score { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.okit-hit-split { cursor: default; }
.okit-hit-split .okit-hit-title { cursor: pointer; }
`;
