# Settings-UX-Slice Implementation Plan (Collapsible Kit-Modul + Index-Delta)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ein neues obsidian-kit-UI-Modul `collapsibleSection` (erstes obsidian-gekoppeltes Kit-Modul) bauen und vault-rag als ersten Consumer darauf umstellen (einklappbare Settings-Sektionen, Zustand persistiert); zusätzlich den Index-Zustand als „980 / 1 000 Notizen"-Delta mit inline „Vervollständigen"-Button (disabled bei kein-Delta) zeigen.

**Architecture:** Kit-Modul = eine selbstenthaltene Datei mit pure `resolveCollapsed` + UI `collapsibleSection(containerEl, opts) → bodyEl` + `COLLAPSIBLE_CSS`. Storage ist ein optionaler Callback (kein data.json im Kit). vault-rag vendored die Datei byte-identisch und verdrahtet `storage` an ein neues `uiCollapsed`-Setting.

**Tech Stack:** TypeScript (strict), vitest. Kit: `environment: node` + obsidian-Mock via `resolve.alias`. vault-rag: happy-dom + bestehender obsidian-Mock.

## Global Constraints

- **TS strict + noImplicitAny** in beiden Repos; keine `any`-Casts.
- **Kit-Ordner-Konvention:** obsidian-gekoppelter Code lebt in **`src/obsidian/`** (reserviert laut README.md:17 / CONTRIBUTING.md:16) — **NICHT `src/ui/`** (Spec-Korrektur: die Spec sagte `src/ui/`, die Kit-Konvention ist `src/obsidian/`; dieser Plan folgt der Konvention).
- **Kit-Modul selbstenthalten:** `collapsible.ts` importiert nur `from "obsidian"`, keine Kit-Barrel-Importe (muss als eine Datei vendorbar sein).
- **Kit TSDoc-Header-Konvention:** Vertrag/Signatur · Reinheits-/Verhaltensgarantie · mind. ein `@example` (als Testfall gespiegelt).
- **Vendor-Header-Format (vault-rag):** erste Zeile exakt `// vendored from obsidian-kit#<version>, src/obsidian/collapsible.ts`.
- **Tests:** vitest, `describe/it/expect`, kein `.only`/`.skip`. Verifizieren echtes Verhalten. Nach jeder Änderung alle Tests grün.
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Default:** Sektionen eingeklappt (`defaultCollapsed` default `true`).
- **CSS als exportierte Konstante** (`COLLAPSIBLE_CSS`) — das Kit injiziert kein CSS selbst.
- **Zwei Repos:** Kit-Tasks in `/Users/Shared/code/obsidian-plugins/obsidian-kit`, vault-rag-Tasks in `/Users/Shared/code/obsidian-plugins/vault-rag`. Jeder Task nennt sein Repo explizit.

## File Structure

**obsidian-kit (Task 1):**
- Create: `src/obsidian/collapsible.ts` (`resolveCollapsed`, `collapsibleSection`, `COLLAPSIBLE_CSS`, Typen), `src/obsidian/index.ts` (Barrel), `tests/collapsible.test.ts`.
- Modify: `package.json` (exports-Map `"./obsidian"`, version bump, obsidian devDep), `tsconfig.json` (DOM-lib), `vitest.config.ts` (obsidian-alias), `src/pure/index.ts` (KIT_VERSION bump), `CHANGELOG.md`, `README.md` (Modul-Tabelle + Layering).

**vault-rag (Tasks 2-5):**
- Create: `src/vendor/kit/collapsible.ts` (vendored), `tests/index_delta.test.ts`.
- Modify: `src/settings_core.ts` (`uiCollapsed`), `src/settings.ts` (collapsibleSection-Integration + zusammengeführte Index-Zeile), `src/main.ts` (indexDelta-Zahlen + storage-Verdrahtung + `indexDeltaReadout`), `styles.css` (COLLAPSIBLE_CSS), `AGENTS.md`, `../REGISTRY.md`.

---

## Task 1: obsidian-kit — collapsible-Modul (neue `src/obsidian/`-Schicht)

**Repo:** `/Users/Shared/code/obsidian-plugins/obsidian-kit`

**Files:**
- Create: `src/obsidian/collapsible.ts`, `src/obsidian/index.ts`, `tests/collapsible.test.ts`
- Modify: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/pure/index.ts`, `CHANGELOG.md`, `README.md`

**Interfaces:**
- Produces:
  - `interface CollapsibleStorage { getCollapsed(key: string): boolean; setCollapsed(key: string, collapsed: boolean): void }`
  - `interface CollapsibleOptions { title: string; defaultCollapsed?: boolean; key?: string; storage?: CollapsibleStorage }`
  - `function resolveCollapsed(key: string | undefined, defaultCollapsed: boolean, storage?: CollapsibleStorage): boolean`
  - `function collapsibleSection(containerEl: HTMLElement, opts: CollapsibleOptions): HTMLElement`
  - `const COLLAPSIBLE_CSS: string`

- [ ] **Step 1: Infra — tsconfig DOM-lib**

In `tsconfig.json`, change the `lib` line to include `DOM` (UI code needs `HTMLElement`, `Event`):
```jsonc
"lib": ["ES2022", "DOM"],
```

- [ ] **Step 2: Infra — obsidian devDep + exports + version bump**

In `package.json`:
- Add `"obsidian": "^1.7.2"` to `devDependencies` (brings the `HTMLElement` augmentations like `createDiv`/`createSpan`/`toggleClass` that the DOM lib alone lacks).
- Add a third exports entry:
```jsonc
"exports": {
  "./pure": "./src/pure/index.ts",
  "./testing": "./src/testing/obsidian-mock.ts",
  "./obsidian": "./src/obsidian/index.ts"
},
```
- Bump `"version"` to `"0.12.0"`.

Then run `npm install` so `obsidian` is present.

In `src/pure/index.ts`, bump `KIT_VERSION` to `"0.12.0"`.

- [ ] **Step 3: Infra — vitest obsidian alias**

In `vitest.config.ts`, add a `resolve.alias` mapping `obsidian` to the testing mock (so the module's `import { setIcon } from "obsidian"` resolves to the mock in tests):
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node", globals: true },
  resolve: {
    alias: { obsidian: fileURLToPath(new URL("./src/testing/obsidian-mock.ts", import.meta.url)) },
  },
});
```

- [ ] **Step 4: Write the failing tests**

Create `tests/collapsible.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeFakeEl } from "../src/testing/obsidian-mock";
import { resolveCollapsed, collapsibleSection, COLLAPSIBLE_CSS } from "../src/obsidian/collapsible";

describe("resolveCollapsed", () => {
  it("nutzt storage-Wert wenn key + storage vorhanden", () => {
    const storage = { getCollapsed: () => false, setCollapsed: () => {} };
    expect(resolveCollapsed("sec", true, storage)).toBe(false);
  });
  it("fällt auf defaultCollapsed zurück ohne storage", () => {
    expect(resolveCollapsed("sec", true, undefined)).toBe(true);
  });
  it("fällt auf defaultCollapsed zurück ohne key", () => {
    const storage = { getCollapsed: () => false, setCollapsed: () => {} };
    expect(resolveCollapsed(undefined, true, storage)).toBe(true);
  });
});

describe("collapsibleSection", () => {
  it("gibt einen Body-Container zurück und rendert einen Header mit Titel", () => {
    const c = makeFakeEl();
    const body = collapsibleSection(c, { title: "Chat" });
    expect(body).toBeTruthy();
    expect(c.textContent).toContain("Chat");
  });
  it("startet standardmäßig eingeklappt (Body is-collapsed, Chevron chevron-right)", () => {
    const c = makeFakeEl();
    const body = collapsibleSection(c, { title: "Chat" });
    expect(body.hasClass("is-collapsed")).toBe(true);
  });
  it("Klick auf den Header toggelt auf und ruft storage.setCollapsed", () => {
    const c = makeFakeEl();
    const calls: Array<[string, boolean]> = [];
    const storage = { getCollapsed: () => true, setCollapsed: (k: string, v: boolean) => calls.push([k, v]) };
    const body = collapsibleSection(c, { title: "Chat", key: "chat", storage });
    const header = c.querySelector(".okit-collapsible-header") ?? c.children?.[0]?.children?.[0];
    // Header ist das erste Kind der section; click darauf
    const section = c.children[0];
    const headerEl = section.children[0];
    headerEl.dispatchEvent({ type: "click" });
    expect(calls).toEqual([["chat", false]]);
    expect(body.hasClass("is-collapsed")).toBe(false);
  });
  it("respektiert initialen storage-Zustand (nicht eingeklappt)", () => {
    const c = makeFakeEl();
    const storage = { getCollapsed: () => false, setCollapsed: () => {} };
    const body = collapsibleSection(c, { title: "Chat", key: "chat", storage });
    expect(body.hasClass("is-collapsed")).toBe(false);
  });
});

describe("COLLAPSIBLE_CSS", () => {
  it("ist ein nicht-leeres CSS-Snippet mit der Body-Hide-Regel", () => {
    expect(COLLAPSIBLE_CSS).toContain(".okit-collapsible-body.is-collapsed");
    expect(COLLAPSIBLE_CSS).toContain("display: none");
  });
});
```

Note on the click test: `makeFakeEl` children are accessible via `.children`. If the mock's element shape differs (e.g. no `querySelector`), use the `section.children[0]` header access shown above and `dispatchEvent({type:"click"})` — the mock's `addEventListener`/`dispatchEvent` pair drives it. If a helper (`querySelector`, `children`) is missing on the fake element, adapt the test to the mock's actual traversal API (read `src/testing/obsidian-mock.ts` `makeFakeEl` first) rather than adding DOM globals.

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run tests/collapsible.test.ts`
Expected: FAIL — `Cannot find module '../src/obsidian/collapsible'`.

- [ ] **Step 6: Implement `src/obsidian/collapsible.ts`**

```ts
import { setIcon } from "obsidian";

/** Optionaler Persistenz-Callback für den Auf-/Zu-Zustand. Der Consumer verdrahtet ihn
 *  an seinen eigenen Speicher (z. B. data.json); das Kit bleibt storage-agnostisch. */
export interface CollapsibleStorage {
  getCollapsed(key: string): boolean;
  setCollapsed(key: string, collapsed: boolean): void;
}

export interface CollapsibleOptions {
  /** Sichtbarer Sektions-Titel (im setHeading-Look). */
  title: string;
  /** Startzustand ohne persistierten Wert. Default: true (eingeklappt). */
  defaultCollapsed?: boolean;
  /** Stabiler Schlüssel für die Persistenz (nur mit storage wirksam). */
  key?: string;
  storage?: CollapsibleStorage;
}

/** Löst den initialen Collapsed-Zustand auf: persistierter Wert (nur mit key UND storage),
 *  sonst defaultCollapsed. Pure — kein DOM.
 *  @example resolveCollapsed("chat", true, undefined) // → true (kein storage)
 *  @example resolveCollapsed("chat", true, { getCollapsed: () => false, setCollapsed(){} }) // → false */
export function resolveCollapsed(key: string | undefined, defaultCollapsed: boolean, storage?: CollapsibleStorage): boolean {
  if (key && storage) return storage.getCollapsed(key);
  return defaultCollapsed;
}

/** Rendert eine einklappbare Sektion (klickbarer Header + Body) in containerEl und gibt den
 *  Body-Container zurück — der Consumer baut seine Inhalte dort hinein. Startet eingeklappt
 *  (bzw. gemäß storage). Erstes obsidian-gekoppeltes Kit-UI-Modul.
 *  @example const body = collapsibleSection(el, { title: "Chat" }); body.createEl("input"); */
export function collapsibleSection(containerEl: HTMLElement, opts: CollapsibleOptions): HTMLElement {
  const defaultCollapsed = opts.defaultCollapsed ?? true;
  let collapsed = resolveCollapsed(opts.key, defaultCollapsed, opts.storage);

  const section = containerEl.createDiv({ cls: "okit-collapsible" });
  const header = section.createDiv({ cls: "okit-collapsible-header" });
  const chevron = header.createSpan({ cls: "okit-collapsible-chevron" });
  header.createSpan({ cls: "okit-collapsible-title", text: opts.title });
  const body = section.createDiv({ cls: "okit-collapsible-body" });

  const apply = (): void => {
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
    body.toggleClass("is-collapsed", collapsed);
    section.toggleClass("is-collapsed", collapsed);
  };
  apply();

  header.addEventListener("click", () => {
    collapsed = !collapsed;
    if (opts.key && opts.storage) opts.storage.setCollapsed(opts.key, collapsed);
    apply();
  });

  return body;
}

/** CSS-Snippet (nur Theme-Variablen) — der Consumer übernimmt es in seine styles.css.
 *  Das Kit injiziert bewusst kein CSS selbst (asset-/seiteneffektfrei). */
export const COLLAPSIBLE_CSS = `
.okit-collapsible-header {
  display: flex; align-items: center; gap: var(--size-4-2);
  cursor: pointer; padding: var(--size-4-2) 0;
  font-weight: var(--font-semibold); color: var(--text-normal);
  border-bottom: 1px solid var(--background-modifier-border);
}
.okit-collapsible-header:hover { color: var(--text-accent); }
.okit-collapsible-chevron { display: inline-flex; color: var(--text-muted); }
.okit-collapsible-body { padding-top: var(--size-4-2); }
.okit-collapsible-body.is-collapsed { display: none; }
`.trim();
```

Create `src/obsidian/index.ts` (barrel for the new layer):
```ts
export { resolveCollapsed, collapsibleSection, COLLAPSIBLE_CSS } from "./collapsible";
export type { CollapsibleStorage, CollapsibleOptions } from "./collapsible";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/collapsible.test.ts`
Expected: PASS. If a test's DOM-traversal doesn't match `makeFakeEl`'s shape, adjust the *test* to the mock's real API (do not add happy-dom).

- [ ] **Step 8: Typecheck + lint + full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 9: Docs — CHANGELOG + README**

Add a `CHANGELOG.md` entry for `0.12.0`: new `obsidian/` layer with `collapsibleSection` (first obsidian-coupled UI module). Add the module to the README module table and note the `obsidian/` layer is now active (was reserved).

- [ ] **Step 10: Commit**

```bash
git add src/obsidian/collapsible.ts src/obsidian/index.ts tests/collapsible.test.ts package.json package-lock.json tsconfig.json vitest.config.ts src/pure/index.ts CHANGELOG.md README.md
git commit -m "feat(obsidian): collapsibleSection — erste obsidian-gekoppelte UI-Schicht (0.12.0)

Einklappbare Settings-Sektion (Header+Body, Chevron, optionaler Storage-Callback).
Aktiviert den reservierten src/obsidian/-Layer; DOM-lib + obsidian devDep + vitest-alias.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: vault-rag — Modul vendoren + uiCollapsed-Setting + CSS

**Repo:** `/Users/Shared/code/obsidian-plugins/vault-rag`

**Files:**
- Create: `src/vendor/kit/collapsible.ts`
- Modify: `src/settings_core.ts` (`uiCollapsed` field + default), `styles.css` (append COLLAPSIBLE_CSS)

**Interfaces:**
- Consumes: the Task 1 module (byte-copy).
- Produces: `VaultRagSettings.uiCollapsed: Record<string, boolean>` (default `{}`); vendored `collapsibleSection`/`resolveCollapsed`/`COLLAPSIBLE_CSS` available at `./vendor/kit/collapsible`.

- [ ] **Step 1: Vendor the module (byte copy + header)**

Copy `obsidian-kit/src/obsidian/collapsible.ts` to `vault-rag/src/vendor/kit/collapsible.ts`, prepending exactly this first line (matching the existing vendored files' header style, e.g. `src/vendor/kit/settings.ts:1`):
```ts
// vendored from obsidian-kit#0.12.0, src/obsidian/collapsible.ts
```
Everything after the header line is identical to the kit file. Verify: `diff <(tail -n +2 src/vendor/kit/collapsible.ts) ../obsidian-kit/src/obsidian/collapsible.ts` prints nothing.

- [ ] **Step 2: Add `uiCollapsed` to settings**

In `src/settings_core.ts`, add to the `VaultRagSettings` interface (near the other fields):
```ts
  /** Auf-/Zu-Zustand der Settings-Sektionen (key → collapsed). */
  uiCollapsed: Record<string, boolean>;
```
And to `DEFAULT_SETTINGS`:
```ts
  uiCollapsed: {},
```
(`mergeSettings` shallow-clones this object, so no reference-sharing issue.)

- [ ] **Step 3: Append COLLAPSIBLE_CSS to styles.css**

Append the CSS from the vendored module to `styles.css`. Since `COLLAPSIBLE_CSS` is a TS export, paste its literal CSS content (the `.okit-collapsible-*` rules) into `styles.css` under a comment `/* obsidian-kit: collapsible sections */`. (styles.css is static CSS, so the rules are inlined here rather than imported.)

- [ ] **Step 4: Typecheck + build + test**

Run: `npm run typecheck && npm test && npm run build`
Expected: green (nothing consumes the vendored module yet — this task only wires it in).

- [ ] **Step 5: Commit**

```bash
git add src/vendor/kit/collapsible.ts src/settings_core.ts styles.css
git commit -m "feat(settings): collapsible-Kit-Modul vendored + uiCollapsed-Setting + CSS

vendored from obsidian-kit#0.12.0. Fundament für einklappbare Sektionen (nächster Task).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: vault-rag — Settings-Sektionen einklappbar machen

**Repo:** `/Users/Shared/code/obsidian-plugins/vault-rag`

**Files:**
- Modify: `src/settings.ts` (replace `sec()` sections with `collapsibleSection`), `src/main.ts` (provide the storage callback if the tab reads it from the plugin)

**Interfaces:**
- Consumes: `collapsibleSection`, `CollapsibleStorage` from `./vendor/kit/collapsible`; `settings.uiCollapsed`.

- [ ] **Step 1: Read the current display() structure**

Read `src/settings.ts` `display()` (≈ lines 186–end) and note every `sec("<Name>")` call and which `build*`/`new Setting(containerEl)` lines belong to each section (a section spans from its `sec()` to the next `sec()`). Current sections (settings.ts:198–227): `Suche`, `Live-Embedding`, `Index`, `Index-Robustheit`, `MCP-Server`, `Chat`, `Smart Apply` — plus the endpoint/embedding block before line 198. Confirm the exact list and order.

- [ ] **Step 2: Add a storage helper on the SettingTab**

At the top of `display()` (after `containerEl.empty()`), build a `CollapsibleStorage` backed by `settings.uiCollapsed`:
```ts
const storage = {
  getCollapsed: (key: string): boolean => this.plugin.settings.uiCollapsed[key] ?? true,
  setCollapsed: (key: string, collapsed: boolean): void => {
    this.plugin.settings.uiCollapsed[key] = collapsed;
    void this.plugin.saveSettings();
  },
};
```
(Default `true` = collapsed on first open. `saveSettings` persists to data.json.)

- [ ] **Step 3: Replace each `sec()` with a collapsibleSection body**

Transformation rule — for every section, replace:
```ts
sec("Chat");
// ... new Setting(containerEl)... / this.buildX(containerEl) ...
```
with:
```ts
const chatBody = collapsibleSection(containerEl, { title: "Chat", key: "chat", storage });
// ... new Setting(chatBody)... / this.buildX(chatBody) ...
```
Assign a stable `key` per section: `search`, `embedding`, `index`, `index-robustness`, `mcp`, `chat`, `smartapply`, and `endpoints` for the leading endpoint block. Every `new Setting(containerEl)` / `build*(containerEl)` between that section's header and the next one must now target the section's `body` element instead of `containerEl`. Import `collapsibleSection` from `./vendor/kit/collapsible`. Remove the old `sec` helper (settings.ts:197) once all sections are converted.

Take care with the `this.display()` re-render paths (settings.ts has many — e.g. "Verbindung prüfen", token toggle): after `containerEl.empty()` the sections are rebuilt, and `storage.getCollapsed` restores each section's state from `uiCollapsed`, so collapse state survives re-render. No extra work needed beyond routing every setting into its section body.

- [ ] **Step 4: Manual-trace verification (no new automated test required)**

There is no unit test for `display()` (it's obsidian-UI glue). Verify by: `npm run typecheck` (every `build*`/`new Setting` now takes the body element — a leftover `containerEl` in a converted section is a type-correct but wrong-parent bug, so grep to confirm no stray `containerEl` remains inside converted sections). Run `grep -n "new Setting(containerEl)\|sec(" src/settings.ts` — expected: no `sec(` left; any remaining `new Setting(containerEl)` must be intentional top-level (e.g. the plugin-title heading), not inside a section.

- [ ] **Step 5: Typecheck + lint + full suite + build**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): Sektionen einklappbar (collapsibleSection, Zustand persistiert)

Alle Settings-Sektionen via Kit-collapsibleSection; Auf/Zu je Sektion in uiCollapsed
(data.json), Default eingeklappt. Ersetzt die flachen setHeading-Sektionen.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: vault-rag — Index-Delta-Readout + inline Vervollständigen-Button

**Repo:** `/Users/Shared/code/obsidian-plugins/vault-rag`

**Files:**
- Create: `tests/index_delta.test.ts`
- Modify: `src/main.ts` (`indexDeltaReadout` + expose embedded/total), `src/settings.ts` (merge the two Index-Robustheit rows)

**Interfaces:**
- Produces: `indexDeltaReadout(embedded: number, total: number): string`; a plugin method/getter returning `{ embedded: number; total: number }` for the settings tab.

- [ ] **Step 1: Write the failing test for the pure formatter**

Create `tests/index_delta.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { indexDeltaReadout } from "../src/main";

describe("indexDeltaReadout", () => {
  it("zeigt embedded/total mit de-DE-Tausendertrennung", () => {
    expect(indexDeltaReadout(980, 1000)).toBe("980 / 1.000 Notizen");
  });
  it("markiert Vollständigkeit bei embedded === total", () => {
    expect(indexDeltaReadout(1000, 1000)).toBe("1.000 / 1.000 Notizen (vollständig)");
  });
  it("behandelt total = 0", () => {
    expect(indexDeltaReadout(0, 0)).toBe("0 / 0 Notizen (vollständig)");
  });
});
```
(If `src/main.ts` cannot be imported in the vitest env because it imports `obsidian` at module top, instead put `indexDeltaReadout` in a small pure module `src/index_delta.ts` and import from there — decide based on whether existing tests import from `main.ts`. Check: `grep -rn "from \"../src/main\"" tests/`. If none import main.ts, use `src/index_delta.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index_delta.test.ts`
Expected: FAIL — `indexDeltaReadout` not exported.

- [ ] **Step 3: Implement `indexDeltaReadout`**

Add (to `src/index_delta.ts` if main.ts isn't test-importable, else exported from main.ts):
```ts
/** Formatiert den Index-Füllstand als "embedded / total Notizen" (de-DE), mit
 *  Vollständigkeits-Hinweis wenn nichts fehlt. Pure. */
export function indexDeltaReadout(embedded: number, total: number): string {
  const fmt = (n: number): string => n.toLocaleString("de-DE");
  const complete = embedded >= total ? " (vollständig)" : "";
  return `${fmt(embedded)} / ${fmt(total)} Notizen${complete}`;
}
```

- [ ] **Step 4: Expose embedded/total from the plugin**

In `src/main.ts`, add a method returning the two counts (embedded = `this.embeddingProgress.embeddedNotes`; total = indexable markdown files minus `exclude` — reuse the same filter logic `diffIndexVsVault`/`healVault` already use to count vault notes; find that logic and mirror it):
```ts
indexDelta(): { embedded: number; total: number } {
  const embedded = this.embeddingProgress.embeddedNotes;
  const total = this.app.vault.getMarkdownFiles()
    .filter(f => !this.settings.exclude.some(e => f.path.startsWith(e))).length;
  return { embedded, total };
}
```
(Match the exact exclude-filter predicate the plugin uses elsewhere — if `diffIndexVsVault` uses a case-insensitive or normalized compare, mirror it exactly. Read that code first.)

Add `indexDelta` + `indexDeltaReadout` to the `PluginBridge`/host interface the settings tab uses (see `settings.ts` top interface, ~line 37–51 lists `embeddingProgress`, `healVault`, `indexHealthReadout`).

- [ ] **Step 5: Merge the two Index-Robustheit rows in settings.ts**

Find the two settings (settings.ts:775–780): `setName("Index-Zustand").setDesc(indexHealthReadout())` and the separate `setName("Index vervollständigen")…addButton("Vervollständigen")`. Merge into one:
```ts
const { embedded, total } = this.plugin.indexDelta();
new Setting(indexRobustnessBody)   // the collapsibleSection body from Task 3
  .setName("Index-Zustand")
  .setDesc(indexDeltaReadout(embedded, total))
  .addButton(b => b
    .setButtonText("Vervollständigen")
    .setDisabled(embedded >= total)
    .onClick(() => { void this.plugin.healVault(); }));
```
Delete the separate "Index vervollständigen" row and its description. Keep this in sync with the 2s progress refresh that already re-renders this area (the disabled state updates on refresh).

- [ ] **Step 6: Run tests + typecheck + lint + build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green, `indexDeltaReadout` tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/settings.ts tests/index_delta.test.ts
# add src/index_delta.ts if created
git commit -m "feat(settings): Index-Zustand als Delta (980/1000) + inline Vervollständigen-Button

Zusammengeführte Index-Zeile mit Delta-Readout; Button disabled bei kein-Delta;
redundante Vervollständigen-Beschreibung entfernt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Docs + Gesamt-Verifikation

**Repo:** `/Users/Shared/code/obsidian-plugins/vault-rag` (+ REGISTRY im Dach)

**Files:**
- Modify: `AGENTS.md` (note the vendored collapsible module + uiCollapsed), `../REGISTRY.md` (register the new kit UI module)

- [ ] **Step 1: AGENTS.md**

In `AGENTS.md`, note in the module layout / vendored-kit area that `src/vendor/kit/collapsible.ts` (from obsidian-kit#0.12.0) provides the collapsible settings sections, and that section collapse state lives in `settings.uiCollapsed`.

- [ ] **Step 2: REGISTRY.md (Dach)**

In `/Users/Shared/code/obsidian-plugins/REGISTRY.md`, add a `[UI]` entry: einklappbare Settings-Sektion → `obsidian-kit/obsidian` → `collapsibleSection` (im Kit @0.12.0, erste obsidian-UI-Schicht; Consumer: vault-rag).

- [ ] **Step 3: Full verification sweep (vault-rag)**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): collapsible-Kit-Modul + uiCollapsed dokumentieren

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
# REGISTRY.md is in the parent repo — commit separately there:
git -C /Users/Shared/code/obsidian-plugins add REGISTRY.md
git -C /Users/Shared/code/obsidian-plugins commit -m "docs(registry): collapsibleSection (obsidian-kit UI-Schicht @0.12.0)"
```
(Note: REGISTRY.md may live in its own repo/worktree at the `obsidian-plugins` root — if it is not a git repo of its own, skip the separate commit and just save the file; confirm with `git -C /Users/Shared/code/obsidian-plugins rev-parse --show-toplevel`.)

---

## Self-Review (durchgeführt)

**Spec-Coverage:**
- Collapsible Kit-Modul (neue UI-Schicht) → Task 1. ✅ (Ordner-Korrektur `src/ui/`→`src/obsidian/` dokumentiert unter Global Constraints.)
- Pure/DOM-Trennung (`resolveCollapsed` pure) → Task 1. ✅
- Optionaler Storage-Callback → Task 1 (Kit) + Task 3 (vault-rag-Verdrahtung an uiCollapsed). ✅
- Default eingeklappt → `defaultCollapsed ?? true` + `getCollapsed ?? true`. ✅
- CSS als Konstante → `COLLAPSIBLE_CSS` (Task 1), in styles.css übernommen (Task 2). ✅
- Vendoring → Task 2. ✅
- Index-Delta „980/1000" + inline Button + Beschreibung weg + disabled bei kein-Delta → Task 4. ✅
- Tests (resolveCollapsed, DOM-Toggle, indexDeltaReadout) → Task 1 + Task 4. ✅

**Placeholder-Scan:** kein TBD/TODO. Die zwei „read the code first"-Stellen (settings.ts display()-Struktur in Task 3; exclude-Filter-Predikat in Task 4) sind bewusste Refactoring-Anweisungen mit Transformationsregel + Verifikation, kein Platzhalter — der genaue Bestandscode ist zu groß zum Zitieren und muss exakt gespiegelt werden.

**Typ-Konsistenz:** `CollapsibleStorage.getCollapsed/setCollapsed`-Signaturen identisch in Kit (Task 1), vault-rag-storage-Helper (Task 3). `indexDeltaReadout(embedded, total)` identisch in Test + Impl + settings-Aufruf (Task 4). Vendor-Header-Version `0.12.0` konsistent mit Kit-bump (Task 1) + Vendoring (Task 2) + REGISTRY (Task 5).

**Bekannte Spec-Abweichung:** `src/obsidian/` statt `src/ui/` (Kit-Konvention) — unter Global Constraints dokumentiert.
