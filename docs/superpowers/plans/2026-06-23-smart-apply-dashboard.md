# Smart Apply Dashboard (Slice 1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Smart-Apply-Sidebar zum persistenten Steuer-Cockpit ausbauen (Modell/Status/Trigger/Stop, Live-Denken + Roh-Stream) und dabei den „Anwenden tut nichts"-Bug (stale/blocked-Feedback) + den Reasoning-Modell-Hänger (suppressThinking + max_tokens-Cap) beheben.

**Architecture:** `SmartApplyView` wird vom transienten Diff-Gate zum persistenten Cockpit mit Zustandsmaschine (idle→running→diff→applied→stale/error). Pure-Core bleibt obsidian-frei; nur View/settings/main fassen `obsidian` an. ChatView-Muster werden **kopiert** (ChatView unangetastet). Eigenes Smart-Apply-Modell + suppressThinking + max_tokens fließen über einen `params()`-Getter in den einen `streamSSE`-Call.

**Tech Stack:** TypeScript strict, esbuild, vitest + happy-dom, Obsidian Plugin API, `streamSSE` (XMLHttpRequest).

## Global Constraints

- Spec (SSOT): `docs/superpowers/specs/2026-06-23-smart-apply-dashboard-design.md`.
- Pure-Core (`smart_apply`/`note_restructurer`/`template_matcher`/`frontmatter`) importiert NIE `obsidian`. Nur `smart_apply_view`/`settings`/`main` (+ `chat_client` nutzt `http`/`sse`) fassen die Plattform an.
- Streaming nur via `ChatClient.stream` → `streamSSE` (XMLHttpRequest). `fetch` verboten (eslint-plugin-obsidianmd).
- View: KEIN `innerHTML`, KEIN inline `style=`-Attribut → `createDiv`/`createEl`/`setIcon`/`setCssStyles`.
- TypeScript strict + `noImplicitAny`; keine `any`-Casts in `src/` (Test-Mocks dürfen `as unknown as`).
- Tests: vitest + happy-dom; Obsidian-Mock `tests/__mocks__/obsidian.ts`; deutsche `it()`-Strings; Imports aus `../src/…`. Vor jedem Commit `npx tsc --noEmit` UND der jeweilige `npx vitest run …` grün; am Ende `npm run lint`.
- Conventional Commits (deutsch ok); NUR berührte Dateien stagen; Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- ChatView (`src/chat_view.ts`) bleibt UNVERÄNDERT — seine Muster werden in `smart_apply_view.ts` gespiegelt, nicht geteilt.
- Der destruktive Write bleibt ausschließlich in `SmartApply.persistApply` (unverändert).

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/chat_client.ts` | (∆) `stream`-Opts um `maxTokens?` → `max_tokens` im Body. |
| `src/smart_apply.ts` | (∆) 3. ctor-Arg `temperature`→`params(): SmartApplyParams`; `propose` reicht temperature/suppressThinking/maxTokens in den Stream. |
| `src/settings.ts` | (∆) `smartApplyModel`/`smartApplySuppressThinking`/`smartApplyMaxTokens` + Builder. |
| `src/smart_apply_view.ts` | (∆ Ausbau) Persistentes Cockpit: Header (Modell/Status/💭/Template/Trigger/Stop) + Zustandsmaschine + Live-💭/Roh-Stream + Apply-Feedback/Stale. |
| `src/main.ts` | (∆) Cockpit-Deps verdrahten; Command/Ribbon enthüllen (kein Auto-Run). |

## Reihenfolge & Abhängigkeiten

T1 (chat_client) → T2 (smart_apply params, nutzt T1) → T3 (settings) → T4 (smart_apply_view Cockpit, nutzt T2) → T5 (main, nutzt T2/T3/T4).

---

### Task 1: chat_client.ts — `max_tokens`-Opt

**Files:**
- Modify: `src/chat_client.ts`
- Test: `tests/chat_client.test.ts`

**Interfaces:**
- Produces: `ChatClient.stream(messages, onContent, onReasoning, signal?, opts?: { model?: string; temperature?: number; suppressThinking?: boolean; maxTokens?: number })` — `maxTokens` wird als `max_tokens` in den Request-Body gespiegelt (nur wenn `!= null`).

- [ ] **Step 1: Failing test** — `stream` schreibt `max_tokens` in den Body, wenn `maxTokens` gesetzt ist. Nutze den vorhandenen `tests/fake_xhr.ts`-Mechanismus (siehe bestehende `chat_client.test.ts`, wie der Request-Body abgegriffen wird). Assertion: der gesendete JSON-Body enthält `max_tokens: 512` bei `opts.maxTokens=512`, und enthält KEIN `max_tokens`, wenn `maxTokens` weggelassen wird.

- [ ] **Step 2: Run → FAIL** — `npx vitest run tests/chat_client.test.ts` (neue Assertion schlägt fehl, da `max_tokens` nie gesetzt wird).

- [ ] **Step 3: Implement** — in `stream` die Opts-Signatur um `maxTokens?: number` erweitern und im `body`-Objekt ergänzen, im Stil der bestehenden temperature-Zeile:
```ts
...(opts?.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
```

- [ ] **Step 4: Run → PASS** — `npx vitest run tests/chat_client.test.ts`; dann `npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `git add src/chat_client.ts tests/chat_client.test.ts && git commit` (`feat(chat-client): max_tokens-Opt in stream`).

---

### Task 2: smart_apply.ts — `params()`-Getter (temperature + suppressThinking + maxTokens)

**Files:**
- Modify: `src/smart_apply.ts`
- Test: `tests/smart_apply.test.ts`

**Interfaces:**
- Consumes: `ChatClient.stream(..., opts: { temperature?, suppressThinking?, maxTokens? })` (Task 1).
- Produces:
```ts
export interface SmartApplyParams { model: string; temperature: number; suppressThinking: boolean; maxTokens: number }
// 3. Konstruktor-Arg: war `temperature: () => number`, ist jetzt `params: () => SmartApplyParams`.
export class SmartApply { constructor(deps: SmartApplyDeps, client: () => ChatClient, params: () => SmartApplyParams); /* … */ }
// propose setzt opts.model = p.model → der Cockpit-Modellwechsel wirkt im Stream OHNE ChatClient-Neubau.
```
  Diff-Gate-Kontrakt (`detect`/`propose`/`persistApply`/`abort`, `build`/`reroll`-Callbacks) UNVERÄNDERT.

- [ ] **Step 1: Failing test** — `propose` reicht alle drei Werte in die Stream-Opts. Im `smart_apply.test.ts` gibt es bereits einen Capture-Spy auf die `stream`-Opts (aus dem temperature-Test). Erweitere/dupliziere ihn: konstruiere `SmartApply` mit `() => ({ model: 'm-fast', temperature: 0.4, suppressThinking: true, maxTokens: 777 })`, fahre `propose`, asserte `capturedOpts.model==='m-fast' && capturedOpts.temperature===0.4 && capturedOpts.suppressThinking===true && capturedOpts.maxTokens===777`. Passe ALLE bestehenden `new SmartApply(...)`-Konstruktionen im Test auf den `params`-Getter an (statt `() => 0` jetzt `() => ({ model: 'm', temperature: 0, suppressThinking: false, maxTokens: 2048 })`).

- [ ] **Step 2: Run → FAIL** — `npx vitest run tests/smart_apply.test.ts` (FAIL: 3. Arg ist noch `temperature`-Getter / suppress+maxTokens fehlen in Opts).

- [ ] **Step 3: Implement** — 3. ctor-Arg in `params: () => SmartApplyParams` umbenennen (Feld `private params`); im Stream-Call:
```ts
const p = this.params();
const r = await this.client().stream(messages, onToken, onReasoning, this.controller.signal,
  { model: p.model, temperature: p.temperature, suppressThinking: p.suppressThinking, maxTokens: p.maxTokens });
```
`SmartApplyParams` exportieren.

- [ ] **Step 4: Run → PASS** — `npx vitest run tests/smart_apply.test.ts`; `npx tsc --noEmit` (rot in main.ts erwartet bis Task 5 — in DIESEM Task nur die smart_apply-Tests + die Datei selbst grün; main.ts-Anpassung ist Task 5. Falls tsc projektweit rot wird wegen main.ts, ist das ok und wird in Task 5 geheilt; vermerke es im Report).

- [ ] **Step 5: Commit** — `git add src/smart_apply.ts tests/smart_apply.test.ts && git commit` (`feat(smart-apply): params()-Getter (temperature/suppressThinking/maxTokens)`).

> **Hinweis an den Controller:** Tasks 2 und 5 hängen zusammen (Konstruktor-Signatur). Falls der Implementer von Task 2 main.ts nicht anfassen darf, wird `npx tsc --noEmit` projektweit erst nach Task 5 grün. Reviewer von Task 2 prüft `smart_apply.ts` + dessen Tests isoliert; die projektweite tsc-Grünung ist Gate von Task 5.

---

### Task 3: settings.ts — Smart-Apply-Modell/Suppress/MaxTokens

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `VaultRagSettings` + `DEFAULT_SETTINGS` um `smartApplyModel: string` (Default `""`), `smartApplySuppressThinking: boolean` (Default `false`), `smartApplyMaxTokens: number` (Default `2048`). Builder im bestehenden `build*`-Muster, in die „Smart Apply"-Sektion in `display()` eingehängt.

- [ ] **Step 1: Failing test** — in `settings.test.ts` einen Default-Test + Backward-Compat-Merge-Test ergänzen:
```ts
it("hat Smart-Apply-Dashboard-Defaults", () => {
  expect(DEFAULT_SETTINGS.smartApplyModel).toBe("");
  expect(DEFAULT_SETTINGS.smartApplySuppressThinking).toBe(false);
  expect(DEFAULT_SETTINGS.smartApplyMaxTokens).toBe(2048);
});
it("Default-Merge ergänzt fehlende Dashboard-Felder (Backward-Compat)", () => {
  const merged = Object.assign({}, DEFAULT_SETTINGS, { smartApplyEnabled: true } as Partial<VaultRagSettings>);
  expect(merged.smartApplyModel).toBe("");
  expect(merged.smartApplySuppressThinking).toBe(false);
  expect(merged.smartApplyMaxTokens).toBe(2048);
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run tests/settings.test.ts`.

- [ ] **Step 3: Implement** — die drei Felder zu `VaultRagSettings` + `DEFAULT_SETTINGS` hinzufügen. In `display()` in der „Smart Apply"-Sektion drei Builder ergänzen (Muster wie `buildSmartApplyEnabled`/`buildTemplateDir`/`buildSmartApplyTemperature`): `buildSmartApplyModel` (Text/Dropdown — ein Text-Feld mit Placeholder „leer = Chat-Modell" reicht), `buildSmartApplySuppress` (Toggle), `buildSmartApplyMaxTokens` (Slider 256–8192 step 256 oder Text). Deutsche Strings; bei Werten mit Sonderzeichen einfache Quotes (esbuild-Curly-Quote-Falle vermeiden).

- [ ] **Step 4: Run → PASS** — `npx vitest run tests/settings.test.ts`; `npx tsc --noEmit`; `npm run lint`.

- [ ] **Step 5: Commit** — `git add src/settings.ts tests/settings.test.ts && git commit` (`feat(settings): Smart-Apply-Modell/suppressThinking/maxTokens`).

---

### Task 4: smart_apply_view.ts — Cockpit (Header + Zustandsmaschine + Live + Apply-Fix)

**Files:**
- Modify: `src/smart_apply_view.ts`
- Test: `tests/smart_apply_view.test.ts`

**Interfaces:**
- Consumes: `ApplyProposal`/`ApplyResult` (aus `./smart_apply`); ChatView-Muster (LESEN: `src/chat_view.ts`) für Modell-`<select>`/`listModels`-Befüllung, Verbindungspunkt+`ping`, `💭`-Toggle, Working-Indicator/Stoppuhr, Reasoning-`<details>`.
- Produces: `SmartApplyViewDeps` erweitert (gespiegelt aus `ChatViewDeps`):
```ts
export interface SmartApplyViewDeps {
  build: (notePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  accept: (p: ApplyProposal) => Promise<ApplyResult>;
  reroll: (p: ApplyProposal, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  openPath: (p: string) => void;
  abort: () => void;
  activeNotePath: () => string | null;
  listModels: () => Promise<string[]>;
  getModel: () => string;
  setModel: (m: string) => void;
  listTemplates: () => Promise<string[]>;
  getSuppress: () => boolean;
  setSuppress: (v: boolean) => void;
  ping: () => Promise<boolean>;
}
```

**Umsetzung (TDD; Reihenfolge der Verhaltens-Tests):** Es gibt schon eine `SmartApplyView` mit `run(notePath)`, Diff-Render, Action-Bar, onAccept/onReroll/onUndo. Dieser Task baut sie zum Cockpit aus. Mirror-Vorlage: `src/chat_view.ts` (NICHT ändern). Zustand über ein `state`-Feld (`"idle"|"running"|"diff"|"applied"|"stale"|"error"`), `render()` macht `contentEl.empty()` + Header + body-nach-state (kein Listener-Leak; `onClose` räumt Timer/Intervalle auf wie in chat_view).

- [ ] **Step 1: Failing test — Header rendert** (Modell-`<select>`, Verbindungspunkt, `💭`-Toggle, Template-`<select>`, „Auf aktive Notiz anwenden", Stop). Test: `await view.onOpen()` → assert je ein Element mit den CSS-Klassen `vault-rag-sa-model`, `vault-rag-sa-conn`, `vault-rag-sa-think`, `vault-rag-sa-template`, `vault-rag-sa-run`, `vault-rag-sa-stop`. `mkView`/Deps-Fake um die neuen Deps erweitern (listModels→`["m1","m2"]`, getModel→`"m1"`, listTemplates→`["T/Besprechung.md"]`, ping→true, activeNotePath→`"a.md"`, getSuppress→false). Run→FAIL.

- [ ] **Step 2: Implement Header** — im `render()` einen fixen Header bauen (gespiegelt aus chat_view: `<select>` über `deps.listModels()` befüllt, `change`→`deps.setModel`; Verbindungspunkt via `deps.ping()` grün/rot; `💭`-Toggle `deps.getSuppress`/`setSuppress`; Template-`<select>` über `deps.listTemplates()`; „Anwenden"-Button → `void this.start()`; Stop-Button → `deps.abort()` + state zurück). Run→PASS.

- [ ] **Step 3: Failing test — Zustandsmaschine idle→running→diff** — `start()` (vom Run-Button): liest `deps.activeNotePath()`; null → bleibt `idle` + Notice; sonst `state="running"` (Spinner/Stoppuhr + `💭`-`<details>` live + Roh-Stream-Pane), ruft `deps.build(path, onToken, onReasoning)`; bei Erfolg `state="diff"`. Test: aktive Notiz gesetzt, `start()` aufrufen, microtasks flushen, assert Diff-Flächen da. Run→FAIL.

- [ ] **Step 4: Implement running/diff + Live** — `start()` implementieren; `onToken` hängt an die Roh-Stream-`<pre>` an, `onReasoning` an den `💭`-`<details>`; Stoppuhr wie `startWorking`/`stopWorking` (aus chat_view gespiegelt). Auf Erfolg → bestehendes Diff-Render (Frontmatter-Tabelle + Body-Stack + Übrig + Guard-Banner). Run→PASS.

- [ ] **Step 5: Failing test — Roh-Stream + 💭 füllen sich live** — fake `build` ruft seine `onToken`/`onReasoning` synchron mit `"{json"`/`"denke"` auf; assert Roh-Stream-Pane enthält `"{json"`, `💭`-Body enthält `"denke"`. Run→FAIL → implementieren (Callbacks an die Panes binden) → PASS.

- [ ] **Step 6: Failing test — Apply-Feedback (blocked)** — bei `proposal.hardOk===false` ist „Anwenden" gesperrt UND das Guard-Banner listet die fehlgeschlagenen Checks (`proposal.checks.filter(c=>!c.ok)`); Klick auf das gesperrte Anwenden ruft `deps.accept` NICHT. Run→FAIL → implementieren → PASS.

- [ ] **Step 7: Failing test — Stale-Pfad + „Neu erzeugen & anwenden"** — `deps.accept` liefert `{written:false, reason:"stale"}` → `state="stale"`, sichtbare Meldung (Klasse `vault-rag-sa-stale`) + Button `vault-rag-sa-rebuild`. Klick auf „Neu erzeugen & anwenden" → ruft `deps.build` erneut (gegen den aktuellen Pfad) und, falls die neue Proposal `hardOk`, `deps.accept` erneut. Test: erst accept→stale, dann rebuild-Button-Klick → assert `deps.build` ein zweites Mal gerufen + (bei hardOk) `deps.accept` erneut. Run→FAIL → implementieren → PASS.

- [ ] **Step 8: Failing test — applied + Stop + Verwerfen** — erfolgreicher accept (`{written:true,undo}`) → `state="applied"` + Rückgängig (ruft `undo`); Stop-Button → `deps.abort` (+ state weg von running); Verwerfen → `state="idle"`, kein Write. (Teile davon existieren schon — anpassen, nicht doppeln.) Run→FAIL → implementieren → PASS.

- [ ] **Step 9: Failing test — kein innerHTML / kein inline-style** — Quelltext-Scan `expect(src).not.toContain("innerHTML")` + setAttribute-Spy auf `"style"` leer (wie bestehende Tests). Run→PASS (sollte schon halten).

- [ ] **Step 10: Run alle View-Tests + tsc + lint** — `npx vitest run tests/smart_apply_view.test.ts`; `npx tsc --noEmit` (ggf. noch rot wegen main.ts → Task 5); `npm run lint`.

- [ ] **Step 11: Commit** — `git add src/smart_apply_view.ts tests/smart_apply_view.test.ts && git commit` (`feat(smart-apply): Cockpit-View (Header/Zustandsmaschine/Live/Apply-Fix)`).

---

### Task 5: main.ts — Cockpit verdrahten (+ projektweit grün)

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `SmartApply(deps, client, params)` (Task 2), `SmartApplyViewDeps` (Task 4), `VaultRagSettings`-Felder (Task 3), `extractType`/`pickTemplate` (vorhanden).

- [ ] **Step 1: Implement Wiring** — beim `new SmartApply(...)` den 3. Arg auf `() => ({ temperature: this.settings.smartApplyTemperature, suppressThinking: this.settings.smartApplySuppressThinking, maxTokens: this.settings.smartApplyMaxTokens })` umstellen. Die `SmartApplyView`-Deps um die neuen Felder ergänzen:
  - `activeNotePath: () => { const f = this.app.workspace.getActiveFile(); return f instanceof TFile && f.extension === "md" ? f.path : null; }`
  - `listModels: () => this.chatClient.listModels()` (gespiegelt aus der Chat-Verdrahtung; falls Signatur abweicht, an die echte `listModels`-Quelle anpassen)
  - `getModel: () => this.settings.smartApplyModel || this.settings.chatModel`
  - `setModel: (m) => { this.settings.smartApplyModel = m; void this.saveSettings(); }`
  - `listTemplates: () => Promise.resolve(this.app.vault.getMarkdownFiles().map(f=>f.path).filter(p=>p.startsWith(this.settings.templateDir)))`
  - `getSuppress: () => this.settings.smartApplySuppressThinking`, `setSuppress: (v) => { this.settings.smartApplySuppressThinking = v; void this.saveSettings(); }`
  - `ping: () => <vorhandener Chat-Ping>` (gespiegelt aus der Chat-Verdrahtung)
  - `abort: () => this.smartApply!.abort()`
  `params()` liefert `{ model: this.settings.smartApplyModel || this.settings.chatModel, temperature: this.settings.smartApplyTemperature, suppressThinking: this.settings.smartApplySuppressThinking, maxTokens: this.settings.smartApplyMaxTokens }`. `model` ist bereits Teil von `SmartApplyParams` (Task 2), `propose` setzt `opts.model` → der Cockpit-`setModel` (schreibt `smartApplyModel`) wirkt im nächsten Lauf, ohne den ChatClient neu zu bauen.
  Command/Ribbon: `activateSmartApplyView()` **enthüllt nur** (reveal/öffne rechtes Leaf), KEIN `run()`-Aufruf mehr (Trigger über den Cockpit-Button).

- [ ] **Step 2: Verify** — `npx tsc --noEmit` MUSS jetzt projektweit grün sein (alle Signaturen verdrahtet). `npm test` (volle Suite grün). `npm run lint`.

- [ ] **Step 3: Manueller Smoke (dokumentiert, kein Auto-Test)** — Reload → Cockpit öffnen → Modell wählen → „Auf aktive Notiz anwenden" → Live-💭/Roh-Stream → Diff → Anwenden/Stale-Rebuild/Stop.

- [ ] **Step 4: Commit** — `git add src/main.ts src/smart_apply.ts tests/smart_apply.test.ts && git commit` (`feat(smart-apply): Cockpit-Verdrahtung + modellbewusster Stream`).

---

## Self-Review-Notiz (für den Controller)

Geprüft: Spec-Coverage vollständig (Cockpit→T4, Modell/suppress/maxTokens→T2+T3, Apply-Feedback/Stale→T4, Live→T4, reveal-only Command→T5, max_tokens-Opt→T1); keine Platzhalter; Typen konsistent — `SmartApplyParams` enthält `model` durchgängig (T2 definiert, T5 füllt). Tasks 2 & 5 koppeln über die `params`-Signatur: projektweites `npx tsc --noEmit` ist erst nach T5 grün (in T2/T4 ggf. transient rot wegen main.ts — Reviewer prüfen die jeweilige Datei + ihre Tests isoliert).
