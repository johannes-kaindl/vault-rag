# Sidebar-Hub-Konsolidierung: 4 Sidebars → 1 Hub

**Datum:** 2026-07-06 · **Status:** validiert, bereit für Plan
**Kontext:** [`../../../AGENTS.md`](../../../AGENTS.md) · [`../../../../UI-STANDARD.md`](../../../../UI-STANDARD.md) §1

## Ziel & Motivation

vault-rag registriert heute **vier** `ItemView`s mit je eigenem Ribbon-Icon und Sidebar-Leaf:
`VIEW_TYPE_RELATED` (Verwandte Notizen), `VIEW_TYPE_SEARCH` (Semantische Suche),
`VIEW_TYPE_CHAT` (Vault Chat), `VIEW_TYPE_SMART_APPLY` (Smart Apply). Das ist genau das
Muster, das der verbindliche **UI-STANDARD §1 („Ein-Frontend-Regel", seit 2026-07-05)**
ablöst: vier konkurrierende Leaves und vier Ribbon-Icons statt eines Ortes, an dem „das
Plugin" lebt. Die Zusammenführung ist dort explizit als eigenes Vorhaben notiert; dieses
Dokument spezifiziert sie.

**Referenz-Pilot:** `vault-crews/src/obsidian/panel.ts` registriert genau einen View-Type
mit interner Tab-Navigation (Kopf → Tab-Leiste → Content → optionale Statuszeile, ein
`navState`-Feld). Wir folgen diesem Muster — mit **einer begründeten Abweichung** (siehe
§1: State-Persistenz).

**Scope:** reine Struktur-Konsolidierung. **Kein** Funktions- oder Verhaltensumbau der
einzelnen Panels, kein CSS-Redesign ihres Innenlebens (YAGNI, siehe §7).

## Architektur-Entscheidung: Panel-Interface + Container-Injection (Approach A)

Jede der vier Views wird von einem `ItemView` zu einer **Panel-Klasse**, die statt des
geerbten `this.contentEl` einen im Konstruktor übergebenen Container-`HTMLElement` bekommt
und **kein `ItemView` mehr ist**. Ein schmales gemeinsames Interface:

```ts
type TabId = "related" | "search" | "chat" | "smart-apply";

interface HubPanel {
  readonly id: TabId;
  readonly label: string;
  readonly icon: string;
  mount(container: HTMLElement): void;       // einmaliger Aufbau
  onShow?(): void;                           // Tab wird sichtbar → lazy refresh
  onHide?(): void;                           // Tab wird versteckt
  onFileOpen?(path: string | null): void;    // nur kontextsensitive Panels
  destroy(): void;                           // Streams/Intervalle abbrechen
}
```

**Warum A** (statt „ItemViews behalten + Sub-Container adoptieren" oder „ein Riesen-View
mit inline-`renderX()`-Methoden"):

- Passt zur schon vorhandenen `deps`-Injection der vier Views (`constructor(leaf, deps)` →
  `constructor(deps)`; kein globaler Zugriff, geringer Umbau).
- Macht die Panels **in Node/happy-dom testbar** (kein `ItemView`/DOM-Erbe) — der
  `VaultAdapter`-Geist aus AGENTS.md („Obsidian-Grenze dünn halten").
- Jedes Panel bleibt eine fokussierte Datei (Smart Apply allein ist ~30 KB; ein
  zusammengezogener Riesen-View verletzt „kleine, klar begrenzte Einheiten").

**Verworfen:** (B) `ItemView` kann nicht ohne echtes `WorkspaceLeaf` leben → Fake-Leaves
wären fragil. (C) Eine ~70 KB-Monsterdatei ist schlecht testbar und wartbar.

Die bestehende Render-Logik wandert nahezu 1:1 (`this.contentEl` → injizierter
`container`). Restliche `ItemView`-Kopplungen (`this.app`, `this.leaf`) werden über `deps`
bzw. Konstruktor aufgelöst — sie laufen größtenteils schon über `deps`.

## 1 · Hub-Aufbau & Lifecycle

`VaultRetrievalView extends ItemView` mit **neuem** `VIEW_TYPE_HUB =
"vault-retrieval-hub"`. Aufbau nach Pilot-Muster: **Kopf → Tab-Leiste (4 Buttons) →
Content-Container mit 4 Panel-Divs**. Hält `navState: TabId` und
`panels: Map<TabId, HubPanel>`.

- `onOpen`: alle vier Panels **einmalig** in ihre Divs mounten; alle außer dem Default auf
  `display:none`; Default-Panel `onShow()`.
- **Tab-Klick:** aktives Panel `onHide()` + Div verstecken → `navState` setzen → neues Div
  zeigen + `onShow()`. **Kein Re-Mount.**
- `onClose`: alle Panels `destroy()`.
- `navState` wird über `getState()/setState()` persistiert → Deep-Link-Commands setzen den
  Tab direkt, und der aktive Tab überlebt einen Obsidian-Layout-Reload.

**Begründete Abweichung vom Pilot (UI-STANDARD §1 verlangt Begründung für Abweichung):**
vault-crews rendert bei jedem Tab-Wechsel from-scratch. vault-rag **behält den Panel-Zustand**
(alle vier gemountet, inaktive per `display:none`), weil Chat (laufende Konversation +
SSE-Stream) und Smart Apply (Zustandsmaschine idle→running→diff→applied + laufender Stream +
Stop) zustandsreich sind — render-from-scratch würde diesen Zustand beim Tab-Wechsel
wegwerfen. Diese Abweichung wird in der Repo-`AGENTS.md` notiert.

## 2 · Kontextsensitives Lazy-Refresh

Der Hub lauscht **einmal zentral** auf `active-leaf-change`/`file-open` und hält
`currentPath`. Nur die kontextsensitiven Panels (Related, Smart Apply) implementieren
`onFileOpen(path)` — aber sie **rechnen nur, wenn sichtbar**: ein inaktives Panel merkt
sich `pendingPath` und refresht erst in `onShow()`. So sparen wir Related-Cosinus /
Smart-Apply-Ranking für unsichtbare Tabs. Chat + Suche sind nicht notiz-gekoppelt → kein
`onFileOpen`.

## 3 · Zugang: 1 Ribbon-Icon + 4 Deep-Link-Commands

- **1 Ribbon-Icon** (`layers`) öffnet den Hub auf dem zuletzt aktiven Tab.
- **4 Commands** rufen `openHub(tabId)` → Hub-Leaf finden/erstellen, revealen, `navState`
  setzen, `onShow()`. IDs/Namen bleiben wie heute (`open-related`, `open-semantic-search`,
  `open-vault-chat`, `smart-apply-active-note`) für Muscle-Memory.
- **Semantik des Deep-Links:** Der Command öffnet/aktiviert den jeweiligen Tab. Das
  **bestehende Panel-Verhalten bleibt unverändert** (Scope §7): `smart-apply-active-note`
  öffnet Hub@Smart-Apply; das Panel ist ohnehin auf die aktive Notiz gekoppelt und verhält
  sich wie heute — kein zusätzlicher Auto-Trigger wird in diesem Vorhaben ergänzt oder
  entfernt.
- **Reindex-Command** (`reindex-vault`) unverändert.

## 4 · Migration alter Leaves

Die vier alten `VIEW_TYPE_*` werden nicht mehr registriert. Ein gespeichertes
Workspace-Layout kann noch alte Leaves enthalten → sonst „unbekannter View-Type"-Leichen.
Fix in `onLayoutReady`: `getLeavesOfType(alt).forEach(l => l.detach())` für die vier
Alt-Types — **einmalig, idempotent, kostenlos** wenn nichts da ist.

## 5 · Tab-Reihenfolge & Default

- **Reihenfolge:** Ähnlich · Suche · Chat · Smart Apply (kontextsensitiv-leicht →
  eigenständig → Aktion; = bisherige Ribbon-Reihenfolge, vertraut).
- **Default beim Erstöffnen:** Ähnlich (leicht, kontextsensitiv, natürlicher Einstieg beim
  Öffnen einer Notiz).

## 6 · Test-Strategie

- Panels sind reine Klassen mit injiziertem Container → in Node/happy-dom testbar
  (`makeFakeEl`-Muster, Obsidian-Mock unter `tests/__mocks__/obsidian.ts`).
- **Neue Tests:** Hub-Navigation (Tab-Klick → richtiges Div sichtbar + `onShow`/`onHide`
  gefeuert, Panels als Spies); Lazy-Refresh (`onFileOpen` bei inaktivem Panel → **kein**
  Recompute; `onShow` → Recompute); `getState/setState`-Roundtrip für `navState`.
- **Bestehende View-Render-Tests** migrieren mit (`container` statt `contentEl`).
- **DoD:** alle Tests grün + `npm run typecheck` + `npm run lint` sauber (AGENTS.md).

## 7 · Bewusst außerhalb (YAGNI)

- **Kein** Funktions- oder Verhaltensumbau der einzelnen Panels — Verhalten identisch zu heute.
- **Kein** CSS-Redesign des Panel-Innenlebens. Neu ist nur die Tab-Leiste + Container
  (§2 nativ-first, `vault-rag-hub-*`-Klassen, ausschließlich Theme-CSS-Variablen).
- **Keine** neuen Features.

## Betroffene Dateien (grob, Details im Plan)

| Datei | Änderung |
|---|---|
| `src/hub_view.ts` (neu) | `VaultRetrievalView` + `HubPanel`-Interface + Tab-Navigation |
| `src/view.ts` | `RelatedNotesView` (ItemView) → `RelatedPanel` (HubPanel) |
| `src/search_view.ts` | `SemanticSearchView` → `SearchPanel` |
| `src/chat_view.ts` | `ChatView` → `ChatPanel` |
| `src/smart_apply_view.ts` | `SmartApplyView` → `SmartApplyPanel` |
| `src/main.ts` | 1 `registerView`, 1 Ribbon, 4 Deep-Link-Commands, Alt-Leaf-Migration |
| `styles.css` | `vault-rag-hub-*` Tab-Leiste (Theme-CSS-Variablen) |
| `AGENTS.md` | §1-Abweichung (State-Persistenz) notieren; Modul-Layout aktualisieren |
| `tests/` | Hub-Nav + Lazy-Refresh + migrierte Panel-Render-Tests |
