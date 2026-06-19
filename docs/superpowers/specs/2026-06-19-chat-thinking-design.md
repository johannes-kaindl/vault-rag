# Chat: Thinking sichtbar machen (reasoning_content) — Design

**Goal:** Das „Denken" von Reasoning-Modellen (DeepSeek-R1, QwQ, …) beim Streamen abgreifen und
über jeder Assistenten-Antwort in einem **aufklappbaren „💭 Gedanken"-Block** anzeigen — live
offen während des Denkens, automatisch zugeklappt sobald die Antwort kommt.

**Architecture:** Der Reasoning-Strom kommt **getrennt vom Antwort-Strom** durch dasselbe SSE.
Zwei Quellen, robust abgedeckt: `delta.reasoning_content` (so liefert LM Studio :1234) **und**
`<think>…</think>`-Tags inline im `content` (rohe llama.cpp/Ollama-Modelle). Das Tag-Stripping
ist zustandsbehaftet (Tags splitten über SSE-Chunks) und liegt deshalb in einer eigenen,
unabhängig testbaren Einheit — `parseSSE` bleibt eine reine Funktion.

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`ItemView`, `<details>`/`<summary>`),
vitest + happy-dom. Berührt nur die Chat-Schicht (`chat_client`/`chat_session`/`chat_view`);
Slice A, Retrieval und Kontext-Panel bleiben unverändert.

## Entscheidungen (Brainstorming 2026-06-19, ratifiziert)

- **Darstellung:** aufklappbarer `<details>`-Block über der Antwort. **Live offen** während des
  Denkens (man sieht das Reasoning streamen), **klappt automatisch zu** sobald das erste Antwort-
  Token kommt. Klick = wieder auf/zu. Zustand ist **aus dem Modell ableitbar** (kein verlorener
  Toggle bei Re-Render).
- **Quelle: beide Kanäle.** `delta.reasoning_content` (primär) **und** `<think>…</think>` im
  `content` (Fallback). Beide landen im selben Reasoning-Strom.
- **Reasoning ist ephemer** (in-memory in `ChatMessage`, keine gesyncte Chat-DB — konsistent mit ADR-009).
- **Reasoning wird NIE ans LLM zurückgeschickt** (Multi-Turn-History bleibt `{role, content}`-only;
  DeepSeek/OpenAI-Guidance — Zurücksenden von `reasoning_content` ist ein Fehler).
- **Live-Timer phasenbewusst:** `workingEl` zeigt „● denkt nach… X s" solange der Live-Assistent nur
  Reasoning hat, danach „● generiert… X s".
- **Out of scope (YAGNI):** kein Settings-An/Aus-Schalter (geparkt); keine eingefrorene Pro-Block-
  Dauer im zugeklappten Summary (Live-Timer deckt das Zeitsignal ab — leichter Nachzug später).
  Token-/Tempo-Stats + Personas bleiben geparkt.

## Architektur-Split

```
SSE-Chunk ──► parseSSE(buffer)  [rein]  ──► { content[], reasoning[], rest, done }
                 │ delta.content           │ delta.reasoning_content
                 ▼
            ThinkSplitter.push(text) [stateful] ──► { content, reasoning }
                 │  zieht <think>…</think> aus dem content-Strom
                 ▼
ChatClient.stream(msgs, onContent, onReasoning, signal)
   reasoning_content-Deltas ───────────────► onReasoning
   content-Deltas → ThinkSplitter → content ► onContent
                                  → think  ──► onReasoning
   return { content, reasoning }
                 ▼
ChatSession.send: assistant.content += c / assistant.reasoning += r ; onToken() (re-render)
                 ▼
ChatView.renderMessages: <details> über content, open ⟺ live & content==""
```

## Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/chat_client.ts` | **ändern** | `parseSSE` liest zusätzlich `delta.reasoning_content` → `{ content[], reasoning[], rest, done }` (Feld `deltas`→`content`). `ChatMessage` bekommt `reasoning?: string`. `stream(msgs, onContent, onReasoning, signal): Promise<{ content, reasoning }>` routet beide Kanäle. |
| `src/think_splitter.ts` | **neu** | `ThinkSplitter`: stateful `push(text): { content; reasoning }`. Hält `insideThink`-Flag, puffert angefangene `<think>`/`</think>`-Tags über Chunk-Grenzen. Pure-logisch, kein DOM → in Node testbar. |
| `src/chat_session.ts` | **ändern** | `send` akkumuliert `assistant.reasoning` neben `.content`; `onToken` wird reiner Re-Render-Notifier; Empty-Guard prüft `result.content`; History-Aufbau bleibt `{role, content}`-only (Kommentar: Reasoning nicht zurücksenden). |
| `src/chat_view.ts` | **ändern** | `renderMessages`: `<details>`-Block bei `m.reasoning`; `workingEl`-Timer phasenbewusst. |
| `styles.css` | **ändern** | Minimal-CSS: gedimmter, monospace-ish Reasoning-Body + Summary-Cursor. |

### Schnittstellen

```ts
// chat_client.ts
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning?: string;          // NEU — ephemer, nie ans LLM zurück
  sources?: string[];
  error?: string;
}
export function parseSSE(buffer: string):
  { content: string[]; reasoning: string[]; rest: string; done: boolean };
// stream(messages, onContent, onReasoning, signal?): Promise<{ content: string; reasoning: string }>

// think_splitter.ts
export class ThinkSplitter {
  push(text: string): { content: string; reasoning: string };
}
```

`ThinkSplitter`-Verhalten:
- Plaintext ohne Tags → alles `content`.
- `<think>X</think>Y` → `reasoning="X"`, `content="Y"`.
- Tag über `push`-Grenzen gesplittet (`"<thi"` + `"nk>X</thi"` + `"nk>Y"`) → korrekt zusammengeführt.
- Geöffnetes `<think>` ohne Close (noch am Denken) → bisheriger Text ist `reasoning`.
- Mehrere `<think>`-Blöcke und Text davor/dazwischen → korrekt geroutet.
- Ein angefangenes, aber noch nicht eindeutiges `<`…-Fragment wird gepuffert (nicht fälschlich als content emittiert), bis klar ist ob es ein think-Tag ist.

## Datenfluss (live)

`ChatSession.send` reicht zwei Closures an `client.stream`:
`c => { assistant.content += c; onToken(); }` und `r => { assistant.reasoning = (assistant.reasoning ?? "") + r; onToken(); }`.
Nach dem Stream: `assistant.content = result.content; assistant.reasoning = result.reasoning || undefined`.
Die View re-rendert bei jedem `onToken()` aus `session.messages` — Content und Reasoning sind beide am `ChatMessage`.

## Rendering (`chat_view.ts`)

- Pro Assistenten-Nachricht mit nicht-leerem `reasoning`: ein `<details>` **vor** dem Content-Div.
  Summary: „💭 denkt nach…" wenn live, sonst „💭 Gedanken". `open`-Attribut ⟺ live.
- **`isLive`-Ableitung:** `m === messages[last] && m.content === "" && !m.error`. Damit ist der Block
  offen solange noch kein Antwort-Token da ist, klappt beim ersten Content-Token zu, und der seltene
  Empty-Answer-Fall (Reasoning vorhanden, content leer, `error` gesetzt) zeigt zugeklappt „💭 Gedanken".
- `workingEl`-Tick liest den Live-Assistenten: nur-Reasoning ⇒ „● denkt nach… X s", sonst „● generiert… X s".

## Zustände / Fehlerbehandlung

- **Normales Modell ohne Reasoning** → `reasoning` bleibt leer/undefined → **kein Block, null Regression**.
- **Abbruch beim Denken** → AbortError-Pfad (unverändert), Teil-Reasoning bleibt sichtbar, keine Fehlermeldung.
- **Empty-Content trotz Reasoning, nicht abgebrochen** → Empty-Answer-Fehler **plus** sichtbarer Denk-Block.
- **Nur `reasoning_content`, kein `<think>`** (LM-Studio-Normalfall) → `ThinkSplitter` ist No-Op auf dem
  content-Strom, reasoning_content geht direkt durch.

## Tests (TDD, vitest)

- `tests/chat_client.test.ts` (erweitern) — `parseSSE`: `reasoning_content`-Deltas extrahiert; content
  + reasoning gemischt; nur eins; `[DONE]`; Teilzeile → rest (bestehende `deltas`-Assertions → `content`).
  `stream`: routet content vs. reasoning_content an die richtigen Callbacks; Rückgabe `{content, reasoning}`;
  HTTP-Fehler wirft (unverändert).
- `tests/think_splitter.test.ts` (neu) — Plaintext; ganzer Block; Tag über Chunks gesplittet; kein
  Close-Tag; Text vor/zwischen Blöcken; Mehrfach-Blöcke; angefangenes `<`-Fragment gepuffert.
- `tests/chat_session.test.ts` (erweitern) — `send` akkumuliert `assistant.reasoning`; **Reasoning NICHT
  in der an `stream` gesendeten History** (Multi-Turn); Empty-Guard greift auf `result.content`.
- `tests/chat_view.test.ts` (erweitern) — `<details>` bei vorhandenem `reasoning`; live → `open` +
  „denkt nach…"; mit content → zugeklappt + „Gedanken"; **kein** `<details>` ohne `reasoning`.

## Self-Review

- **Placeholder-Scan:** kein TBD/TODO.
- **Konsistenz:** Reasoning-Routing ausschließlich in `chat_client`/`ThinkSplitter`; `ChatSession` sammelt,
  `ChatView` zeigt. History-Pfad unverändert ⇒ Reasoning fließt nie ans LLM zurück. `parseSSE` bleibt rein,
  Zustand isoliert im `ThinkSplitter`.
- **Scope:** ein Plan. Kein Settings-Toggle, keine Pro-Block-Dauer (beide explizit ausgegliedert).
- **Ambiguität:** „live" = letzte Nachricht & `content===""` & kein `error`; Quelle = beide Kanäle in
  **einen** Reasoning-Strom; Rückgabe von `stream` ist `{content, reasoning}` (Bruch des alten `string`-
  Rückgabewerts — `ChatSession` ist der einzige Aufrufer und wird mitgezogen).
