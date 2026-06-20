# Chat-Modell-UX — Design

**Goal:** Das Chat-Plugin um Modell-Konfiguration und -Verwaltung abrunden: Temperatur + editierbarer
System-Prompt, ein Modell-**Dropdown** (Liste vom Server), best-effort **Modell-Details** (Context-Window
etc.), ein **Modell-Switcher im Chat-Panel**, und ein **Eingabe-oben/unten-Toggle**. Alles **live** aus den
Settings — kein Neu-Aufbau des Clients nötig.

**Architecture:** Eine durchgehende **Live-Getter**-Schicht. `ChatSession` liest Client, System-Prompt und
Modell-Parameter über Getter-Closures, die jeweils den **aktuellen** Settings-Stand zurückgeben. `ChatClient.stream`
bekommt einen `opts`-Parameter (`model`, `temperature`), die in den Request-Body wandern. Damit greifen
Settings-Änderungen (inkl. Endpoint/Modell) **sofort** im offenen Chat — das behebt zugleich den vorbestehenden
Stale-Client-Bug (reconnect ersetzte `this.chatClient`, aber `ChatSession` hielt die alte Referenz).

**Single Source of Truth fürs Modell:** `settings.chatModel`. Settings-Dropdown UND Panel-Switcher
schreiben dorthin; alle Leser nutzen den Live-Getter. Kein zweiter Modell-State.

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`addDropdown`/`addTextArea`/`addButton`), vitest.
Berührt nur die Chat-Schicht + Settings. Slice A / Retrieval unverändert.

## Entscheidungen (Brainstorming 2026-06-20, ratifiziert)

- **Scope:** Temperatur · System-Prompt (editierbar) · Modell-Dropdown · Modell-Details (best-effort) ·
  Frontend-Switcher · Eingabe-Position-Toggle. **Nur das Chat-Modell** (Embedding-Modell-Dropdown später).
- **Live-Getter überall:** `ChatSession.deps.client` wird `() => ChatClient` (live, übersteht reconnect),
  plus `systemPreamble: () => string` und `params: () => {model, temperature}`.
- **System-Prompt:** das editierbare Feld **ersetzt** den hartkodierten `SYSTEM_PREAMBLE`; der Notiz-Kontext
  wird weiterhin **angehängt** (Grounding bleibt). Default-Text wandert nach `DEFAULT_SETTINGS`.
- **Modell-Details best-effort + provider-spezifisch:** primär LM Studios `GET /api/v0/models`
  (`max_context_length`, `loaded_context_length`, `quantization`, `arch`, `state`). Liefert der Endpoint nichts
  Verwertbares → Detail-Zeile bleibt leer/„keine Details". Kein harter Fehler.
- **Dropdown mit Fallback:** Settings holt `listModels()`; bei Erfolg ein Dropdown, sonst das bisherige Textfeld
  (+ „Modelle neu laden"-Button). Modell-Wechsel ändert nur `settings.chatModel` (kein reconnect nötig).
- **Eingabe-Position:** `chatInputPosition: "bottom" | "top"`, **Default `"bottom"`** (konventionell). Wird beim
  Öffnen der View gelesen; Umschalten greift beim nächsten Öffnen des Panels.
- **YAGNI:** kein max_tokens/top_p (bewusst), kein Embedding-Modell-Dropdown (später), kein Per-Chat-Override.

## Settings (neu in `VaultRagSettings`)

```ts
chatTemperature: number;     // Default 0.7
chatSystemPrompt: string;    // Default = bisheriger SYSTEM_PREAMBLE-Text
chatInputPosition: "bottom" | "top";  // Default "bottom"
```

## Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/chat_client.ts` | **ändern** | `stream(…, opts?)` mit `{model?, temperature?}` → Request-Body. `listModels(): Promise<string[]>` (`GET /v1/models` → `data[].id`). `modelInfo(model): Promise<ModelInfo \| null>` (best-effort `GET /api/v0/models`). |
| `src/chat_session.ts` | **ändern** | Deps: `client: () => ChatClient`, `systemPreamble: () => string`, `params: () => {model, temperature}`. `send` nutzt sie live; `SYSTEM_PREAMBLE`-Const entfällt (Default in Settings). |
| `src/settings.ts` | **ändern** | 3 neue Felder + Defaults. Chat-Sektion: Temperatur-Slider, System-Prompt-Textarea, Modell-Dropdown(+Fallback/Refresh), Modell-Details-Zeile, Eingabe-Position-Dropdown. |
| `src/chat_view.ts` | **ändern** | Modell-Switcher (Dropdown in der Kopfzeile) → `setModel`. Eingabe-Position oben/unten beim Aufbau. Neue Deps `listModels`/`getModel`/`setModel`/`inputPosition`. |
| `src/main.ts` | **ändern** | Live-Getter verdrahten (`client: () => this.chatClient`, `systemPreamble`, `params`, `listModels`, `getModel`/`setModel`, `inputPosition`). |

### Schnittstellen

```ts
// chat_client.ts
export interface ModelInfo { id: string; contextLength?: number; loadedContextLength?: number; quantization?: string; arch?: string; state?: string }
// stream(messages, onContent, onReasoning, signal?, opts?: { model?: string; temperature?: number }): Promise<{content, reasoning}>
//   Body: { model: opts.model ?? this.model, messages, stream: true, ...(opts.temperature != null ? {temperature} : {}) }
export async function /* method */ listModels(): Promise<string[]>;     // [] bei Fehler/Offline
export async function /* method */ modelInfo(model: string): Promise<ModelInfo | null>;  // null wenn nicht verfügbar

// chat_session.ts
export interface ChatSessionDeps {
  client: () => ChatClient;
  assemble: (paths: string[]) => Promise<ContextResult>;
  systemPreamble: () => string;
  params: () => { model: string; temperature: number };
}

// chat_view.ts (ChatViewDeps erweitert)
listModels: () => Promise<string[]>;
getModel: () => string;
setModel: (m: string) => void;        // schreibt settings.chatModel + save
inputPosition: () => "bottom" | "top";
```

## Datenfluss

```
Senden → ChatSession.send → p = deps.params(); sys = deps.systemPreamble()
        → deps.client().stream(sent, onC, onR, signal, { model: p.model, temperature: p.temperature })
Settings/Panel-Switcher → settings.chatModel = m; save  → nächster Request nutzt m (Live-Getter)
Settings öffnen → listModels() → Dropdown (oder Textfeld-Fallback); modelInfo(model) → Detail-Zeile
```

## Zustände / Fehlerbehandlung

- **Server offline beim Settings-Öffnen:** `listModels()` → `[]` → Textfeld-Fallback + „Modelle neu laden"-Button; `modelInfo` → `null` → keine Detail-Zeile. Keine Crashes.
- **Modell nicht in der Liste** (manuell getippt): bleibt gültig; Dropdown zeigt zusätzlich den aktuellen Wert.
- **`temperature` undefined** (Altdaten ohne Feld): `Object.assign(DEFAULT_SETTINGS, loadData())` füllt die Defaults; stream lässt `temperature` weg, wenn nicht gesetzt.
- **System-Prompt leer:** dann nur der Notiz-Kontext als System-Message (kein Crash); UI-Hinweis optional.
- **Eingabe-Position-Wechsel** wirkt beim nächsten Panel-Öffnen (onOpen liest `inputPosition()`).

## Tests (TDD, vitest)

- `chat_client.test.ts` — `stream` schickt `temperature` und `model` aus `opts` im Body (fetch-Body asserten); ohne `opts` unverändert. `listModels` parst `data[].id`; `[]` bei HTTP-Fehler. `modelInfo` parst `/api/v0/models`-Eintrag; `null` wenn Modell fehlt/Fehler.
- `chat_session.test.ts` — Deps auf Getter umgestellt; `send` nutzt `client()`, `systemPreamble()`, `params()`; Modell+Temperatur landen in `stream`-`opts`; System-Message = `systemPreamble()` + ctx; Reasoning weiterhin nicht in der History.
- `settings.test.ts` — neue Defaults (`chatTemperature` 0.7, `chatInputPosition` "bottom", `chatSystemPrompt` = Preamble-Text) vorhanden.
- `chat_view.test.ts` — Modell-Switcher gerendert; `setModel` bei Auswahl aufgerufen; `inputPosition()==="top"` → Eingabezeile ist **erstes** Strukturelement (statt letztes); Kopier-Button/Quellen unverändert.

## Self-Review

- **Placeholder-Scan:** kein TBD/TODO.
- **Konsistenz:** ein Modell-State (`settings.chatModel`); Live-Getter in `ChatSession` + `ChatView`-Wiring; `stream`-`opts` einzige Stelle, die model/temperature in den Body schreibt.
- **Scope:** ein Plan, in 2 Phasen (Modell-Parameter+Live-Getter · Discovery+UI). max_tokens/top_p/Embedding-Dropdown/Per-Chat bewusst raus.
- **Ambiguität:** Modell-Details = best-effort LM-Studio-`/api/v0/models`, null-sicher; Eingabe-Position greift beim Öffnen; Default-System-Prompt = bisheriger Text (verbatim nach `DEFAULT_SETTINGS`).
- **Risiko:** Settings-/View-UI ist mit dem Minimal-Obsidian-Mock nur teilweise unit-testbar (Dropdown/Details visuell beim User); die testbaren Invarianten (stream-opts, Getter-Nutzung, setModel-Call, Eingabe-Position-DOM-Order, Defaults) sind abgedeckt, der Rest wird in Obsidian verifiziert.
```

