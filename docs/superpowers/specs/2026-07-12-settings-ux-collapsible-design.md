# Settings-UX-Slice — Einklappbare Sektionen (Kit-UI) + Index-Delta-Readout

**Datum:** 2026-07-12
**Status:** Design freigegeben, bereit für Implementierungsplan
**Typ:** UX-Feature (mit Kit-Dimension) + kleiner lokaler UX-Fix
**Repos:** `obsidian-kit` (neues UI-Modul) + `vault-rag` (erster Consumer)

## Kontext & Motivation

Der vault-rag-Settings-Tab ist lang geworden (Endpunkte, Chat, SmartApply, Index-Robustheit,
MCP …). Sektionen sind heute flache `setHeading()`-Überschriften (`sec()` in `settings.ts:197`);
alle Settings hängen direkt an `containerEl`. Zwei Verbesserungen:

1. **Einklappbare Sektionen** (wie Style Settings / Obsidians Community-Plugins-Header) — standardmäßig
   eingeklappt, per Klick ausklappbar. Da mehrere unserer Plugins wachsende Settings-Tabs haben
   (markdown-presentation, vault-crews, image-to-markdown), wird das ein **wiederverwendbares
   obsidian-kit-UI-Modul**.
2. **Index-Zustand-Readout mit Delta** — „980 / 1 000 Notizen" statt eines abstrakten Health-Texts,
   damit das Delta (fehlende Embeddings) sofort sichtbar ist; der „Vervollständigen"-Button wandert
   in dieselbe Zeile, seine (redundante) Beschreibung entfällt.

## Entscheidungen (aus dem Brainstorming)

- **Kit-Strategie:** Collapsible wird **sofort ins obsidian-kit als neue UI-Schicht** gebaut
  (`obsidian-kit/src/ui/`), nicht lokal gehalten. Das Kit bekommt damit erstmals obsidian-abhängigen
  Code; `pure/` + `testing/` bleiben obsidian-frei. vault-rag **vendored** das Modul
  (`src/vendor/kit/`), wie alle anderen Kit-Module.
- **Mechanismus:** custom Header + Body-Container (nicht native `<details>`) — Kontrolle über Styling
  (konsistent mit `setHeading`-Look), Chevron-Rotation, kein Marker-CSS-Kampf.
- **Persistenz:** über einen **optionalen** `storage`-Callback; ohne ihn verhält sich der Helper rein
  nach `defaultCollapsed`. Der Kit-Helper bleibt storage-agnostisch (koppelt nicht an data.json).
- **Default:** alle Sektionen eingeklappt.
- **CSS:** als exportierte Konstante (`COLLAPSIBLE_CSS`), die der Consumer in seine `styles.css`
  übernimmt — das Kit bleibt asset-/seiteneffektfrei (kein erzwungenes Style-Injection).
- **Index-Button:** disabled, wenn kein Delta (`embedded ≥ total`).

## Architektur

### Teil A.1 — obsidian-kit: neue UI-Schicht `src/ui/collapsible.ts`

**Pure (obsidian-frei, node-testbar) — bleibt trennbar:**
```ts
// Auflösung des initialen Zustands aus storage/default.
resolveCollapsed(key: string | undefined, defaultCollapsed: boolean,
                 storage?: CollapsibleStorage): boolean
```

**UI (obsidian):**
```ts
interface CollapsibleStorage { getCollapsed(key: string): boolean; setCollapsed(key: string, v: boolean): void }
interface CollapsibleOptions {
  title: string;
  defaultCollapsed?: boolean;   // default true
  key?: string;                 // Schlüssel für storage
  storage?: CollapsibleStorage;
}
/** Rendert eine einklappbare Sektion in containerEl; gibt den Body-Container zurück,
 *  in den der Consumer seine Settings baut. */
function collapsibleSection(containerEl: HTMLElement, opts: CollapsibleOptions): HTMLElement

/** CSS-Snippet (Theme-Variablen), das der Consumer in seine styles.css übernimmt. */
const COLLAPSIBLE_CSS: string
```
- Header-Zeile: klickbar, `setIcon` (chevron-right ↔ chevron-down), Titel im setHeading-Look.
- Klick → Body `display` toggeln + Chevron rotieren + `storage?.setCollapsed(key, …)`.
- Initialzustand via `resolveCollapsed`.
- **Kit-Aufbau:** neue `ui/`-Export-Fläche; obsidian als peer/dev-dep für die UI-Schicht; Tests via
  `testing/obsidian-mock` + happy-dom (Toggle → Body-display; storage-Aufruf).

### Teil A.2 — vault-rag: Integration

- `src/vendor/kit/collapsible.ts` — byte-identisch vendored (Vendor-Header), wie die übrigen Kit-Module.
- `settings.ts` `display()`: jede Sektion via `collapsibleSection(containerEl, {title, key, storage})`;
  die Settings der Sektion hängen am zurückgegebenen `bodyEl` statt an `containerEl`. `sec()` entfällt
  bzw. wird durch den Aufruf ersetzt.
- Neues Setting `uiCollapsed: Record<string, boolean>` (data.json, shallow-merge-migriert, Default `{}`);
  `storage` verdrahtet `getCollapsed`/`setCollapsed` dorthin + `saveSettings()`.
- Stabile keys pro Sektion (z. B. `endpoints`, `chat`, `smartapply`, `index`, `mcp`).
- `COLLAPSIBLE_CSS` in `styles.css` übernehmen.

### Teil B — vault-rag: Index-Delta-Readout + inline Button

- Neue pure Formatierung `indexDeltaReadout(embedded: number, total: number): string` → „980 / 1 000 Notizen"
  (de-DE-Tausendertrennung), ggf. plus Health-Suffix.
- „total" = indexierbare Notizen (Markdown minus `exclude`) — dieselbe Basis wie `diffIndexVsVault`;
  `embedded` = `embeddingProgress.embeddedNotes`. Das Plugin exponiert die zwei Zahlen für die Settings.
- `settings.ts`: die zwei Zeilen (Index-Zustand + Index vervollständigen) zu **einer** zusammenführen —
  `setName("Index-Zustand").setDesc(<delta-readout>).addButton("Vervollständigen" → healVault())`. Die
  separate „Index vervollständigen"-Zeile + ihre Beschreibung entfallen.
- Button **disabled**, wenn `embedded ≥ total`. Aktualisiert über den bestehenden 2s-Progress-Refresh.

## Testing

- **obsidian-kit:** `resolveCollapsed` (pure, alle storage/default-Fälle); `collapsibleSection`
  DOM-Verhalten (happy-dom: Klick toggelt Body-`display`, ruft `storage.setCollapsed`, respektiert
  initialen storage-Zustand).
- **vault-rag:** `indexDeltaReadout`-Formatierung (pure, inkl. total=0, embedded=total).

## Scope-Grenzen (YAGNI)

- **Nur vault-rag** als erster Consumer; andere Plugins migrieren separat (eigene Slices).
- Keine aufwändigen Animationen (nur Chevron-Rotation + display-Toggle).
- Kein „alle auf-/zuklappen"-Master-Toggle.
- Kein npm-Release-Zwang fürs Vendoring — byte-Kopie mit Vendor-Header + KIT_VERSION-Bump genügt
  (Release des Kits separat, falls/ wenn nötig).

## Betroffene Dateien (Erwartung)

- **obsidian-kit — neu:** `src/ui/collapsible.ts`, Tests (`tests/collapsible*.test.ts`); ggf. Export-Index
  für die UI-Schicht; `package.json` (obsidian als devDep, KIT_VERSION-Bump).
- **vault-rag — neu:** `src/vendor/kit/collapsible.ts`, `tests/index_delta.test.ts` (o. ä.).
- **vault-rag — geändert:** `src/settings.ts` (collapsibleSection-Integration + zusammengeführte
  Index-Zeile), `src/settings_core.ts`/DEFAULT_SETTINGS (`uiCollapsed`), `src/main.ts` (indexDelta-Zahlen
  exponieren, storage-Verdrahtung), `styles.css` (COLLAPSIBLE_CSS), AGENTS.md/REGISTRY.md (neues Kit-Modul).
