# Sidebar-Hub-Konsolidierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die vier Sidebar-`ItemView`s (Related, Search, Chat, Smart Apply) zu **einem** Hub-View `VaultRetrievalView` mit interner Tab-Navigation zusammenführen, gemäß UI-STANDARD §1.

**Architecture:** Approach A — Panel-Interface + Container-Injection. Jede View wird von einem `ItemView` zu einer `HubPanel`-Klasse, die einen injizierten Container-`HTMLElement` rendert. Ein `VaultRetrievalView extends ItemView` hält alle vier Panels gemountet (State-Persistenz), schaltet per `display:none` und lauscht **einmal zentral** auf Notizwechsel → `onFileOpen` (lazy-refresh nur für sichtbare kontextsensitive Panels).

**Tech Stack:** TypeScript strict · esbuild · vitest + happy-dom · Obsidian Plugin API. Referenz-Pilot: `../vault-crews/src/obsidian/panel.ts`.

**Spec:** [`../specs/2026-07-06-sidebar-hub-konsolidierung-design.md`](../specs/2026-07-06-sidebar-hub-konsolidierung-design.md)

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen (AGENTS.md).
- **DOM nur über `createEl`/`createDiv`/`createSpan`/`empty()`** — nie `innerHTML`/HTML-String (UI-STANDARD §2, Lint `no-forbidden-elements`).
- **Nur Theme-CSS-Variablen** in neuem CSS (UI-STANDARD §5) — keine Hardcode-Farben.
- **Icons via `setIcon(el, name)`** (Lucide-Set), nie eingebettetes SVG.
- **Nach jeder Änderung grün:** `npm test` + `npm run typecheck` + `npm run lint`.
- **Commits:** Conventional Commits, deutsche Beschreibung; **nur berührte Dateien stagen — nie `git add -A`**; Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Tab-Reihenfolge/IDs (verbatim, in allen Tasks identisch):** `related` ("Ähnlich", Icon `search`) · `search` ("Suche", Icon `telescope`) · `chat` ("Chat", Icon `message-square`) · `smart-apply` ("Smart Apply", Icon `wand-2`). Default-Tab: `related`.
- **Test-Idiom (verbindlich, in allen Test-Tasks):** Panel-/Hub-Container werden mit `makeFakeEl()` aus `tests/__mocks__/obsidian.ts` erzeugt (NICHT `document.createElement`), Assertions laufen über `.children` + `.className`/`.getAttribute` (NICHT `querySelector`/`classList`) — exakt wie die bestehenden View-Tests. `makeFakeEl` bietet: `children`, `empty/createDiv/createEl/createSpan`, `toggleClass` (manipuliert `.className`), `setAttribute/getAttribute`, `addEventListener/click`, `setText`; `addClass/removeClass` sind No-ops (nicht in Assertions verwenden). Keine ad-hoc-DOM-Helfer bauen. **`createDiv` im Mock ignoriert `attr`** — wenn ein `data-…`-Attribut auf einem Div getestet werden muss, den Mock-`createDiv` um `attr`-Support ergänzen (analog Mock-`createEl`, Zeile 8) — das ist eine legitime Mock-Vervollständigung Richtung echtem Obsidian.
- **Hub-View-Type (verbatim):** `VIEW_TYPE_HUB = "vault-retrieval-hub"`. Hub-Ribbon-Icon: `layers`.
- **Alt-View-Types (nur noch für Migration/Detach referenziert):** `vault-rag-related`, `vault-rag-search`, `vault-rag-chat`, `vault-rag-smart-apply`.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/hub_panel.ts` (neu) | `TabId`-Typ + `HubPanel`-Interface — der Vertrag aller Panels |
| `src/hub_view.ts` (neu) | `VaultRetrievalView` (ItemView): Tab-Leiste, `navState`, Panel-Mounting, Sichtbarkeit, zentraler Kontext-Listener, `getState/setState`, Deep-Link + externe Refresh-Methoden |
| `src/view.ts` (mod) | `RelatedNotesView` → `RelatedPanel implements HubPanel` (etabliert das Panel-Muster) |
| `src/search_view.ts` (mod) | `SemanticSearchView` → `SearchPanel implements HubPanel` |
| `src/chat_view.ts` (mod) | `ChatView` → `ChatPanel implements HubPanel` |
| `src/smart_apply_view.ts` (mod) | `SmartApplyView` → `SmartApplyPanel implements HubPanel`; self-registrierte file-Events entfernt |
| `src/main.ts` (mod) | 1 `registerView(HUB)`, `buildPanels()`, 1 Ribbon, 4 Deep-Link-Commands, `openHub`, Alt-Leaf-Migration, `refresh()`/`refreshSmartApplyRanking()` auf Hub umgestellt |
| `styles.css` (mod) | `vault-rag-hub-*` Tab-Leiste + `is-hidden`/`is-active` |
| `AGENTS.md` (mod) | Modul-Layout + §1-Abweichung (State-Persistenz) notieren |
| `tests/hub_view.test.ts` (neu) | Tab-Nav, Sichtbarkeit, Lazy-Refresh, State-Roundtrip |
| `tests/{view,search_view,chat_view,smart_apply_view}.test.ts` (mod) | auf Panel-API migriert (`mount(container)` statt View/`contentEl`) |

**Panel-Transformationsregel (gilt für Task 1–4 identisch):**
1. `export class XView extends ItemView` → `export class XPanel implements HubPanel`.
2. Interface-Props ergänzen: `readonly id: TabId = "…"`, `readonly label = "…"`, `readonly icon = "…"`. `getViewType()/getDisplayText()/getIcon()` **löschen**.
3. `constructor(leaf: WorkspaceLeaf, private deps: …)` → `constructor(private deps: …)`. `WorkspaceLeaf`-Import entfernen, wenn ungenutzt.
4. Feld `private container!: HTMLElement;` ergänzen. Jedes `this.contentEl` → `this.container`.
5. `async onOpen()` → `mount(container: HTMLElement): void { this.container = container; …(bisheriger onOpen-Body ohne await-Signatur; async-Init in `void this.initAsync()` auslagern)… }`. Der Interface-`mount` ist **synchron**; asynchrone Initialisierung (z.B. `refreshModels`) in einer privaten `async`-Methode kapseln und mit `void` starten.
6. `async onClose()` → `destroy(): void { … }` (Timer/Intervalle/Streams abbrechen; DOM-Cleanup entfällt, der Hub leert den Container).
7. Lazy-Refresh-Felder + Methoden ergänzen (nur kontextsensitive Panels, siehe Task 1/4):
   ```ts
   private visible = false;
   private dirty = false;
   onShow(): void { this.visible = true; if (this.dirty) { this.refreshContext(); this.dirty = false; } }
   onHide(): void { this.visible = false; }
   onFileOpen(_path: string | null): void {
     if (this.visible) { this.refreshContext(); this.dirty = false; } else { this.dirty = true; }
   }
   ```
   wobei `refreshContext()` die panel-spezifische Neuberechnung ist.

---

### Task 1: `HubPanel`-Interface + `RelatedPanel`

Etabliert Interface + das einfachste Panel + das Lazy-Refresh-Muster in einem Zug.

**Files:**
- Create: `src/hub_panel.ts`
- Modify: `src/view.ts` (ganze Datei, `RelatedNotesView` → `RelatedPanel`)
- Test: `tests/view.test.ts`

**Interfaces:**
- Produces: `TabId = "related" | "search" | "chat" | "smart-apply"`; `HubPanel` (siehe unten); `RelatedPanel implements HubPanel` mit `constructor(deps: ViewDeps)`, `mount(container)`, `onShow/onHide/onFileOpen`, `destroy()`. `renderHits` + `ViewDeps` bleiben exportiert unverändert.

- [ ] **Step 1: `src/hub_panel.ts` schreiben**

```ts
export type TabId = "related" | "search" | "chat" | "smart-apply";

/** Ein Panel im Vault-Retrieval-Hub. Kein ItemView — bekommt seinen Container injiziert,
 *  bleibt gemountet (State-Persistenz), wird nur per display:none aus-/eingeblendet. */
export interface HubPanel {
  readonly id: TabId;
  readonly label: string;
  readonly icon: string;
  /** Einmaliger Aufbau in den übergebenen Container. Synchron; async-Init intern via void. */
  mount(container: HTMLElement): void;
  /** Tab wird sichtbar — kontextsensitive Panels holen hier ausstehende Updates nach. */
  onShow?(): void;
  /** Tab wird versteckt. */
  onHide?(): void;
  /** Aktive Notiz gewechselt (zentral vom Hub gerufen). Nur kontextsensitive Panels. */
  onFileOpen?(path: string | null): void;
  /** Cleanup: Timer/Intervalle/Streams abbrechen. */
  destroy(): void;
}
```

- [ ] **Step 2: `tests/view.test.ts` auf Panel-API umschreiben (failing)**

Bestehende Tests instanziieren `new RelatedNotesView(leaf, deps)` und rufen `.render()` bzw. lesen `.contentEl`. Umschreiben auf:

```ts
import { RelatedPanel } from "../src/view";

function mountPanel(deps: ConstructorParameters<typeof RelatedPanel>[0]) {
  const container = document.createElement("div");
  const panel = new RelatedPanel(deps);
  panel.mount(container);
  return { panel, container };
}

it("zeigt Treffer", () => {
  const { container } = mountPanel({ getHits: () => [{ path: "A.md", score: 0.9 } as any], openPath: () => {} });
  expect(container.querySelectorAll(".vault-rag-hit").length).toBe(1);
});

it("Leerzustand ohne Treffer", () => {
  const { container } = mountPanel({ getHits: () => [], openPath: () => {} });
  expect(container.querySelector(".vault-rag-empty")).not.toBeNull();
});

it("onFileOpen rendert nur wenn sichtbar (lazy)", () => {
  let hits: any[] = [];
  const { panel, container } = mountPanel({ getHits: () => hits, openPath: () => {} });
  panel.onHide();                       // unsichtbar
  hits = [{ path: "A.md", score: 0.9 }];
  panel.onFileOpen("A.md");             // dirty, kein Re-Render
  expect(container.querySelectorAll(".vault-rag-hit").length).toBe(0);
  panel.onShow();                       // holt nach
  expect(container.querySelectorAll(".vault-rag-hit").length).toBe(1);
});
```

- [ ] **Step 3: Test failt** — `npx vitest run tests/view.test.ts` → FAIL (`RelatedPanel` existiert nicht).

- [ ] **Step 4: `src/view.ts` umbauen**

`renderHits` + `ViewDeps` + `VIEW_TYPE_RELATED` bleiben (VIEW_TYPE für Migration in main.ts noch gebraucht). `RelatedNotesView` ersetzen durch:

```ts
import { HubPanel, TabId } from "./hub_panel";
// ItemView/WorkspaceLeaf-Import entfernen, wenn sonst ungenutzt.

export class RelatedPanel implements HubPanel {
  readonly id: TabId = "related";
  readonly label = "Ähnlich";
  readonly icon = "search";
  private container!: HTMLElement;
  private visible = false;
  private dirty = false;

  constructor(private deps: ViewDeps) {}

  mount(container: HTMLElement): void { this.container = container; this.refreshContext(); }
  onShow(): void { this.visible = true; if (this.dirty) { this.refreshContext(); this.dirty = false; } }
  onHide(): void { this.visible = false; }
  onFileOpen(_path: string | null): void {
    if (this.visible) { this.refreshContext(); this.dirty = false; } else { this.dirty = true; }
  }
  destroy(): void {}

  /** Public, damit der Hub nach Index-Reload extern refreshen kann. */
  refreshContext(): void {
    const c = this.container; c.empty();
    const hits = this.deps.getHits();
    if (hits.length === 0) { c.createDiv({ cls: "vault-rag-empty", text: "Keine verwandten Notizen (oder Notiz noch nicht indexiert)." }); return; }
    renderHits(c, hits, this.deps.openPath);
  }
}
```

- [ ] **Step 5: Test grün** — `npx vitest run tests/view.test.ts` → PASS.

- [ ] **Step 6: typecheck + lint** — `npm run typecheck && npm run lint` → sauber. (main.ts referenziert noch `RelatedNotesView` → das bricht typecheck; darum diesen Task erst mit Task 6 vollständig grün erwarten. **Zwischenlösung:** in main.ts `RelatedNotesView` noch nicht anfassen — stattdessen bis Task 6 den Import + `registerView`-Aufruf für RELATED provisorisch belassen ist NICHT möglich, weil die Klasse weg ist. Daher: Task 1–6 bilden **eine Commit-Kette**; typecheck/lint werden erst nach Task 6 vollständig grün. Pro Task nur `npx vitest run <datei>` grün halten.)

- [ ] **Step 7: Commit**

```bash
git add src/hub_panel.ts src/view.ts tests/view.test.ts
git commit -m "refactor(hub): HubPanel-Interface + RelatedPanel (View→Panel, lazy-refresh)"
```

---

### Task 2: `SearchPanel`

**Files:**
- Modify: `src/search_view.ts` (`SemanticSearchView` → `SearchPanel`)
- Test: `tests/search_view.test.ts`

**Interfaces:**
- Consumes: `HubPanel`, `TabId` aus `src/hub_panel.ts`.
- Produces: `SearchPanel implements HubPanel`, `constructor(deps: SearchDeps)`, `mount(container)`, `destroy()`. **Kein** `onFileOpen` (nicht kontextsensitiv). `SearchResult`/`SearchDeps`/`VIEW_TYPE_SEARCH` bleiben exportiert.

- [ ] **Step 1: `tests/search_view.test.ts` umschreiben (failing)** — `new SemanticSearchView(leaf, deps)` → `const p = new SearchPanel(deps); p.mount(container)`. Assertions gegen `container.querySelector(...)` statt `view.contentEl`. Die Query-/Debounce-/renderResult-Logik bleibt inhaltlich identisch; nur Konstruktion + Wurzel-Element ändern sich.

- [ ] **Step 2: Test failt** — `npx vitest run tests/search_view.test.ts` → FAIL.

- [ ] **Step 3: `src/search_view.ts` umbauen** — Transformationsregel anwenden:
  - `class SemanticSearchView extends ItemView` → `class SearchPanel implements HubPanel`.
  - Props: `readonly id: TabId = "search"; readonly label = "Suche"; readonly icon = "telescope";` — `getViewType/getDisplayText/getIcon` löschen.
  - `constructor(leaf, private deps: SearchDeps)` → `constructor(private deps: SearchDeps)`.
  - `private container!: HTMLElement;` ergänzen; `this.contentEl` (Zeile 31) → `this.container`.
  - `async onOpen()` → `mount(container: HTMLElement): void { this.container = container; … }` (Body unverändert außer `const c = this.container`).
  - `async onClose()` → `destroy(): void { if (this.timer !== null) window.clearTimeout(this.timer); }`.
  - Kein `onShow/onHide/onFileOpen` nötig.

- [ ] **Step 4: Test grün** — `npx vitest run tests/search_view.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/search_view.ts tests/search_view.test.ts
git commit -m "refactor(hub): SearchPanel (View→Panel)"
```

---

### Task 3: `ChatPanel`

**Files:**
- Modify: `src/chat_view.ts` (`ChatView` → `ChatPanel`)
- Test: `tests/chat_view.test.ts`

**Interfaces:**
- Consumes: `HubPanel`, `TabId`.
- Produces: `ChatPanel implements HubPanel`, `constructor(deps: ChatViewDeps)`, `mount(container)`, `destroy()`. **Kein** `onFileOpen`. `ChatViewDeps`/`VIEW_TYPE_CHAT` bleiben exportiert.

- [ ] **Step 1: `tests/chat_view.test.ts` umschreiben (failing)** — Konstruktion auf `new ChatPanel(deps); panel.mount(container)`. Der ContextPanel wird weiterhin im Konstruktor erzeugt (`this.panel = new ContextPanel(deps, deps.autoK)`) — unverändert.

- [ ] **Step 2: Test failt** — `npx vitest run tests/chat_view.test.ts` → FAIL.

- [ ] **Step 3: `src/chat_view.ts` umbauen** — Transformationsregel:
  - `class ChatView extends ItemView` → `class ChatPanel implements HubPanel`.
  - Props `id="chat"`, `label="Chat"`, `icon="message-square"`; `getViewType/getDisplayText/getIcon` löschen.
  - Konstruktor: `constructor(leaf, private deps: ChatViewDeps)` → `constructor(private deps: ChatViewDeps)`. Body (`this.panel = new ContextPanel(...)`) bleibt; `super(leaf)` löschen.
  - `private container!: HTMLElement;` ergänzen.
  - `async onOpen()` → `mount(container: HTMLElement): void {`: `const c = this.contentEl` → `const c = this.container = container`. **Wichtig:** die zwei `await`-Aufrufe am Ende (`refreshStatus`, `refreshModels`) in eine private `async initAsync()` verschieben und `void this.initAsync()` aufrufen (mount ist synchron). `this.renderThinkToggle()`/`renderMessages()` bleiben synchron in `mount`.
  - `async onClose()` → `destroy(): void { … }` (Body: `contentEl.removeClass` **entfernen** — der Hub leert den Container; Timer/debTimer-Cleanup unverändert).
  - `c.addClass("vault-rag-chat-root")` bleibt (auf `this.container`).

- [ ] **Step 4: Test grün** — `npx vitest run tests/chat_view.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat_view.ts tests/chat_view.test.ts
git commit -m "refactor(hub): ChatPanel (View→Panel, async-Init entkoppelt)"
```

---

### Task 4: `SmartApplyPanel`

Komplexestes Panel: kontextsensitiv (lazy-refresh) **und** self-registrierte file-Events, die zum Hub wandern.

**Files:**
- Modify: `src/smart_apply_view.ts` (`SmartApplyView` → `SmartApplyPanel`)
- Test: `tests/smart_apply_view.test.ts`

**Interfaces:**
- Consumes: `HubPanel`, `TabId`.
- Produces: `SmartApplyPanel implements HubPanel`, `constructor(deps: SmartApplyViewDeps)`, `mount(container)`, `onShow/onHide/onFileOpen`, `destroy()`, **public `refreshRanking(): void`** (bleibt, wird von main.ts über den Hub gerufen). `SmartApplyViewDeps`/`VIEW_TYPE_SMART_APPLY` bleiben exportiert.

- [ ] **Step 1: `tests/smart_apply_view.test.ts` umschreiben (failing)** — Konstruktion auf `new SmartApplyPanel(deps); panel.mount(container)`. Assertions gegen `container`. Bestehende State-Machine-Tests (idle/running/diff…) bleiben inhaltlich.

- [ ] **Step 2: Test failt** — `npx vitest run tests/smart_apply_view.test.ts` → FAIL.

- [ ] **Step 3: `src/smart_apply_view.ts` umbauen** — Transformationsregel + Besonderheiten:
  - `class SmartApplyView extends ItemView` → `class SmartApplyPanel implements HubPanel`.
  - Props `id="smart-apply"`, `label="Smart Apply"`, `icon="wand-2"`; `getViewType/getDisplayText/getIcon` löschen.
  - `constructor(leaf, private deps)` → `constructor(private deps)`; `super(leaf)` löschen.
  - `private container!: HTMLElement;` + Lazy-Felder `private visible = false; private dirty = false;` ergänzen.
  - **`onOpen` (Zeile 86–97) → `mount`:**
    ```ts
    mount(container: HTMLElement): void {
      this.container = container;
      this.container.addClass("vault-rag-sa-root");
      this.render();
      void this.initAsync();
    }
    private async initAsync(): Promise<void> {
      await this.refreshModels();
      await this.refreshConn();
      await this.recomputeRanking();
    }
    ```
    Die **zwei `this.registerEvent(this.app.workspace.on("active-leaf-change"/"file-open", …))`-Zeilen (95/96) ersatzlos LÖSCHEN** — der Hub übernimmt das zentral und ruft `onFileOpen`.
  - **Lazy-Refresh statt Selbst-Events:**
    ```ts
    onShow(): void { this.visible = true; if (this.dirty) { this.scheduleRecompute(); this.dirty = false; } }
    onHide(): void { this.visible = false; }
    onFileOpen(_path: string | null): void {
      if (this.visible) { this.scheduleRecompute(); this.dirty = false; } else { this.dirty = true; }
    }
    ```
    (`scheduleRecompute` existiert bereits — nur der Auslöser wandert von den Selbst-Events hierher.)
  - **`onClose` (99–103) → `destroy`:** `this.container.removeClass("vault-rag-sa-root")` **entfernen** (Hub leert Container); `stopTimer()` + `rankTimer`-Cleanup unverändert.
  - Alle `this.contentEl` (u.a. Zeile 108) → `this.container`.
  - `refreshRanking()` bleibt public unverändert.

- [ ] **Step 4: Test grün** — `npx vitest run tests/smart_apply_view.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/smart_apply_view.ts tests/smart_apply_view.test.ts
git commit -m "refactor(hub): SmartApplyPanel (View→Panel, file-Events an Hub abgegeben)"
```

---

### Task 5: `VaultRetrievalView` Hub

**Files:**
- Create: `src/hub_view.ts`
- Test: `tests/hub_view.test.ts`

**Interfaces:**
- Consumes: `HubPanel`, `TabId` aus `src/hub_panel.ts`.
- Produces: `VIEW_TYPE_HUB = "vault-retrieval-hub"`; `class VaultRetrievalView extends ItemView` mit `constructor(leaf: WorkspaceLeaf, panels: HubPanel[], defaultTab: TabId)`; public `showTab(id: TabId): void` (Deep-Link); public `refreshContext(): void` (externer Related-Refresh nach Index-Reload); public `refreshRanking(): void` (delegiert an SmartApply-Panel). Konsumiert von Task 6 (main.ts).

- [ ] **Step 1: `tests/hub_view.test.ts` schreiben (failing)**

Der Hub ist mit Fake-Panels (Spies) testbar, ohne echtes ItemView-Rendering. Da `VaultRetrievalView extends ItemView` einen `WorkspaceLeaf` braucht und `this.app` nutzt, testen wir die **reine Navigations-/Sichtbarkeitslogik** über eine extrahierbare Kernmethode. Struktur:

```ts
import { describe, it, expect } from "vitest";
import { VaultRetrievalView } from "../src/hub_view";
import { makeFakeEl } from "./__mocks__/obsidian";
import type { HubPanel, TabId } from "../src/hub_panel";

function fakePanel(id: TabId): HubPanel & { log: string[] } {
  const log: string[] = [];
  return {
    id, label: id, icon: "x", log,
    mount(c: HTMLElement) { log.push("mount"); (c as any).createDiv({ cls: `p-${id}` }); },
    onShow() { log.push("show"); },
    onHide() { log.push("hide"); },
    onFileOpen(p) { log.push(`file:${p ?? "null"}`); },
    destroy() { log.push("destroy"); },
  } as HubPanel & { log: string[] };
}

// Panel-Div per data-tab finden — children-Traversal + getAttribute (kein querySelector).
function panelDiv(root: any, tab: TabId): any {
  const content = root.children.find((c: any) => c.className?.includes("vault-rag-hub-content"));
  return content.children.find((c: any) => c.getAttribute?.("data-tab") === tab);
}

describe("VaultRetrievalView.buildInto", () => {
  it("mountet alle Panels, zeigt nur den Default-Tab", () => {
    const panels = [fakePanel("related"), fakePanel("chat")];
    const root = makeFakeEl();
    VaultRetrievalView.buildInto(root, panels, "related");   // reine Aufbau-Logik, siehe Step 3
    expect(panels.every(p => (p as any).log.includes("mount"))).toBe(true);
    expect(panelDiv(root, "related").className.includes("is-hidden")).toBe(false);
    expect(panelDiv(root, "chat").className.includes("is-hidden")).toBe(true);
  });

  it("Default-Panel bekommt initial onShow, das andere nicht", () => {
    const panels = [fakePanel("related"), fakePanel("chat")];
    VaultRetrievalView.buildInto(makeFakeEl(), panels, "related");
    expect((panels[0] as any).log).toContain("show");
    expect((panels[1] as any).log).not.toContain("show");
  });

  it("Tab-Wechsel: altes Panel hide, neues show, Sichtbarkeit getauscht", () => {
    const panels = [fakePanel("related"), fakePanel("chat")];
    const root = makeFakeEl();
    const ctrl = VaultRetrievalView.buildInto(root, panels, "related");
    ctrl.setTab("chat");
    expect((panels[0] as any).log).toContain("hide");
    expect((panels[1] as any).log).toContain("show");
    expect(panelDiv(root, "chat").className.includes("is-hidden")).toBe(false);
    expect(panelDiv(root, "related").className.includes("is-hidden")).toBe(true);
  });

  it("Kontextwechsel ruft onFileOpen auf allen Panels", () => {
    const panels = [fakePanel("related"), fakePanel("chat")];
    const root = makeFakeEl();
    const ctrl = VaultRetrievalView.buildInto(root, panels, "related");
    ctrl.notifyFileOpen("Note.md");
    expect((panels[0] as any).log).toContain("file:Note.md");
    expect((panels[1] as any).log).toContain("file:Note.md");
  });
});
```

> **Voraussetzung für `panelDiv(...)`:** Die Panel-Divs tragen `data-tab` (via `createDiv({ cls, attr: { "data-tab": panel.id } })`). Der Mock-`createDiv` (Zeile 7 in `tests/__mocks__/obsidian.ts`) ignoriert `attr` derzeit — **im Rahmen dieses Tasks den Mock-`createDiv` um `attr`-Support ergänzen** (analog Mock-`createEl`, Zeile 8: `if (o?.attr) for (const k of Object.keys(o.attr)) attrs[k] = String(o.attr[k]);`). Das ist eine legitime Mock-Vervollständigung Richtung echtem Obsidian und die einzige erlaubte Änderung an der Mock-Datei.

- [ ] **Step 2: Test failt** — `npx vitest run tests/hub_view.test.ts` → FAIL.

- [ ] **Step 3: `src/hub_view.ts` schreiben**

Die Aufbau-/Navigationslogik lebt in einer statischen `buildInto`, die ein `HubController`-Objekt zurückgibt — so ist sie ohne `WorkspaceLeaf`/`this.app` unit-testbar. Die `ItemView`-Klasse ist eine dünne Schale, die `buildInto` nutzt und die Obsidian-Events verdrahtet.

```ts
import { ItemView, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import type { HubPanel, TabId } from "./hub_panel";

export const VIEW_TYPE_HUB = "vault-retrieval-hub";

export interface HubController {
  setTab(id: TabId): void;
  notifyFileOpen(path: string | null): void;
  currentTab(): TabId;
  destroy(): void;
}

export class VaultRetrievalView extends ItemView {
  private ctrl: HubController | null = null;

  constructor(leaf: WorkspaceLeaf, private panels: HubPanel[], private navState: TabId) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_HUB; }
  getDisplayText(): string { return "Vault Retrieval"; }
  getIcon(): string { return "layers"; }

  async onOpen(): Promise<void> {
    this.ctrl = VaultRetrievalView.buildInto(this.contentEl, this.panels, this.navState);
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.emitFileOpen()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.emitFileOpen()));
  }

  async onClose(): Promise<void> {
    this.ctrl?.destroy();
    this.ctrl = null;
    this.contentEl.empty();
  }

  private emitFileOpen(): void {
    this.ctrl?.notifyFileOpen(this.app.workspace.getActiveFile()?.path ?? null);
  }

  // ── Public API für main.ts ────────────────────────────────────────────────
  showTab(id: TabId): void { this.ctrl?.setTab(id); this.navState = id; }
  refreshContext(): void { this.ctrl?.notifyFileOpen(this.app.workspace.getActiveFile()?.path ?? null); }
  refreshRanking(): void {
    const sa = this.panels.find(p => p.id === "smart-apply") as { refreshRanking?: () => void } | undefined;
    sa?.refreshRanking?.();
  }

  getState(): Record<string, unknown> { return { tab: this.navState }; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const tab = (state as { tab?: TabId } | null)?.tab;
    if (tab) { this.navState = tab; this.ctrl?.setTab(tab); }
    return super.setState(state, result);
  }

  // ── Reine Aufbau-/Navigationslogik (node-testbar, ohne Obsidian) ──────────
  static buildInto(root: HTMLElement, panels: HubPanel[], defaultTab: TabId): HubController {
    root.empty();
    root.addClass("vault-rag-hub-root");
    const tabsEl = root.createDiv({ cls: "vault-rag-hub-tabs" });
    const contentEl = root.createDiv({ cls: "vault-rag-hub-content" });
    const panelDivs = new Map<TabId, HTMLElement>();
    const tabBtns = new Map<TabId, HTMLElement>();
    let navState = defaultTab;

    const applyVisibility = (): void => {
      for (const [id, div] of panelDivs) div.toggleClass("is-hidden", id !== navState);
      for (const [id, btn] of tabBtns) btn.toggleClass("is-active", id === navState);
    };

    for (const panel of panels) {
      const btn = tabsEl.createEl("button", { cls: "vault-rag-hub-tab", attr: { "data-tab": panel.id } });
      const ic = btn.createSpan({ cls: "vault-rag-hub-tab-icon" }); setIcon(ic, panel.icon);
      btn.createSpan({ cls: "vault-rag-hub-tab-label", text: panel.label });
      btn.addEventListener("click", () => ctrl.setTab(panel.id));
      tabBtns.set(panel.id, btn);
      const div = contentEl.createDiv({ cls: "vault-rag-hub-panel", attr: { "data-tab": panel.id } });
      panelDivs.set(panel.id, div);
      panel.mount(div);
    }

    const ctrl: HubController = {
      currentTab: () => navState,
      setTab(id: TabId): void {
        if (id === navState) return;
        panels.find(p => p.id === navState)?.onHide?.();
        navState = id;
        applyVisibility();
        panels.find(p => p.id === navState)?.onShow?.();
      },
      notifyFileOpen(path: string | null): void { for (const p of panels) p.onFileOpen?.(path); },
      destroy(): void { for (const p of panels) p.destroy(); },
    };

    applyVisibility();
    panels.find(p => p.id === navState)?.onShow?.();   // Default-Panel initial onShow
    return ctrl;
  }
}
```

> **Hinweis `setIcon` im Node-Test:** `setIcon` kommt aus dem Obsidian-Mock (`tests/__mocks__/obsidian.ts`). Falls dort noch nicht vorhanden, als No-op ergänzen: `export function setIcon(_el: HTMLElement, _name: string): void {}`. Ebenso muss der Mock `createEl/createDiv/createSpan/empty/addClass/toggleClass/setText` auf `HTMLElement` bereitstellen (happy-dom-Prototyp-Patch — bestehendes Muster im Mock wiederverwenden).

- [ ] **Step 4: Test grün** — `npx vitest run tests/hub_view.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hub_view.ts tests/hub_view.test.ts
git commit -m "feat(hub): VaultRetrievalView — Tab-Navigation + zentraler Kontext-Listener"
```

---

### Task 6: `main.ts` verdrahten

Ein Hub statt vier Views; `buildPanels()`; 1 Ribbon + 4 Deep-Link-Commands; `openHub`; Alt-Leaf-Migration; `refresh`/`refreshSmartApplyRanking` auf Hub. **Nach diesem Task ist der volle `typecheck`/`lint`/`test`-Lauf wieder grün.**

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `VaultRetrievalView`, `VIEW_TYPE_HUB` (Task 5); `RelatedPanel` (T1), `SearchPanel` (T2), `ChatPanel` (T3), `SmartApplyPanel` (T4); `TabId`.

- [ ] **Step 1: Imports umstellen** — Alt-View-Klassen-Imports (`RelatedNotesView`, `SemanticSearchView`, `ChatView`, `SmartApplyView`) entfernen; stattdessen `RelatedPanel`, `SearchPanel`, `ChatPanel`, `SmartApplyPanel`, `VaultRetrievalView`, `VIEW_TYPE_HUB`, `TabId` importieren. Die `VIEW_TYPE_*`-Konstanten der Alt-Views bleiben importiert (für Migration).

- [ ] **Step 2: `buildPanels()` einführen** — die vier deps-Objekte aus dem heutigen `registerView`-Block (Zeilen 79–216) in eine Methode ziehen, die **Panel-Instanzen** statt Views erzeugt. SmartApply nur bei `settings.smartApplyEnabled`. Die deps-Objekte selbst (getHits/openPath/search/session/… ) bleiben **byte-für-byte identisch** — nur `new XView(leaf, deps)` → `new XPanel(deps)`.

```ts
private buildPanels(): HubPanel[] {
  const panels: HubPanel[] = [
    new RelatedPanel({ getHits: () => this.currentHits(), openPath: this.openPath }),
    new SearchPanel({ search: (q) => this.runSearch(q), openPath: this.openPath }),
    new ChatPanel({ /* … exakt das bisherige ChatViewDeps-Objekt … */ }),
  ];
  if (this.settings.smartApplyEnabled && this.smartApply && this.templateRanker) {
    panels.push(new SmartApplyPanel({ /* … exakt das bisherige SmartApplyViewDeps-Objekt … */ }));
  }
  return panels;
}
```

- [ ] **Step 3: `registerView` konsolidieren** — die vier `this.registerView(VIEW_TYPE_*, …)` ersetzen durch:

```ts
this.registerView(VIEW_TYPE_HUB, (leaf: WorkspaceLeaf) => new VaultRetrievalView(leaf, this.buildPanels(), "related"));
```

> **Reihenfolge-Hinweis:** `buildPanels()` braucht `this.smartApply`/`this.templateRanker`. Die werden heute erst im `if (settings.smartApplyEnabled)`-Block (ab Zeile 154) erzeugt — der liegt **nach** dem alten registerView. Da `registerView` nur eine Factory registriert (lazy bei Leaf-Erzeugung aufgerufen), ist das unkritisch, solange die Smart-Apply-Objekte vor dem ersten Hub-Öffnen existieren. Den `registerView(HUB)`-Aufruf **ans Ende von onload** (nach dem Smart-Apply-Block) verschieben, um das deterministisch zu machen.

- [ ] **Step 4: Ribbon + Commands** — die vier `addRibbonIcon` durch **eines** ersetzen, vier Commands auf `openHub(tab)` umstellen:

```ts
this.addRibbonIcon("layers", "Vault Retrieval", () => void this.openHub("related"));
this.addCommand({ id: "open-related", name: "Verwandte Notizen öffnen", callback: () => void this.openHub("related") });
this.addCommand({ id: "open-semantic-search", name: "Semantische Suche öffnen", callback: () => void this.openHub("search") });
this.addCommand({ id: "open-vault-chat", name: "Vault Chat öffnen", callback: () => void this.openHub("chat") });
// Smart-Apply-Command bleibt checkCallback-gated (nur bei aktiver md-Notiz), öffnet Hub@smart-apply:
this.addCommand({
  id: "smart-apply-active-note",
  name: "Smart Apply auf aktive Notiz",
  checkCallback: (checking: boolean) => {
    const f = this.app.workspace.getActiveFile();
    const ok = f instanceof TFile && f.extension === "md" && this.settings.smartApplyEnabled;
    if (ok && !checking) void this.openHub("smart-apply");
    return ok;
  },
});
```

- [ ] **Step 5: `openHub` + Alt-Leaf-Migration** — die vier `activateXView`-Methoden durch eine ersetzen; Migration in `onLayoutReady`:

```ts
async openHub(tab: TabId): Promise<void> {
  const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HUB);
  const leaf = existing.length ? existing[0] : this.app.workspace.getRightLeaf(false);
  if (!leaf) return;
  if (!existing.length) await leaf.setViewState({ type: VIEW_TYPE_HUB, active: true });
  const view = leaf.view;
  if (view instanceof VaultRetrievalView) view.showTab(tab);
  void this.app.workspace.revealLeaf(leaf);
}

private migrateOldLeaves(): void {
  for (const t of ["vault-rag-related", "vault-rag-search", "vault-rag-chat", "vault-rag-smart-apply"]) {
    for (const leaf of this.app.workspace.getLeavesOfType(t)) leaf.detach();
  }
}
```

In `onload` ergänzen: `this.app.workspace.onLayoutReady(() => this.migrateOldLeaves());`

- [ ] **Step 6: `refresh`/`refreshSmartApplyRanking` auf Hub** — die `getLeavesOfType(VIEW_TYPE_RELATED/SMART_APPLY)`-Schleifen (Zeilen 547–560) umstellen; die `active-leaf-change → this.refresh()`-Registrierung (Zeile 128) **entfernen** (der Hub lauscht selbst):

```ts
refresh(): void {
  for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HUB)) {
    const v = leaf.view;
    if (v instanceof VaultRetrievalView) v.refreshContext();
  }
}
refreshSmartApplyRanking(): void {
  for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HUB)) {
    const v = leaf.view;
    if (v instanceof VaultRetrievalView) v.refreshRanking();
  }
}
```

- [ ] **Step 7: Voller Lauf grün** — `npm test && npm run typecheck && npm run lint` → alles PASS/sauber.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "feat(hub): main.ts auf einen VaultRetrievalView-Hub verdrahtet (1 Ribbon + 4 Deep-Links, Alt-Leaf-Migration)"
```

---

### Task 7: CSS Tab-Leiste

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: `vault-rag-hub-*`-Regeln ergänzen** (nur Theme-CSS-Variablen):

```css
.vault-rag-hub-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.vault-rag-hub-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--background-modifier-border); flex: 0 0 auto; }
.vault-rag-hub-tab { display: flex; align-items: center; gap: 4px; padding: 6px 10px; background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); cursor: pointer; border-radius: 0; }
.vault-rag-hub-tab:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
.vault-rag-hub-tab.is-active { color: var(--text-normal); border-bottom-color: var(--interactive-accent); }
.vault-rag-hub-tab-icon { display: inline-flex; }
.vault-rag-hub-content { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }
.vault-rag-hub-panel { height: 100%; overflow: auto; }
.vault-rag-hub-panel.is-hidden { display: none; }
```

> **Kompatibilität:** Die Panel-Roots (`vault-rag-chat-root`, `vault-rag-sa-root`) setzen `height:100%` — sie liegen jetzt in `.vault-rag-hub-panel` (auch `height:100%`), das trägt. Keine Änderung an bestehenden Panel-CSS-Regeln nötig.

- [ ] **Step 2: Verifizieren** — `npm run build` erzeugt `main.js` ohne Fehler; visueller Smoke folgt in Task 9.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style(hub): Tab-Leisten-CSS (vault-rag-hub-*, nur Theme-Variablen)"
```

---

### Task 8: Doku — AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Modul-Layout aktualisieren** — im `src/`-Layout-Block: `view.ts`/`search_view.ts`/`chat_view.ts`/`smart_apply_view.ts` als `*Panel` beschreiben; `hub_panel.ts` + `hub_view.ts` ergänzen. In „Architecture principles" den Satz „Nur `main.ts`, `view.ts`, … importieren `obsidian`" auf `hub_view.ts` + `main.ts` als einzige View-Layer-obsidian-Importe korrigieren (Panels sind obsidian-frei bis auf `setIcon`).

- [ ] **Step 2: §1-Abweichung notieren** — in „Abweichungen von der Leitkonvention" (oder „Gotchas") ergänzen:

> **UI-STANDARD §1 (Ein-Frontend):** erfüllt — ein `VIEW_TYPE_HUB` statt vier Views. **Begründete Abweichung vom vault-crews-Pilot:** der Hub rendert **nicht** render-from-scratch pro Tab, sondern hält alle Panels gemountet (`display:none`), weil Chat (SSE-Stream) und Smart Apply (Zustandsmaschine + Stream) zustandsreich sind und ein Neuaufbau laufende Zustände verwürfe.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): Hub-Konsolidierung — Modul-Layout + §1-Abweichung"
```

---

### Task 9: Integrations-Smoke (manuell, durch Johannes)

Kein automatisierter Test kann das echte Obsidian-Layout/Sync abdecken. Nach Task 1–8:

- [ ] **Step 1: `npm run build`** und Plugin in Obsidian neu laden.
- [ ] **Step 2: Verifizieren:**
  - Ein Ribbon-Icon (`layers`) öffnet den Hub; die vier Commands springen je auf ihren Tab.
  - Alte, im Layout gespeicherte Leaves sind weg (Migration).
  - Tab-Wechsel: laufender Chat-Stream / offener Smart-Apply-Diff **überlebt** den Wechsel.
  - Related aktualisiert bei Notizwechsel (sichtbar sofort, unsichtbar beim nächsten Öffnen des Tabs).
- [ ] **Step 3:** Ergebnis an mich zurück → dann `finishing-a-development-branch`.

---

## Self-Review

**Spec-Coverage:** §1 Hub-Lifecycle → T5/T6. §2 Lazy-Refresh → T1 (Related) + T4 (SmartApply) + T5 (Listener). §3 Zugang → T6 (Ribbon+Commands+openHub). §4 Migration → T6 (migrateOldLeaves). §5 Reihenfolge/Default → Global Constraints + T5/T6 (`"related"`). §6 Tests → T1–T5 (unit) + T9 (Smoke). §7 YAGNI → keine Panel-Verhaltensänderung (Transformationsregel ist rein strukturell). ✅ keine Lücke.

**Typ-Konsistenz:** `TabId`-Literale identisch überall (`"related"|"search"|"chat"|"smart-apply"`). `HubPanel`-Methodennamen (`mount/onShow/onHide/onFileOpen/destroy`) konsistent T1→T5. `refreshContext` (Related public) ↔ Hub `refreshContext` ↔ main `refresh`; `refreshRanking` (SmartApply public) ↔ Hub `refreshRanking` ↔ main `refreshSmartApplyRanking`. ✅

**Platzhalter:** In T6/Step 2 stehen `/* … exakt das bisherige …Deps-Objekt … */` — bewusst, weil die deps-Objekte byte-identisch aus main.ts:91–125 (Chat) bzw. 198–216 (SmartApply) übernommen werden; der ausführende Agent kopiert den existierenden Block. Kein erfundener Code.
