# Smart Apply (Smart Templating — Slice 1) — Design

**Goal:** Eine unstrukturierte Notiz **bewusst** in eine etablierte Struktur überführen — in *einem*
Vorgang: Notiz-Typ erkennen → den **Body in die Struktur eines Templates umsortieren** → das
**Frontmatter** nach Vault-Konventionen füllen/normalisieren. Das Ergebnis erscheint hinter einem
**Preview/Diff-Gate**; die Originalnotiz bleibt unangetastet, bis der User explizit „Anwenden" klickt.

Adressiert den Kernschmerz „Capture ist leicht, Struktur nachziehen ist schwer". Erste Slice einer
größeren *Smart-Templating*-Fähigkeit.

## Scope & Slicing

- **Slice 1 — Smart Apply (diese Spec).** Template anwenden + Frontmatter füllen, Preview-Gate, eine
  Notiz. RAG wird für die **Typ-Erkennung** genutzt (nicht für Frontmatter-Werte).
- **Slice 1.1 — Few-Shot-Konventionslehre (zurückgestellt).** 0–3 gleichtypige Beispiel-Notizen via
  Retriever als Few-Shot, damit das LLM Emoji/kontrolliertes Vokabular/Link-Stil fürs Frontmatter
  *implizit* lernt. Bewusst aus Slice 1 ausgeklammert, bis der Reflow-Kern bewiesen ist (eigene Spec).
- **Slice 2 — Reverse Template Synthesis (zurückgestellt).** Aus N Beispiel-Notizen ein
  **selbsterklärendes** Template generieren (mit `%% … %%`-Annotationen als „eingebautem Prompt").
  Eigener brainstorming→spec→plan→TDD-Zyklus.

## Architektur

**Pure-Core (obsidian-frei, Node-testbar hinter `VaultAdapter` + injizierten Clients) macht die gesamte
Logik; eine dünne Obsidian-Schicht macht nur IO + Rendering.** Konsistent mit PROF-OBS-03/04 und dem
`VaultAdapter`-Prinzip aus AGENTS.md.

1. **pure-core:** `smart_apply.ts` (Orchestrator + *einziger* Writer), `template_matcher.ts`
   (Typ-Fallback + Template parsen + `%%`-Strip), `note_restructurer.ts` (Block-Split + Host-Zusammenbau
   + Konservierungs-Checks), `frontmatter.ts` (`yaml_lite`: parse/serialize/merge/diff). Kein
   `obsidian`-Import; jedes IO über injizierte Deps in der Form von `VaultAdapter` + `ChatClient.stream`.
2. **obsidian-view:** `smart_apply_view.ts` (`ItemView`, Diff-Gate, Live-Body-Streaming,
   Anwenden/Verwerfen/Erneut), `template_picker.ts` (FuzzySuggest, Schwester von `note_picker.ts`).
3. **settings:** `settings.ts`-Erweiterung.
4. **glue:** `main.ts` (registerView/Command/Ribbon, Deps zusammenstecken, der *eine*
   `VaultAdapter.write` beim Anwenden).

Der destruktive Schreibvorgang existiert an **genau einer Stelle**: `persistApply` in `smart_apply.ts`,
das die injizierte `write()` aufruft (`main.ts` reicht `app.vault.adapter.write` durch — nie
`vault.modify/create`). Alles vor „Anwenden" ist read-only.

## Kern-Mechanismus: Block-Permutation (Non-Fabrication als checkbare Invariante)

Das LLM eine ganze neue Notiz schreiben zu lassen, macht „hat es erfunden/verloren?" **unentscheidbar**.
Stattdessen:

1. Der **Host** zerlegt den Original-Body in **nummerierte, unveränderliche Blöcke** (`block_0…block_N`,
   Absatz-Ebene; Überschriften sind eigene Blöcke).
2. Das LLM liefert **nur eine strukturierte Zuordnung** zurück (JSON): pro Template-Überschrift die
   geordnete Liste der Block-IDs, plus die nicht zugeordneten Blöcke (`unassigned`), plus ein typisiertes
   Frontmatter-Objekt. **Es emittiert nie Body-Prosa.**
3. Der **Host** baut den Body **aus den Original-Bytes** dieser Blöcke zusammen — nie das Modell.

Damit ist Erfinden **per Konstruktion unmöglich**, nicht bloß per Prompt angewiesen. Geprüft wird mit
einer **Permutations-/Abdeckungs-Kontrolle**: `multiset(sections ∪ unassigned)` muss exakt
`{block_0…block_N}` sein; bewusst weggelassene Blöcke **müssen** in `unassigned` auftauchen und werden im
„Übrig"-Eimer angezeigt — nie still verloren. (Eine Byte-Konservierung `tokens(content) ⊆ tokens(original)`
ist durch den Host-Zusammenbau ohnehin garantiert und wird als **Unit-Test auf `assembleBody`** abgesichert,
nicht als Laufzeit-Check — die vom Host injizierten Überschriften-/Sentinel-Tokens sind dabei ausgenommen.)

## Entscheidungen (aus dem Brainstorming, ratifiziert)

- **Heimat: das vault-rag-Plugin** (nicht ein eigenes Plugin). Begründung: Das „Smart" *ist* Retrieval
  über dem Embedding-Index — Smart Apply ist RAG, kein bloßer SSE-Transport-Konsument wie das
  ausgegliederte `image-to-markdown`. Ein eigenes Plugin müsste entweder den Index-Apparat duplizieren
  (genau die Redundanz, die vault-rag abschafft) oder fragil `_vaultrag/` mitlesen. Es ist faktisch die
  in ADR-031 vorgesehene **Integrator-Stufe 2 (Struktur — Frontmatter/MOC)**.
- **Ein Fluss, kein Modus-Schalter.** Typ-Matching ist eine **Fallback-Kette**: (1) gültiges Frontmatter
  `type:` → dessen Template; (2) sonst → RAG schlägt den wahrscheinlichsten Typ vor; (3) **immer** ein
  FuzzySuggest-Picker mit vorausgewähltem Vorschlag — jederzeit überstimmbar. *Ein* konsistenter Ablauf
  ist vorhersehbarer als drei umschaltbare (Vorhersehbarkeits-Constraint).
- **Template-Datei = Struktur-Wahrheit.** Eine Markdown-Vorlage aus `Templates/` definiert sowohl die
  Frontmatter-Keys als auch die Body-Überschriften. **Kein separater `_types`-Schema-Parser** (YAGNI) —
  die Template-Datei ist die einzige Schema-Quelle.
- **RAG-Typ-Erkennung über normale Vault-Notizen** *(geklärt 2026-06-22)*. Typisierte Beispiel-Notizen
  liegen im normalen (indizierten) Vault; nur die Template-**Dateien** liegen in `Templates/` (vom Index
  ausgeschlossen) — die liest Smart Apply **direkt** via `VaultAdapter`, nicht über den Index.
- **Few-Shot zurückgestellt auf Slice 1.1** *(geklärt 2026-06-22)*. Slice 1 füllt Frontmatter nur aus dem
  **Inhalt** (source=`content`); kein Vokabular-Lernen, keine `same-type`-Filterung, kleinerer Prompt.
- **Kontrolle = Preview/Diff-Gate, nicht-destruktiv, eine Notiz.** `detect` + `propose` sind read-only;
  der Vorschlag lebt rein im Speicher (`ApplyProposal`) bis „Anwenden". Verwerfen/Schließen schreibt nichts.
- **Panel bleibt nach Anwenden offen** *(geklärt 2026-06-22)*: re-rendert als „angewendet" + In-Session-
  **Rückgängig**-Button (kein auf Klick verschwindendes Panel — vorhersehbarer; Undo gut auffindbar).
- **Host-seitiger, strukturierter Frontmatter-Merge** statt „dem Modell-YAML vertrauen". Bestehende
  Werte gewinnen; unbekannte Keys bleiben erhalten; ein **Serialize→Reparse-Self-Check verweigert
  unlesbares YAML** (harte Cockpit-YAML-Integritäts-Lehre).
- **Block-Granularität: Absatz-Ebene** (Überschriften als eigene Blöcke). Section-Ebene wäre zu grob zum
  Umverteilen, Satz-Ebene sprengt Prompt + Block-Zahl. Die Grenz-Regex ist eine getestete Einzelfunktion,
  später tunebar ohne den Vertrag zu berühren.
- **`source=content`-Match: whitespace+case+emoji-normalisierter Substring** des Original-Body/-Frontmatter.
  Exakt wäre zu spröde (das Modell trimmt/recased kopierte Titel), Token-Overlap zu lose. Derselbe
  Normalizer wie bei der Byte-Konservierung — einmal getestet, konsistent.

## ADR-Bezug

- **ADR-031** (hyperforge wird Reservoir, vault-rag wird Produkt): Smart Apply ist die konkrete
  **Stufe 2 (Struktur)** des dort skizzierten Integrators — vault-rag wächst „über reines Retrieval
  hinaus zum aktiven Integrations-Assistenten".
- **ADR-009** (HyperForge retrieval-only): Die Schreib-/Editier-Logik lebt im Plugin, nicht im Backend.
  Konsistent — Smart Apply schreibt im Plugin.

## Datenfluss

```
Command „Smart Apply auf aktive Notiz" (gated: settings.smartApplyEnabled)
  → Snapshot: originalText + günstiger Content-Hash (djb2, in-core)
  → detectType (pure, KEIN LLM):
        read note → Frontmatter scannen auf type:
        (a) gültiger type + passendes Template in templateDir → {source:'frontmatter', confidence:'confirmed'}
        (b) sonst: aktiven Body LIVE einbetten → Retriever.search(vec,{k,minSim,exclude})
                   → top-k Hits' frontmatter type: lesen → gewichteter Vote → {source:'rag', confidence:'likely'}
        (c) sonst → {source:'none'}                        (Index/Embedder offline → graceful)
  → template_picker (obsidian): IMMER FuzzySuggest über templateDir/*.md, Vorschlag oben (Label „(Vorschlag)")
        User wählt | Abbruch (null → Ende, nichts geschrieben)
  → SmartApplyView öffnet im rechten Leaf → core.propose():
        read Template → stripAnnotations(%% %%) → parseTemplate (keys + geordnete headings)
        splitBlocks(originalBody) → block_0..block_N
        buildRestructurePrompt(template, blocks)           (Anti-Fabrikations-Vertrag wiederholt)
        EIN streamSSE-Call via ChatClient.stream           (Body-Tokens streamen LIVE ins Panel)
  → Stream-Ende:
        parseAssignment(raw) → {sections→blockIds, unassigned, frontmatter{key:{source,value}}}
        harte Checks: assignment-parst · permutation/coverage (inkl. unknown id) · frontmatter-roundtrip
        assembleBody(template, assignment, blocks)          (NUR Original-Bytes; „(noch leer)"-Sentinel)
        mergeFrontmatter (Template-Reihenfolge, bestehende/unbekannte Keys erhalten, source-gating)
          → serialize → Reparse-Self-Check
        → ApplyProposal { proposedContent, fmRows, sectionDiff, unassigned, checks, hardOk }
  → View rendert Zwei-Flächen-Diff. „Anwenden" ist GESPERRT, solange hardOk=false.
  → „Anwenden“ → persistApply:
        re-read note, Hash vs. Snapshot. Mismatch → Abbruch „zwischenzeitlich geändert, bitte Erneut“.
        sonst: EIN write(notePath, proposedContent).
        Panel bleibt offen, re-rendert „angewendet“ + Rückgängig-Button (write(notePath, originalText)).
  „Verwerfen“ verwirft. „Erneut“ stößt den einen LLM-Call neu an (z.B. nach anderem Template).
```

## Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/smart_apply.ts` | **neu** | Pure Orchestrator + *einziger* Writer. `detect`, `propose(...)→ApplyProposal`, `persistApply(...)→ApplyResult` (Stale-Hash-Guard + 1× injizierter write + Undo-Closure), `abort()`. DI spiegelt `ChatSessionDeps`. Obsidian-frei. |
| `src/template_matcher.ts` | **neu** | Pure Fallback-Kette + Template-Parsing. `extractType` (lokale `FRONTMATTER_RE`, da chunkers nicht exportiert), `stripAnnotations` (`%% … %%`), `parseTemplate(md)→TemplateSpec`, `resolveTemplateForType` (emoji/case-normalisiert), `detectType(notePath, deps)→TypeSuggestion`. |
| `src/note_restructurer.ts` | **neu** | Non-Fabrication-Backbone. `splitBlocks(body)→SourceBlock[]`, `buildRestructurePrompt(...)→ChatMessage[]`, `parseAssignment(raw)→Assignment\|null` (toleranter JSON-Extrakt), `permutationCheck`, `assembleBody(...)→string` (nur Original-Bytes; Sentinel für leere Sektionen). |
| `src/frontmatter.ts` | **neu** | `yaml_lite`: `parseFrontmatter` (flache Skalare + einfache Listen), `serializeFrontmatter` (parsebares-YAML-Garantie: Quoten/Escapen von Werten mit `:`/`#`/führendem Emoji/`[[Links]]`), `mergeFrontmatter` (Template-Reihenfolge, bestehende/unbekannte Keys erhalten, source-gated), `diffFrontmatter→FmRow[]`. **Null neue npm-Deps.** |
| `src/smart_apply_view.ts` | **neu** | `SmartApplyView extends ItemView` (`VIEW_TYPE_SMART_APPLY`, rechtes Leaf). Zwei-Flächen-Diff (Frontmatter-Tabelle + Body-Sektions-Stack mit Herkunft + leer-Sentinel + „Übrig"-Eimer), Guard-Banner (Anwenden gesperrt bei `hardOk=false`), sticky Action-Bar, Live-Body-Streaming, einklappbarer Reasoning-`<details>`. Reuse von `chat_view`-Helfern (`createDiv/createEl/setIcon/setCssStyles`). |
| `src/template_picker.ts` | **neu** | `pickTemplate(app, templateDir, preselect)→Promise<string\|null>`. FuzzySuggest-Schwester von `note_picker.ts`: gleiches `settled`/`onClose`-`setTimeout(0)`-null-Muster; `getItems` auf `templateDir`-Präfix gefiltert; `setQuery(preselect)` **seedet** den Vorschlag (Obsidians Fuzzy-Ranking sortiert nach Score, garantiert *kein* Top-Sticking — der Vorschlag ist daher zusätzlich per „(Vorschlag)"-Label/`getItemText` markiert, nicht nur per Query). |
| `src/settings.ts` | **ändern** | `VaultRagSettings` + `DEFAULT_SETTINGS` erweitern: `smartApplyEnabled`(false), `templateDir`('Templates/'), `smartApplyTemperature`(0). Neue Sektion „Smart Apply" über `build*`-Line-Builder im bestehenden Muster. Reuse `chatEndpoint/chatModel` (read-only Hinweis + bestehender Ping) + `embeddingEndpoint/embeddingModel`/`minSim`/`exclude`. |
| `src/main.ts` | **ändern** | `registerView(VIEW_TYPE_SMART_APPLY)`, `addRibbonIcon('wand-2')`, `addCommand('smart-apply-active-note')` (Active-Note-Guard) — alles hinter `settings.smartApplyEnabled`. `SmartApplyDeps` zusammenstellen (read/write via `app.vault.adapter`, stream via `chatClient`, search via `retriever`, embed via `embedder`, `listTemplates` via `getMarkdownFiles` gefiltert, `pickTemplate`). `activateSmartApplyView()` analog `activateChatView()`. |
| `tests/template_matcher.test.ts` | **neu** | type-Short-Circuit; RAG-gewichteter Vote; none-Fallback; `%%`-Stripping (multiline); `parseTemplate` keys/headings; `resolveTemplateForType` emoji/case. Node, `VaultAdapter`-Mock + fake `search`. |
| `tests/note_restructurer.test.ts` | **neu** | `splitBlocks` deterministisch + Round-Trip; `assembleBody` byte-für-byte aus Blöcken + Sentinel; `permutationCheck` (Duplikat/fehlend/unbekannt abgelehnt, Drops müssen in `unassigned`); Byte-Konservierung (Überschriften/Sentinel ausgenommen); `buildRestructurePrompt` enthält Template verbatim + Anti-Fabrikations-Klausel. Node. |
| `tests/frontmatter.test.ts` | **neu** | parse/serialize Round-Trip inkl. Emoji (`💻 Coding`), Wikilink (`up: [[X]]`), Listen; Quoting-Edge-Cases (`:`/`#`/führendes Emoji) reparse-stabil; `mergeFrontmatter` Präzedenz + preserve-unknown; `diffFrontmatter`-Klassifikation; Round-Trip-Self-Check verweigert Unparsebares; Notiz-ohne-Frontmatter → Frontmatter neu erzeugt. Node. |
| `tests/smart_apply.test.ts` | **neu** | e2e mit fake stream/adapter/search: gültige Assignment → `hardOk`, Body host-assembled, FM gemerged; unbekannte Block-ID → `hardOk=false`, Anwenden gesperrt; erfundener FM-Wert → Feld geleert; malformed JSON → graceful; `abort` propagiert; `persistApply` Stale-Hash → kein write; Happy-Path → genau 1× write; Undo restauriert; Idempotenz: re-run auf angewendeter Notiz → leerer Diff. Node. |
| `tests/smart_apply_view.test.ts` | **neu** | happy-dom + obsidian-Mock: beide Diff-Flächen rendern; Reihen stabil sortiert; Anwenden gesperrt bei `hardOk=false`; Live-Token-Append; Anwenden→`onAccept` 1×; Verwerfen schreibt nichts; Erneut re-runs; kein `innerHTML`/kein Inline-Style. |
| `tests/__mocks__/obsidian.ts` | **ändern** | `FuzzySuggestModal`-Stub (`open/setQuery/getItems/getItemText/onChooseItem/onClose`) + `Notice`-Stub + nötige `WorkspaceLeaf`/`setViewState`-Teile. Additiv; pure-cores bleiben DOM-frei. |

## Schnittstellen (Kern)

```ts
// --- template_matcher.ts ---
export interface TemplateSection { heading: string; level: number; placeholder: string }
export interface TemplateSpec { type: string; keys: string[]; sections: TemplateSection[]; raw: string }
export function stripAnnotations(text: string): string;          // %% ... %% (multiline) entfernen
export function extractType(noteText: string): string | null;    // lokale FRONTMATTER_RE → /^type:\s*(.+)$/m
export function parseTemplate(text: string): TemplateSpec;
export type SuggestionSource = "frontmatter" | "rag" | "none";
export interface TypeSuggestion {
  type: string | null; templatePath: string | null;
  source: SuggestionSource; confidence: "no" | "likely" | "confirmed";
}
// Critic-Fix: Retriever hat kein related(vec). Erkennung bettet die (evtl. unindizierte) aktive
// Notiz LIVE ein und ruft search(vec, opts) — NICHT related(path), das bei neuen Notizen leer liefert.
export interface DetectDeps {
  read: (p: string) => Promise<string>;
  listTemplates: () => Promise<string[]>;                        // *.md unter templateDir
  embed: (text: string) => Promise<Float32Array>;
  search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
  typeOf: (p: string) => Promise<string | null>;                 // read + extractType, auf top-k gecappt
}
export function detectType(notePath: string, deps: DetectDeps): Promise<TypeSuggestion>;

// --- note_restructurer.ts (Non-Fabrication-Backbone) ---
export interface SourceBlock { id: string; text: string }
export type FmSource = "content" | "empty";                      // (Slice 1.1 ergänzt "vocab")
export interface FmAssignedValue { source: FmSource; value: string }
export interface Assignment {
  version: number;
  sections: { heading: string; blocks: string[] }[];
  unassigned: string[];
  frontmatter: Record<string, FmAssignedValue>;
}
// HART (blockieren hardOk → Anwenden gesperrt): assignment-parse, permutation, fm-roundtrip.
// WEICH (blockiert nicht; zwingt nur das betroffene Feld auf leer): fm-source.
export type CheckId = "assignment-parse" | "permutation" | "fm-roundtrip" | "fm-source";
export interface CheckResult { id: CheckId; ok: boolean; detail?: string }
export function splitBlocks(body: string): SourceBlock[];        // Absatz-Ebene, Überschriften eigene Blöcke
export function buildRestructurePrompt(tpl: TemplateSpec, blocks: SourceBlock[]): ChatMessage[];
export function parseAssignment(raw: string): Assignment | null; // toleranter JSON-Extrakt aus dem Stream
export function permutationCheck(allIds: string[], a: Assignment): CheckResult;
export function assembleBody(tpl: TemplateSpec, a: Assignment, blocks: SourceBlock[]): string; // nur Original-Bytes

// --- frontmatter.ts (yaml_lite) ---
export type FmValue = string | string[];
export interface ParsedFrontmatter { data: Record<string, FmValue>; order: string[]; body: string }
export function parseFrontmatter(text: string): ParsedFrontmatter;   // keine Delimiter → {data:{},order:[],body:text}
export function serializeFrontmatter(data: Record<string, FmValue>, order: string[]): string; // parsebares YAML
export function mergeFrontmatter(
  tplKeys: string[], original: ParsedFrontmatter, llm: Record<string, FmAssignedValue>,
): { data: Record<string, FmValue>; order: string[] };  // preserve-existing + preserve-unknown sind INVARIANTEN
export type FmChange = "unveraendert" | "geaendert" | "neu" | "entfernt";
export interface FmRow { key: string; original?: FmValue; proposed?: FmValue; change: FmChange }
export function diffFrontmatter(original: ParsedFrontmatter, proposed: { data: Record<string, FmValue>; order: string[] }): FmRow[];

// --- smart_apply.ts (Orchestrator + einziger Writer) ---
export interface ApplyProposal {
  notePath: string; templatePath: string; type: string;
  originalText: string; originalHash: number;
  proposedContent: string;                          // host-assembled; "" gdw. ein harter Check fehlschlug
  fmRows: FmRow[];
  sectionDiff: { heading: string; blockIds: string[]; provenance: string | null }[];
  unassigned: SourceBlock[]; checks: CheckResult[]; hardOk: boolean; reasoning: string;
  detection: { source: SuggestionSource; confidence: "no" | "likely" | "confirmed" };
}
export interface ApplyResult { written: boolean; reason?: "stale" | "blocked"; undo?: () => Promise<void> }
export interface SmartApplyDeps {
  client: () => ChatClient;
  read: (p: string) => Promise<string>;
  write: (p: string, data: string) => Promise<void>;             // VaultAdapter.write — EINZIGER Writer
  listTemplates: () => Promise<string[]>;
  typeOf: (p: string) => Promise<string | null>;
  embed: (text: string) => Promise<Float32Array>;
  search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
  params: () => { model: string; temperature: number; suppressThinking: boolean };
}
export class SmartApply {
  constructor(deps: SmartApplyDeps);
  detect(notePath: string): Promise<TypeSuggestion>;
  propose(notePath: string, templatePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void): Promise<ApplyProposal>;
  persistApply(p: ApplyProposal): Promise<ApplyResult>;          // Stale-Hash-Guard + 1× write + Undo-Closure
  abort(): void;
}

// --- view + picker ---
export const VIEW_TYPE_SMART_APPLY = "vault-rag-smart-apply";
export interface SmartApplyViewDeps {
  build: (notePath: string) => Promise<ApplyProposal>;
  accept: (p: ApplyProposal) => Promise<ApplyResult>;
  reroll: (p: ApplyProposal) => Promise<ApplyProposal>;
  openPath: (p: string) => void;
  abort: () => void;
}
export function pickTemplate(app: App, templateDir: string, preselect: string | null): Promise<string | null>;
```

## LLM-Vertrag

- **Genau ein** streamender Call via `ChatClient.stream(messages, onContent, onReasoning, signal, opts)` →
  `streamSSE` (XMLHttpRequest; `fetch` ist gesperrt). Typ-Erkennung nutzt **kein** LLM.
- **Output = strukturiertes JSON, kein Freitext.** Das Modell bekommt: (1) die Template-Struktur (geordnete
  Headings + Frontmatter-Keys + Key-Beschreibungen, `%%` vorab gestrippt), (2) den Body in **nummerierten
  Blöcken** `block_0…block_N`, (3) den wiederholten Anti-Fabrikations-Vertrag. Es liefert ein einzelnes
  gefenctes JSON: `{ version, sections:[{heading, blocks:["block_3"]}], unassigned:["block_7"],
  frontmatter:{ type:{source:"content",value:"…"}, up:{source:"content",value:"[[Parent]]"}, tags:{source:"empty"} } }`.
- **Frontmatter source-gating (Slice 1, ohne few-shot):** `source=content`-Werte müssen ein
  (normalisierter) Substring des Body/bestehenden Frontmatters sein; sonst wird das Feld auf leer/Platzhalter
  gezwungen. `source=empty` bleibt leer. (`source=vocab` kommt erst mit Slice 1.1.)
- **Temperatur** = `smartApplyTemperature` (Default 0). Idempotenz-Hebel ist primär der strukturierte
  Vertrag + der kanonische Serializer; Temperatur 0 ist Best-Effort (backend-abhängig).

## Preview/Diff-Gate (UX)

Dediziertes **Panel im rechten Leaf** (kein Modal — räumlich stabil, Re-Runs landen im selben Leaf). Layout
**jeden Lauf identisch**, oben→unten: Header (Notizname + Typ-Chip + Quelle-Badge: „aus type:" / „Vorschlag
(RAG)" / „manuell") → Status-Zeile (Reuse `chat_view`) → Guard-Banner (grün „alle Prüfungen bestanden" |
rote Liste fehlgeschlagener Checks; **Anwenden gesperrt, bis `hardOk`**) → **Frontmatter-Diff** → **Body-Diff**
→ „Übrig"-Eimer → sticky Action-Bar (Anwenden / Verwerfen / Erneut / Vorlage öffnen). Optionaler einklappbarer
Reasoning-`<details>`.

- **Frontmatter-Diff = Key-Tabelle**, eine Reihe je Key (Union aus Template- + Original-Keys), Spalten
  `key | original | vorgeschlagen`, je Reihe `unveraendert/geaendert/neu/entfernt` (farbiger Rand + `setIcon`),
  plus Herkunft (aus Inhalt / leer). Rendert **erst nach** Stream-Ende (halb-gestreamte Keys würden flackern).
- **Body-Diff = Sektions-Stack**, ein Block je Template-Überschrift mit Herkunft („umsortiert aus: <orig
  heading>"); Template-only-Sektionen zeigen einen gedämpften **„(noch leer)"-Sentinel** — was *nicht*
  befüllt wurde, ist **sichtbar**. Body **streamt live** rein; der Diff finalisiert bei Stream-Ende.
- **Granularität:** ganz-Notiz-atomares **Anwenden** in Slice 1 (passt zur „eine bewusste Operation"-
  Entscheidung). Gerendert wird sektionsweise zur Prüfung; committet wird der ganze Vorschlag auf einmal.

## Anwenden & Sicherheit

- Der destruktive Write lebt in **genau einer** Funktion (`persistApply`), `main.ts` reicht
  `app.vault.adapter.write` durch — nie `vault.modify/create`. Das ist die **wieder hinzugefügte**
  Notiz-Schreib-Fähigkeit (eine Notiz, *nicht* das `image-to-markdown`-Batch-`writeTranscripts`).
- **Auf Anwenden:** (1) Notiz re-read + Hash vs. Snapshot. Mismatch (externer Edit/Sync) → Abbruch mit
  Notice „zwischenzeitlich geändert — bitte Erneut", Original unangetastet. (2) sonst **1×**
  `write(notePath, proposedContent)`. (3) Panel bleibt offen, re-rendert „angewendet" + **Rückgängig**
  (`write(notePath, originalText)` aus dem Snapshot) — 1-Step-Undo, gültig bis das Panel schließt oder ein
  neuer `propose` läuft. Längerfristig: Obsidian-File-Recovery / git.
- **Kein** Backup-Datei-/Readback-/Rollback-Apparat (als Slice-1-YAGNI gestrichen — wir lesen/schreiben nie
  in-place, ein `write`-Fehler lässt das Original auf der Platte; ein Notice meldet ihn).
- **Idempotenz:** deterministische Block-IDs + kanonischer Serializer → re-run auf angewendeter Notiz ergibt
  leeren Diff (Anwenden wird No-op).

## Fehlerbehandlung

- LLM offline / Stream abgebrochen / partiell → unvollständiger/leerer Content = fehlgeschlagener
  `assignment-parse`-Check → `hardOk=false`, Panel zeigt „abgebrochen", Original unberührt (spiegelt
  `ChatSession`-Abort).
- Malformed/Non-JSON-Assignment → `parseAssignment` null → Check fehlschlägt → Anwenden gesperrt, „Erneut".
- Template fehlt/unparsebar → freundliches Notice „Vorlage nicht in Templates/ gefunden" + Abbruch (keine
  Stub-Erzeugung — der einzige-Writer-Invariante zuliebe, als YAGNI gestrichen).
- Index/Embedder offline oder Notiz noch nicht indiziert → RAG-Stufe übersprungen, Kette fällt auf
  `source:'none'`, Picker öffnet ohne Vorauswahl. Degradiert sauber, blockiert nie.
- Frontmatter nicht emittierbar → `fm-roundtrip`-Self-Check fehlschlägt → `hardOk=false`; **nie unlesbares
  YAML schreiben** (Cockpit-YAML-Lehre).
- Notiz ohne Frontmatter → `ParsedFrontmatter{data:{},order:[],body}`; `serialize` erzeugt einen
  wohlgeformten Block + genau eine Leerzeile vor dem Body (eigener Test).

## Out of scope (Slice 1, bewusst — YAGNI)

- Few-Shot-Konventionslehre / Vokabular-Gating → **Slice 1.1**.
- Selbsterklärende `%%`-Template-**Autorenschaft** → **Slice 2** (Slice 1 *strippt* `%%` nur).
- Sektions-/feldweises Teil-Accept → ganz-Notiz-atomar.
- Batch / Mehr-Notiz-Apply → eine bewusst gewählte Notiz.
- Auto-Apply ohne Diff-Gate → Gate ist Pflicht.
- Backup-Datei + Readback + Rollback-Maschinerie → Gate + Stale-Guard + File-Recovery reichen.
- Zweiter LLM-Call für Typ-Erkennung → Erkennung ist Frontmatter → RAG-Vote → Picker, kein LLM.
- Separater `_types`-Schema-Parser → die Template-Datei ist die einzige Schema-Quelle.
- Zeilen-Diff-Modul (`diff.ts`) → der Body ist eine Permutation; Herkunfts-Label + Sektions-Stack genügen.
- Neue YAML-npm-Dependency → Repo hat null Runtime-Deps; ein getesteter `yaml_lite` (flache Skalare +
  einfache Listen) wird stattdessen ausgeliefert. Verschachtelte Maps degradieren opak statt zu korrumpieren.
- Integrator-Stufe-1-Linkschreiben (`## Verwandte Notizen`) / MOC-Platzierung → andere Slice.

## Teststrategie (TDD Default)

vitest + happy-dom; pure-cores in reinem Node (kein DOM, kein `obsidian`-Import); der obsidian-Mock nur für
View + Picker. Die pure-core-Tests sind das **primäre Vehikel** der Non-Fabrication-Garantie — jeder
Fehlermodus ist ein red-first-Test. Pro Modul ein Conventional Commit (red→green), nur berührte Dateien
stagen; vor jedem Commit `npm run typecheck` **und** `npm test` grün (fangen Verschiedenes), plus
`npm run lint` (kein `fetch`, kein `eslint-disable`, `plugin:any`).

Reihenfolge:
1. `frontmatter.ts` (+Test) — parse/serialize Round-Trip inkl. Emoji/Wikilink/Listen; Quoting-Edge-Cases
   reparse-stabil; `mergeFrontmatter`-Präzedenz + preserve-unknown; `diffFrontmatter`; Self-Check verweigert
   Unparsebares; no-Frontmatter-Fall.
2. `template_matcher.ts` (+Test) — type-Short-Circuit; RAG-gewichteter Vote (gefakte `search`); none-Fallback;
   `%%`-Stripping; `parseTemplate`; `resolveTemplateForType` emoji/case.
3. `note_restructurer.ts` (+Test) — `splitBlocks` deterministisch + Round-Trip; `assembleBody` byte-für-byte +
   Sentinel; `permutationCheck` (Duplikat/fehlend/unbekannt; Drops müssen in `unassigned`); Byte-Konservierung
   (Property-Test über zufällige gültige Assignments; Überschriften/Sentinel ausgenommen);
   `buildRestructurePrompt` enthält Template verbatim + Anti-Fabrikations-Klausel.
4. `smart_apply.ts` (+Test) — e2e mit fake stream/adapter/search (s. Komponenten-Tabelle).
5. `tests/__mocks__/obsidian.ts` — `FuzzySuggestModal` + `Notice` Stubs (additiv).
6. `template_picker.ts` — über den View-Test mitgedeckt (settled/onClose-null-Muster, preselect-Seeding).
7. `smart_apply_view.ts` (+Test) — beide Diff-Flächen; stabile Reihenfolge; Anwenden-Gate; Live-Token-Append;
   Anwenden/Verwerfen/Erneut; kein `innerHTML`/Inline-Style.
8. `settings.ts` (settings.test erweitern) — Default-Merge: neue Felder erscheinen mit Defaults auf altem
   `data.json` (Backward-Compat).
9. `main.ts`-Verdrahtung (Smoke; kein Live-Netz im Test — Stream immer injiziert).
```
