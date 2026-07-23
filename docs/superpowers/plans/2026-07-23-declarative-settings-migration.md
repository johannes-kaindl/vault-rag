# Deklarative Settings-Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Settings-Tab von imperativem `display()` auf die deklarative Obsidian-1.13-API `getSettingDefinitions()` umstellen — statische Zeilen werden durchsuchbar, dynamische laufen über den `render`-Escape-Hatch.

**Architecture:** `getSettingDefinitions()` liefert ein flaches Array aus sieben `type:"group"`-Objekten und wird die einzige Wahrheit. `getControlValue`/`setControlValue` (switch-Map) tragen Coercion + Seiteneffekte. Einfache Felder sind deklarative Controls (`slider`/`toggle`/`dropdown`/`text`/`textarea`/`folder`/`action`/`empty`); alles Async/Imperative (Endpoint-Listen, Status-Poll, Modell-Probing, MCP-Sektion, Budget-Slider) läuft über `render`-Hatches mit dem `hostFor`-Trick. `display()` entfällt komplett (kein `<1.13`-Fallback, weil `minAppVersion` 1.13.0).

**Tech Stack:** TypeScript (strict), Obsidian Plugin API 1.13.1, vitest + happy-dom, hand-gerollter Obsidian-Mock (`tests/__mocks__/obsidian.ts`) via vitest-Alias.

**Spec:** `docs/superpowers/specs/2026-07-23-declarative-settings-migration-design.md`

## Global Constraints

- **`minAppVersion` = 1.13.0** — reine deklarative API, kein `display()`-Fallback.
- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen (Ausnahme: die unvermeidbaren `key`-indizierten Zugriffe in `get/setControlValue`, dort eng gekapselt).
- **Kein `obsidian`-Import in `settings_core.ts`** — dieses Modul wird vom MCP-Server genutzt.
- **`settings.ts` importiert `obsidian` nur an der Kante** (bestehendes Muster).
- **Tests:** vitest + happy-dom, Obsidian-Mock, kein echter obsidian-Import im Test, kein `.only`/`.skip`. Nach jeder Änderung **alle Tests grün** (aktuell 688).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt, **nur berührte Dateien stagen (nie `git add -A`)**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`this.update()` statt `this.display()`** für alle Struktur-Refreshes.
- **render-Hatches werden nicht gerendert-getestet** (Dach-Kanon) — Tests prüfen nur die Definitions-Struktur pure.

## File Structure

- **`src/settings_core.ts`** (modify) — bekommt zwei pure Coercion-Helfer: `splitExcludePaths`, `normalizeTemplateDir`. Bleibt obsidian-frei.
- **`src/settings.ts`** (modify, groß) — `VaultRagSettingTab` wird umgebaut: `getSettingDefinitions()` + `getControlValue`/`setControlValue` + private Gruppen-Builder (`searchGroup()` … `smartApplyGroup()`) + private render-Hatch-Helfer (aus den bisherigen `build*`-Methoden umgezogen) + `hostFor()`. `display()`, `rerender()`, `resetRenderState()`, collapsibleSection-Aufbau entfallen am Schluss.
- **`tests/__mocks__/obsidian.ts`** (modify) — `PluginSettingTab` bekommt `update()`-Stub; `SettingGroup`-Klasse als leichter Stub, falls von render-Hatch-Typen benötigt. Kein `getSettingDefinitions` im Mock (kommt aus der Subklasse).
- **`tests/settings.test.ts`** (modify) — behält die Default-/Helfer-Tests; bekommt neue Definitions-Struktur-Tests (Fake-Host-Harness, Round-Trip, Seiteneffekte).
- **`tests/settings_core.test.ts`** (create) — pure Tests der neuen Coercion-Helfer. (Falls bereits eine passende Datei existiert, dort ergänzen.)

## Type-Referenz (aus `node_modules/obsidian/obsidian.d.ts`, hier verbatim für Offline-Leser)

```ts
// getSettingDefinitions(): SettingDefinitionItem[]   — auf PluginSettingTab, seit 1.13.0
// getControlValue(key: string): unknown              — Default liest settings[key]
// setControlValue(key: string, value: unknown): void | Promise<void>

type SettingDefinitionItem = SettingDefinition | SettingDefinitionGroup | SettingDefinitionList | SettingDefinitionPage;
type SettingDefinition = SettingDefinitionControl | SettingDefinitionRender | SettingDefinitionAction | SettingDefinitionEmpty;

interface SettingDefinitionBase { name: string; desc?: string | DocumentFragment; aliases?: string[];
  searchable?: boolean | (() => boolean); visible?: boolean | (() => boolean); }

interface SettingDefinitionGroup { type: 'group' | 'list'; heading?: string; cls?: string;
  items?: SettingGroupItem[]; visible?: boolean | (() => boolean); /* search?, extraButtons? */ }

interface SettingDefinitionControl extends SettingDefinitionBase { control: SettingControl; }  // key liegt im control
interface SettingDefinitionRender  extends SettingDefinitionBase { render: (setting: Setting, group: SettingGroup) => void | (() => void); }
interface SettingDefinitionAction  extends SettingDefinitionBase { action: (el: HTMLElement, index: number) => void; disabled?: boolean | (() => boolean); }
interface SettingDefinitionEmpty   extends SettingDefinitionBase { /* nur name/desc */ }

// SettingControl (Auswahl):
interface SettingControlBase<V> { key: string; defaultValue?: V; validate?: (v: V) => string | void; disabled?: boolean | (() => boolean); }
interface SettingSliderControl   extends SettingControlBase<number>  { type: 'slider'; min: number; max: number; step: number; displayFormat?: (v: number) => string; }
interface SettingToggleControl   extends SettingControlBase<boolean> { type: 'toggle'; }
interface SettingTextControl     extends SettingControlBase<string>  { type: 'text'; placeholder?: string; }
interface SettingTextAreaControl extends SettingControlBase<string>  { type: 'textarea'; /* rows via cls/CSS */ }
interface SettingDropdownControl extends SettingControlBase<string>  { type: 'dropdown'; options: Record<string,string>; }
interface SettingFolderControl   extends SettingControlBase<string>  { type: 'folder'; placeholder?: string; includeRoot?: boolean; }
```

**Deklarative Keys (18) — Referenz für alle Tasks:**
`k`, `minSim`, `exclude`, `debounceMs`, `showStatusBar`, `hideIndexFolder`,
`chatK`, `chatTemperature`, `chatSystemPrompt`, `chatInputPosition`, `suppressThinking`, `enterSends`,
`smartApplyEnabled`, `templateDir`, `smartApplyTemperature`, `smartApplySuppressThinking`,
`smartApplyMaxTokens`, `smartApplyDefaultMode`.

**Seiteneffekt-Keys:** `k`,`minSim` → `refresh()`; `showStatusBar` → `setStatusBarVisible(v)`;
`hideIndexFolder` → `refreshIndexFolderHiding()`; `templateDir` → `refreshSmartApplyRanking()`.
**Coercion-Keys:** `exclude` (string ↔ string[]), `templateDir` (Trailing-Slash).

---

### Task 1: Pure Coercion-Helfer in `settings_core.ts`

**Files:**
- Modify: `src/settings_core.ts`
- Test: `tests/settings_core.test.ts` (create, oder in bestehende `settings_core.mcp.test.ts` nebenan — hier neue Datei)

**Interfaces:**
- Produces: `splitExcludePaths(input: string): string[]`, `normalizeTemplateDir(input: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings_core.test.ts
import { describe, it, expect } from "vitest";
import { splitExcludePaths, normalizeTemplateDir } from "../src/settings_core";

describe("splitExcludePaths", () => {
  it("splittet komma-getrennt, trimmt, filtert leere", () => {
    expect(splitExcludePaths("Templates/, Archive/ ,")).toEqual(["Templates/", "Archive/"]);
  });
  it("leere Eingabe → leere Liste", () => {
    expect(splitExcludePaths("   ")).toEqual([]);
  });
});

describe("normalizeTemplateDir", () => {
  it("ergänzt fehlenden Trailing-Slash", () => {
    expect(normalizeTemplateDir("Templates")).toBe("Templates/");
  });
  it("lässt vorhandenen Trailing-Slash unangetastet", () => {
    expect(normalizeTemplateDir("Templates/")).toBe("Templates/");
  });
  it("leere Eingabe bleibt leer (kein Slash)", () => {
    expect(normalizeTemplateDir("  ")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings_core.test.ts`
Expected: FAIL — `splitExcludePaths`/`normalizeTemplateDir` nicht exportiert.

- [ ] **Step 3: Write minimal implementation**

In `src/settings_core.ts` unten anhängen (obsidian-frei):

```ts
/** Komma-getrennte Ausschluss-Pfade → getrimmte, leer-gefilterte Liste. */
export function splitExcludePaths(input: string): string[] {
  return input.split(",").map(x => x.trim()).filter(Boolean);
}

/** Vorlagen-Ordner normalisieren: getrimmt, mit Trailing-Slash (leer bleibt leer). */
export function normalizeTemplateDir(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  return trimmed.endsWith("/") ? trimmed : trimmed + "/";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings_core.test.ts`
Expected: PASS (5 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/settings_core.ts tests/settings_core.test.ts
git commit -m "feat(settings): pure Coercion-Helfer (exclude-split, templateDir-normalize)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Fundament — `getControlValue`/`setControlValue` + Test-Harness

Baut die Lese-/Schreibschicht und den Fake-Host für alle folgenden Struktur-Tests. `getSettingDefinitions()` liefert vorerst `[]` (display() bleibt aktiv). Der Round-Trip-Test iteriert über die explizite `DECLARATIVE_KEYS`-Liste.

**Files:**
- Modify: `src/settings.ts` (Klasse `VaultRagSettingTab`), `src/settings_core.ts` (Import der Helfer in settings.ts)
- Modify: `tests/__mocks__/obsidian.ts` (falls `update()`-Stub fehlt)
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `splitExcludePaths`, `normalizeTemplateDir` (Task 1); `VaultRagPluginHost` (bestehend, `src/settings.ts:32`).
- Produces: `VaultRagSettingTab.getControlValue(key)`, `.setControlValue(key, value)`; Test-Helper `makeFakeHost()` (in der Testdatei).

- [ ] **Step 1: Mock um `update()` ergänzen**

In `tests/__mocks__/obsidian.ts` die `PluginSettingTab`-Zeile erweitern:

```ts
export class PluginSettingTab { app: any; plugin: any; containerEl: any;
  constructor(app: any, plugin: any) { this.app = app; this.plugin = plugin; this.containerEl = makeFakeEl(); }
  display() {} update() {} }
```

- [ ] **Step 2: Write the failing test**

In `tests/settings.test.ts` importe erweitern und neuen `describe`-Block anhängen:

```ts
import { VaultRagSettingTab } from "../src/settings";
import { vi } from "vitest";

const DECLARATIVE_KEYS = [
  "k","minSim","exclude","debounceMs","showStatusBar","hideIndexFolder",
  "chatK","chatTemperature","chatSystemPrompt","chatInputPosition","suppressThinking","enterSends",
  "smartApplyEnabled","templateDir","smartApplyTemperature","smartApplySuppressThinking",
  "smartApplyMaxTokens","smartApplyDefaultMode",
] as const;

function makeFakeHost() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    refreshSmartApplyRanking: vi.fn(),
    setStatusBarVisible: vi.fn(),
    refreshIndexFolderHiding: vi.fn(),
    // Endpoint-/Modell-/MCP-Methoden für render-Hatches (in Struktur-Tests nicht aufgerufen):
    resolveAndReconnectEmbedder: vi.fn().mockResolvedValue(undefined),
    resolveAndReconnectChat: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeTab(host = makeFakeHost()) {
  return { tab: new VaultRagSettingTab({} as any, host), host };
}

describe("getControlValue/setControlValue", () => {
  it("round-trippt jeden deklarativen Key ohne Store-Drift", async () => {
    const { tab, host } = makeTab();
    for (const key of DECLARATIVE_KEYS) {
      const before = structuredClone(host.settings[key]);
      await tab.setControlValue(key, tab.getControlValue(key));
      expect(host.settings[key]).toEqual(before);
    }
  });

  it("exclude: string ↔ string[] Coercion", async () => {
    const { tab, host } = makeTab();
    expect(tab.getControlValue("exclude")).toBe("Templates/, Archive/");
    await tab.setControlValue("exclude", "A/, B/");
    expect(host.settings.exclude).toEqual(["A/", "B/"]);
  });

  it("templateDir: Trailing-Slash-Normalisierung + Ranking-Refresh", async () => {
    const { tab, host } = makeTab();
    await tab.setControlValue("templateDir", "Vorlagen");
    expect(host.settings.templateDir).toBe("Vorlagen/");
    expect(host.refreshSmartApplyRanking).toHaveBeenCalled();
  });

  it("Seiteneffekte: k→refresh, showStatusBar→setStatusBarVisible, hideIndexFolder→refreshIndexFolderHiding", async () => {
    const { tab, host } = makeTab();
    await tab.setControlValue("k", 30);
    expect(host.refresh).toHaveBeenCalled();
    await tab.setControlValue("showStatusBar", true);
    expect(host.setStatusBarVisible).toHaveBeenCalledWith(true);
    await tab.setControlValue("hideIndexFolder", false);
    expect(host.refreshIndexFolderHiding).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `getControlValue`/`setControlValue` liefern noch das Default-Verhalten (kein exclude-join, keine Seiteneffekte).

- [ ] **Step 4: Implement `getControlValue`/`setControlValue`**

In `src/settings.ts`: Import ergänzen
`import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, migrateEndpointList, splitExcludePaths, normalizeTemplateDir, type VaultRagSettings } from "./settings_core";`

In der Klasse `VaultRagSettingTab` zwei Methoden ergänzen (Coercion + Seiteneffekte gekapselt):

```ts
getControlValue(key: string): unknown {
  const s = this.plugin.settings as unknown as Record<string, unknown>;
  if (key === "exclude") return (s.exclude as string[]).join(", ");
  return s[key];
}

async setControlValue(key: string, value: unknown): Promise<void> {
  const s = this.plugin.settings as unknown as Record<string, unknown>;
  if (key === "exclude") s.exclude = splitExcludePaths(value as string);
  else if (key === "templateDir") s.templateDir = normalizeTemplateDir(value as string);
  else s[key] = value;
  await this.plugin.saveSettings();
  switch (key) {
    case "k": case "minSim": this.plugin.refresh(); break;
    case "showStatusBar": this.plugin.setStatusBarVisible(s.showStatusBar as boolean); break;
    case "hideIndexFolder": this.plugin.refreshIndexFolderHiding(); break;
    case "templateDir": this.plugin.refreshSmartApplyRanking(); break;
  }
}

getSettingDefinitions(): import("obsidian").SettingDefinitionItem[] { return []; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + Commit**

Run: `npx tsc --noEmit` → keine Fehler.

```bash
git add src/settings.ts tests/settings.test.ts tests/__mocks__/obsidian.ts
git commit -m "feat(settings): getControlValue/setControlValue mit Coercion + Seiteneffekten

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Suche-Gruppe (rein deklarativ) + `hostFor` + wachsender Konsistenz-Test

Erste echte Gruppe. Führt den dach-weiten Konsistenz-Test ein, der ab jetzt mit jeder Gruppe strenger wird.

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: private `searchGroup(): SettingDefinitionGroup`; private `hostFor(setting): HTMLElement`; `getSettingDefinitions()` enthält jetzt die Suche-Gruppe.

- [ ] **Step 1: Write the failing test**

```ts
describe("getSettingDefinitions – Struktur", () => {
  function groups(tab: VaultRagSettingTab) {
    const defs = tab.getSettingDefinitions() as any[];
    return defs.filter(d => d.type === "group");
  }
  function controlKeys(tab: VaultRagSettingTab): string[] {
    return groups(tab).flatMap(g => (g.items ?? []))
      .filter((i: any) => i.control).map((i: any) => i.control.key);
  }

  it("liefert nur Groups auf oberster Ebene", () => {
    const { tab } = makeTab();
    const defs = tab.getSettingDefinitions() as any[];
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) expect(d.type).toBe("group");
  });

  it("jeder Control-Key existiert in DEFAULT_SETTINGS und round-trippt", async () => {
    const { tab, host } = makeTab();
    for (const key of controlKeys(tab)) {
      expect(key in host.settings).toBe(true);
      const before = structuredClone(host.settings[key]);
      await tab.setControlValue(key, tab.getControlValue(key));
      expect(host.settings[key]).toEqual(before);
    }
  });

  it("Suche-Gruppe hat k, minSim, exclude", () => {
    const { tab } = makeTab();
    const search = groups(tab).find(g => g.heading === "Suche");
    expect(search).toBeTruthy();
    const keys = (search!.items as any[]).filter(i => i.control).map(i => i.control.key);
    expect(keys).toEqual(["k", "minSim", "exclude"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts -t "Struktur"`
Expected: FAIL — `getSettingDefinitions()` liefert `[]`.

- [ ] **Step 3: Implement `hostFor` + `searchGroup` + verdrahten**

In `src/settings.ts` Import der Setting-Typen sicherstellen (Type-only):
`import type { SettingDefinitionItem, SettingDefinitionGroup, SettingSliderControl } from "obsidian";`

`hostFor`-Helfer (für spätere render-Hatches, hier schon anlegen):

```ts
/** Macht die von der API übergebene Setting-Row zu einem neutralen Block-Container:
 *  render-Hatches, die mehrere Rows zeichnen, dürfen sonst nicht in die Zwei-Spalten-.setting-item.
 *  Achtung: leert settingEl → Desc muss der Hatch selbst neu setzen. */
private hostFor(setting: Setting): HTMLElement {
  setting.settingEl.empty();
  setting.settingEl.removeClass("setting-item");
  return setting.settingEl;
}
```

`searchGroup` + `getSettingDefinitions`:

```ts
private searchGroup(): SettingDefinitionGroup {
  return { type: "group", heading: "Suche", items: [
    { name: "Anzahl verwandter Notizen",
      desc: "Wie viele ähnliche Notizen im Panel angezeigt werden (5–50)",
      control: { type: "slider", key: "k", min: 5, max: 50, step: 1,
        displayFormat: (v: number) => String(v) } },
    { name: "Mindest-Ähnlichkeit",
      desc: "Notizen unterhalb dieser Schwelle werden ausgeblendet — niedriger = mehr Treffer, unschärfer",
      control: { type: "slider", key: "minSim", min: 0, max: 0.9, step: 0.05,
        displayFormat: (v: number) => `${Math.round(v * 100)} %` } },
    { name: "Ausschluss-Pfade",
      desc: "Kommagetrennte Pfade, die nicht eingebettet werden (z.B. Templates/, Archive/). Versteckte Pfade (Konfig-Ordner, Papierkorb) sind immer automatisch ausgeschlossen.",
      control: { type: "text", key: "exclude", placeholder: "Templates/, Archive/" } },
  ] };
}

getSettingDefinitions(): SettingDefinitionItem[] {
  return [ this.searchGroup() ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS. Danach voller Lauf `npm test` → weiterhin grün.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): Suche-Gruppe deklarativ + hostFor-Helfer + Konsistenz-Test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Live-Embedding-Gruppe (deklarativ + render-Hatches)

Debounce/Statusleiste deklarativ; Endpoint-Liste, Modell-Dropdown, Status-Poll als render-Hatches (bestehender Code umgezogen).

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: bestehende private Helfer `buildEndpointList` (bleibt als render-Body genutzt), `buildEmbeddingModel`-Logik, `buildEmbeddingStatus`-Logik.
- Produces: private `embeddingGroup(): SettingDefinitionGroup`; render-Hatch-Helfer `renderEmbeddingEndpoints`, `renderEmbeddingModel`, `renderEmbeddingStatus` (Umzug der bisherigen `build*`-Bodies).

- [ ] **Step 1: Write the failing test**

```ts
it("Live-Embedding-Gruppe: Debounce/Statusleiste deklarativ, 3 render-Hatches", () => {
  const { tab } = makeTab();
  const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Live-Embedding");
  expect(g).toBeTruthy();
  const items = g.items as any[];
  const controlKeys = items.filter(i => i.control).map(i => i.control.key);
  expect(controlKeys).toEqual(["debounceMs", "showStatusBar"]);
  expect(items.filter(i => typeof i.render === "function").length).toBe(3); // Endpunkte, Modell, Status
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts -t "Live-Embedding"`
Expected: FAIL — Gruppe fehlt.

- [ ] **Step 3: render-Hatch-Helfer aus bestehenden `build*`-Methoden umziehen**

Wandle die bisherigen `buildEmbeddingEndpointList` / `buildEmbeddingModel` / `buildEmbeddingStatus` in render-Hatch-Helfer. Muster (Endpunkte):

```ts
/** render-Hatch: Embedding-Endpunkt-Liste. Body = bisheriger buildEndpointList, in hostFor gezeichnet,
 *  this.display() → this.update(). */
private renderEmbeddingEndpoints = (setting: Setting): void => {
  const host = this.hostFor(setting);
  this.buildEndpointList({
    containerEl: host,
    label: "Embedding-Endpunkte",
    desc: "Werden der Reihe nach probiert — der erste erreichbare wird genutzt. Ollama- oder MLX-Server-URLs (Desktop oder LAN/VPN-erreichbar).",
    placeholder: "http://localhost:11434",
    get: () => this.plugin.settings.embeddingEndpoints,
    set: (eps) => { this.plugin.settings.embeddingEndpoints = eps; },
    active: () => this.plugin.activeEmbeddingEndpoint,
    probe: (ep) => new EmbeddingClient(ep, this.plugin.settings.embeddingModel).probe(),
    reconnect: () => this.plugin.resolveAndReconnectEmbedder(),
  });
};
```

Ersetze **in `buildEndpointList` alle `this.display()` durch `this.update()`** (drei Stellen: blur, trash, preset; + „Verbindung prüfen"-Button).

`renderEmbeddingModel` = bisheriger `buildEmbeddingModel`-Body, aber statt `s.addDropdown` auf einer übergebenen `Setting` zeichnet er in `this.hostFor(setting)` eine frische `new Setting(host)`; `this.rerender()` → `this.update()`. Analog `renderEmbeddingStatus` = bisheriger `buildEmbeddingStatus`-Body; **wichtig:** der 2 s-Intervall wird als Cleanup zurückgegeben:

```ts
private renderEmbeddingStatus = (setting: Setting): (() => void) => {
  const host = this.hostFor(setting);
  const s = new Setting(host).setName("Embedding-Status");
  // … bisheriger buildEmbeddingStatus-Body auf s …
  const interval = window.setInterval(render, 2000);
  this.pollIntervals.push(interval);          // Feld `private pollIntervals: number[] = [];`
  return () => { window.clearInterval(interval); };
};
```

`embeddingGroup`:

```ts
private embeddingGroup(): SettingDefinitionGroup {
  return { type: "group", heading: "Live-Embedding", items: [
    { name: "Embedding-Endpunkte", desc: "", render: this.renderEmbeddingEndpoints },
    { name: "Embedding-Modell", desc: "Modellname wie auf dem Endpoint verfügbar", render: this.renderEmbeddingModel },
    { name: "Embedding-Status", desc: "", render: this.renderEmbeddingStatus },
    { name: "Debounce", desc: "Wartezeit nach dem letzten Speichern, bevor neu eingebettet wird",
      control: { type: "slider", key: "debounceMs", min: 500, max: 10000, step: 500,
        displayFormat: (v: number) => `${v / 1000} s` } },
    { name: "Fortschritt in Statusleiste", desc: "Zeigt Embedding-Status in der unteren Obsidian-Leiste",
      control: { type: "toggle", key: "showStatusBar" } },
  ] };
}
```

In `getSettingDefinitions()` ergänzen: `this.embeddingGroup()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts` → PASS. `npm test` → grün. `npx tsc --noEmit` → sauber.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): Live-Embedding-Gruppe (deklarativ + 3 render-Hatches, Poll-Cleanup)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Index- + Index-Robustheit-Gruppen

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: bestehende `buildIndexDir`-, `buildRobustnessSection`-Logik; Modals `ReindexConfirmModal`, `RestoreBackupModal`, `HealConfirmModal`.
- Produces: `indexGroup()`, `robustnessGroup()`; render-Hatches `renderIndexDir`, `renderIndexHealth`.

- [ ] **Step 1: Write the failing test**

```ts
it("Index-Gruppe: Index-Ordner render-Hatch + hideIndexFolder toggle", () => {
  const { tab } = makeTab();
  const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Index");
  expect(g).toBeTruthy();
  const items = g.items as any[];
  expect(items.filter(i => typeof i.render === "function").length).toBe(1);
  expect(items.filter(i => i.control).map(i => i.control.key)).toEqual(["hideIndexFolder"]);
});

it("Index-Robustheit-Gruppe: 1 render-Hatch (Zustand) + 2 action-Zeilen", () => {
  const { tab } = makeTab();
  const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Index-Robustheit");
  expect(g).toBeTruthy();
  const items = g.items as any[];
  expect(items.filter(i => typeof i.render === "function").length).toBe(1);
  expect(items.filter(i => typeof i.action === "function").length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts -t "Index"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`renderIndexDir` = bisheriger `buildIndexDir`-Body in `hostFor`, `this.display()` → `this.update()`.
`renderIndexHealth` = bisherige erste Zeile aus `buildRobustnessSection` (Index-Zustand mit dynamischer Desc via `this.plugin.indexHealthReadout(...)` + „Vervollständigen"-Button, disabled via `!healthy || embedded >= total`), gezeichnet in `hostFor`.

```ts
private indexGroup(): SettingDefinitionGroup {
  return { type: "group", heading: "Index", items: [
    { name: "Index-Ordner", desc: "", render: this.renderIndexDir },
    { name: "Index-Ordner im Datei-Explorer ausblenden",
      desc: "Versteckt den Index-Ordner kosmetisch im Datei-Explorer. Daten, Sync und Suche bleiben unberührt. Standardmäßig an.",
      control: { type: "toggle", key: "hideIndexFolder" } },
  ] };
}

private robustnessGroup(): SettingDefinitionGroup {
  return { type: "group", heading: "Index-Robustheit", items: [
    { name: "Index-Zustand", desc: "", render: this.renderIndexHealth },
    { name: "Aus Backup wiederherstellen",
      desc: "Geräte-lokale Sicherungen des Index (letzte 3). Ersetzt den aktuellen Index.",
      action: () => { void (async () => {
        new RestoreBackupModal(this.app, await this.plugin.listBackups(), (n) => void this.plugin.restoreBackup(n)).open();
      })(); } },
    { name: "Vault neu indizieren",
      desc: "Baut den kompletten Index von Grund auf neu — der letzte Ausweg.",
      action: () => { new ReindexConfirmModal(this.app, () => { void this.plugin.reindexVault(); }).open(); } },
  ] };
}
```

`getSettingDefinitions()` um `this.indexGroup(), this.robustnessGroup()` ergänzen.

> Hinweis Umzug: der bisherige `buildRobustnessSection` zieht `indexDelta()` einmal oben; im render-Hatch `renderIndexHealth` bleibt das so (frisch bei jedem Render/`update()`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts` → PASS. `npm test` → grün.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): Index- und Index-Robustheit-Gruppen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: MCP-Server-Gruppe (ein großer render-Hatch + Enable-Toggle)

Die MCP-Sektion ist zustandsreich (bedingte Zeilen, Token-Toggle, Port-Debounce-Restart, Snippet-`<pre>`) → ein render-Hatch, der den kompletten bisherigen `buildMcpSection`-Body zeichnet. Der Enable-Toggle steuert `restartMcpServer` + `update()`.

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: bestehende `buildMcpSection`-Logik, `mcpClient`-Feld, `showMcpToken`-Feld, `mcpPortRestartTimer`-Feld.
- Produces: `mcpGroup()`; render-Hatch `renderMcpSection`.

- [ ] **Step 1: Write the failing test**

```ts
it("MCP-Gruppe: genau ein render-Hatch", () => {
  const { tab } = makeTab();
  const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "MCP-Server");
  expect(g).toBeTruthy();
  const items = g.items as any[];
  expect(items.length).toBe(1);
  expect(typeof items[0].render).toBe("function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts -t "MCP"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`renderMcpSection` = kompletter bisheriger `buildMcpSection(containerEl)`-Body, aber `containerEl = this.hostFor(setting)`, und **alle `this.display()` → `this.update()`** (Enable-Toggle, Port-Restart-Timer-Callback, Token anzeigen/verbergen, Token-Rotation, Client-Dropdown). Der `<pre>`-Snippet und die bedingten Zeilen (`if (!this.plugin.settings.mcpEnabled) return;`) bleiben unverändert.

```ts
private renderMcpSection = (setting: Setting): void => {
  const host = this.hostFor(setting);
  // … bisheriger buildMcpSection-Body, containerEl := host, this.display() := this.update() …
};

private mcpGroup(): SettingDefinitionGroup {
  return { type: "group", heading: "MCP-Server", items: [
    { name: "MCP-Server", desc: "", render: this.renderMcpSection },
  ] };
}
```

`getSettingDefinitions()` um `this.mcpGroup()` ergänzen.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts` → PASS. `npm test` → grün. `npx tsc --noEmit` → sauber.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): MCP-Server-Gruppe als render-Hatch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Chat-Gruppe (viele deklarative + render-Hatches inkl. Budget)

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `buildChatModel`-, `buildModelDetails`-, `buildCaps`-, `buildBudget`-, `buildThinking`-Logik; `showInfo`, `showCaps`, `renderCaps`, `updateBudgetMax`, `lastCaps`, `infoValue`, `capSetting`.
- Produces: `chatGroup()`; render-Hatches `renderChatEndpoints`, `renderChatModel`, `renderModelDetails`, `renderCapsRow`, `renderBudget`, `renderThinking`.

- [ ] **Step 1: Write the failing test**

```ts
it("Chat-Gruppe: deklarative Keys + render-Hatches + Testen-Action", () => {
  const { tab } = makeTab();
  const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Chat");
  expect(g).toBeTruthy();
  const items = g.items as any[];
  const keys = items.filter(i => i.control).map(i => i.control.key);
  expect(keys).toEqual(["chatK", "chatTemperature", "chatSystemPrompt", "chatInputPosition", "suppressThinking", "enterSends"]);
  // Endpunkte, Modell, Modelldetails, Fähigkeiten, Budget = 5 render-Hatches
  expect(items.filter(i => typeof i.render === "function").length).toBe(5);
  // „Testen" als eigene Action-Zeile
  expect(items.filter(i => typeof i.action === "function").length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts -t "Chat-Gruppe"`
Expected: FAIL.

- [ ] **Step 3: Implement**

render-Hatches (Umzug analog Task 4): `renderChatEndpoints` (buildChatEndpointList-Body, `this.display()`→`this.update()`), `renderChatModel` (buildChatModel-Body + `showInfo`/`showCaps`), `renderModelDetails` (buildModelDetails: `this.infoValue = host-span`), `renderCapsRow` (buildCaps: `this.capSetting`), `renderBudget` (buildBudget-Body inkl. `updateBudgetMax`-Kopplung — bleibt render-Hatch wegen modell-gekoppeltem max).

Thinking: **Toggle deklarativ** (`suppressThinking`), **„Testen" als eigene Action-Zeile** (bisheriger Button-Body aus `buildThinking`, inkl. `isAlwaysOnThinker`-Guard und Caps-Upgrade — die Caps-Anzeige über `this.capSetting`/`renderCaps`):

```ts
private chatGroup(): SettingDefinitionGroup {
  return { type: "group", heading: "Chat", items: [
    { name: "Chat-Endpunkte", desc: "", render: this.renderChatEndpoints },
    { name: "Chat-Modell", desc: "Modellname wie auf dem Chat-Endpoint verfügbar", render: this.renderChatModel },
    { name: "Modelldetails", desc: "", render: this.renderModelDetails },
    { name: "Fähigkeiten", desc: "", render: this.renderCapsRow },
    { name: "Kontext-Notizen", desc: "Wie viele Notizen als Kontext in den Chat gehen (Auto-RAG)",
      control: { type: "slider", key: "chatK", min: 1, max: 20, step: 1, displayFormat: (v: number) => String(v) } },
    { name: "Kontext-Budget", desc: "", render: this.renderBudget },
    { name: "Temperatur", desc: "Kreativität vs. Bestimmtheit (0 = deterministisch, höher = kreativer)",
      control: { type: "slider", key: "chatTemperature", min: 0, max: 2, step: 0.1, displayFormat: (v: number) => String(v) } },
    { name: "System-Prompt", desc: "Grundanweisung an das Modell. Der Notiz-Kontext wird automatisch angehängt.",
      control: { type: "textarea", key: "chatSystemPrompt" } },
    { name: "Eingabe-Position", desc: "Wo die Chat-Eingabe sitzt (greift beim nächsten Öffnen des Panels)",
      control: { type: "dropdown", key: "chatInputPosition", options: { bottom: "Unten", top: "Oben" } } },
    { name: "Thinking unterdrücken",
      desc: "Standard für neue Chats. Sendet Suppress-Hints (reasoning_effort/enable_thinking). Pro Chat im Panel umschaltbar.",
      control: { type: "toggle", key: "suppressThinking" } },
    { name: "Thinking testen", desc: "Prüft, ob das Modell bei „unterdrücken" wirklich abschaltet.",
      action: () => { void this.runThinkingTest(); } },
    { name: "Enter sendet", desc: "An: Enter sendet, Shift+Enter macht eine neue Zeile. Aus: umgekehrt.",
      control: { type: "toggle", key: "enterSends" } },
  ] };
}
```

`runThinkingTest()` = der bisherige „Testen"-onClick-Body aus `buildThinking` (ohne Button-Disable-Handling; stattdessen `new Notice(...)` für Rückmeldung). Caps-Upgrade schreibt `this.lastCaps` + `if (this.capSetting) this.renderCaps(this.capSetting, this.lastCaps)`.

`getSettingDefinitions()` um `this.chatGroup()` ergänzen.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts` → PASS. `npm test` → grün. `npx tsc --noEmit` → sauber.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): Chat-Gruppe (deklarativ + render-Hatches, Testen als Action)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Smart-Apply-Gruppe (deklarativ + folder-control + Modell-render-Hatch)

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `buildSmartApplyModel`-Logik.
- Produces: `smartApplyGroup()`; render-Hatch `renderSmartApplyModel`.

- [ ] **Step 1: Write the failing test**

```ts
it("Smart-Apply-Gruppe: deklarative Keys inkl. folder + 1 render-Hatch + empty-Hinweis", () => {
  const { tab } = makeTab();
  const g = (tab.getSettingDefinitions() as any[]).find(d => d.heading === "Smart Apply");
  expect(g).toBeTruthy();
  const items = g.items as any[];
  const keys = items.filter(i => i.control).map(i => i.control.key);
  expect(keys).toEqual([
    "smartApplyEnabled", "templateDir", "smartApplyTemperature",
    "smartApplySuppressThinking", "smartApplyMaxTokens", "smartApplyDefaultMode",
  ]);
  expect(items.find(i => i.control?.key === "templateDir").control.type).toBe("folder");
  expect(items.filter(i => typeof i.render === "function").length).toBe(1); // Modell
  expect(items.filter(i => !i.control && !i.render && !i.action).length).toBe(1); // Verbindungs-Hinweis (empty)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts -t "Smart-Apply-Gruppe"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`renderSmartApplyModel` = bisheriger `buildSmartApplyModel`-Body in `hostFor`, `this.rerender()` → `this.update()`.

```ts
private smartApplyGroup(): SettingDefinitionGroup {
  return { type: "group", heading: "Smart Apply", items: [
    { name: "Smart Apply aktivieren",
      desc: "Schaltet Befehl, Ribbon-Icon und Panel frei: eine unstrukturierte Notiz hinter einem Diff-Gate in die Struktur einer Vorlage überführen. Greift beim nächsten Neuladen des Plugins.",
      control: { type: "toggle", key: "smartApplyEnabled" } },
    { name: "Verbindung",
      desc: 'Smart Apply nutzt die Chat-Verbindung (Endpoint, Modell) aus dem Abschnitt „Chat" — kein eigener Endpoint nötig.' },
    { name: "Vorlagen-Ordner",
      desc: "Ordner mit den Vorlagen — Markdown-Dateien darin und in Unterordnern werden berücksichtigt. Ausgenommen sind Folder Notes (Datei trägt den Namen ihres Ordners).",
      control: { type: "folder", key: "templateDir", placeholder: "Templates/" } },
    { name: "Smart-Apply-Temperatur",
      desc: "Temperatur für den Umsortier-Call (0 = deterministisch — empfohlen für reproduzierbare Vorschläge).",
      control: { type: "slider", key: "smartApplyTemperature", min: 0, max: 2, step: 0.1, displayFormat: (v: number) => String(v) } },
    { name: "Smart-Apply-Modell", desc: 'Modell für den Umsortier-Call. Leer = Chat-Modell verwenden.',
      render: this.renderSmartApplyModel },
    { name: "Thinking unterdrücken (Smart Apply)",
      desc: "Sendet Suppress-Hints für den Smart-Apply-Call — sinnvoll bei Thinking-Modellen, die auch strukturiert schreiben können.",
      control: { type: "toggle", key: "smartApplySuppressThinking" } },
    { name: "Smart-Apply-Max-Tokens",
      desc: "Maximale Anzahl generierter Tokens für den Umsortier-Call (512–16384). Höher = sicher für große Notizen.",
      control: { type: "slider", key: "smartApplyMaxTokens", min: 512, max: 16384, step: 512, displayFormat: (v: number) => String(v) } },
    { name: "Smart-Apply-Standardmodus",
      desc: "Für Vorlagen ohne eigene Modus-Angabe. Additiv lässt das LLM Werte erschließen und ergänzen (mit Konfidenz).",
      control: { type: "dropdown", key: "smartApplyDefaultMode",
        options: { deterministisch: "Deterministisch (nur zuordnen)", additiv: "Additiv (erschließen + ergänzen)" } } },
  ] };
}
```

`getSettingDefinitions()` finalisieren:

```ts
getSettingDefinitions(): SettingDefinitionItem[] {
  return [ this.searchGroup(), this.embeddingGroup(), this.indexGroup(),
    this.robustnessGroup(), this.mcpGroup(), this.chatGroup(), this.smartApplyGroup() ];
}
```

> **Coercion-Hinweis:** `templateDir` ist ein `folder`-Control (Wert = Ordnerpfad ohne garantierten Trailing-Slash). Die Normalisierung passiert bereits in `setControlValue` (Task 2) → kein zusätzlicher Code hier.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts` → PASS. `npm test` → grün. `npx tsc --noEmit` → sauber.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): Smart-Apply-Gruppe (deklarativ + folder-control + Modell-Hatch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Scharfschalten — toten imperativen Code entfernen + Cleanup + Abnahme

Jetzt liefert `getSettingDefinitions()` alle sieben Gruppen; `display()` ist zur Laufzeit bereits tot. Dieser Task entfernt den imperativen Altpfad und härtet den Poll-Cleanup.

**Files:**
- Modify: `src/settings.ts`, `src/eslint.config.mjs`-Kommentar (nur falls Bezug auf display), `AGENTS.md` (Modul-Layout-Zeile settings.ts)
- Test: gesamte Suite

**Interfaces:**
- Consumes: alles aus Tasks 2–8.

- [ ] **Step 1: Toten Code entfernen**

Aus `src/settings.ts` entfernen: `display()`, `rerender()`, `resetRenderState()`, `resolvedOnOpen`-Feld + seine Nutzung im alten `display()`, der collapsibleSection-Aufbau, die alten `build*`-Wrapper, die **nur** von `display()` genutzt wurden (`buildK`, `buildMinSim`, `buildExclude`, `buildDebounce`, `buildStatusBar`, `buildHideIndexFolder`, `buildInputPos`, `buildEnter`, `buildSmartApplyEnabled`, `buildSmartApplyConnectionNote`, `buildTemplateDir`, `buildSmartApplyTemperature`, `buildSmartApplySuppress`, `buildSmartApplyMaxTokens`, `buildSmartApplyDefaultMode`, `buildChatK`, `buildTemp`, `buildSystemPrompt`, `buildRobustnessSection`, `buildEmbeddingModel`, `buildEmbeddingStatus`, `buildEmbeddingEndpointList`, `buildChatEndpointList`, `buildModelDetails`, `buildCaps`, `buildChatModel`, `buildBudget`, `buildThinking`, `buildIndexDir`, `buildMcpSection`, `buildSmartApplyModel`).
Behalten: `buildEndpointList` (von render-Hatches genutzt), `renderCaps`, `showInfo`, `showCaps`, alle `render*`-Hatches, `runThinkingTest`, `hostFor`.
Import `collapsibleSection`/`CollapsibleStorage` entfernen (nur hier genutzt).

> Der `resolveAndReconnect*`-Verbindungs-Moment „beim Tab-Öffnen" wanderte implizit: er läuft weiterhin, sobald die Endpoint-render-Hatches zeichnen (die `probe`-Aufrufe). Der explizite Fire-and-forget aus dem alten `display()` entfällt bewusst — die Reachability-Icons lösen ihn ohnehin aus. Falls die manuelle Abnahme zeigt, dass der aktive Endpunkt beim Öffnen nicht aufgelöst wird, in `renderEmbeddingEndpoints`/`renderChatEndpoints` einmalig `void this.plugin.resolveAndReconnect*()` voranstellen.

- [ ] **Step 2: Poll-Cleanup in `hide()` härten**

`hide()` so anpassen, dass alle in `pollIntervals` gesammelten Intervalle gestoppt werden (defensiv, da render-Cleanup laut API beim Fenster-Zerstören nicht garantiert läuft):

```ts
hide(): void {
  for (const id of this.pollIntervals) window.clearInterval(id);
  this.pollIntervals = [];
  if (this.mcpPortRestartTimer !== null) { window.clearTimeout(this.mcpPortRestartTimer); this.mcpPortRestartTimer = null; }
  super.hide();
}
```

(Das alte `clearInterval`/`refreshInterval`-Feld entfällt — der Status-Poll läuft jetzt über `pollIntervals` + render-Cleanup.)

- [ ] **Step 3: Volle Verifikation**

```bash
npm test        # alle Tests grün (≥ 688 + neue Struktur-Tests)
npx tsc --noEmit
npm run lint    # eslint sauber (max-warnings 0)
npm run build   # main.js baut
```
Expected: alles grün. Falls `npm run lint` eine `require-display`/`prefer-setting-definitions`-Regel neu triggert (jetzt migriert) — das ist erwünscht grün; einen veralteten Datei-Override oder Kommentar dazu entfernen.

- [ ] **Step 4: AGENTS.md-Modul-Layout aktualisieren**

Die `settings.ts`-Zeile im Modul-Layout (`AGENTS.md`) auf die neue Realität bringen: „VaultRagSettingTab · `getSettingDefinitions()` (deklarativ, durchsuchbar) · `get/setControlValue` · render-Hatches für dynamische Zeilen · kein `display()` mehr". Die Zeile zu `collapsible.ts` unter „Vendored Kit Module" mit einem Hinweis versehen, dass sie von settings.ts nicht mehr genutzt wird (Datei bleibt für Kit-Konsistenz).

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts AGENTS.md eslint.config.mjs
git commit -m "refactor(settings): display()/collapsibleSection entfernt — rein deklarativ

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Manuelle GUI-Abnahme (Jay, in echtem Obsidian)**

Pflicht (analog Ladeweg-Regel aus dem 0.16.1-Gotcha — Render-Weg strukturell test-untauglich):
1. Plugin neu laden, Settings-Tab öffnen → alle 7 Sektionen sichtbar, in Reihenfolge.
2. **Obsidian-Settings-Suche**: nach „Temperatur", „Debounce", „Enter" suchen → Zeilen erscheinen.
3. Slider (k, minSim, Debounce, chatK, Temperaturen, Max-Tokens) zeigen Live-Wert inline.
4. Toggles mit Seiteneffekt: Statusleiste an/aus wirkt; Index-ausblenden wirkt.
5. Endpoint-Listen: Endpunkt hinzufügen (blur), löschen, Preset, „Verbindung prüfen" → Status-Icons + Aktiv-Markierung.
6. Embedding-Status: Live-Zähler tickt (2 s); Tab schließen/öffnen → **kein Interval-Leak** (Konsole/CPU ruhig).
7. Modell-Dropdowns befüllen sich (Server an); „Modelle laden" bei Server aus.
8. Kontext-Budget: max koppelt ans Modell-Fenster nach Modellwahl.
9. Vorlagen-Ordner: nativer Ordner-Suggester; Wert bekommt Trailing-Slash.
10. MCP: aktivieren → Token/Port/Snippet erscheinen; Token anzeigen/verbergen; Port ändern → Debounce-Restart; „Verbindung testen"; Kopieren.
11. „Thinking testen" (Chat) → Notice; „Neu indizieren"/„Backups…" → Modals.

Bei Fund: als Task-Nachschlag beheben, erneut abnehmen.

---

## Self-Review

**1. Spec coverage:**
- getSettingDefinitions ersetzt display() → Tasks 2–9 ✓
- kein Fallback (minAppVersion 1.13.0) → Task 9 entfernt display() ✓
- get/setControlValue switch-Map + Coercion + Seiteneffekte → Task 2 ✓
- Coercion-Helfer pure in settings_core.ts → Task 1 ✓
- 7 native Groups, kein Collapse, Vendor-Kit-Import raus → Tasks 3–9 ✓
- Zeilen-Klassifikation (18 deklarativ / 12 render-Hatch) → Tasks 3–8 decken alle Zeilen ✓
- hostFor-Trick → Task 3 ✓
- Endpoint-Liste handgebaut im render-Hatch, this.display()→update() → Task 4 ✓
- Status-Poll cleanup + hide()-Härtung → Tasks 4 + 9 ✓
- Budget-Slider render-Hatch (modell-max) → Task 7 ✓
- folder-control für templateDir → Task 8 ✓
- Slider displayFormat → Tasks 3–8 ✓
- pure Struktur-Tests (key∈DEFAULT_SETTINGS + round-trip + Seiteneffekte) → Tasks 2–8 ✓
- GUI-Abnahme Pflicht → Task 9 Step 6 ✓

**2. Placeholder scan:** Umzugs-Anweisungen verweisen auf konkret benannte bestehende `build*`-Methoden mit gezeigtem Wrapper-Muster (kein „TBD"); deklarative Controls sind vollständig ausgeschrieben. Keine offenen TODOs.

**3. Type consistency:** `getSettingDefinitions(): SettingDefinitionItem[]`, Gruppen-Builder liefern `SettingDefinitionGroup`, render-Hatches sind `(setting: Setting) => void | (() => void)`, `pollIntervals: number[]`, `runThinkingTest`, `hostFor(setting): HTMLElement` — durchgängig konsistent über Tasks 2–9. `templateDir`-Coercion nur an einer Stelle (setControlValue, Task 2), Task 8 verlässt sich darauf.
