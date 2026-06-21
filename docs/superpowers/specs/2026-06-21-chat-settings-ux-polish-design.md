# Chat- & Settings-UX-Politur — Design

**Goal:** Das Plugin vor der Community-Einreichung UX-seitig abrunden, nach aktuellen Obsidian- und
LLM-Server-Best-Practices (2026, quellengestützt recherchiert): mehrzeilige Auto-Grow-Chat-Eingabe,
größeres System-Prompt-Feld, Embedding-Modell-**Dropdown** (kohärent zum Chat), vereinfachtes
Endpoint-Setup mit Inline-Verbindungstest, **Capability-Anzeige** (Vision/Thinking) in Settings **und**
Frontend, sowie ein **Thinking-Toggle** mit sauberer, nicht-hacky Suppression.

**Architecture:** Die neue Logik lebt in **zwei reinen, voll testbaren Modulen** (`reasoning.ts`,
`capabilities.ts`); View und Settings verdrahten nur. Die `VaultAdapter`-Grenze und das Index-Format
(Slice A) bleiben unangetastet. Settings bleibt die Single Source of Truth (`saveSettings` + Live-Getter
wie in der Chat-Modell-UX etabliert).

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`addDropdown`/`addTextArea`/`addButton`/`setIcon`),
vitest + happy-dom. Berührt: `chat_view.ts`, `settings.ts`, `chat_client.ts`, `embedder.ts`,
`chat_session.ts`, `styles.css` + zwei neue Module + Tests. Retrieval/Index unverändert.

---

## Recherche-Grundlage (2026, primärquellengestützt)

Drei parallele Recherchen (offizielle Docs + GitHub-Source der führenden Plugins/Server). Kernergebnisse,
die das Design tragen:

### Thinking-Suppression — der saubere Cross-Server-Weg
Kein einzelnes Standardfeld. Etabliert ist eine **Union dreier Parameter** in einem Request, die sich
ergänzen und von fremden Servern **ignoriert** (nicht abgelehnt) werden:

```jsonc
"reasoning_effort": "none",                            // Ollama, vLLM, OpenAI-Standard (emerging de-facto)
"chat_template_kwargs": { "enable_thinking": false },  // llama.cpp, MLX, LM Studio (passthrough), Qwen3
"reasoning_budget": 0                                  // llama.cpp belt-and-suspenders
```

- **Footgun (hart):** Ollama `/v1` lehnt `reasoning_effort` als **Boolean** ab (`cannot unmarshal bool`)
  und `"minimal"` ebenfalls (`invalid think value`). `"none"` ist ok. → **nie Boolean senden, nie
  `"minimal"`.**
- **`reasoning_format`/Parser-Settings NICHT anfassen** — `none` dort ändert nur, *wo* der Denktext landet,
  stoppt ihn nicht.
- **Ob der Suppress griff, erkennt man an der Antwort** (nicht am Request): nicht-leeres
  `reasoning_content`/`reasoning`/`thinking` **oder** `<think>…</think>` im Content ⇒ Suppress hat **nicht**
  gegriffen.
- **gpt-oss/Harmony-Modelle** lassen sich prinzipiell nicht vollständig abschalten (nur low/medium/high) →
  dem User ehrlich melden.

Quellen: llama.cpp server README + #20196/#20182, Ollama OpenAI-compat + thinking-docs + #12004/#14820,
vLLM reasoning_outputs, Qwen3-Quickstart, mlx-lm #914, open-webui reasoning-docs.

### Capability-Erkennung — geschichtet, ohne falsche Sicherheit
Kein server-übergreifender Standard. Strategie **L1 Metadaten → L2 Name-Heuristik → L3 Live-bestätigt**,
mit **Monotonie-Regel: Live-Signale stufen nur HOCH, nie runter** (Absence beweist nichts).

| Layer | Quelle | Wirkung |
|---|---|---|
| **L1 Metadaten** | Ollama `POST /api/show` → `capabilities[]` (`vision`/`thinking`/…); LM Studio `GET /api/v1/models` → `capabilities.{vision, reasoning}`; Fallback altes `GET /api/v0/models` → `type==="vlm"` | `confirmed`/`likely` |
| **L2 Name-Heuristik** | Substring-Listen (s.u.) | nur `likely`, nie allein entscheidend |
| **L3 Live-bestätigt** | Stream trug `reasoning_content`/`reasoning`/`thinking` oder `<think>` | **Upgrade → `confirmed`** |

- Thinking ist **drei-wertig**: `none` / `hybrid` (umschaltbar, z.B. qwen3) / `always` (z.B. deepseek-r1, qwq).
- OpenAI-kompatible `/v1/models` liefern **nirgends** Capabilities (nur ids) → für reine MLX/OpenAI-Server
  bleibt nur L2 + L3.
- ⚠️ **`normalizeEndpoint`-Interaktion:** native Pfade (`/api/show`, `/api/v1/models`, `/api/v0/models`)
  liegen **außerhalb** des OpenAI-`/v1`-Namespace → dürfen **kein** `/v1` angehängt bekommen. Basis-URL
  (ohne `/v1`) nutzen.

Vision wird **nur** aus Metadaten + Name abgeleitet (keine Bild-Probe: eine 200-Antwort ist kein Beweis,
Server droppen Bilder teils still).

### UI-Best-Practices (Obsidian, 2026)
- **Chat-Eingabe:** Auto-Grow-`<textarea>`, Start ~3 Zeilen (min-height ~60px), max ~180px dann interner
  Scroll, `resize:none`. **Enter=senden, Shift+Enter=Zeile**, konfigurierbar. **IME-Composition-Guard**
  (`event.isComposing`) — der häufigste vergessene Bug (bricht CJK-Eingabe).
- **Settings-Textarea:** `inputEl.rows = 8` + CSS-Klasse mit `resize:vertical`, volle Breite (keine
  Inline-Styles).
- **Verbindungstest:** Inline-`addButton` am Feld + Status-Punkt via `--text-success`/`--text-error`;
  Lade-Zustand (Button disabled + „Teste…").
- **Guidelines:** keine Inline-Styles (CSS-Klassen + Obsidian-Variablen), `setHeading()`, sentence case,
  kein „settings"/„plugin" in Namen, `aria-label`/`setTooltip` auf Icon-Buttons, `clickable-icon`,
  mobile-tauglich.
- **Polish:** Senden deaktiviert wenn leer/streamt, Escape stoppt Generierung, Autofocus der Eingabe.

Quellen: docs.obsidian.md (Plugin-Guidelines/Settings/Icons), obsidian-copilot
(`KeyboardPlugin.tsx`/`LexicalEditor.tsx`), Smart Composer (`OnEnterPlugin.tsx`), Smart Connections PR #361.

---

## Entscheidungen (Brainstorming 2026-06-21, ratifiziert)

- **Scope:** alles in **einer Slice** (Eingabe-Textareas, Embedding-Dropdown, Endpoint-Test+Inline-Status,
  Thinking-Toggle mit echter Suppression, Capability-Anzeige).
- **Thinking-„aus" = echte Suppress-Hints senden, Gedanken-Block NICHT ausblenden.** Denkt das Modell
  trotzdem, bleibt der Block sichtbar = ehrliches Signal. Suppression sauber per o.g. Param-Union.
- **Thinking-Toggle-Orte:** Settings = Default-Wert **+ „Suppress testen"-Button**; Frontend = schneller
  Toggle mit sichtbarem Zustand (an/aus + Umschalten).
- **Capability-Anzeige:** Settings **und** Frontend (an den Modell-Dropdowns + als Chips im Chat).
- **Enter-Verhalten:** **konfigurierbar**, Default `Enter=senden` (`enterSends: true`).
- **Capability-Quelle:** „am saubersten" = die geschichtete L1→L2→L3-Strategie oben.
- **YAGNI:** kein Lexical-Editor/@-Mentions (Kontext-Panel deckt Notizauswahl ab); keine Vision-Bild-Probe;
  keine Persona-Presets; kein Top-p/max_tokens.

---

## Neue/geänderte Settings (`VaultRagSettings`)

```ts
suppressThinking: boolean;   // Default false (Thinking an). Frontend-Toggle überschreibt pro Sitzung.
enterSends: boolean;         // Default true. false ⇒ Shift+Enter sendet, Enter macht Zeilenumbruch.
```

`suppressThinking` ist der **persistente Default**; der Frontend-Toggle hält einen Live-Wert pro
View-Sitzung (initialisiert aus dem Setting, schreibt aber nicht zwingend zurück — schnelles, situatives
Umschalten). Über einen Live-Getter (`suppress: () => boolean`) erreicht der Wert die offene `ChatSession`,
analog zur bestehenden Live-Getter-Schicht.

---

## Modul 1: `reasoning.ts` (pure)

```ts
export type ThinkingSupport = "none" | "hybrid" | "always";

/** Union-Params zum Abschalten von Reasoning. Leeres Objekt wenn nicht unterdrückt werden soll. */
export function suppressParams(suppress: boolean): Record<string, unknown>;
//  suppress=true  → { reasoning_effort: "none",
//                     chat_template_kwargs: { enable_thinking: false },
//                     reasoning_budget: 0 }
//  suppress=false → {}

/** Hat das Modell trotz (oder ohne) Suppress real gedacht? */
export function reasoningHappened(content: string, reasoning: string | undefined): boolean;
//  true wenn (reasoning?.trim()) ODER /<think>[\s\S]*?<\/think>/ mit Non-Whitespace in content.

/** Modelle, die sich prinzipiell nicht abschalten lassen (Harmony/gpt-oss). */
export function isAlwaysOnThinker(model: string): boolean;
```

- `suppressParams` liefert **nie** einen Boolean für `reasoning_effort` und **nie** `"minimal"`.
- Test-Schwerpunkte: exakte Param-Form; `reasoningHappened` für leeren/`<think>`-Content/separates
  Reasoning-Feld; `isAlwaysOnThinker` für gpt-oss.

## Modul 2: `capabilities.ts` (pure)

```ts
import { ThinkingSupport } from "./reasoning";
export interface Capabilities { vision: Confidence; thinking: ThinkingState }
export type Confidence = "no" | "likely" | "confirmed";
export interface ThinkingState { support: ThinkingSupport; confidence: Confidence }

export function parseOllamaShow(json: unknown): Capabilities | null;     // capabilities[] → vision/thinking
export function parseLmStudioV1(json: unknown, model: string): Capabilities | null;  // capabilities.{vision,reasoning}
export function parseLmStudioV0(json: unknown, model: string): Capabilities | null;  // type==="vlm" → vision; thinking unbekannt
export function guessFromName(model: string): Capabilities;             // L2-Heuristik (Substring-Listen)
export function mergeCapability(
  base: Capabilities | null,        // L1 (oder null)
  nameGuess: Capabilities,          // L2
  live: { thinking?: boolean; vision?: boolean }, // L3 (nur Upgrades)
): Capabilities;
```

**Name-Heuristik-Listen** (case-insensitiv, Token-Grenzen für kurze Marker) — gepflegt aus der Recherche:
- **Vision (high):** `llava`, `bakllava`, `*vision*`, `pixtral`, `moondream`, `minicpm-v`, `internvl`,
  `smolvlm`, `cogvlm`, `*-vl`, `glm-4v`/`glm-4.1v`/`glm-4.5v`, `molmo`, `nvlm`, `aya-vision`, `kimi-vl`,
  `ovis`, `*multimodal*`. **Versions-gated/Ausnahmen:** `gemma3` (≥4B; `:1b`/`:270m` text-only),
  `mistral-small` (nur 3.1/3.2), `glm-4`/`-4.5`/`-4.6` **ohne** `v` = text.
- **Thinking always-on:** `deepseek-r1`(+distill), `qwq`, `*-thinking`, `magistral`, `gpt-oss`,
  `phi-4*-reasoning`, `exaone-deep`, `glm-z1`, `minimax-m1`, `seed-oss-thinking`, `marco-o1`, `openthinker`.
- **Thinking hybrid (toggelbar):** `qwen3` (bare; `qwen3-instruct-2507` = non-thinking),
  `deepseek-v3.1`/`v3.2`, `granite3.2+`, `nemotron`, `cogito`, `glm-4.5`/`-4.6`, `kimi-k2`.

**`mergeCapability`-Regeln:** L1 schlägt L2; Live (`thinking:true`/`vision:true`) hebt auf `confirmed`;
Live-`false`/Absence ändert **nichts** (Monotonie). Drei-Zustand-Thinking bleibt erhalten.

---

## Client-Erweiterungen

### `EmbeddingClient` (`embedder.ts`)
- `listModels(): Promise<string[]>` — `GET ${endpoint}/v1/models` (wie `ChatClient`), `[]` bei Fehler.
  Ermöglicht das Embedding-Dropdown.

### `ChatClient` / `EmbeddingClient` — `fetchCapabilities`
```ts
async fetchCapabilities(model: string): Promise<Capabilities | null>;
```
- Probiert in Reihenfolge gegen die **Basis-URL** (ohne `/v1`): Ollama `POST /api/show {name}` →
  `parseOllamaShow`; LM Studio `GET /api/v1/models` → `parseLmStudioV1`; Fallback `GET /api/v0/models`
  → `parseLmStudioV0`. Alles fehlgeschlagen → `null` (Caller fällt auf `guessFromName`).
- Eine kleine Helper-Util `baseUrl(endpoint)` (strippt `/v1`) ergänzt `endpoint.ts`.

### `ChatClient.stream(...)` — Suppress
- Neuer `opts.suppressThinking?: boolean`. Wenn `true`, wird `suppressParams(true)` in den Request-Body
  gemischt. `ChatSession.params()` (Live-Getter) liefert den aktuellen Wert.
- Nach Stream-Ende: `reasoningHappened(content, reasoning)` ist via vorhandenem Rückgabewert ableitbar; die
  View entscheidet über den dezenten „trotz aus gedacht"-Hinweis.

---

## Chat-View (`chat_view.ts`)

- **Eingabe:** `<input>` → **Auto-Grow-`<textarea>`**. Helper `autoGrow(el, maxPx)` (Höhe = `scrollHeight`
  bis `maxPx`, dann `overflow-y:auto`). Start ~3 Zeilen, max ~180px, `resize:none`.
- **Keydown:** IME-Guard (`e.isComposing || e.key === "Process"` → nichts senden). Senden-Bedingung aus
  `enterSends`: Default Enter (ohne Shift/Meta/Ctrl/Alt) sendet, Shift+Enter = Zeile; invertiert wenn
  `enterSends=false`. Escape → laufende Generierung stoppen.
- **Senden deaktiviert** wenn Eingabe leer/whitespace oder läuft. **Autofocus** beim Öffnen.
- **Thinking-Schnell-Toggle** neben dem Modell-Dropdown: sichtbarer Zustand (💭 an / 💭 aus, `aria-label`),
  Klick schaltet den Live-Wert. Bei `isAlwaysOnThinker(model)` deaktiviert + Tooltip „lässt sich bei diesem
  Modell nicht abschalten".
- **Capability-Chips** am Modell: `👁 Vision` / `💭 Thinking` (CSS-Klasse signalisiert Konfidenz:
  ausgegraut=`likely`, voll=`confirmed`). Beim Modellwechsel via `fetchCapabilities`→`merge`→Re-Render.
- **Dezenter Hinweis** wenn Suppress=aus, aber `reasoningHappened` true: kleine Zeile am Gedanken-Block
  („Modell hat trotz ‚aus' gedacht"). Der Block selbst bleibt sichtbar.

## Settings (`settings.ts`)

- **Embedding-Modell** → Dropdown via `EmbeddingClient.listModels()`, Text-Fallback + „Modelle laden"
  offline (Muster vom Chat-Modell).
- **Endpoints (Embedding + Chat):** je ein **„Testen"-Button inline** + Status-Punkt direkt am Feld
  (`addButton` + ein Status-`<span>`-Element via `addExtraButton`/eigenes Element). Erkannter Server-Typ
  (Ollama/LM Studio/…) als kurzer Desc-Hinweis. Sammel-Status-Block unten entschlackt.
- **Modell-Dropdowns:** Capability-Chips/Desc an der Auswahl (gleiche `capabilities.ts`-Logik).
- **System-Prompt-Textarea:** `inputEl.rows = 8` + CSS-Klasse (`resize:vertical`, volle Breite).
- **Thinking:** Default-Toggle (`suppressThinking`) **+ „Suppress testen"-Button**: schickt einen
  reasoning-provozierenden Mini-Prompt mit `suppressParams(true)` und meldet via `reasoningHappened`
  „✓ wird unterdrückt" / „⚠ Modell denkt trotzdem" (Notice + Inline). Bei `isAlwaysOnThinker` vorab
  warnen.
- **Enter-Verhalten:** Toggle `enterSends` (Default an).

## `styles.css` + Guidelines

- Alle neuen Styles als **CSS-Klassen** (`vault-rag-chat-input` als textarea, Capability-Chips, Status-Punkte),
  Obsidian-Variablen, keine Inline-Styles. sentence case, `aria-label`/Tooltip, `clickable-icon`.
- Räumt nebenbei guideline-relevante Submission-Punkte ab (CORE/PROF-OBS).

---

## Tests (TDD, Default)

**Reine Module (Schwerpunkt):**
- `reasoning.ts`: `suppressParams` (exakte Form, nie Boolean/`"minimal"`); `reasoningHappened`
  (leer / `<think>` / separates Feld); `isAlwaysOnThinker`.
- `capabilities.ts`: jede `parse*`-Funktion (echte Beispiel-JSONs); `guessFromName` inkl. Ausnahmen
  (`gemma3:1b` text, `qwen3-instruct-2507` non-thinking, `glm-4` vs `glm-4v`); `mergeCapability`
  Monotonie (Live hebt nur hoch).
- `embedder.ts`: `listModels` Erfolg/Fehler/Offline-`[]`.
- `endpoint.ts`: `baseUrl` (strippt `/v1`, lässt native Pfade unangetastet).

**View/DOM (soweit headless sinnvoll):** Auto-Grow-Höhenkappung, IME-Guard (kein Senden bei
`isComposing`), `enterSends`-Invertierung, Senden-disabled-bei-leer.

**Invarianten:** alle bestehenden Tests bleiben grün; `npx tsc --noEmit` sauber; `npm run build` sauber.

## Build-Sequenz (grob, für writing-plans)

1. `reasoning.ts` + Tests → 2. `capabilities.ts` + Tests → 3. `endpoint.baseUrl` + `embedder.listModels`
+ `fetchCapabilities` + Tests → 4. `ChatClient.stream`-Suppress + Settings-Felder (`suppressThinking`,
`enterSends`) → 5. Chat-View (Textarea/IME/Toggle/Chips) → 6. Settings (Dropdown/Endpoint-Test/Status/
System-Prompt/Suppress-Test) → 7. `styles.css` + Guideline-Politur → 8. Whole-Branch-Review.

## Nicht-Ziele

Lexical/@-Mentions, Vision-Bild-Probe, Personas, Top-p/max_tokens, Änderung am Index-Format oder der
`VaultAdapter`-Grenze, Integrator (ADR-031, separat).
