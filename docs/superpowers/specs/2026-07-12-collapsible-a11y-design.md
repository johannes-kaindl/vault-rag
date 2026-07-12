# Spec: Tastatur-/Screenreader-Bedienbarkeit für `collapsibleSection`

**Datum:** 2026-07-12
**Status:** approved (brainstorming abgeschlossen)
**Repos:** obsidian-kit (Kern-Änderung + Release 0.13.0), vault-rag (Re-Vendor + CSS + Release)

## Problem

Das obsidian-kit-Modul `collapsibleSection` (0.12.0, `src/obsidian/collapsible.ts`) rendert
einen klickbaren Sektions-Header als `<div>` mit reinem `click`-Listener. Er hat **kein**
`role`, `tabindex`, `aria-expanded` und **keinen** Keyboard-Handler. Folgen:

- **Nicht tastaturbedienbar** (WCAG 2.1.1 Keyboard verletzt): per Tab nicht fokussierbar,
  kein Enter/Space-Toggle.
- **Für Screenreader stumm** (WCAG 4.1.2 Name/Role/Value): kein Rollen-/Zustands-Signal,
  dass es ein aufklappbarer Schalter ist.

Das Modul ist die erste obsidian-gekoppelte UI-Schicht des Kits und für **mehrere Plugins**
gedacht (aktuell vendored in vault-rag `#0.12.0`) — a11y gehört hier in den geteilten Baustein,
nicht in jeden Consumer.

## Ziel & Scope

**Ansatz „Keyboard-Basis" (bewusst gewählt, YAGNI):** volle WCAG-Konformität für ein
Disclosure-Widget dieser Einfachheit, minimal-invasiv.

**In Scope:**
- Header wird fokussierbar + als Schalter erkennbar (`role="button"`, `tabindex="0"`).
- `aria-expanded` spiegelt den Auf/Zu-Zustand, synchron beim Toggle.
- Keyboard-Toggle: **Enter** und **Leertaste** (Space mit `preventDefault` gegen Seiten-Scroll).
- Sichtbarer Fokus-Ring via `:focus-visible` im mitgelieferten CSS.

**Explizit NICHT (verworfene Alternativen):**
- **Volles Disclosure-Pattern** (`aria-controls` mit generierter Body-`id`, `role="region"`/
  `aria-labelledby`): Mehr Verdrahtung + id-Generierung für marginalen Mehrwert bei simplen
  Settings-Sektionen. YAGNI.
- **Echtes `<button>`-Element:** semantisch minimal sauberer, aber braucht User-Agent-Style-Reset
  und ändert Markup/CSS spürbar → höheres Regressionsrisiko für die vendornden Plugins. Der
  `div`+`role="button"`-Weg ist WCAG-konform und nativ-first im Obsidian-Sinn.

## Design

### Kit-Änderung: `src/obsidian/collapsible.ts`

`collapsibleSection` — additive Änderungen, Signatur/Rückgabewert **unverändert**:

1. **Header-Attribute** direkt nach dem Erstellen:
   - `header.setAttribute("role", "button")`
   - `header.setAttribute("tabindex", "0")`
2. **`aria-expanded` in `apply()`** mit-synchronisieren:
   `header.setAttribute("aria-expanded", String(!collapsed))` (offen → `"true"`).
3. **Toggle-Extraktion:** die bisher im `click`-Listener inline stehende Logik
   (`collapsed = !collapsed` → optional `storage.setCollapsed` → `apply()`) wandert in eine
   lokale `toggle()`-Funktion. `click` ruft `toggle()`.
4. **`keydown`-Listener** auf dem Header: bei `evt.key === "Enter"` oder `evt.key === " "`
   → `evt.preventDefault()` (verhindert bei Space den Scroll, bei Enter unschädlich) → `toggle()`.
   Alle anderen Tasten: keine Aktion (kein preventDefault).

### Kit-CSS: `COLLAPSIBLE_CSS`

Neue Regel ergänzen (Obsidian-Fokus-Variablen, keine Hardcodes):

```css
.okit-collapsible-header:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
  border-radius: var(--radius-s);
}
```

### Tests: `tests/collapsible.test.ts` (Kit, `makeFakeEl`-Stil)

Neue Fälle (Fake-DOM kann `get/setAttribute` + reicht Event-Objekte an Listener durch):
- Header trägt `role="button"` und `tabindex="0"`.
- `aria-expanded` = `"false"` im eingeklappten Start; nach Toggle `"true"`; spiegelt storage-Startzustand.
- `keydown` **Enter** toggelt auf **und** ruft `storage.setCollapsed` **und** ruft `preventDefault`.
- `keydown` **Space** (`" "`) toggelt **und** ruft `preventDefault`.
- `keydown` andere Taste (z. B. `"a"`) → **kein** Toggle, **kein** `preventDefault`.
- Bestehende Tests (click-Toggle, Startzustand, storage) bleiben unverändert grün.

## Roll-out (nach grünem Kit-TDD)

1. **Kit-Release 0.13.0:** von `main` branchen (Gotcha: HEAD verifizieren — steht aktuell korrekt
   auf `main`), CHANGELOG-Eintrag, version-bump, Tag + Dual-Push (Codeberg + GitHub).
2. **vault-rag Re-Vendor:** `src/vendor/kit/collapsible.ts` byte-identisch aus Kit `#0.13.0`
   übernehmen (nur Vendor-Header-Zeile anpassen), Vendor-Header-Version auf `#0.13.0`.
3. **vault-rag CSS:** `:focus-visible`-Regel in `styles.css` (bei den `.okit-collapsible-*`-Regeln,
   Z. 198–207) nachziehen.
4. **vault-rag-Release:** bündelt a11y + Slice 2 (RetrievalFacade) + Settings-UX. Version beim
   Release-Schritt festlegen (voraussichtlich Minor). `npm run release`.

## Verifikation

- **Headless:** `npm test` im Kit (neue + bestehende collapsible-Tests grün), `npm run typecheck`
  + `npm run lint` im Kit und in vault-rag grün.
- **Manuell (a11y ist real nur im UI prüfbar):** in Obsidian den vault-rag-Settings-Tab öffnen,
  per **Tab** auf einen Sektions-Header springen (Fokus-Ring sichtbar?), **Enter**/**Leertaste**
  → klappt auf/zu. Optional VoiceOver: Header wird als Button „reduziert/erweitert" angesagt.
  → als kurze Handover-Checkliste an Johannes.
