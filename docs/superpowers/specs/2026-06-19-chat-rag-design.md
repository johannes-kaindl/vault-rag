# Slice B — RAG-Chat — Design

**Goal:** Ein Chat-Panel, das Fragen über lokale LLM-Generierung beantwortet, gegroundet in
Vault-Notizen (Retrieval). Ersetzt `local-gpt` + den Smart-Composer-Chat. Multi-Turn, streamend,
mit klickbaren Quellen.

**Architecture:** Eine Chat-Pipeline, in die drei austauschbare **Kontext-Strategien** einspeisen.
Generierung läuft im Plugin (ADR-009: HyperForge bleibt retrieval-only). Retrieval nutzt die
vorhandene Engine (`toIndexVector` + `Retriever.search`/`related` aus Slice A/Suche).

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`ItemView`), natives `fetch` mit
SSE-Streaming + `AbortController`, vitest + happy-dom. Kein neues npm-Paket.

## Entscheidungen (aus dem Brainstorming, ratifiziert)

- **Drei Kontext-Modi, eine Pipeline** über eine `ContextSource`-Abstraktion + Modus-Umschalter:
  **Auto-RAG** (Default, ganzer Vault) · **aktive Notiz** (+ verwandte) · **manuell gewählte Notizen**.
  Implementierungsreihenfolge nach Wert: Auto-RAG → aktive Notiz → gewählt.
- **Multi-Turn** mit Verlauf; bei Auto-RAG wird pro Nutzerfrage neu retrievt.
- **Ephemer:** Verlauf nur in der Session (in-memory), weg bei Schließen/Reload. **Kein Vault-Footprint**
  (vermeidet den Smart-Composer-Schmerz einer gesyncten Chat-DB).
- **Streaming:** Token-für-Token via SSE, abbrechbar (Stop-Button).
- **Citations:** Quellen-Chips unter der Antwort, Klick öffnet die Notiz.
- **Online-only:** braucht erreichbaren Chat-Endpoint (lokal/VPN); separater, konfigurierbarer
  Chat-Endpoint/Modell (OpenAI-kompatibel), getrennt vom Embedding-Endpoint.
- **Vereinfachung (bewusst):** `chatK` + `contextCharBudget` sind feste Settings — kein dynamisches
  Token-Counting pro Modell.

## ADR-Bezug

ADR-009: HyperForge bleibt retrieval-only; die Generierung (Chat) lebt im Plugin. Der Chat-LLM-Call
geht direkt vom Plugin an einen lokalen OpenAI-kompatiblen Endpoint (z. B. MLX/LM-Studio
`http://localhost:8080/v1`), getrennt vom Ollama-Embedding-Endpoint (`:11434`).

## Datenfluss

```
Nutzerfrage
  → ContextSource.assemble(query, deps) ── 1 von 3 Strategien ──► { text, sources[] }
  → ChatSession baut messages: [System-Prompt(+Kontext), …Verlauf, User-Frage]
  → ChatClient.stream(messages, onToken, signal) ── SSE /v1/chat/completions ──► Token-Strom
  → ChatView rendert die Assistenten-Nachricht streamend + Quellen-Chips (Klick öffnet Notiz)
```

## Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/chat_client.ts` | **neu** | `ChatClient(endpoint, model)`: `stream(messages, onToken, signal): Promise<string>` (SSE-Parse von `/v1/chat/completions`, `stream:true`), `ping()`. Pure SSE-Parser `parseSSE(buffer)` separat (testbar). |
| `src/context_source.ts` | **neu** | `assembleContext(mode, query, deps): Promise<ContextResult>` — 3 Strategien. `ContextResult = { text: string; sources: string[] }`. |
| `src/chat_session.ts` | **neu** | `ChatSession`: `messages: ChatMessage[]`; `send(query, onToken): Promise<void>` orchestriert assemble→Prompt→stream→append; `abort()`. |
| `src/chat_view.ts` | **neu** | `ChatView extends ItemView` (`VIEW_TYPE_CHAT`): Nachrichtenliste, Eingabe, Modus-Umschalter, Stop-Button, Quellen-Chips. |
| `src/settings.ts` | **ändern** | Sektion „Chat": `chatEndpoint`, `chatModel`, `chatK`, `contextCharBudget` + Defaults. |
| `src/main.ts` | **ändern** | `VIEW_TYPE_CHAT` registrieren, Ribbon + Command, Deps verdrahten (ChatClient aus Settings; ContextSource-Deps aus retriever/embedder/index/app). |

### Schnittstellen

```ts
// chat_client.ts
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export function parseSSE(buffer: string): { deltas: string[]; rest: string; done: boolean };
export class ChatClient {
  constructor(endpoint: string, model: string);
  ping(): Promise<boolean>;
  stream(messages: ChatMessage[], onToken: (t: string) => void, signal?: AbortSignal): Promise<string>;
}

// context_source.ts
export type ChatMode = "auto-rag" | "active-note" | "picked-notes";
export interface ContextResult { text: string; sources: string[] }
export interface ContextDeps {
  embed: (q: string) => Promise<Float32Array>;          // embed+toIndexVector, von main
  search: (qVec: Float32Array) => string[];             // Retriever.search → Pfade
  related: (path: string) => string[];                  // Retriever.related → Pfade
  read: (path: string) => Promise<string>;              // adapter.read
  activePath: () => string | null;
  picked: () => string[];
  k: number; budget: number;
}
export function assembleContext(mode: ChatMode, query: string, deps: ContextDeps): Promise<ContextResult>;

// chat_session.ts
export interface ChatSessionDeps {
  client: ChatClient;
  assemble: (mode: ChatMode, query: string) => Promise<ContextResult>;
}
export class ChatSession {
  messages: ChatMessage[];
  mode: ChatMode;
  send(query: string, onToken: (t: string) => void): Promise<{ sources: string[] }>;
  abort(): void;
}
```

`main` baut `ContextDeps.embed = q => toIndexVector([await embedder.embed([q]).then(v=>v[0])], index.dim)`
(Snapshot-Guards wie in `runSearch`), `search/related` über den `Retriever`, `read` über
`app.vault.adapter.read`.

## Prompt & Citations

System-Prompt (Kern): „Du beantwortest Fragen gegroundet in den bereitgestellten Notizen des Nutzers.
Wenn die Antwort nicht aus ihnen hervorgeht, sag das. Zitiere knapp." Danach ein Kontextblock —
je Quelle `## <pfad>` + gekürzter Text. `contextCharBudget` (Default 12000) deckelt den Gesamt-Kontext;
bei Auto-RAG anteilig auf die Top-`chatK` Notizen verteilt (jede Notiz gekürzt). `sources[]` werden
unter der Assistenten-Antwort als klickbare Chips gerendert.

## Zustände / Fehlerbehandlung

- **Chat-Endpoint nicht erreichbar** (`ping` false oder `stream` wirft) → Inline-Hinweis
  „Chat-LLM nicht erreichbar (lokal/VPN)"; Eingabe bleibt erhalten.
- **kein Index** (Auto-RAG ohne `retriever`/`index`) → Hinweis „Kein Index — HyperForge-Export nötig";
  Modus „aktive Notiz"/„gewählt" funktionieren weiter.
- **Stream-Abbruch** (Stop) → `AbortController.abort()`; Teilantwort bleibt stehen.
- **0 Retrieval-Treffer** (Auto-RAG) → Antwort ohne Grounding + Hinweis „keine passenden Notizen gefunden".
- `stream`-/Netzwerkfehler werden in `ChatSession.send` gefangen und als Fehlernachricht gerendert
  (View wirft nie selbst).

## Testing (TDD, vitest)

- `tests/chat_client.test.ts` — `parseSSE`: mehrere `data:`-Deltas akkumulieren, `[DONE]` setzt `done`,
  unvollständige Zeile bleibt in `rest`. `stream`: fetch-Mock mit ReadableStream → `onToken`-Sequenz +
  Volltext; HTTP-Fehler wirft; Abort bricht ab.
- `tests/context_source.test.ts` — Auto-RAG (Mock embed/search/read → Kontext enthält Pfade + Texte,
  `contextCharBudget` kürzt, `sources` = Treffer); aktive Notiz (+related); gewählte Notizen; leere Treffer.
- `tests/chat_session.test.ts` — `send` hängt User+Assistant an `messages`; Multi-Turn (zweiter `send`
  sieht Verlauf); `assemble` wird mit aktuellem Modus aufgerufen; Client-Fehler → Fehlerpfad.
- `tests/chat_view.test.ts` — rendert Nachrichten + Quellen-Chips + Zustände mit gemockten Deps
  (Muster `search_view.test.ts`); Stop-Button ruft `abort`.
- `tests/settings.test.ts` — neue Defaults (`chatEndpoint`, `chatModel`, `chatK`, `contextCharBudget`).

## Out of Scope (dieser Slice)

- **Umfangreiche Modell-Konfiguration** (mehrere Profile, Per-Modell-Parameter, Temperatur-UI etc.) —
  ausdrücklich späteres Nice-to-have; hier nur Endpoint/Modell/`chatK`/Budget.
- Inline-Composer (Slice C) · persistenter/exportierter Verlauf · Tool-Use/Agentik · Cloud-Modelle ·
  Multimodal · dynamisches Token-Counting.

## Gotchas

- **Streaming braucht natives `fetch`** — Obsidians `requestUrl` buffert (kein Stream). Der bestehende
  `EmbeddingClient` nutzt schon `fetch` gegen den lokalen Endpoint erfolgreich → CORS/Electron ok.
  Falls iOS-Webview `response.body.getReader()` nicht unterstützt → mobil Fallback auf non-streaming.
- Chat-Endpoint ist **getrennt** vom Embedding-Endpoint (anderer Port/Server möglich).

## Self-Review

- **Placeholder-Scan:** keine TBD/TODO.
- **Konsistenz:** `ContextResult`/`ChatMode`/`ChatMessage` durchgängig; `assembleContext` zentralisiert
  alle drei Modi (eine Pipeline). Retrieval reuse statt Duplikat. View wirft nie (Fehler in `send` gekapselt).
- **Scope:** ein Plan, aber größer (≈7 Tasks) — Kontext-Modi inkrementell (Auto-RAG zuerst). Modell-Konfig
  bewusst ausgegliedert.
- **Ambiguität:** `chatK`/`contextCharBudget` fest (kein Token-Counting); Chat-View in der rechten Sidebar;
  ephemerer Verlauf — alle explizit.
