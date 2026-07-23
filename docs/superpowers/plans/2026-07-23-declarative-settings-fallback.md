# 1.12.7-Fallback (zweigleisig) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den migrierten Settings-Tab zweigleisig machen — `getSettingDefinitions()` (nativ ab Obsidian 1.13) **plus** ein schlanker `display()`-Fallback für ≤1.12, der dieselbe Struktur imperativ rendert. `minAppVersion` zurück auf 1.12.7. Warning-frei (keine deprecated-API, keine eslint-disable).

**Architecture:** `getSettingDefinitions()` bleibt die einzige Wahrheit. `display()` kommt zurück als `display() { this.renderImperative(); }`; `renderImperative()` durchläuft `getSettingDefinitions()` und rendert jede Definition mit der klassischen `Setting`-API (Vorbild: `markdown-presentation/src/settings.ts`). Die 1.13-only-APIs werden per Runtime-Feature-Check abgesichert (`setDestructive` → sonst `mod-warning`-DOM-Klasse; `displayFormat` → im Fallback im Namen genutzt).

**Tech Stack:** TypeScript (strict), Obsidian Plugin API 1.13.1 typings / Ziel-Laufzeit ab 1.12.7, vitest + happy-dom, hand-gerollter Obsidian-Mock.

**Spec:** `docs/superpowers/specs/2026-07-23-declarative-settings-migration-design.md` — Abschnitt **NACHTRAG (2026-07-23): Prämissen-Korrektur**.

**Kontext:** Baut additiv auf dem Branch `worktree-declarative-settings` (HEAD nach Tasks 1–9 = `6a10f3a`). Die reine deklarative Migration ist fertig; dieser Sub-Slice ergänzt den Fallback.

## Global Constraints

- **Warning-frei ist Gate:** `npm run lint` (`eslint src`) muss **0 Warnings, 0 Errors** bleiben — nach jeder Task verifizieren. Kein `setWarning` (deprecated), kein `requireApiVersion`, kein `// eslint-disable`, kein neuer file-scoped Override.
- **Ziel-`minAppVersion` = 1.12.7** — keine API nutzen, die zur Laufzeit auf 1.12.7 fehlt, ohne Feature-Check. Typings sind 1.13.1 (statische Checks laufen dagegen).
- **`getSettingDefinitions()` bleibt unverändert die eine Wahrheit.** `display()`/`renderImperative()` lesen NUR daraus, definieren keine zweite Struktur.
- TS strict + `noImplicitAny` — die einzige sanktionierte Ausnahme ist der bestehende `as unknown as Record<string, unknown>`-Cast in get/setControlValue. Test files may use `as any`.
- Tests: vitest + happy-dom, obsidian-mock, no `.only`/`.skip`, full suite green (currently 706) after each task.
- Commits: Conventional Commits, deutsche Beschreibung erlaubt, **stage only touched files (never `git add -A`)**, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- **`src/settings.ts`** (modify) — bekommt `display()`, `renderImperative()`, `renderDefinitionItem()`, `renderControl()`, und einen `applyDestructive()`-Helfer; die 2 `setDestructive()`-Direktaufrufe werden auf `applyDestructive()` umgestellt.
- **`tests/__mocks__/obsidian.ts`** (modify) — `Setting` bekommt `addSlider/addToggle/addText/addTextArea/addDropdown/addButton`-Stubs; `ButtonComponent`-Stub mit `setButtonText/onClick/setClass/setDestructive?/buttonEl`.
- **`tests/settings.test.ts`** (modify) — `renderImperative`-Smoke-Test über alle 7 Gruppen.
- **`manifest.json`** (modify) — `minAppVersion` 1.13.0 → 1.12.7.
- **`versions.json`** (modify) — Eintrag für die nächste Version → 1.12.7.

---

### Task F1: `applyDestructive()`-Helfer + 2 Stellen umstellen

Die zwei `setDestructive()`-Direktaufrufe crashen auf 1.12.7 (Methode existiert dort nicht). Ein Feature-Check-Helfer macht sie versionssicher und warning-frei.

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: module-level `applyDestructive(b: ButtonComponent): ButtonComponent`

- [ ] **Step 1: Write the failing test**

Der Helfer ist pure genug für einen direkten Test mit einem Fake-Button. In `tests/settings.test.ts` neuen Block anhängen:

```ts
import { applyDestructive } from "../src/settings";

describe("applyDestructive", () => {
  it("nutzt setDestructive, wenn vorhanden (1.13+)", () => {
    let called = false;
    const b = { setDestructive() { called = true; return this; }, buttonEl: { addClass() { throw new Error("nicht erwartet"); } } };
    applyDestructive(b as any);
    expect(called).toBe(true);
  });
  it("fällt auf mod-warning-Klasse zurück, wenn setDestructive fehlt (1.12.7)", () => {
    const classes: string[] = [];
    const b = { buttonEl: { addClass(c: string) { classes.push(c); } } };  // kein setDestructive
    applyDestructive(b as any);
    expect(classes).toContain("mod-warning");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts -t "applyDestructive"`
Expected: FAIL — `applyDestructive` nicht exportiert.

- [ ] **Step 3: Implement**

In `src/settings.ts` (nahe `applyEndpointEdit`, module-level export):

```ts
/** Roter/destruktiver Button, versionssicher: setDestructive() ab Obsidian 1.13, sonst die
 *  mod-warning-DOM-Klasse (kein deprecated setWarning, kein Lint-Warning, roter Look überall). */
export function applyDestructive(b: ButtonComponent): ButtonComponent {
  if (typeof (b as { setDestructive?: () => unknown }).setDestructive === "function") b.setDestructive();
  else b.buttonEl.addClass("mod-warning");
  return b;
}
```

Dann die zwei Aufrufer umstellen:
- `RestoreBackupModal` (`row.addButton(b => b.setButtonText("Wiederherstellen").setDestructive()…`) → `applyDestructive(b.setButtonText("Wiederherstellen"))…`
- MCP-„Neu generieren" in `renderMcpSection` (`.addButton(b => b.setButtonText("Neu generieren").setDestructive()…`) → `applyDestructive(b.setButtonText("Neu generieren"))…`

(Beide behalten ihren `.onClick(...)` — Kette bleibt: `applyDestructive(b.setButtonText(…)).onClick(…)`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts` → PASS. Dann `npm test` (706 green), `npx tsc --noEmit` (clean), `npm run lint` (**0 warnings**).

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): destruktive Buttons versionssicher (setDestructive|mod-warning)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F2: `display()`-Fallback — `renderImperative`-Walker + Mock + Smoke-Test

Der Kern des Sub-Slices. `display()` kommt zurück und rendert `getSettingDefinitions()` imperativ für ≤1.12.

**Files:**
- Modify: `src/settings.ts`, `tests/__mocks__/obsidian.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `getSettingDefinitions()`, `getControlValue`/`setControlValue`, `hostFor`, alle `render*`-Hatches (aus Tasks 1–9); `FolderSuggest` (bestehend).
- Produces: `display()`, `renderImperative()`, `renderDefinitionItem(containerEl, item)`, `renderControl(s, name, control)`.

**Vorlage:** `markdown-presentation/src/settings.ts` — Methode `renderImperative()` (~Zeile 167) + `hostFor()`. Lies sie zuerst; das Walker-Muster wird übernommen und an unsere Definition-Typen angepasst.

- [ ] **Step 1: Mock erweitern**

In `tests/__mocks__/obsidian.ts` die `Setting`-Klasse um Control-Adder erweitern (jeweils Callback mit einem Fake-Component aufrufen, `return this`), und einen `ButtonComponent`-Stub sicherstellen. Beispiel-Struktur (an den vorhandenen Mock-Stil anpassen):

```ts
class FakeSlider { setLimits() { return this; } setValue() { return this; } setDynamicTooltip() { return this; } onChange() { return this; } }
class FakeToggle { setValue() { return this; } onChange() { return this; } }
class FakeText { setPlaceholder() { return this; } setValue() { return this; } onChange() { return this; } inputEl = makeFakeEl(); }
class FakeDropdown { addOption() { return this; } setValue() { return this; } onChange() { return this; } }
class FakeButton { setButtonText() { return this; } setClass() { return this; } setCta() { return this; } onClick() { return this; } buttonEl = makeFakeEl(); }
// In class Setting ergänzen:
//   addSlider(cb){ cb(new FakeSlider()); return this; }
//   addToggle(cb){ cb(new FakeToggle()); return this; }
//   addText(cb){ cb(new FakeText()); return this; }
//   addTextArea(cb){ cb(new FakeText()); return this; }
//   addDropdown(cb){ cb(new FakeDropdown()); return this; }
//   addButton(cb){ cb(new FakeButton()); return this; }
//   addExtraButton(cb){ cb(new FakeButton()); return this; }
```

(Falls der Mock manche davon schon hat — die render-Hatches liefen in Tasks 4–8 nie im Test —, nur die fehlenden ergänzen. `settingEl`/`controlEl` müssen `empty()`/`createSpan()`/`createDiv()`/`addClass()`/`removeClass()` können, wie `hostFor` sie braucht.)

- [ ] **Step 2: Write the failing test**

```ts
describe("renderImperative (display-Fallback für <1.13)", () => {
  it("rendert alle 7 Gruppen ohne Crash", () => {
    const { tab } = makeTab();
    tab.containerEl = makeFakeEl() as any;   // falls nicht schon gesetzt
    expect(() => tab.display()).not.toThrow();
  });
  it("display() liest aus getSettingDefinitions (kein separater Baum)", () => {
    const { tab } = makeTab();
    const spy = vi.spyOn(tab, "getSettingDefinitions");
    tab.display();
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts -t "renderImperative"`
Expected: FAIL — `display()` existiert nicht mehr (in Task 9 entfernt) bzw. wirft.

- [ ] **Step 4: Implement the walker**

In `src/settings.ts` (Type-Imports ergänzen: `SettingDefinition`, `SettingControl` type-only from obsidian):

```ts
display(): void { this.renderImperative(); }

/** Fallback-Renderpfad für Obsidian < 1.13 (dort ruft der Host display() statt getSettingDefinitions()).
 *  Liest dieselbe Definitions-Struktur und zeichnet sie imperativ — eine Wahrheit. */
private renderImperative(): void {
  this.containerEl.empty();
  for (const item of this.getSettingDefinitions()) this.renderDefinitionItem(this.containerEl, item);
}

private renderDefinitionItem(containerEl: HTMLElement, item: SettingDefinitionItem): void {
  if ((item as SettingDefinitionGroup).type === "group") {
    const g = item as SettingDefinitionGroup;
    if (g.heading) new Setting(containerEl).setName(g.heading).setHeading();
    for (const sub of g.items ?? []) this.renderDefinitionItem(containerEl, sub as SettingDefinitionItem);
    return;
  }
  const def = item as SettingDefinition & { render?: unknown; action?: unknown; control?: SettingControl };
  const s = new Setting(containerEl);
  if (def.name) s.setName(def.name);
  if (def.desc) s.setDesc(def.desc as string);
  if (typeof def.render === "function") { (def.render as (s: Setting, g?: unknown) => void)(s); return; }
  if (typeof def.action === "function") {
    const action = def.action as (el: HTMLElement, index: number) => void;
    s.addButton(b => b.setButtonText(def.name).onClick(() => action(s.settingEl, 0)));
    return;
  }
  if (def.control) this.renderControl(s, def.name, def.control);
  // empty: nur name/desc (bereits gesetzt)
}

private renderControl(s: Setting, name: string, c: SettingControl): void {
  const key = c.key;
  const cur = this.getControlValue(key);
  const save = (v: unknown): void => { void this.setControlValue(key, v); };
  switch (c.type) {
    case "slider": {
      const fmt = c.displayFormat;
      const label = (v: number): void => { if (fmt) s.setName(`${name}: ${fmt(v)}`); };
      label(cur as number);
      s.addSlider(sl => sl.setLimits(c.min, c.max, c.step).setValue(cur as number).setDynamicTooltip()
        .onChange((v: number) => { save(v); label(v); }));
      break;
    }
    case "toggle":
      s.addToggle(t => t.setValue(cur as boolean).onChange(save));
      break;
    case "dropdown":
      s.addDropdown(d => { for (const [k, v] of Object.entries(c.options)) d.addOption(k, v); d.setValue(cur as string).onChange(save); });
      break;
    case "textarea":
      s.addTextArea(t => { t.setValue(cur as string).onChange(save); if (c.rows) t.inputEl.rows = c.rows; });
      break;
    case "folder":
      s.addText(t => { t.setPlaceholder(c.placeholder ?? "").setValue(cur as string).onChange(save);
        new FolderSuggest(this.app, t.inputEl).onSelect((p: string) => { t.setValue(p); save(p); }); });
      break;
    case "text":
    default:
      s.addText(t => t.setPlaceholder((c as { placeholder?: string }).placeholder ?? "").setValue(cur as string).onChange(save));
      break;
  }
}
```

> Notes: `setDynamicTooltip()` ist auf 1.12 nötig, damit der Slider-Wert überhaupt sichtbar ist; ab 1.13 ist es no-op/deprecated-neutral im Aufruf — falls `eslint no-deprecated` es flaggt, den Wert stattdessen NUR im Namen zeigen (via `displayFormat`) und `setDynamicTooltip()` weglassen. **Verifiziere `npm run lint` = 0 nach diesem Step; passe an, falls eine Regel triggert.** The declarative render-hatches already handle their own rows; here `def.render(s)` reuses them so the fallback path shows identical dynamic rows.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts` → PASS. Then `npm test` (all green), `npx tsc --noEmit` (clean), `npm run lint` (**0 warnings** — if `setDynamicTooltip` triggers `no-deprecated`, remove it per the note and re-verify).

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts tests/__mocks__/obsidian.ts tests/settings.test.ts
git commit -m "feat(settings): display()-Fallback via renderImperative (Obsidian <1.13)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F3: `minAppVersion` → 1.12.7 + versions.json

**Files:**
- Modify: `manifest.json`, `versions.json`

- [ ] **Step 1: Update manifest**

In `manifest.json`: `"minAppVersion": "1.13.0"` → `"minAppVersion": "1.12.7"`.

- [ ] **Step 2: Update versions.json**

`versions.json` bildet Plugin-Version → min-Obsidian-Version ab. Der jüngste Eintrag ist `"0.16.1": "1.13.0"`. Füge einen Eintrag für die **nächste** Plugin-Version hinzu, die diesen Slice ausliefert — die konkrete Versionsnummer wird beim Release gesetzt; bis dahin trägt der neue Eintrag `1.12.7`. Wenn die Release-Version noch offen ist, im Commit-Body vermerken, dass der versions.json-Eintrag beim Release-Bump auf die reale Version gesetzt wird. Ändere **`0.16.1`** NICHT (bereits released).

> Ambiguität (vom Controller aufzulösen, nicht raten): welche Plugin-Version dieser Slice trägt (z.B. 0.17.0). Wenn unklar, den Eintrag als Platzhalter mit klarer Commit-Notiz lassen und beim Release nachziehen.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` (clean — manifest ist JSON, kein TS-Effekt), `npm run build` (baut, liest manifest), `npm test` (green). `node -e "const v=require('./versions.json'); console.log(v)"` — Eintrag prüfen.

- [ ] **Step 4: Commit**

```bash
git add manifest.json versions.json
git commit -m "chore(settings): minAppVersion 1.13.0 → 1.12.7 (1.13 ist nur Catalyst-Preview)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (Nachtrag):**
- display()-Fallback + renderImperative → Task F2 ✓
- displayFormat als eine Wahrheit (Wert im Namen im Fallback) → Task F2 renderControl slider ✓
- minAppVersion → 1.12.7 + versions.json → Task F3 ✓
- setDestructive warning-frei (Feature-Check + mod-warning) → Task F1 ✓
- renderImperative-Smoke-Test + Mock-Erweiterung → Task F2 ✓
- Warning-Freiheit als Gate (lint 0 nach jeder Task) → Global Constraints + jede Task Step ✓

**2. Placeholder scan:** Der Walker-Code ist vollständig ausgeschrieben; der `setDynamicTooltip`-Lint-Vorbehalt ist mit konkreter Fallback-Anweisung versehen (kein offenes TODO). Die versions.json-Versionsnummer ist eine echte, benannte Ambiguität mit Auflösungsanweisung (Controller entscheidet), kein Platzhalter im Code.

**3. Type consistency:** `applyDestructive(b: ButtonComponent): ButtonComponent` (F1) · `display()`/`renderImperative()`/`renderDefinitionItem(containerEl, item)`/`renderControl(s, name, control)` (F2) — konsistent. `renderControl` liest über `getControlValue`/`setControlValue` (aus Task 2), nutzt `displayFormat` (aus Tasks 3–8) und `FolderSuggest` (bestehend). Keine Referenz auf entfernte `build*`-Methoden.
