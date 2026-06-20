# Chat-Modell-UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Temperatur + editierbarer System-Prompt + Modell-Dropdown/-Details/-Switcher + Eingabe-Position-Toggle, alles live aus den Settings.

**Architecture:** Live-Getter in `ChatSession` (`client()`/`systemPreamble()`/`params()`); `stream(…, opts)` schreibt model+temperature in den Body; Single Source of Truth `settings.chatModel`.

**Tech Stack:** TS strict, vitest, Obsidian API.

## Global Constraints

- Alle Tests nach jeder Änderung grün. Conventional Commits, nur berührte Dateien stagen, AI-Trailer.
- Settings-UI (`display()`) ist nicht unit-getestet (kein Test ruft sie); nur `DEFAULT_SETTINGS` + tsc decken sie. Logik/Invarianten unit-testen.
- Befehle: `npx vitest run tests/<datei>` · `npm test` · `npm run build` · `npx tsc --noEmit`.

---

## PHASE 1 — Konfigurierbare Parameter (live)

### Task 1: `ChatClient.stream` mit `opts {model, temperature}`

**Files:** `src/chat_client.ts` · `tests/chat_client.test.ts`

- [ ] Test: `stream(..., undefined, { model:"m2", temperature:0.2 })` → fetch-Body enthält `"model":"m2"` und `"temperature":0.2`; ohne opts kein `temperature`-Key, model = Konstruktor-Wert.
- [ ] Impl: 5. Param `opts?: { model?: string; temperature?: number }`; Body `{ model: opts?.model ?? this.model, messages, stream: true, ...(opts?.temperature != null ? { temperature: opts.temperature } : {}) }`. Signatur: `stream(messages, onContent, onReasoning, signal?, opts?)`.
- [ ] Grün (bestehende stream-Tests ohne opts laufen weiter). Commit `feat(chat): stream-opts model+temperature`.

### Task 2: Settings-Felder + Defaults

**Files:** `src/settings.ts` · `tests/settings.test.ts`

- [ ] Test: `DEFAULT_SETTINGS.chatTemperature===0.7`, `chatInputPosition==="bottom"`, `chatSystemPrompt` enthält "gegroundet".
- [ ] Impl: `export const DEFAULT_SYSTEM_PROMPT = "Du beantwortest Fragen gegroundet in den bereitgestellten Notizen des Nutzers. Wenn die Antwort nicht aus ihnen hervorgeht, sag das offen. Antworte knapp und auf Deutsch.";` Interface + DEFAULT_SETTINGS: `chatTemperature: 0.7`, `chatSystemPrompt: DEFAULT_SYSTEM_PROMPT`, `chatInputPosition: "bottom"`.
- [ ] Grün. (Commit zusammen mit Task 3.)

### Task 3: `ChatSession` auf Live-Getter + System-Prompt + Params

**Files:** `src/chat_session.ts` · `tests/chat_session.test.ts` · `src/main.ts`

- [ ] Tests (mkSession umbauen): `client: () => clientObj`, `systemPreamble: () => "SYS"`, `params: () => ({ model:"m", temperature:0.5 })`. Neue its: stream bekommt `opts` mit model+temperature (5. Arg asserten); System-Message beginnt mit `systemPreamble()`. Bestehende its weiter grün (Stream-Mocks ignorieren 5. Arg).
- [ ] Impl `chat_session.ts`: `SYSTEM_PREAMBLE`-Const entfernen. Deps-Interface: `client: () => ChatClient`, `systemPreamble: () => string`, `params: () => { model: string; temperature: number }` (+ assemble). `send`: `const parts = [this.deps.systemPreamble(), ctx.text].filter(Boolean); system.content = parts.join("\n\n");` und `const p = this.deps.params(); const result = await this.deps.client().stream(sent, c=>…, r=>…, this.controller.signal, { model: p.model, temperature: p.temperature });`
- [ ] Impl `main.ts`: ChatSession-Deps → `client: () => this.chatClient`, `systemPreamble: () => this.settings.chatSystemPrompt`, `params: () => ({ model: this.settings.chatModel, temperature: this.settings.chatTemperature })`.
- [ ] Settings-UI (`display()`, Chat-Sektion): Temperatur-Slider (0–2, step 0.1) + System-Prompt-Textarea (`addTextArea`, Default-Wert). onChange speichert (kein reconnect).
- [ ] `npm test` grün + `npm run build` + `npx tsc --noEmit`. Commit `feat(chat): Temperatur + editierbarer System-Prompt (live)`.

**CHECKPOINT:** Build deployen, User verifiziert Temp + System-Prompt in Obsidian.

---

## PHASE 2 — Modell-Discovery + UI

### Task 4: `ChatClient.listModels` + `modelInfo`

**Files:** `src/chat_client.ts` · `tests/chat_client.test.ts`

- [ ] Tests: `listModels` parst `{data:[{id:"a"},{id:"b"}]}` → `["a","b"]` (sortiert); HTTP-Fehler → `[]`. `modelInfo("m")` parst `/api/v0/models`-Eintrag (`max_context_length`, `quantization`, `state`) → ModelInfo; fehlendes Modell/Fehler → `null`.
- [ ] Impl: `ModelInfo`-Interface; `listModels()` (`GET /v1/models`, `data[].id`, filter string, sort, `[]` on catch/!ok); `modelInfo(model)` (`GET /api/v0/models`, find `id===model`, map Felder, `null` on catch/!ok/missing).
- [ ] Grün. Commit `feat(chat): listModels + modelInfo (best-effort)`.

### Task 5: ChatView Modell-Switcher + Eingabe-Position; Settings Dropdown/Details/Position

**Files:** `src/chat_view.ts` · `tests/chat_view.test.ts` · `src/settings.ts` · `src/main.ts`

- [ ] Tests (mkView-Deps erweitern: `listModels: async()=>[]`, `getModel: ()=>"qwen3"`, `setModel: vi.fn()`, `inputPosition: ()=>"bottom"`): Switcher `<select class="vault-rag-chat-model">` existiert; change → `setModel(value)` (über `_listeners["change"]`); `inputPosition()==="top"` → input-row-Index < messages-Index; Default bottom → input-row letztes (bestehender Test bleibt grün).
- [ ] Impl `chat_view.ts`: ChatViewDeps += `listModels/getModel/setModel/inputPosition`. `onOpen`: model-`<select>` nach Status; DOM-Reihenfolge per `inputPosition()` (top: inputBlock vor messagesBlock). `refreshModels()` async: Optionen aus `listModels()`, `value=getModel()`, `o.value=m` setzen. change → `setModel(sel.value)`.
- [ ] Impl `settings.ts` (`display()`): Modell-Dropdown via `listModels().then(...)` (online → `addDropdown`+`addOption`; offline → bisheriges Textfeld + Refresh-Button `this.display()`); Modell-Details-Zeile via `modelInfo()`; Eingabe-Position-`addDropdown` (`bottom`/`top`).
- [ ] Impl `main.ts`: ChatView-Deps += `listModels: () => this.chatClient.listModels()`, `getModel: () => this.settings.chatModel`, `setModel: (m) => { this.settings.chatModel = m; void this.saveSettings(); }`, `inputPosition: () => this.settings.chatInputPosition`.
- [ ] CSS: `.vault-rag-chat-model { … }` (kompakt, oben). `npm test` + build + tsc grün. Commit `feat(chat): Modell-Dropdown/-Switcher/-Details + Eingabe-Position-Toggle`.

**CHECKPOINT:** Build deployen, User verifiziert Dropdown/Switcher/Details/Position in Obsidian.

## Self-Review

- **Spec-Coverage:** Temp (T1/T3) · System-Prompt (T2/T3) · stream-opts (T1) · listModels/modelInfo (T4) · Dropdown/Switcher/Details/Position (T5) · Live-Getter inkl. client (T3, fixt Stale-Bug). ✓
- **Placeholder:** keine.
- **Typ-Konsistenz:** `params()` liefert `{model,temperature}` (T3) = `stream`-opts (T1); `ModelInfo` (T4) = settings-Detail-Zeile (T5); `inputPosition: () => "bottom"|"top"` (T5) = settings-Feld (T2).
- **Grün-Gruppierung:** T1 additiv (grün). T2+T3 zusammen (Getter-Bruch atomar). T4 additiv. T5 zusammen.
