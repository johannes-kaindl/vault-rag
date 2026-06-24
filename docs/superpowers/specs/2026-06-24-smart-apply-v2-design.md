# Smart Apply v2 — Relevanz-Rangliste + selbsterklärende Vorlagen — Design

**Goal:** Den Smart-Apply-Einstieg von „erst klicken, dann erfährt man, welche Vorlage passt" zu
**„Sidebar auf → relevanteste Vorlagen nach Relevanz sortiert sichtbar, oberste vorausgewählt → ein
Tap anwenden"** machen — und Vorlagen zu **selbsterklärenden** Artefakten aufwerten, die dem LLM in
nicht-gerenderten `%%`-Kommentaren sagen, welche Inhalte wohin gehören. Letzteres senkt die
Routing-Unsicherheit und macht damit **gute Ergebnisse auch ohne Thinking** möglich — innerhalb des
bestehenden Non-Fabrication-Vertrags (das Modell routet nur Original-Blöcke, es schreibt keine Prosa).

Aufsetzend auf Slice 1 (Smart Apply, gemergt) + Slice 1.5 (Dashboard, gemergt). Zwei klar getrennte
Module: **Relevanz-Ranking (Erkennung + UX)** und **`%%`-Guidance (Prompt)**.

## Scope & Slicing

- **Slice 1.6 — Smart Apply v2 (diese Spec).** (a) Vorlagen werden im Cockpit als **Rangliste** nach
  Relevanz gezeigt, oberste vorausgewählt; Erkennung läuft **eager** beim Öffnen + Notiz-Wechsel.
  (b) Relevanz aus **direktem Vorlagen-Match** (aktive Notiz ↔ Vorlagen-Text). (c) Vorlagen erklären
  sich in `%%`-Kommentaren selbst (Routing je Überschrift + Hinweise je Frontmatter-Key); der Prompt
  liest diese **strukturiert** und gerahmt als Anleitung.
- **Slice 1.1 — Few-Shot-Konventionslehre (weiter zurückgestellt).** Bleibt unberührt.
- **Slice 2 — Reverse Template Synthesis (weiter zurückgestellt).** Das *automatische Schreiben*
  selbsterklärender Vorlagen aus N Notizen. Diese Slice baut die **Konsum-Hälfte** (`%%` *lesen*) —
  den natürlichen Vorläufer; das *Generieren* bleibt Slice 2 mit eigenem Zyklus.

## Entscheidungen (aus dem Brainstorming, ratifiziert)

- **UX A — Rangliste statt Dropdown.** Radio-Liste im Cockpit-Header: Top 3–5 Vorlagen sichtbar mit
  Score-Balken, **oberste vorausgewählt**, Rest hinter „weitere ▾". Ranking + Konfidenz sind ohne
  Klick sichtbar (explizit/deterministisch). Das heutige `<select>` (Slice 1.5) wird ersetzt.
- **Relevanz B — direkter Vorlagen-Match.** Score = Cosinus(aktive Notiz, Vorlagen-Text). Jede
  Vorlage rankt — auch brandneue ohne bestehende Notizen ihres Typs (behebt den „erscheint nie"-Fall
  des heutigen Vault-Vote). Der Vorlagen-Inhalt inkl. `%%`-Selbsterklärung prägt die Relevanz mit
  (Synergie zu Modul 2). Frontmatter-`type`-Treffer **pinnt** die zugehörige Vorlage hart nach oben.
- **`%%`-Reichweite — Body-Routing + FM-Hinweise.** `%%` je Überschrift = welche Original-Blöcke
  dorthin gehören; `%%` je Frontmatter-Key = Hinweis, was dort hingehört. **Form-/Stil-Umformung
  bleibt draußen** (bräche Non-Fabrication). FM-Werte bleiben **wörtlich aus der Notiz**.
- **Vorlagen-Embeddings — client-seitig lazy + gecacht.** Kein HyperForge-Eingriff. Die Vorlagen
  werden im Plugin eingebettet (über den bestehenden `EmbeddingClient`) und **mtime-keyed gecacht**;
  Re-Embed nur bei Vorlagen-Änderung. Passt zum „vault-rag standalone"-Pivot. *Verworfen:* Vorlagen
  in den statischen `_vaultrag/`-Export aufnehmen (koppelt an Backend-Reindex, verschmutzt
  Related-Notes).

## Architektur

Konsistent mit Slice 1/1.5: **Pure-Core (obsidian-frei, Node-testbar hinter `VaultAdapter` +
injizierten Clients) macht die Logik; eine dünne Obsidian-Schicht macht IO + Rendering.** Der einzige
destruktive Schreibvorgang bleibt `persistApply` in `smart_apply.ts` — **unverändert**.

1. **pure-core (neu):** `template_ranker.ts` — Relevanz-Ranking der Vorlagen + Embedding-Cache.
2. **pure-core (erweitert):** `template_matcher.ts` (`%%` strukturiert parsen statt verwerfen),
   `note_restructurer.ts` (`%%`-Guidance gerahmt in den Prompt).
3. **obsidian-view (erweitert):** `smart_apply_view.ts` (Rangliste statt `<select>`, eager Recompute).
4. **glue (erweitert):** `main.ts` (`active-leaf-change`-Event, `rankTemplatesForNote` als Dep
   verdrahten, Embedding-Cache anstoßen).

### Modul 1 — Relevanz-Ranking

**Neue pure-core-Funktion** (in `template_ranker.ts`):

```ts
interface TemplateRank { templatePath: string; type: string; score: number; source: "confirmed" | "match" | "fallback" }
interface RankDeps {
  listTemplates(): string[];                       // = templateFilesUnder(allMd, templateDir)
  read(path: string): Promise<string>;
  embed(text: string): Promise<number[]>;          // EmbeddingClient → toIndexVector (256-dim, normalisiert)
  embedTemplate(path: string): Promise<number[] | null>;  // gecacht, mtime-keyed; null = offline/Fehler
  noteType(noteText: string): string | null;       // extractType
  templateType(path: string): string;              // normalizeType(basename) bzw. extractType der Vorlage
}
async function rankTemplatesForNote(noteText: string, deps: RankDeps): Promise<TemplateRank[]>
```

**Datenfluss:**
1. Aktive Notiz-Body (ohne Frontmatter) einbetten → `vec`. Schlägt das fehl (Embedder offline) →
   **Fallback** (siehe Fehlerbehandlung).
2. Für jede Vorlage: gecachtes Vorlagen-Embedding holen → `score = cosine(vec, tplVec)`.
   Vorlagen ohne Cache-Treffer (noch nicht/nicht einbettbar) bekommen `score = 0`, bleiben aber
   gelistet (am Tabellenende), damit manuelle Wahl immer möglich ist.
3. Hat die Notiz ein `type:`, das auf eine Vorlage matcht → diese Vorlage wird mit `source:"confirmed"`
   **an Position 1 gepinnt** (überschreibt den Cosinus-Rang), Score auf 1.0 angehoben.
4. **Normalisierung** der Cosinus-Scores auf `0..1` für die %-Balken (max-Normalisierung über die
   gerankten Kandidaten; der gepinnte confirmed-Treffer = 100 %). Absteigend sortiert zurückgeben.

Reuse: Cosinus aus `retriever`/`index` (normalisierte Vektoren → Skalarprodukt), `embedder.embed`,
`templateFilesUnder` (`template_matcher.ts:60-66`), `extractType` (`template_matcher.ts:18-25`).

**Embedding-Cache:** `template_ranker.ts` hält einen `Map<path, {mtime, vec}>`; `embedTemplate(path)`
liest mtime, gibt bei Treffer den Cache-Vektor, sonst bettet es `stripAnnotations(read(path))`-bereinigten
Vorlagen-Text ein (die `%%`-Marker selbst sind kein semantischer Inhalt fürs Ranking, ihre *Bedeutung*
steckt im umgebenden Text) und cached. Persistenz des Caches: in `data.json` unter einem eigenen Key
(klein, wenige Vorlagen); Invalidierung rein über mtime.

### Modul 2 — `%%`-Guidance im Prompt

**`template_matcher.ts`:** `parseTemplate` **verwirft `%%` nicht mehr global**. Erweiterung:
- `TemplateSection` bekommt ein optionales `guidance: string` (der `%%`-Text, der **direkt unter der
  Überschrift** / in deren Body-Platzhalter steht, Marker entfernt, getrimmt).
- Ein neuer `fmGuidance: Record<string, string>` (key → `%%`-Hinweis) wird aus dem Frontmatter-Block
  extrahiert (`%%`-Kommentar in derselben Zeile / direkt unter dem Key).
- Der **gerenderte/zuzuordnende** Body-Platzhalter bleibt frei von `%%` (Marker raus), damit
  `placeholder` weiter sauber ist. `stripAnnotations` (heute toter Code, `template_matcher.ts:10-15`)
  wird zur lokalen Helfer-Funktion für genau dieses Entfernen umgebaut + getestet.

**`note_restructurer.ts` (`buildRestructurePrompt`, heute `:211-242`):** Statt `tpl.raw` **verbatim**
zu dumpen (`:224-226`), eine **strukturierte, gerahmte** Repräsentation ausgeben:
- Pro Überschrift: `### <heading>` + (falls vorhanden) `Anleitung: <guidance>`.
- Pro Frontmatter-Key: `<key>` + (falls vorhanden) `Hinweis: <fmGuidance[key]>`.
- **Explizite Instruktion** im System-Prompt (neben `ANTI_FABRICATION`): *„`Anleitung:`/`Hinweis:`-Zeilen
  sind Vorgaben der Vorlage, KEIN zuzuordnender Inhalt. Nutze sie, um die nummerierten Original-Blöcke
  der Notiz den Überschriften zuzuordnen — erfinde nichts, schreibe keine Prosa."*
- **Rückwärtskompatibel:** Vorlage ohne `%%` → `guidance`/`fmGuidance` leer → der Block enthält nur
  Überschriften + Keys (semantisch äquivalent zum heutigen Verhalten, nur sauberer als Roh-Dump).

Der Non-Fabrication-Vertrag ist **unberührt**: Das Modell liefert weiter nur das JSON-Assignment;
`assembleBody` baut den Body aus Original-Blöcken; `%%`-Texte landen **nie im Output**. FM-Werte
durchlaufen weiter den `content|empty`-Gate (`smart_apply.ts:194-206`) — der `Hinweis:` hilft nur bei
der *Auswahl*, welcher Notiz-Inhalt zu welchem Key gehört, eröffnet aber **keinen** neuen
Fabrikations-Pfad.

### Modul 3 — View/UX (`smart_apply_view.ts` + `main.ts`)

- **Rangliste** ersetzt das Header-`<select>` (`smart_apply_view.ts:160-171`): Radio-Liste der Top-N
  (`N=5`) mit Emoji/Name + Score-Balken + %; „weitere ▾" klappt den Rest auf. `selectedTemplate` ist
  die angeklickte/vorausgewählte Vorlage; ein neues Flag `userOverrode` unterscheidet manuell vs. auto.
- **Eager Recompute:** neuer Render-Zustand „⏳ erkenne…" in der Listen-Region. `onOpen`
  (`:82-88`) **und** ein in `main.ts` registriertes `workspace.on("active-leaf-change")` triggern
  `recomputeRanking()`, **debounced (~400 ms)**. Bei Notiz-Wechsel wird neu gerankt und die neue
  Top-Vorlage vorausgewählt (`userOverrode` zurückgesetzt — der alte manuelle Pick galt der alten
  Notiz). Embedding-Last: ein Embed der aktiven Notiz pro (debounced) Wechsel — identisch zur heutigen
  Auto-Erkennung, nur eager statt lazy.
- **Apply-Flow unverändert:** „Auf aktive Notiz anwenden" → `runBuild(selectedTemplate)` → Diff-Gate →
  Anwenden/Erneut/Verwerfen/Rückgängig (`:414-456`), Stale-Guard/Single-Writer/Undo bleiben.
- Der heutige Lazy-Auto-Detect-Fallback in `proposeSmartApply` (`main.ts:404-432`) wird obsolet, weil
  die Vorlage jetzt **immer** vorausgewählt ist; der „vorlage-waehlen"/„keine-vorlage"-Pfad bleibt als
  Sicherung (0 Vorlagen → Hinweis „Vorlagen-Ordner in den Einstellungen setzen").

## Fehlerbehandlung

- **Embedder offline / `embed` wirft:** Ranking fällt **graceful** zurück — (1) gibt es einen
  Frontmatter-`type`-Treffer → diese Vorlage `source:"confirmed"`, Rest alphabetisch `score:0`;
  (2) sonst alle Vorlagen `source:"fallback"`, `score:0`, alphabetisch. Dezente Notiz in der Liste:
  „offline — Ranking nicht verfügbar, Vorlage manuell wählen". **Kein Blockieren**, manuelle Wahl
  immer möglich. (Konsistent mit heute: Auto-Detect war schon online-abhängig.)
- **0 Vorlagen / `templateDir` leer/falsch:** bestehender „keine-vorlage"-Hinweis + Verweis auf die
  Einstellung.
- **Vorlage nicht einbettbar (z. B. leer):** `score:0`, bleibt gelistet; keine Exception nach oben.
- **`%%` unbalanciert in einer Vorlage** (`%%` ohne schließendes `%%`): defensiv — der Parser behandelt
  den Rest als normalen Platzhalter (kein Crash); ein Unit-Test deckt das ab.

## Tests (TDD je Baustein)

- **`tests/template_ranker.test.ts` (neu):** Sortier-Reihenfolge nach Cosinus; Frontmatter-`type`-Pin
  schlägt Cosinus; Score-Normalisierung 0..1; Vorlage ohne Embedding bleibt gelistet (score 0); Cache
  invalidiert bei mtime-Änderung; Offline-Fallback (embed wirft → alphabetisch, kein Throw).
- **`tests/template_matcher.test.ts` (erweitert):** `parseTemplate` extrahiert `guidance` je Section +
  `fmGuidance` je Key; `placeholder` bleibt `%%`-frei; unbalanciertes `%%` crasht nicht; Vorlage ohne
  `%%` → leere Guidance.
- **`tests/note_restructurer.test.ts` (erweitert):** Prompt enthält `Anleitung:`/`Hinweis:`-Zeilen +
  die explizite „kein Inhalt"-Instruktion; Vorlage ohne `%%` → rückwärtskompatibler Prompt; `%%`-Text
  erscheint **nie** im `assembleBody`-Output.
- **View (headless, injizierte Closures, bestehendes Muster):** Rangliste rendert sortiert, Top
  vorausgewählt; „⏳ erkenne…"-Zustand; Recompute bei Notiz-Wechsel setzt `userOverrode` zurück.
- **Pflicht-Abschluss — echter E2E-Smoke:** Ein realer Lauf gegen ein **schwaches / non-thinking**
  lokales Modell mit einer selbsterklärenden Vorlage, der zeigt, dass die `%%`-Guidance das Routing
  ohne Thinking trägt. (Lesson: der echte Call fängt, was Spec/Plan/Review systematisch verpassen.)

## Out of scope (YAGNI / später)

- **Reverse Synthesis** (Vorlagen automatisch *schreiben*) → Slice 2.
- **Form-/Stil-Umformung** durch `%%` → bricht Non-Fabrication; eigener späterer Entwurf mit eigenem
  Schutz.
- **Hybrid-Relevanz** (Vault-Vote + direkter Match kombiniert) → erst, falls direkter Match in der
  Praxis zu dünn ist; nachrüstbar.
- **Few-Shot-Frontmatter-Vokabular** → bleibt Slice 1.1.
- **Geteilte Embedding-Cache-Persistenz über Geräte** (Sync) → der Cache ist gerätelokal/derived,
  rebaut sich bei Bedarf; kein Sync-Artefakt.

## Offene Detail-Klärungen (im Plan zu fixieren, nicht blockierend)

- **`%%`-Platzierungs-Konvention:** Guidance „direkt unter der Überschrift" vs. „im Platzhalter-Body".
  Vorschlag: beides akzeptieren, der erste `%%`-Block einer Section gewinnt; im Plan an einem Fixture
  festzurren.
- **N (sichtbare Top-Einträge):** Vorschlag `N=5`; final beim View-Bau.
- **Cache-Ort:** `data.json`-Key vs. kleine Datei unter `_vaultrag/`. Vorschlag: `data.json` (klein,
  gerätelokal, kein Sync nötig).
