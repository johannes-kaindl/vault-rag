# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

## [0.37.0] — 2026-09-30

### Fixed

- **Reformatting no longer destroys wikilinks.** Links, embeds, inline code and code blocks go to the model only as placeholders and are put back after the answer. The result's links are then counted against the original: if a link is missing, changed or new, "Apply" stays disabled and the status line says how many (copying the text stays possible). **Visible consequence:** the base prompt of every LLM transform gained a sentence about the placeholders, so llm-lab's prompt-version hash changes for all of them.

### Added

- **New instant transform "Remove paragraph line breaks"** (Reformat, group "Instant · offline"): joins soft-wrapped lines of a paragraph into one line. Blank lines, headings, lists, quotes, tables, rules, indented code, `$$` formulas, hard line breaks (two trailing spaces or a backslash) and everything inside fenced code blocks stay untouched. Offline and deterministic, no model.
- The Smart Apply option "Keep provenance" now explains itself: a short line below the switch says that it marks what the model added or inferred (`%%erschlossen: …%%` comment and the `smartapply_erschlossen` frontmatter field).
- The GitHub release now also carries a ready-to-unpack `vault-retrieval.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.

### Changed

- **Model requests now come from a shared table instead of four separate switches.** What the plugin sends (temperature, top_p/top_k/min_p, reasoning effort, token budget) is decided by a table per model family (Qwen 3.8/3.6, Gemma 4, gpt-oss) and backend (LM Studio, Open WebUI, unknown) — one mode per call site: chat *grounded* (temperature 0.4, was 0.7), Smart Apply *structured* (0.1, was 0), reformatting *transform* (0.2, unchanged). **Visible consequences:** chat answers are a little more deterministic by default; the settings lose the chat temperature slider, the Smart Apply temperature slider, both "suppress thinking" switches and the "test thinking" action; a new collapsible section **Request** shows what is sent per mode and whether it takes effect on your backend, takes overrides per mode × model family, and shows the last request and deviations of the session (a notice appears once per session when the model thinks although thinking is off, or the server rejects the request). A temperature or "suppress thinking" value you had set is carried over on the first start (a temperature that differs from the old default becomes an override, with one notice). The Smart Apply token budget stays a setting. Family and backend come from the LLM Endpoint Manager if it is installed, otherwise the family is estimated from the model name and the backend is detected once per address.
- **The thinking button in the chat and Smart Apply tabs is the shared component now.** Its label says what is on ("Thinking off" / "Thinking: low"), a model family that cannot switch thinking off (gpt-oss) says so, and the new setting "Level picker in chat" swaps the button for a dropdown with all four levels. Switching models redraws it; showing the tab picks up changes made in the settings.
- Kit chat client 0.44.0 (no user-visible change).

## [0.36.0] — 2026-09-26

### Changed
- **Chat client and SSE transport now come from the kit** (`createChatClient`, obsidian-kit 0.43.0; the local `sse.ts` and the streaming part of `chat_client.ts` are removed). **Visible consequences:** there is a deadline for the first time — a server that stays silent for 120 s is cut off (600 s until the first byte, because LM Studio loads a model on the first call); the chat then shows "No answer from the chat LLM for … s" instead of hanging forever. If a server refuses the stream (origin check), the client retries once without streaming via `requestUrl`. An HTTP 200 response with an error body is now an error carrying the server message instead of an empty answer. The abort listener no longer stays attached to the signal.
- **`ttftMs` in the LLM Lab measures the first byte** instead of the first content token — for a thinking model the value is therefore earlier than before.
- **The index folder is hidden in the main window** (kit `folder-hide`, target `rootSplit.doc` instead of `activeDocument`): if a pop-out is in the foreground at load time, the rule no longer lands there. New check in the GUI smoke.
- The lab client (`lab-client`) now comes from the kit; if the lab is installed but speaks a different contract version, the kit client states the reason. Kit pin `obsidian-kit` 0.41.1 → 0.43.0, endpoint list CSS updated to the 0.43.0 state.

## [0.35.0] — 2026-09-26

### Added
- **Help row at the very top of the settings** (UI-STANDARD §8): a text button "Open documentation" linking to the documentation index and a bug icon linking to the issue tracker on GitHub. Kit module `help-setting.ts` from obsidian-kit 0.43.0, pinned individually; the other vendored modules remain unchanged.

## [0.34.0] — 2026-09-25

### Fixed
- **Recording in the LLM Lab was silently off.** `lab_client.ts` checked `apiVersion === 3`, while llm-lab has delivered 4 since 2026-09-03 — `readLabApi` therefore returned `null`, and chat, Smart Apply and reformatting reported nothing any more. Now raised to 4; every user action (a chat message, a Smart Apply run, a reformat) carries a fresh `turnId`. Measured on a running Obsidian 1.14.2 against the real llm-lab 0.6.0: the call shows up in its trace with `turnId`.

### Changed
- **Endpoints come from the LLM Endpoint Manager when it is installed** (kit `endpoint-source`, kit pin `obsidian-kit` 0.35.0 → 0.41.1, `code-kit` 0.6.0 → 0.7.0). Two roles, one call each: `chat` for chat, Smart Apply and reformatting, `embedding` for search and index. **Visible consequences:** if the manager is present, the settings show the manager component instead of the two endpoint lists (choose endpoint, choose model, adopt local endpoints into the manager); the choice is stored in `chatChoice`/`embeddingChoice` in `data.json`, keys and the manager model are never stored. Without the manager everything stays as before (local list as fallback). The manager also decides on "no endpoint" — there is then no silent fallback to the local list. A change in the manager is picked up without a restart.
- **The model guard also applies to the manager endpoint.** If the model of the embedding endpoint does not match the loaded index, it is not marked as active but keeps answering search requests; nothing is written to the index (write protection at persist, as with the local list). A manager endpoint without a model name never becomes active, so that a reindex does not stamp `embedding_model: ""`.
- The kit changes of the pin bump are additive for this plugin (key hook and extra row on the endpoint list, `installTabRefreshOnOpen`, sampling profiles); chat client and SSE transport remain untouched.

## [0.33.0] — 2026-09-24

### Fixed
- **`suppressThinking` no longer suppresses thinking on gpt-oss/harmony models** (`chat_client.ts`).
  These models reject `reasoning_effort`/`chat_template_kwargs`/`reasoning_budget` with HTTP 400
  instead of ignoring them as a no-op — so the request used to fail as soon as the thinking
  switch-off was active. Guard `isAlwaysOnThinker(effectiveModel)` (already vendored) before `suppressParams`, checked
  against the model name actually in use (`opts.model ?? this.model`).
- **Smart Apply: the disabled "Apply to active note" button now reads as disabled.**
  Until now it only carried the class `is-disabled`, which Obsidian's theme does not render on buttons — it
  looked active (measured on a running Obsidian 1.14.0, screenshot identical). Now
  `aria-disabled` plus a rule of its own (dimmed, cursor "not allowed", no clicks), the same
  disabled grammar as the mode buttons. Also applies to "Stop". The GUI smoke measures the visible
  state, not the class.

### Changed
- `authorUrl` in the manifest points to the GitHub profile again (return to the store).
- **Kit pin 0.31.0 → 0.35.0** (code-kit 0.5.0 → 0.6.0) — no functional changes to the
  existing vendor modules, only the stamp.
- **Smart Apply (running card) and the reformat preview now use the streaming
  answer area from the kit** (`buildStreamArea`, UI-STANDARD §8). Behaviour change:
  - The thinking block of Smart Apply still stays open during the stream; the running
    raw stream (the model's protocol JSON) is now **always visible** instead of behind a
    collapsed "raw stream" element — the kit area has no second, independently collapsible
    surface next to the thinking block.
  - The reformat preview is now **one** scroll area (the modal) instead of three nested ones
    (modal + two `overflow: auto` fields of its own); the result area scrolls with the modal
    (quick task from Johannes).
  - New in the reformat window: a copy button for the result, and result and original text
    can be explicitly selected.
- The thinking switch now shows its state without colour as well (icon, label,
  aria-pressed) — UI-STANDARD §8 "state button (toggle)". Affects the toggle in the
  chat panel and in Smart Apply: icon switches `brain` ↔ `brain-cog`,
  `aria-pressed="true|false"`, tooltip (`setTooltip`) instead of a bare `aria-label`, and for an
  always-on model additionally a native `disabled` with the reason in the tooltip. `brain-off` (the name
  originally given in §8) does not exist in the Obsidian bundle and renders empty
  (measured 2026-09-16) — `brain-cog` is the verified existing second member.

## [0.32.0] — 2026-09-07

### Added
- **Integrator (stage 1): link suggestions with a review inbox** — sixth tab in the sidebar
  (opt-in, setting "Enable Integrator"). For a note, the plugin fetches the semantically
  nearest notes from the index (offline, no LLM), filters out already linked and rejected targets
  and puts the rest into the inbox as a suggestion. **Accept** writes a wikilink into the note,
  **Reject** remembers the target for that note. No auto-apply: nothing is written without
  confirmation (umbrella scope: vault-rag supplies material, decides nothing).
  - Three triggers: automatically after every change for notes under the configured folders,
    the command "Suggest links for active note", the command "Suggest links for folders" (batch for
    existing notes). An empty folder list means: commands only.
  - Two write modes: **section** at the end of the note (factory default, heading configurable) or
    **frontmatter list property** (default `related`). In frontmatter mode only the
    lines of that one property are touched — everything else stays byte for byte; inline and
    block lists keep their form.
  - One suggestion per note (a new one replaces the old), stale protection by hash against changes made in the meantime,
    inbox device-local in the plugin folder (no vault footprint).
- **Plugin API:** `proposeLinks(path)` and `applyLink(path, target)` for other plugins — e.g. a
  future crew that takes over the unattended part. `apiVersion` stays 1 (additive).

## [0.31.0] — 2026-09-07

### Changed
- **The model now lives only in the endpoint row.** The global fields "Embedding model"
  and "Chat model" are gone; on the first start after the update the old value moves into
  every row that does not yet carry a model of its own (rows with a model stay as they are).
  The reason is the kit decision from obsidian-kit 0.29.0: a model name exists only on the
  endpoint that reports it — "global model plus per-row override" was the same information
  in two places with a precedence rule on top. The endpoint description and the docs no longer
  say "empty means global model".
  - The old keys are removed from the settings after the migration; otherwise it would run
    again on every start and refill a row model that had been deliberately cleared (measured on the
    running plugin).
- **Vendor layer on code-kit 0.5.0 / obsidian-kit 0.31.0** (previously obsidian-kit 0.27.0). Eight
  of the 15 pure modules no longer exist in obsidian-kit; `tools/sync-kit.sh` now reads them
  directly from code-kit. What reaches us from that: the chat understands reasoning deltas also under
  `reasoning` (MLX) and `thinking`, and servers that send whole messages despite `stream: true`
  no longer silently deliver nothing. The local `model_choice.ts` is swapped for the
  kit version (which had been in the tree since the endpoint editor anyway).
- **The endpoint row editor now comes from the kit** instead of a local copy. The
  module `obsidian/endpoint-list.ts` was moved into the kit on 2026-08-08 as "moved out of vault-rag" —
  this repo did not adopt its own extraction back for a month and a half and kept running the
  original (278 lines in `settings.ts`). It is gone; what remains here is only
  the language half, which maps the 22 text spots of the kit contract onto our i18n keys.
  - **No loss of function, and that was the real question:** everything this row carried beyond
    other consumers — "Use first", the role line, the third-party icon
    when a key is set, the per-row model override, the model guard against the
    index model — is parameterised in the kit. The nine open generalisations from the
    registry analysis of 2026-07-16 have meanwhile all been resolved there as well.
  - **Proven rather than claimed:** GUI smoke before the rebuild 34/34, afterwards 34/34, with an **identical
    set of checks** (names diffed, not just the totals compared) and the same single
    skipped check. Without a recorded baseline "green" could not have been told apart from "differently green".
  - Pulled along: the model list cache (`vendor/kit/model-list-cache` — likewise an
    extraction from this repo) and the CSS grammar, which is now called `okit-ep-*`.
- **Smart Apply now suppresses thinking by default.** Thinking and answer share the same
  `smartApplyMaxTokens` budget; at 4096 and a model that thinks at length it is exhausted
  **before** the answer begins — measured on 2026-08-23 with `google/gemma-4-26b-a4b-qat`:
  14,083 characters of reasoning, empty answer, 105.9 s runtime without a result. Smart Apply fills a
  JSON schema; a thinking phase beforehand brings nothing for that. The toggle already existed, it
  was just the wrong way round, and the field's description now says what switching it off costs.
  - **Deliberately without migration:** a missing field inherits the new default, an explicitly
    stored `false` stays. `data.json` holds only the value, not whether anyone
    set it — a migration could not tell the two cases apart and would thereby also reverse a
    deliberate decision. For this case the new finding carries the information.

### Added
- **A dedicated finding when the token budget was used up while thinking**
  (`reasoning-consumed-budget`, replaces `output-truncated` in this case). Both describe
  the same class but have different remedies: if the budget ran out during the *answer*,
  only a larger one helps; if it went on the *thinking phase*, switching thinking off is the
  closer remedy. The generic text only said "raise max tokens" — whoever followed it turned the
  budget up, and the model thought it away again the next time. Like `output-truncated`, a
  pure companion finding: it never enters `hardOk`.

### Fixed
- **The Smart Apply model was silently ineffective as soon as the chat row carried a model** —
  and it did in every setup with a row override. The precedence rule (row beats feature)
  dated from the time when the global field was the base; measured 2026-09-07 on a real
  vault, Smart Apply ran on the row model while the setting showed another one. Now
  the feature field wins. The price is stated: if a fallback endpoint does not know the name,
  Smart Apply fails loudly in its error box instead of silently switching to another model.

## [0.30.0] — 2026-09-05

### Added
- **The index now reports when a note has changed since it was embedded.** Until then
  a stale vector with an existing path was recognisable by **nothing**: CRC32 covers header
  and payload together and certifies a faulty state along with them, `diffIndexVsVault` is purely
  set-based, `findDeadVectorPaths` only sees zero vectors — search silently got worse
  while "Complete index" had nothing to offer. For this the container carries `[mtime, size]` of the
  note per row; on load the plugin compares against the current state, reports
  the deviations and queues them for re-embedding (as it already did for the dead rows).
  - **No format break:** the field is optional under the same `schema_version`. A container
    with stamps stays readable for every older plugin version — important, because the index folder
    is synced and a version bump there would have triggered the *danger state*.
  - **An index without stamps (built before this version) reports nothing**, instead of declaring the whole
    vault stale: unchecked is not suspicious. The stamps are created at the next
    reindex that is due anyway; none is forced.
  - **Cost at startup: none.** Obsidian supplies `mtime` and `size` from `TFile.stat` in
    memory. Measured on 2026-09-04 in the working vault: a content hash would instead have read all
    7200 notes (44 MB, 768 ms raw, many times that through the Obsidian layer).

- **The plugin API reports that a full reindex is currently running** (`status().reindexing`). Until then
  the rebuild was invisible from outside: `indexed` and `noteCount` stayed true and referred to the
  *previous* state — a third-party plugin could not distinguish between "index is finished and good"
  and "index is being replaced right now" and unknowingly passed on the old neighbourhood.
  Reported from the only consumer side (koda-agent) from a real parallel run.
  - **Deliberately a boolean, not a progress number.** "2900 of 6696" invites building a threshold
    ("from 80 % I trust the hits again") — and a judgement about hit quality
    belongs to the source, not the consumer. Progress is shown by the plugin's own UI.
  - **`indexed` stays `true`.** The new field qualifies it, it does not contradict it:
    during the rebuild there is still a usable index — the old one sits completely in
    memory, `related()` keeps computing on it offline. An "honest `false`" would mean "no
    index" and take the capability away from the consumer for hours.
  - **No `apiVersion` bump:** an additional field does not change the shape of the contract. Older
    plugin versions simply return `undefined` here.
  - Seen on the running system: `reindexing` is `true` during a real run
    and falls back to `false` when it ends.

- **A running full reindex can be cancelled** (command "Stop vault indexing").
  There was no way to do that before: no flag, no `AbortController`, and disabling the
  plugin did not end the running operation — it kept working through its list, occupied the
  embedding endpoint and at the end wrote its index into a plugin that no longer
  existed. The only available stop was reloading the whole vault window.
  - **A cancellation costs nothing.** The index stays *complete*: newly computed notes plus
    all those not yet reached with their previous vectors. Measured on the running system —
    cancelled after 32 of 168 notes, afterwards there were still 168 in the index.
  - Cancellation happens at the next group boundary, not in the middle of an embedding request:
    its vectors would otherwise be lost. Measured, the run ended 6 seconds after the command.
  - The command stays visible in the palette even when nothing is running, and explains that
    then — a command that disappears looks as if the feature did not exist.

### Fixed
- **A single note without a stamp no longer takes the stamps away from the whole index.** The
  stamp field is an array parallel to the paths, and `stampsFor` aborted at the first gap
  — the container was then written without any stamps at all. But `stampOf` returns
  `undefined` as soon as a note disappears from the vault between reading and stamping, and in
  a run over thousands of notes **one** is enough. The guard against stale vectors was
  thereby blind precisely in large, actively used vaults — that is, where it was built to work.
  - **Measured on 2026-09-05**, in two vaults with the same build: staging (18 notes, ~30 s)
    ⇒ 18 stamps in the container. Working vault (7,002 notes, ~10 h) ⇒ **none**. The three
    index backups of the run carried none either.
  - **The run reported nothing in the process:** container valid, CRC fine, vectors fresh, notice
    "N notes indexed". And at the next start the guard stays silent, correctly, because an index
    without stamps counts as *unchecked*, not as suspicious — the faulty state could not be told apart from
    a healthy one.
  - **Gaps now carry `[0, 0]`** and count as unchecked in the comparison. The objection behind
    the old solution ("an unstamped row must not be taken for inconspicuous")
    thus remains answered — the row is *marked* as unchecked instead of missing. No
    format break: the value is valid under the same `schema_version`, and `[0, 0]` cannot be a
    real note (mtime 0 would be 1970; a note of 0 bytes has no chunks and is never
    in the index).
  - **A legacy index stays without a stamp field**, instead of filling every row with placeholders:
    that keeps "never stamped" and "single gap" distinguishable and saves ~42 KB of header JSON
    without meaning at 7,000 notes.

### Changed
- **A full reindex bundles the chunks of several notes into one embedding request.** The
  embedding client has always batched internally to 32, but from the reindex it received only the chunks of *one*
  note at a time — typically 1–5 — and thus almost always ran idle. Measured on 2026-09-05 at the
  real endpoint (`qwen3-embedding:8b`, Ollama): **1 chunk costs 3.62 s, 32 chunks
  cost 4.68 s.** The call overhead dominates, not the work; a full reindex over ~7,200
  notes accordingly ran at ~0.5 notes/s.
  - **The splitting of the response is secured against offset.** The vectors are distributed to the notes by
    chunk count — if an endpoint returns more or fewer vectors than
    chunks, *every* assignment from there on shifts by the same amount. That is exactly the
    staircase-shaped misassignment that affected ~79 % of the working vault on 2026-08-30 and that
    CRC32 cannot see. If the length does not match, the run falls back to single processing:
    better slow and right than fast and wrong.
  - **One broken note does not drag its group down.** If the group request fails, the run retries
    note by note — `failed` thus keeps its earlier granularity instead of also reporting up to
    32 healthy notes.
  - Not touched: `healMissing` (delta reindex) still embeds per note. There it is
    about a few notes, and the rebuild would sit in the same write path.

### Fixed
- **A full reindex now maps the vault as it looks at COMPLETION — not as it did
  at the start.** `reindexAll` works through a path list snapshotted at the start and replaced the whole
  inventory at the end; everything that came in during the run dropped out in the process. Measured on
  2026-09-04 in three forms: a **newly created** note was missing afterwards, a
  **changed** one kept the (older) vector read during the run, a **deleted** one
  came back. Live handlers now record their paths during a run; on completion and at
  every intermediate state the live state wins against the snapshot.
  ⚠️ The "changed note" case was the dangerous one, because it was **silent**: the path is in the index, only
  the vector is stale — `diffIndexVsVault` is set-based and never sees that,
  `computeIndexDelta` reports "complete", `status()` still `indexed: true`. It healed
  neither on its own nor through "Complete index", only at the next full reindex.
- **A live update during the writing of an intermediate state is no longer lost.**
  `persistCheckpoint` re-pointed `this.noteVectors` to a temporary map for the duration of the write
  and restored the old state afterwards. Because there is an `await` in between
  and the reindex does **not** run under the live mutex (`runIndexOp`), a
  concurrent `handleModify` wrote into exactly the map that was discarded immediately afterwards.
  The re-pointing is removed without replacement — the map to be written is now
  passed as an argument (`persistVectors`), the time window no longer exists instead of being guarded.

- **`scripts/index-probe.ts` now keeps its promise of comparability** (maintainer tool).
  The docblock promised that a repeat run hits the same selection — but the Fisher-Yates shuffle
  drew `j = seed % (i + 1)`, so the *length* of the file list went into every position. A
  single additional note therefore shifted the whole selection; two runs before and after a
  full reindex shared not a single note and still read like an improvement.
  - The selection now orders by a hash per *path* instead of by position and lives in tested code
    (`scripts/probe_core.ts`) instead of in the `evaluate` string — before, it was structurally untestable.
  - `--wie <report.json>` measures exactly the notes of an earlier run and compares the ranks.
    Only that allows the statement "this note is healed"; notes that are missing in the second
    run are reported instead of swallowed.

## [0.29.1] — 2026-09-03

### Changed
- **GitHub-Ausstieg: beide READMEs zeigten ins Leere, alle acht Bilder waren tot.** Gemessen
  2026-09-03: `github.com/johannes-kaindl` antwortet mit **404**, und damit auch jede der 16
  `raw.githubusercontent.com`-Einbettungen — die READMEs waren nutzersichtbar kaputt, nicht nur
  unvollständig verlinkt. Alle 39 GitHub-URLs zeigen jetzt auf Forgejo
  (`raw/branch/main` für Bilder, `src/branch/main` für Dateien); jede ersetzte URL ist einzeln
  auf 200 geprüft, nicht nur umgeschrieben.
- **`authorUrl` → `https://jkaindl.de`.** Das Feld ist in Obsidians Plugin-Liste anklickbar und
  zeigte auf ein aufgegebenes Profil. Die alte Regel („nie die eigene Domain") hatte den
  Store-Review als Grund, und der findet für dieses Plugin nicht mehr statt.
- **Installationsweg ersetzt: Plugin-Katalog statt Community-Verzeichnis.** Beide bisherigen
  Wege waren tot — das Store-Listing ist verschwunden, und BRAT setzt den GitHub-Mirror voraus.
  An ihrer Stelle steht der eigene Katalog über
  [AnySource Sideloader](https://git.jkaindl.de/jkaindl/anysource-sideloader); der
  BRAT-Abschnitt ist ersatzlos entfallen. Manueller Weg und Bau aus dem Quellcode bleiben.

### Removed
- **CI-Badge aus beiden READMEs.** GitHub Actions ist nicht mehr erreichbar, und auf der
  Forgejo-Instanz läuft kein Runner. Das ist dieselbe Begründung wie bei seiner Einführung
  (CORE-META-02): ein Badge, der nicht auf einen echten Lauf zeigt, ist schlechter als keiner.

### Internal
- GUI-Smoke: läuft jetzt vollständig im Staging-Vault auf einer Zweitinstanz (34/34, Rezept in
  `docs/SMOKE.md`). Das Fixture trägt Plugin-Einstellungen mit je zwei Endpunkt-Zeilen
  (`docs/images/fixture/plugin/settings.json`), die Bilanz zählt übersprungene Prüfpunkte getrennt
  und mit Grund, und ein neuer Prüfpunkt belegt, dass die Reformat-Vorschau nach dem Verwerfen
  geschlossen ist. Fünf Treiber-Befunde behoben (Warten im Renderer, Sprachquelle, kollabierte
  Sidebar, kalter Chat-Endpunkt, Backslash im Template-String) — keiner am Plugin.
- **`scripts/index-probe.ts`** — Selbstfindungs-Stichprobe über den laufenden Index als
  wiederholbares Werkzeug. Misst, ob eine kurze Notiz sich über ihren *eigenen* Wortlaut auf
  Rang 0 findet, und wertet nach Änderungsdatum aus. Erster Lauf gegen 6.952 Pfade: 35/40 auf
  Rang 0; der treppenförmige Zeilenversatz vom 2026-08-30 ist weg, drei verbliebene Rückstände
  tragen einen konstanten Versatz von 4 Zeilen. Kein Auslieferungscode — Wartungswerkzeug.
- **Release läuft mit `--no-github`.** Store-Weg und Mirror-getriebenes Store-Release existieren
  für dieses Plugin nicht mehr; die Verteilung geht über den Forgejo-Release und den
  AnySource-Sideloader-Katalog.

## [0.29.0] — 2026-08-30

### Added
- **Der Index sagt jetzt, wenn seine Vektoren nicht mehr zu seinen Notizen gehören.** Bisher
  konnte er strukturell perfekt sein — CRC32 grün, Notizzahl plausibel, `indexed: true` — und
  trotzdem zu jeder Notiz die Ähnlichkeit einer *fremden* Notiz liefern. Die Trefferlisten sahen
  dabei nicht kaputt aus, sondern vertrauenswürdig: hohe Werte, zusammenhanglose Notizen. Zwei
  Wächter schließen die Lücke:
  - Notizen, die im Index stehen, aber einen unbrauchbaren Vektor tragen, werden beim Laden
    gemeldet und zum Neu-Einbetten vorgemerkt. Sie waren zuvor doppelt unsichtbar: nie
    auffindbar, und von der Vollständigkeitsanzeige als vorhanden gezählt.
  - Der GUI-Smoke prüft, ob eine kurze Notiz sich über ihren eigenen Wortlaut auf Platz 1 findet.
    Das ist die einzige Probe, die diese Schadensklasse überhaupt sieht.

### Changed
- **„Vault neu indizieren" verliert bei einem Abbruch nicht mehr den ganzen Lauf.** Bisher wurde
  der neue Index erst ganz am Schluss geschrieben — brach der Vorgang vorher ab, war die gesamte
  Rechenzeit verloren, auch wenn er kurz vor dem Ziel stand. Jetzt wird alle 250 Notizen ein
  Zwischenstand gespeichert; ein Abbruch kostet höchstens diese letzte Etappe, der Rest bleibt
  erhalten und wird beim nächsten Start übernommen.
  Der Zwischenstand ist dabei immer **vollständig**: die schon neu berechneten Notizen, ergänzt um
  die noch nicht erreichten aus dem bisherigen Index. Während des Laufs liefert die Suche
  unverändert den bisherigen Stand, damit die Ergebnisse nicht mitten in der Benutzung wandern.
  Wird das Embedding-Modell gewechselt, entfallen die Zwischenstände bewusst — dort würde ein
  gemischter Index zwei nicht vergleichbare Vektorräume enthalten.
- **Die Anbindung an „LLM Lab" verlangt jetzt dessen apiVersion 3** (der stabile Anteil des
  System-Prompts wird als `promptTemplate` gemeldet, damit das Lab daraus eine Prompt-
  **Fassung** statt eines einzelnen Aufrufs bilden kann — Chat, Umformatieren und Smart Apply
  melden dafür je ihren eigenen stabilen Anteil). Ist „LLM Lab" noch auf dem alten Vertrag
  (apiVersion 2, vor dessen nächstem Release), meldet vault-rag ab diesem Release **gar nichts
  mehr** ans Lab — genau wie ohne installiertes Lab, nur still, bis „LLM Lab" nachzieht.

## [0.28.0] — 2026-08-27

### Changed
- **Fünf lokale Fassungen sind durch die Module aus obsidian-kit 0.27.0 ersetzt** — die
  Fehlerkörper-Kaskade, der Callout-Bau, die Hub-Tab-Leiste und beide Kopier-Stellen. Vier davon
  waren Quellen der Kit-Extraktion; sie liefen hier weiter, während die Fixes, die beim
  Zusammenführen entstanden, nicht ankamen. Vendoring läuft ab jetzt über `tools/sync-kit.sh`
  statt per Handkopie, und beide Vendor-Verzeichnisse tragen einen einheitlichen Pin.
- **„In Callout einpacken" schreibt bei Leerzeilen `>` statt `> `** (ohne nachlaufendes
  Leerzeichen). Obsidian rendert beides identisch, im Dokument ist der Unterschied nur mit
  sichtbarem Whitespace zu erkennen — genannt wird er trotzdem, weil der Befehl in die Notizen
  des Nutzers schreibt und eine unbenannte Änderung dort nichts zu suchen hat.

### Fixed
- **„Kopiert" erscheint nicht mehr, wenn gar nichts kopiert wurde.** Beide Kopier-Knöpfe (MCP-Port
  im Chat-Panel, MCP-Konfiguration in den Einstellungen) zeigten die Erfolgsmeldung unbedingt,
  ohne das Ergebnis abzuwarten. Lehnt die Zwischenablage ab — Fokusverlust oder fehlende
  Berechtigung, im unfokussierten Fenster der Normalfall —, stand „Kopiert" bei leerer
  Zwischenablage. Jetzt erscheint die Meldung nach erfolgreichem Schreiben, und ein Fehlschlag
  meldet sich als solcher.
- **Ein Fehlerkörper mit leerem Fehlertext zeigt jetzt den Rohtext statt gar nichts.** Bei einer
  Antwort wie `{"error":""}` fiel die Serverbegründung vorher komplett weg: der leere String galt
  als Treffer, und der Rückfall auf den Rohtext griff deshalb nicht.
- **Ein Tab-Wechsel auf ein abgeschaltetes Panel leert den Hub nicht mehr.** Bei deaktiviertem
  Smart Apply konnte der Befehl einen Tab aktivieren, dessen Panel nie gebaut wurde — sichtbar
  wurde ein leerer Hub. Der Wechsel ist jetzt wirkungslos statt zerstörend.

### Accessibility
- **Die Hub-Tab-Leiste ist eine echte ARIA-Tabliste.** Tabs melden `role`/`aria-selected` und
  zeigen per `aria-controls` auf ihr Panel; die Navigation läuft über Pfeiltasten, Home und End
  (roving tabindex). ⚠️ Damit sind inaktive Tabs **nicht mehr per Tab-Taste** erreichbar — das ist
  das Standardverhalten einer Tabliste, aber eine Änderung gegenüber vorher.

## [0.27.0] — 2026-08-24

### Fixed
- **Gemma-Modelle werden nicht mehr fälschlich als „keine Vision" angezeigt.** Die Erkennung
  kannte nur die Ollama-Schreibweise (`gemma3:4b`). LM Studio liefert dasselbe Modell als
  `google/gemma-3-4b-it`, und die gesamte Gemma-4-Reihe fiel ebenfalls durch — beide wurden als
  vision-los geführt, obwohl sie Bilder verstehen. Die kleinen Text-Modelle (`3-1b`, `3-270m`)
  bleiben korrekt als vision-los erkannt, jetzt aus dem richtigen Grund statt zufällig.
- **„Auf aktive Notiz anwenden" ist gesperrt, solange keine Vorlage feststeht.** Wer klickte,
  während die Vorlagen-Erkennung noch lief, startete einen Lauf ohne Vorlage; das Panel fiel
  daraufhin still in den Ausgangszustand zurück. Von außen war das nicht davon zu unterscheiden,
  dass Smart Apply noch rechnet — was legitim zehn Minuten dauern kann. Wer eine Sekunde später
  geklickt hätte, hätte ein korrektes Ergebnis bekommen.
- **Das Öffnen der Einstellungen schreibt die Konfiguration nicht mehr.** Beim Zeichnen zog das
  Plugin die Obergrenze des Kontext-Budgets ans Modell nach und löste damit einen vollständigen
  Speichervorgang aus, ohne dass jemand etwas geändert hatte. Das zementierte einen fehlerhaften
  Zustand sofort auf die Platte und machte „die Konfigurationsdatei wurde geschrieben" als
  Hinweis bei der Fehlersuche wertlos. Eine echte Anpassung des Werts wird weiterhin gespeichert.
- **Ein abgebrochener Chat zeichnet den bis dahin erhaltenen Text auf** (nur mit installiertem
  „LLM Lab"). Bisher wurde ein per „Stopp" beendeter Lauf mit leerem Inhalt gemeldet — also
  ohne genau das, wofür man ihn nachsieht.

### Changed
- **Das Prüfgatter läuft jetzt bei jeder Änderung an `main`, nicht mehr nur beim Release.**
  Dazu prüft es neu, dass die Obsidian-Abhängigkeit auf die dafür vorgesehenen Dateien beschränkt
  bleibt — die Architekturregel dahinter stand bisher nur in der Dokumentation.
- **Die Anbindung an „LLM Lab" verlangt jetzt dessen apiVersion 2** (Endpunkt-Schlüssel zur
  exakten Maskierung, Kontext-Pfade für einen Ordner-Filter). Ist „LLM Lab" noch auf dem
  alten Vertrag (apiVersion 1, vor dessen Release 0.3.0), meldet vault-rag ab diesem Release
  **gar nichts mehr** ans Lab — genau wie ohne installiertes Lab, nur still, bis „LLM Lab" auf
  0.3.0 aktualisiert ist.

## [0.26.0] — 2026-08-23

### Fixed
- **Eine Vorlage, deren Überschriften Smart Apply nicht sieht, wird als solche gemeldet — statt
  als leeres Ergebnis.** Stehen die `##`-Überschriften einer Vorlage nicht je auf einer eigenen
  Zeile, erkennt das Plugin keine einzige. Bisher lief der komplette Weg trotzdem durch: das
  Modell wurde gefragt, und weil es keine Ziel-Überschrift gab, landete anschließend *jeder*
  Block unter „übrig". Das Ergebnis las sich als „0 von 8 zugeordnet" und war von einem
  Modell-Versagen nicht zu unterscheiden — es hat genau diese Fehldiagnose auch ausgelöst. Smart
  Apply bricht jetzt vor der Anfrage ab, nennt die Vorlage als Ursache und den nötigen Handgriff,
  und behauptet keine Zuordnung, die nie versucht wurde.
- **Smart Apply weist das Modell in der Sprache der Oberfläche an.** Der Prompt, der die
  Vorlage und die Notiz-Blöcke beschreibt, war fest deutsch gebaut — bis hinunter zu den
  Platzhaltern im Antwortschema. Wer Obsidian auf Englisch fährt, ließ damit eine englische
  Notiz nach einer deutschen Arbeitsanweisung aufräumen. Es ist dieselbe Stelle wie beim
  Chat-Prompt: ein Text, der nicht in die Oberfläche geht, sondern ins Modell. Die
  Konfidenz-Wörter, die das Modell zurückliefern soll, sind dabei bewusst Teil der
  Übersetzung geblieben — sie werden ausgewertet, und ein englischer Prompt, der deutsche
  Wörter verlangt, hätte jede Ergänzung still auf „niedrig" fallen lassen. Was in der Notiz
  landet (die Auffang-Überschrift, die Provenienz-Marker), bleibt unverändert: es steht
  bereits in bestehenden Notizen.
- **Der Chat antwortet in der Sprache der Oberfläche, nicht mehr grundsätzlich auf Deutsch.**
  Der ausgelieferte System-Prompt verlangte wörtlich „Antworte knapp und auf Deutsch." — wer
  Obsidian auf Englisch fährt, stellte eine englische Frage und bekam eine deutsche Antwort. Der
  Prompt wird jetzt erst bei der Anfrage aufgelöst und folgt der eingestellten Sprache. Ein selbst
  geschriebener System-Prompt bleibt unangetastet; wer den alten Vorgabetext nie verändert hat,
  findet das Feld künftig leer vor — leer heißt „die eingebaute Vorgabe gilt", und die
  Feldbeschreibung sagt das jetzt auch.

### Added
- **Die LLM-Aufrufe des Plugins können mitgeschrieben werden — wenn du das Plugin „LLM Lab"
  installierst.** Vault Retrieval meldet Chat, Umformatieren und Smart Apply an dessen API, sobald
  sie da ist; ohne das Nachbarplugin passiert nichts, und der Endpunkt-Testknopf ist ab Werk
  ausgenommen. Ein einziger Einhängepunkt (`ChatClient.stream`) erfasst alle drei Wege, jeder
  Aufruf trägt seine Feature-Kennung.
- **Die README ist bebildert** (acht Screenshots: Verwandte Notizen, Suche, Chat, sichtbares
  Denken, Umformatieren-Vorschau, Endpunkt-Rollen, Einstellungen und das Smart-Apply-Diff-Gate).
  Aufgenommen werden sie reproduzierbar per `npm run shots` gegen ein laufendes Obsidian; der
  Aufnahme-Vertrag steht in `docs/images/README.md`.

## [0.25.0] — 2026-08-21

### Fixed
- **Eine ins Token-Limit gelaufene Antwort wird nicht mehr als inhaltlicher Fehler gemeldet.**
  Wer mit Smart Apply in das selbst eingestellte Budget lief, las „LLM-Antwort enthält kein gültiges
  Assignment-JSON" und suchte den Fehler beim Modell — während die Ursache
  „Smart-Apply-Max-Tokens" heißt und eine Einstellung weiter oben in derselben Oberfläche steht.
  Die Prüfliste nennt den Abbruch jetzt beim Namen und beziffert das erreichte Limit. Der Befund
  begleitet nur einen echten Fehlschlag: eine abgeschnittene Antwort, die sich vollständig
  verwerten lässt, bleibt fehlerfrei.
- **Die Umformatieren-Vorschau weist auf ein abgeschnittenes Ergebnis hin**, statt es kommentarlos
  kürzer anzuzeigen. Das Ergebnis bleibt anwendbar — der Hinweis erklärt nur, warum es endet, wo es
  endet (das Token-Budget der Umformatierung ist fest verdrahtet und nicht einstellbar).

### Changed
- Der vendorte SSE-Parser steht wieder auf dem Kit-Stand mit `finish_reason` (obsidian-kit 0.3.0).
  Ohne das Feld ist ein Abbruch am Token-Limit von einer inhaltlich unbrauchbaren Antwort nicht zu
  unterscheiden — beides sieht am Empfänger identisch aus.
- **Die Selbstheilung des Index hat erstmals einen Prüfpunkt, der ihre Wirkung misst.** Getestet war
  bisher nur die Entscheidung, ob geheilt wird — der Fehler von August lag aber daneben, in der
  Ausführung. Der neue GUI-Prüfpunkt stellt den Schadensfall gegen ein laufendes Obsidian wirklich
  her und belegt, dass der Index ohne erreichbaren Endpunkt aus dem Backup zurückkommt.

## [0.24.0] — 2026-08-18

### Changed
- **Diagnose-Meldungen folgen jetzt der Sprachwahl** (i18n Teil 3). Die Sprachschicht aus 0.21.0/
  0.22.0 erfasste jeden Text, der *direkt* in eine Anzeige geschrieben wird. Entsteht ein Text
  dagegen als **Rückgabewert** einer Funktion und wird erst später angezeigt, liegt dazwischen
  keine Literalstelle mehr — für den automatischen Wächter unsichtbar. Betroffen war vor allem der
  häufigste Fall überhaupt: wer die Oberfläche auf Englisch stellte, bekam bei **jedem** nicht
  erreichbaren Endpunkt einen deutschen Tooltip. Dazu die Prüfliste unter einem Smart-Apply-Vorschlag
  und die Meldung eines fehlgeschlagenen MCP-Server-Starts.
- **Fehlermeldungen des MCP-Servers sind jetzt durchgängig englisch** — und bleiben es unabhängig
  von der eingestellten Sprache. Sie werden von einem Agenten über den Loopback-Kanal gelesen, nicht
  von einem Menschen in einer lokalisierten Oberfläche; sie an die UI-Sprache des Vaults zu koppeln
  wäre falsch.

### Fixed
- **Der Index wird jetzt auch dann automatisch aus einem Backup wiederhergestellt, wenn der
  Embedding-Endpunkt nicht erreichbar ist.** Bisher prüfte die Selbstheilung zuerst den Endpunkt und
  sah erst danach nach einem Backup — wer offline war (oder einen falsch eingetragenen Endpunkt
  hatte), blieb dauerhaft bei „kein Index", obwohl die Sicherung lokal danebenlag und nur von Hand
  eingespielt werden musste. Ein Backup zu übernehmen braucht kein Netz; nur das Nachtragen der
  seither hinzugekommenen Notizen braucht es.
- **Auf dem iPhone passiert dabei nichts.** Ein Gerät ohne eigenen Embedding-Endpunkt kann die
  Lücke nie selbst schließen — und weil der Index-Ordner mitsynct, wäre der ältere Stand von dort an
  alle Geräte zurückgewandert. Dort bleibt es deshalb beim Schreibschutz, und die Meldung sagt
  jetzt, dass die Reparatur am Desktop passiert und per Sync ankommt.
- **Die versprochene Nachbesserung findet jetzt wirklich statt.** Nach einer Wiederherstellung ohne
  Endpunkt meldete das Plugin, die seither hinzugekommenen Notizen würden automatisch ergänzt,
  sobald der Endpunkt antwortet — angestoßen wurde das aber nie. Diese Notizen landen jetzt in der
  Warteschlange, die das Plugin ohnehin im Minutentakt abarbeitet.
- **Ein wiederhergestellter Index trägt wieder den Namen des Modells, mit dem er gebaut wurde**,
  statt den des gerade eingetragenen Endpunkts. Andernfalls konnte der Schutz, der das Vermischen
  zweier Embedding-Modelle in einem Index verhindert, ihn beim nächsten Speichern nicht mehr
  erkennen.
- Die Meldung eines fehlgeschlagenen MCP-Server-Starts nannte den Grund doppelt
  (`(boom): boom`) — sie zeigt ihn jetzt einmal.


## [0.23.0] — 2026-08-13

### Added
- **Plugin-API für andere Obsidian-Plugins** (`app.plugins.plugins["vault-retrieval"]?.api`).
  Retrieval war bisher nur im Plugin selbst und über den MCP-Server erreichbar — Nachbar-Plugins
  mussten sich einen eigenen Embedding-Index bauen, um dasselbe zu können. Die neue Fläche ist
  bewusst schmal: `apiVersion` (1), `status()` (synchron und netzfrei — für die Frage „kann ich
  Retrieval überhaupt anbieten?"), `search(query)` und `related(path)`. Notiz-Lesen und rohe
  Embedding-Vektoren sind ausdrücklich **nicht** enthalten: ein Plugin liest das Vault über
  Obsidians eigene API, und Vektoren würden Aufrufer an Index-Dimension, Modell und Quantisierung
  binden — genau die Interna, die dieses Plugin frei ändern können muss.
  Erwartbare Zustände sind **Werte statt Ausnahmen** (`{ok:true,hits}` bzw. `{ok:false,reason}`
  mit `reason` aus `"no-index"`/`"offline"`/`"not-indexed"`), und `reason` ist ein
  maschinenlesbarer Code ohne übersetzten Text — ein fremdes Plugin kann unsere TypeScript-Typen
  nicht importieren und muss den Diskriminator zur Laufzeit anfassen können. Die Ausschluss-Liste
  aus den Einstellungen ist nicht überschreibbar (Nutzergrenze, kein Tuning-Parameter); Scores
  kommen ungerundet zurück, die Darstellung entscheidet der Aufrufer.
  Kein Zustimmungs-Tor: ein Plugin, das diese API aufrufen kann, läuft ohnehin mit vollem
  Vault-Zugriff — ein Tor schützte nichts Reales und kostete nur Klickwege.
  Neues Modul `src/plugin_api.ts` (obsidian-frei, dünner Adapter über die geteilte
  `RetrievalFacade`, exakt nach dem Muster von `mcp/tools.ts`), 17 Tests. Dokumentiert in beiden
  READMEs und unter `docs/reference/`.

### Notes
- Der Vertrag ist versioniert, aber jung: **Version 1 gilt als experimentell**, bis ein zweiter
  Konsument seine Form bestätigt hat (erster ist `koda-agent`). Das Versionsfeld existiert von
  Anfang an, weil es sich nachträglich nicht bruchfrei einführen ließe — die Stabilitätszusage
  ist die teure Hälfte und kann später folgen.
- `npm run smoke:gui` hat sechs neue Prüfpunkte, die die API über CDP im Renderer aufrufen —
  also auf demselben Weg wie ein fremdes Plugin, nicht über internen Code. Einer davon bewacht
  gezielt die Grenze: taucht `readNote` oder `embedQuery` in der Fläche auf, ist der Vertrag
  aufgeweicht worden.

## [0.22.0] — 2026-08-09

### Added
- **Englische Benutzeroberfläche für die reguläre Bedienoberfläche vollständig** (Panels,
  Einstellungen, Befehle, Meldungen, Statusleiste, Fehlertexte). Die zweite Runde der
  Sprachumstellung (siehe 0.21.0-Notiz) hebt die restlichen fest-deutschen Stellen auf die
  Sprachschicht: Endpunkt-Zeilen und -Rollen, Backup-Verwaltung, Statusleiste,
  Vervollständigen-Dialog, Chat-Fehlertexte, Smart-Apply-Panel (inkl. Block-Zählung), die
  Umformatieren-Vorschau, das Kontext-Panel des Chats und die Client-Auswahl im MCP-Setup. Rund
  250 Strings über 14 Dateien sind jetzt über `t()` geführt.
- **Regressionsschutz für die Sprachschicht:** ein struktureller Wächter-Test
  (`tests/i18n/no_german_ui.test.ts`) läuft über sämtliche `src/**/*.ts`-Dateien und meldet jede
  Text-Senke (Setting-Name, Tooltip, Button-Text, `aria-label`, `text:`/`label:`-Property), die
  ein String-Literal erreicht, ohne durch `t()` zu laufen — sprachunabhängig statt über eine
  Wortliste, die morgen schon veraltet wäre (`tests/i18n/sink_guard.ts`, aus Task 7 dieses Slices).

### Notes
- Eine Handvoll fest-deutscher Diagnose-Strings bleibt erreichbar: Smart-Apply-Guard-Details
  (`note_restructurer.ts`), Tooltips aus dem vendorten `endpoint_diagnostics.ts`, Fehlertexte aus
  dem vendorten `frontmatter.ts` und die MCP-Start-Fehlermeldung — Folge-Slice.
- Zwei bewusst deutsch gebliebene Stellen: die `Confidence`-Werte `hoch`/`mittel`/`niedrig` in
  `src/frontmatter.ts` (Frontmatter-Daten echter Notizen, keine UI) und die MCP-Tool-Beschreibungen
  in `src/mcp/register_tools.ts` (liest ein Agent, kein Mensch — gehören auf Englisch, aber in
  einen eigenen, kleinen Commit außerhalb dieses Slices).
- Die drei entfernten fest-deutschen `toLocaleString("de-DE")`-Aufrufe (Statusleiste) formatieren
  Zahlen jetzt ohne erzwungenes Locale — die Tausendertrennung folgt damit dem **Betriebssystem**,
  nicht der Obsidian-Oberflächensprache: ein deutsches Obsidian auf einer en-US-Maschine zeigt
  `● 1,000` innerhalb deutscher Sätze. Kein Regressions-Bug, falls das später auffällt.

## [0.21.0] — 2026-08-07

### Added
- **Englische Benutzeroberfläche — vault-rag spricht jetzt zwei Sprachen.** Bisher war die
  gesamte Oberfläche fest deutsch, unabhängig von der Spracheinstellung in Obsidian. Jetzt
  richtet sich das Plugin nach `Obsidian → Einstellungen → Über → Sprache`: **Englisch ist die
  kanonische Fassung**, Deutsch wird ausgeliefert, jede andere Sprache fällt auf Englisch
  zurück. Umgestellt sind die Einstellungen, alle Befehle der Befehlspalette, die Meldungen
  (Notices) des Plugins sowie die Text-Bausteine für Index-Delta und Umformatieren-Bereitschaft.

### Changed
- **Zahlen werden in der Sprache der Oberfläche formatiert** statt fest nach deutscher
  Konvention — eine englische Oberfläche zeigt `1,234` statt `1.234`.

### Notes
- Die Sprachumstellung ist **noch nicht vollständig**: ein Teil der Einstellungs-Zeilen, die
  Statusleiste sowie einige Zustandstexte im Smart-Apply-Bereich sind weiterhin fest deutsch.
  Diese Reste folgen in einer zweiten Runde.

## [0.20.0] — 2026-08-05

### Added
- **Endpunkt-Priorität ohne Löschen änderbar:** Jede Endpunkt-Zeile (ab Platz 2) bekommt einen
  „Zuerst verwenden"-Knopf, der sie an die Spitze der Fallback-Liste setzt. Da die Liste selbst
  die Priorität ist (der erste erreichbare Endpunkt gewinnt), war Umsortieren bisher nur über
  Löschen + Neuanlegen möglich. Jede Zeile zeigt außerdem ihre aktuelle Rolle als Text
  („aktiv" / „erreichbar, aber Platz N" / „nicht erreichbar" / „übersprungen — Modell passt nicht
  zum Index"), damit nie unklar ist, welcher Endpunkt gerade tatsächlich genutzt wird.

### Fixed
- **Aktiver Endpunkt war optisch nie markiert:** Die Hervorhebung setzte `font-weight` auf den
  Status-Icon-Container — der trägt aber nur ein SVG, auf dem `font-weight` wirkungslos ist. Die
  aktive Zeile sah daher genauso aus wie jede andere erreichbare. Die Markierung sitzt jetzt auf
  dem neuen Rollen-Text der Zeile, wo sie tatsächlich sichtbar wird.
- **Fehler des Chat-Endpunkts werden im Klartext gemeldet:** Bisher wurde jeder Fehlschlag durch
  „Chat-LLM nicht erreichbar (lokal/VPN)." ersetzt — auch ein HTTP 401 mit einer Begründung des
  Servers. Bei einem gehosteten Endpunkt zeigte diese Vermutung zusätzlich in die falsche
  Richtung. Jetzt nennt die Meldung Status und Serverbegründung („Zugriff verweigert (HTTP 401)
  — API-Schlüssel fehlt, ist ungültig oder abgelaufen. — Server: …"), sodass Adresse, Schlüssel,
  Pfad und Modellname unterscheidbar werden.
- **Rollen-Text folgte dem Modell-Override nicht:** Wurde das Modell einer Endpunkt-Zeile
  geändert, blieb die Rollen-Anzeige auf ihrem alten Stand — ein Embedding-Endpunkt, den der
  Modell-Guard bereits überspringt, meldete weiter „erreichbar, aber Platz N". Korrekt wurde es
  erst nach einem Neuaufbau des Einstellungs-Tabs.

## [0.19.0] — 2026-08-05

### Added
- **Externe LLM-Anbieter:** Endpunkte können jetzt einen API-Schlüssel und ein eigenes Modell
  tragen. Damit lassen sich OpenAI-kompatible Dienste (OpenRouter, Groq, Together, Mistral,
  OpenAI …) genauso in die Endpunkt-Liste eintragen wie lokale Server — die Liste bleibt eine
  Fallback-Kette, der erste erreichbare gewinnt. Der Schlüssel wird maskiert eingegeben und liegt
  wie alle Einstellungen unverschlüsselt in `data.json`.
- **Modellauswahl als Dropdown statt Freitext:** Alle vier Modellname-Felder der Einstellungen
  (Embedding-Modell, Chat-Modell, Smart-Apply-Modell, Modell-Override je Endpunkt-Zeile) zeigen
  jetzt eine Liste der vom Endpunkt gemeldeten Modelle statt eines Textfelds — bisher war das
  Endpunkt-Override der einzige Freitext dieser vier und damit tippfehleranfällig. Ist der
  Endpunkt nicht erreichbar, bleibt der gespeicherte Wert sichtbar, aber gesperrt; liefert er
  keine Modell-Liste, bleibt es beim Freitextfeld.
- **Modell-Schutz für den Embedding-Index:** Da ein Index an das Modell gebunden ist, mit dem er
  gebaut wurde, überspringt der Endpunkt-Resolver jeden Kandidaten, dessen Embedding-Modell nicht
  zum Index passt, und jeder Schreibvorgang (Live-Embedding, „Index vervollständigen") wird
  blockiert, wenn Container-Modell und Embedder-Modell auseinanderlaufen — Suche und Lesen laufen
  dabei unverändert weiter. Ein bewusster Modellwechsel läuft ausschließlich über
  „Vault neu indizieren" (Voll-Neuaufbau). Betrifft nur Embedding-Endpunkte; ein Modellwechsel bei
  Chat-Endpunkten bleibt folgenlos.

### Fixed
- **Backup-Rotation ließ leere Ordner zurück:** Beim Aufräumen alter Index-Backups blieb jedes
  Mal ein leerer Ordner stehen — über Wochen sammelten sich so 1309 davon an. Ursache: Obsidians
  Adapter kann ein Verzeichnis nur mit `recursive: true` entfernen; der bisherige Aufruf schlug
  auf **jedem** Verzeichnis fehl und der Fehler wurde stillschweigend verworfen. Das Entfernen
  läuft jetzt in einem Zug, und Fehlschläge werden protokolliert statt geschluckt. Dieselbe
  kaputte Aufrufform steckte im Aufräumen des alten Index-Ordners nach einem Pfadwechsel.

## [0.18.0] — 2026-07-29

### Changed
- **Index-Format:** Der Sync-Index ist jetzt EINE Container-Datei `_vaultrag/index.bin`
  (vorher drei: `notes.i8`/`paths.json`/`manifest.json`). Obsidian Sync kann damit keine
  inkonsistenten Mischzustände aus zwei Generationen mehr erzeugen — die Wurzel der
  wiederkehrenden Index-Beschädigung (Vorfälle 19.07./22.07.) ist beseitigt, nicht nur erkannt.
  Bestehende Indizes werden beim ersten Start automatisch und verlustfrei migriert.
  **Mixed-Version-Hinweis:** Ein Gerät, das noch eine ältere Plugin-Version läuft, zeigt bis
  zu seinem Update „kein Index" an (kein Datenverlust — Notizen sind unberührt).

### Added
- **Automatische Wiederherstellung:** Ist der Index beim Laden beschädigt (z. B. halber
  Sync-Download), stellt das Plugin ihn selbstständig aus dem neuesten per Prüfsumme
  verifizierten geräte-lokalen Backup wieder her und ergänzt fehlende Notizen per
  Delta-Reindex — sofern der Embedding-Endpoint erreichbar ist. Sonst wie bisher:
  Schreibschutz + Meldung.

## [0.17.4] — 2026-07-28

### Fixed
- **The confirmation dialog no longer calls the deprecated `setWarning()`.** The dialog was moved to
  the shared kit's `confirmAction` in the previous cycle, and that vendored copy reintroduced the very
  API the community-store review had flagged for 0.16.0 — invisible locally, because `eslint` exits 0
  on warnings. Fixed at the root in `obsidian-kit` 0.17.1 (`applyDestructive`, re-vendored here): the
  button is marked destructive through a runtime check — `setDestructive()` where Obsidian provides it
  (1.13+), otherwise the native `mod-warning` class. Calling either one unconditionally is wrong;
  `setDestructive()` does not exist on the supported floor of 1.12.7.

### Changed
- **`npm run lint` now fails on warnings** (`--max-warnings 0`). ESLint exits 0 on warnings, so the
  local gate reported green while the store scan — which is the same `eslint-plugin-obsidianmd` —
  reported findings. The very first run under the hardened gate caught the `setWarning()` regression
  above.

### Documentation
- **README updated to describe the plugin as it actually works.** It still documented four separate
  ribbon icons for related notes, search, chat and Smart Apply; those were consolidated into a single
  sidebar hub with tabs back in 0.8.0. Also corrected: the supported Obsidian version (1.12.7, not
  1.13), the default chat port (1234, not 8080), and the claim that the embedding index has to come
  from an external backend — the plugin builds it itself. Added a command reference and the index
  robustness features (persist guards, rotating backups, self-heal), which were undocumented.

## [0.17.3] — 2026-07-24

### Changed
- **`node:http` for the MCP server now loads via a `Platform.isDesktop`-guarded dynamic `import()`**,
  clearing the last **`no-nodejs-modules`** store-scorecard warning that 0.17.2's static import had
  traded the `require()` warning for. This is the only source form that passes **both** obsidianmd
  store-scan rules (`no-nodejs-modules` accepts a guarded dynamic import; `no-require-imports` sees no
  `require`). To keep the guarded import from breaking in Electron (esbuild leaves a bare
  `import("node:…")` untransformed, which Electron resolves as a network fetch), an esbuild plugin
  rewrites `node:` dynamic imports to a `require()` shim in the bundle — source stays scan-clean,
  bundle stays runtime-safe (identical to the `require()` path that shipped in 0.17.0). The local lint
  now runs both rules sharp with no per-file override, so `npm run lint` matches the store scanner.

## [0.17.2] — 2026-07-24

### Changed
- **`node:http` for the in-plugin MCP server is now a static `import` instead of a `require()`.**
  This clears the last **`require()` style import is forbidden** store-scorecard warning. Runtime is
  unchanged: esbuild places the import inside its `__esm()` lazy-init wrapper (`require("node:http")`
  inside `init_http_server`), so it still runs only when `main.ts` calls
  `await import("./mcp/http_server")` behind the `Platform.isMobile` guard — never at plugin load,
  never on mobile. `obsidianmd/no-nodejs-modules` is disabled for this one file, since its mobile
  safety is guaranteed structurally via `main.ts` rather than by the lint rule.

## [0.17.1] — 2026-07-24

### Changed
- **MCP read-guard now uses the Obsidian vault API instead of `node:fs`/`realpath`.** The
  desktop-only symlink-escape guard is replaced by a whitelist check
  (`vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile`) — pure Obsidian API, no
  Node built-in. This removes the **Direct Filesystem Access** store-scorecard warning and drops
  `node:fs/promises` and `node:path` from the source entirely (`require()` usage reduced from three
  sites to one; `node:http` for the in-plugin MCP server necessarily stays a `Platform.isDesktop`-
  guarded `require()`, as the official lint rule mandates it while the scan flags it — a
  documented contradiction in Obsidian's own tooling).

### Security
- **`read_note` over MCP no longer reads deleted notes** (`.trash/…`) or any path Obsidian does not
  list as a vault file. The new guard is stricter against path-traversal (only real vault files
  pass). Trade-off: an in-vault symlink pointing outside the vault — which Obsidian itself follows —
  is no longer specifically blocked (parity with Obsidian and comparable plugins); the MCP server
  remains token-authenticated and bound to `127.0.0.1`.

## [0.17.0] — 2026-07-23

### Changed
- **Settings tab migrated to Obsidian 1.13's declarative `getSettingDefinitions()` API.** Simple rows
  (sliders, toggles, dropdowns, the template-folder picker, the system-prompt textarea) are now
  declarative controls and therefore appear in Obsidian's **global settings search** on 1.13+. Dynamic
  rows (endpoint lists, model probing, the live embedding-status poll, model details/capabilities, the
  MCP section, the model-coupled context-budget slider) run through imperative render-hatches. The
  seven sections are no longer collapsible — the global search replaces collapsing.
- **Lowered `minAppVersion` back to 1.12.7 and made the tab dual-track.** On Obsidian ≥1.13 the tab
  renders declaratively and searchably; on ≤1.12 a `display()` fallback renders the *same*
  `getSettingDefinitions()` structure imperatively (one source of truth). Every 1.13-only API
  (`SettingTab.update`, `ButtonComponent.setDestructive`) is feature-detected at runtime, so the build
  is lint-clean under 1.12.7 without deprecated-API use. This reverses the 0.16.1 bump to 1.13.0, which
  — because 1.13 is currently only a Catalyst preview — effectively withheld updates from most users.

### Fixed
- Index-corruption notices now clearly name the **embedding/search index** and state that your notes
  are unaffected, instead of the ambiguous "vault-rag: Index" that read like the Obsidian vault index.

## [0.16.1] — 2026-07-20

### Changed
- **Bumped `minAppVersion` to 1.13.0.** Installations on Obsidian below 1.13 will no longer receive
  updates. Reason: `setDestructive()` — used for the three destructive-action buttons below — only
  exists from 1.13 onward.
- Cleared the remaining Obsidian community-store review warnings: `createSpan(…)` instead of
  `createEl("span", …)` at 7 call sites, and `setDestructive()` instead of the deprecated
  `setWarning()` at 3 call sites (reindex, MCP token regeneration, backup restore).
- Removed every `node:` import flagged by the store review's `no-nodejs-modules` lint. Node
  operations are now injected into the read-guard instead of imported at module top level, desktop-
  only code paths load Node built-ins via `await import(…)` inside `Platform.isDesktop` checks
  or with early platform guards instead of static imports or `require`, and the `node:http` type
  import was replaced with local structural interfaces. `npm run lint` now reports zero
  `no-nodejs-modules` occurrences.
- The MCP server now throws explicitly when started outside a desktop platform, instead of relying
  solely on its caller's guard.

### Not changed
Four points the store review flags are properties of the plugin or its dependencies, not bugs, and
were left as-is:
- **Direct Filesystem Access** — `fs.realpath` in the MCP server's symlink-escape guard; desktop-only
  and scoped to that one check.
- **Vault Enumeration** — the core function of a retrieval plugin.
- **Clipboard Access** — write-only (`writeText`), always user-initiated; the clipboard is never read.
- **Dynamic Code Execution** — `new Function` comes from `ajv`, pulled in via
  `@modelcontextprotocol/sdk`; not code of this plugin.

Also out of scope for this slice: `getSettingDefinitions()` (the declarative settings search
available from Obsidian 1.13) and the `display()` deprecation it would resolve — both are reserved
for a separate slice.

## [0.16.0] — 2026-07-20

### Added
- **Reformat a selection.** A new "Abschnitt umformatieren" command (and editor context-menu
  entry) turns a selected block into a different shape: mechanical transforms (table ↔
  columns/rows transpose, table → bullet list, wrap in callout) apply instantly with no LLM
  round-trip, while shape-changing ones (→ list, → prose, → table, → Mermaid diagram, or a free-
  text instruction) stream a preview from your local chat LLM that you review before applying.
- **Reformat sidebar tab.** The transforms are now launchable from a "Umformatieren" tab in the
  Vault Retrieval sidebar, grouped by effect (instant/offline vs. preview/LLM). Buttons are
  disabled with a plain-language reason when there is nothing to act on.
- **Model dropdown for Smart Apply.** The Smart Apply model is picked from the endpoint's model
  list instead of typed by hand, with an explicit "use chat model" option.
- **Waiting state in the reformat preview.** Until the first token arrives, the result area shows
  a running seconds counter, so a cold model start is distinguishable from a hang; after five
  seconds it adds a hint that the first call may still be loading the model. It deliberately does
  not claim the model *is* loading — the endpoint does not tell us whether it is loading or just
  thinking.

### Fixed
- **"Abschnitt umformatieren" no longer disappears from the command palette.** It used
  `editorCallback`, which Obsidian hides whenever no editor is focused — reading mode, or focus in
  the sidebar. It is now always listed and explains why it cannot run.
- **Replacements are guarded against a stale selection.** If the text at the captured position
  changed between selecting and applying, nothing is written and a notice explains why.

## [0.15.2] — 2026-07-19

### Fixed
- **Device-local index backups no longer accumulate indefinitely.** A backup snapshot could
  race against a concurrent live index write and leave an incomplete, empty folder behind
  instead of a real backup — and since rotation only ran after a successful copy, each failed
  attempt left another orphan. A real vault had accumulated 1127 backup folders instead of the
  intended 3 (1124 of them empty). Snapshots are now serialized against live index writes, and
  an incomplete copy is discarded immediately instead of left behind.
- **The shared index could get wiped out after using a second device (e.g. iPhone).** The
  live-persist safety guard checked a cached in-memory note count instead of the actual index
  on disk. If the plugin started before Obsidian Sync finished delivering the shared index, a
  subsequent edit could overwrite the real, larger index with a tiny one — which then
  propagated the loss to every synced device. The guard now reads the real index from disk
  immediately before every live write.

## [0.15.1] — 2026-07-14

### Fixed
- **Empty notes no longer count as a permanent index deficit.** Notes with no embeddable
  content (empty or frontmatter-only, e.g. folder notes) can never be indexed — but the
  index-state delta counted them as missing forever, and "complete the index" reported a
  confusing "0 notes added" while the button stayed enabled. The delta now excludes them
  (with an explicit "N empty notes ignored" hint), the self-heal reports honestly
  ("X added · Y empty skipped · Z failed"), and the auto-heal prompt on load only fires
  for genuinely embeddable gaps. The heal progress popup counts only real embedding work
  (e.g. "1/1" instead of "119/179"). Live edits keep the classification current: emptying
  a note moves it out of the tally, filling it moves it back in.

## [0.15.0] — 2026-07-12

### Added
- **Collapsible settings sections.** The settings tab now groups its sections into collapsible
  headers you can fold away, and the open/closed state persists per section. The Live-Embedding
  section starts expanded the first time you open settings (that's where you enter the endpoint
  nothing works without). Section headers are fully **keyboard- and screenreader-operable** —
  focusable via Tab, Enter/Space to toggle, with a visible focus ring and `aria-expanded`.
- **Index state shown as a delta.** The index section reads "N / M notes" with an inline
  "complete the index" button. The count is computed as `embedded = total − missing` (the same
  basis as the self-heal), so it reflects genuinely missing notes instead of a stale index count.

### Changed
- **One backlog truth.** The embedding status no longer shows a separate "pending" count; the
  index-state delta is now the single source of truth for what still needs embedding — this
  removes the confusing "1 pending" vs "225 missing" contradiction.
- Internal: all query-embedding / retrieval call sites were consolidated behind a single
  obsidian-free `RetrievalFacade` shared by the UI and the MCP server (the MCP tools behave
  byte-identically).

### Fixed
- **Chat and Smart Apply reconnect after going offline.** Both now resolve the embedder through
  the shared facade, so after an offline period or an endpoint switch they reconnect correctly
  instead of embedding against a dead endpoint.

## [0.14.1] — 2026-07-12

### Changed
- Build: replaced the `builtin-modules` dev-dependency with Node's built-in
  `node:module` `builtinModules` for the esbuild externals list (both bare and
  `node:`-prefixed forms). No runtime or behaviour change — addresses a
  community-review recommendation.

## [0.14.0] — 2026-07-12

### Added
- **Easier MCP setup for external clients.** The MCP-server settings section now generates
  ready-to-copy connection snippets for **Claude Code, OpenCode, OpenClaw, and a generic
  `.mcp.json`** client (pick from a dropdown), lets you **reveal and rotate the Bearer token**,
  lists the three tools the server exposes (`search`, `related`, `read_note`), and adds a
  **"Test connection" button** that self-checks the running server end-to-end (with a 5s timeout
  so it can never hang). Server start failures now report a plain-text cause (e.g. "Port belegt")
  instead of a generic guess. Loopback-only, no new transport, no new dependencies.

## [0.13.0] — 2026-07-11

### Added
- **External access via MCP is now a built-in plugin feature.** Enable the MCP server in
  Settings → "MCP-Server" and connect an external LLM agent (e.g. Claude Code) with
  `claude mcp add --transport http …` — three read-only tools (`search`, `related`, `read_note`)
  over your vault's index. The server is **desktop-only**, binds to **loopback (127.0.0.1)** only,
  runs only while Obsidian is open, and requires a **Bearer token** (auto-generated on enable) on
  every request. Defense-in-depth: DNS-rebinding protection (Host-header allowlist), constant-time
  token comparison, and a realpath containment guard so `read_note` cannot follow a symlink out of
  the vault.

### Changed
- The MCP server is now this in-plugin HTTP server (Streamable HTTP) instead of a separate stdio
  Node CLI — it is bundled into `main.js` and the standalone `mcp-server.js` target is removed.

## [0.12.0] — 2026-07-11

### Added
- **Index robustness** — the vector index is now hardened against data loss. A truncated or unreadable index is detected loudly (byte-length validation on load) and puts the plugin into a read-protected state instead of silently overwriting your good index with an empty one — the failure mode that could previously collapse a full index down to a handful of notes. New recovery tools in a "Index-Robustheit" settings section: **complete the index** re-embeds only the notes missing from the index (a fast delta reindex, also offered automatically when a large gap is detected on load), and **device-local backups** (kept in the plugin folder outside vault sync, last 3 rotated) can be restored with one click. When another device syncs a drastically smaller index, the good in-memory index is kept rather than adopted. A degraded index state is now surfaced in the status bar (`⚠ Index beschädigt`) instead of failing silently.

### Changed
- Internal: data-loss-critical decisions centralised in pure-core `index_guard.ts` (load classification, persist shrink-guard, vault↔index diff) and `index_backup.ts` (backup naming/rotation); live index writes are serialised to keep the persist guard correct under concurrent vault events.

## [0.11.0] — 2026-07-10

### Added
- **MCP server** — use your vault index from Claude Code and other MCP clients. A bundled stdio server (`mcp-server.js`, built alongside the plugin by `npm run build`) exposes three read-only tools over your existing embedding index: `search` (semantic search, embeds the query via your configured endpoint), `related` (neighbours of a note, fully offline), and `read_note` (full markdown text, `.md` only, exclude prefixes enforced case-insensitively, symlink-escape protection via realpath containment). Configuration is read at server startup from the plugin's own settings (`data.json`); the index itself is picked up live whenever the plugin rewrites it. One server instance per vault; the server never writes to your vault. See the README's "MCP server" section for client registration (`.mcp.json`).

### Changed
- Internal: pure settings truth (`VaultRagSettings`/`DEFAULT_SETTINGS`/endpoint migration) extracted to `settings_core.ts` (re-exported, no behaviour change); obsidianmd lint rules scoped to plugin code with a targeted import guard for the Node-side MCP code.

## [0.10.1] — 2026-07-08

## [0.10.0] — 2026-07-08

### Added
- Endpunkt-Presets: Ein-Klick-Buttons „+ LM Studio" / „+ Ollama" mit korrekten Default-Ports.
- Klartext-Diagnose pro Endpunkt statt nur rot/grün (Verbindung abgelehnt / Hostname unbekannt / Zeitüberschreitung / kein LLM-API).
- Nicht-blockierende Eingabe-Prüfung (fehlendes Schema/Port, Platzhalter-IP).

### Changed
- Chat-Endpunkt-Default auf `http://localhost:1234` (LM Studio) geändert.

## [0.9.0] — 2026-07-07

### Added

- **Non-deterministic Smart Apply mode ("additive")** — a per-application mode toggle in the Smart Apply cockpit. Alongside the default deterministic mode (the LLM only assigns your original blocks and never invents), the additive mode lets the LLM *infer* frontmatter values that aren't verbatim in the text and insert marked addition blocks — each carrying an ordinal confidence (high/medium/low) that you accept or reject individually in the diff gate. Low-confidence items are unchecked by default. Your original blocks stay byte-exact either way, and the deterministic path is bit-identical to before. A template can declare its preferred mode via a reserved `smartapply_modus` frontmatter key (never leaked into target notes), with a global default in settings. An optional "keep provenance" audit toggle records inferred keys as a `smartapply_erschlossen` field and marks additions with `%%erschlossen: …%%` comments — or leaves a clean document. Confidence is encoded via icon shape and text, not colour alone (WCAG 1.4.1).
- **Undo ↔ Redo toggle** in the Smart Apply diff gate — after "Undo" the button becomes "Redo" and restores exactly what was applied (the final selection plus audit state), so an accidental undo is one click to reverse.

## [0.8.0] — 2026-07-07

### Added

- **Unified sidebar hub** — the four separate sidebar views (Related Notes, Semantic Search, Chat, Smart Apply) are now a single "Vault Retrieval" hub with a tab bar, opened from one ribbon icon. The four commands deep-link straight to their tab. All panels stay mounted, so state persists across tab switches: a running chat stream or an open Smart-Apply diff survives switching away and back. The context-sensitive panels (Related, Smart Apply) refresh lazily — only when their tab is visible.

### Changed

- Old per-function sidebar leaves are migrated away automatically on load (one hub view replaces four).
- Tab icons: Related now uses `waypoints`, Search uses the magnifying glass.

### Fixed

- Smart Apply no longer resets a manually chosen template when a background re-index fires for the same note.

## [0.7.1] — 2026-06-28

### Fixed

- Removed the `obsidian-kit` git dependency by vendoring the two endpoint helpers it provided (`normalizeEndpoint`, `resolveActiveEndpoint`) back into the plugin. The self-hosted `git+https` dependency could not be resolved by Obsidian's automated plugin review, which then treated the entire Obsidian type surface as untyped. No runtime or behavior change.

## [0.7.0] — 2026-06-27

### Added

- **Endpoint fallback lists** — both the embedding and the chat endpoint now accept an *ordered list* of URLs instead of a single one; the first reachable endpoint wins. This covers a local LLM server that changes with the network (e.g. `localhost` on the host machine vs. a LAN/VPN address when you are away) from a single synced config. The active endpoint is cached and re-resolved automatically — with exactly one retry — when a connection drops, and each endpoint shows a live reachability status in settings.

### Changed

- Existing single-endpoint settings migrate automatically to one-element lists — no action needed.
- `normalizeEndpoint` and the endpoint resolver are now sourced from the shared `obsidian-kit` library (de-duplicated across plugins).

## [0.6.0] — 2026-06-26

### Added

- Index folder is now configurable (setting "Index folder") and is hidden by default in the file explorer (setting "Hide index folder in file explorer", default on).

### Changed

- **Note for existing users:** the previously visible `_vaultrag` folder is now hidden in the file explorer after the update (cosmetic only; always configurable via setting; data and sync are unaffected).

## [0.5.0] — 2026-06-26

### Added

- **Self-contained indexing** — a *Vault neu indizieren* command (and a confirmed button under **Settings → Index**) builds the full embedding index from every note via your configured endpoint, with live progress in the notice and status bar. The plugin no longer needs an external (HyperForge) export to bootstrap — anyone with an embedding endpoint can use it from scratch. The rebuild is atomic: aborting it never corrupts your existing index.
- **Frontmatter guidance for Smart Apply templates** — `#`-comments on a template's frontmatter keys steer the LLM (e.g. `art: # Meeting | Telefonat | …`) without becoming literal values. Together with `%%` body guidance, even weak / non-thinking local models route reliably.
- Smart Apply max-tokens is configurable (default 4096, up to 16384) for large notes with many blocks.

### Changed

- **Smart Apply diff-gate redesigned** into a semantic three-level view: a scan header (check status by icon *shape* + template/detection + stat chips), a decluttered frontmatter block (only set/changed fields prominent; empty/unchanged collapsed, with an `Original / Vorschlag` column label), a body-reflow view (which original block lands under which heading, plus an *Übrig* leftover-safety indicator), and the raw text on-demand. WCAG 1.4.1 throughout.

### Fixed

- `parseFrontmatter` strips `#`-comments only when explicitly requested (template parsing), so note-write paths never lose `#`-bearing values.
- The reflow view no longer shows a misleading "nothing lost" when the LLM assignment failed to parse.

## [0.4.0] — 2026-06-24

### Added

- **Smart Apply** *(opt-in)* — restructure a messy note into a chosen template's sections. A local LLM only emits a block-to-heading assignment; the body is rebuilt from your original bytes (never fabricated) behind a diff preview. Templates self-describe via `%%` guidance comments. A relevance-ranked template list preselects the best fit and recomputes live as you switch notes. Enable under **Settings → Smart Apply**.

### Changed

- Smart Apply ranking reuses the persisted note-level index vectors (`index.vectorFor`) instead of re-embedding each template — instant ranking, no embedder flood on large template folders.
- Connection and model status indicators encode state by icon **shape** (check / x / loader), not colour alone (WCAG 1.4.1), with an accessible refresh control and a roomier header.

### Fixed

- Template ranking recomputes when a note is opened in the same tab, not only on a tab switch.
- Folder notes (a note named after its parent folder) are excluded from template ranking and apply.
- Changing the template folder re-ranks the open cockpit immediately, without a reload.

## [0.3.5] — 2026-06-22

### Changed
- The chat SSE stream now uses **`XMLHttpRequest`** (via `onprogress`) instead of `fetch`. This keeps live
  token streaming while removing the last `fetch` usage — so the plugin no longer triggers the
  "use `requestUrl` instead of `fetch`" lint, without sacrificing streaming (`requestUrl` cannot stream).

## [0.3.4] — 2026-06-22

### Added
- **GitHub Actions release pipeline.** Pushing a version tag builds, type-checks, tests and lints the
  plugin, then publishes the GitHub release with **build-provenance attestations** for `main.js` /
  `manifest.json` / `styles.css` — cryptographic proof the assets were built from this source in CI.

## [0.3.3] — 2026-06-22

### Fixed
- Removed inline `eslint-disable` directives — the Obsidian community review disallows them. The two
  unavoidable cases (the chat SSE `fetch`, and the deprecated `display()` kept for `minAppVersion 1.7.2`)
  are now handled in the local ESLint config instead of inline comments.
- Reworded the README install section (dropped the "coming soon" placeholder).

## [0.3.2] — 2026-06-22

### Changed
- All network requests except the chat SSE stream now use Obsidian's `requestUrl` (CORS-free,
  mobile-friendly) via a single internal `http` module. The chat stream keeps `fetch` for incremental
  token streaming, which `requestUrl` cannot do.

### Fixed
- Cleared all ESLint findings from the community review: typed the settings tab's plugin reference
  (no more `any`), removed redundant type assertions, voided fire-and-forget promises, and dropped
  deprecated `setDynamicTooltip` calls. Added `lint` and `typecheck` npm scripts (ESLint with
  `typescript-eslint` + `eslint-plugin-obsidianmd`).

## [0.3.1] — 2026-06-22

### Fixed
- Obsidian community-review fixes: replaced a direct `style.height` assignment with `setCssStyles`
  (no-static-styles-assignment), and voided floating workspace-leaf promises.
- Removed the inert declarative settings API (`getSettingDefinitions`) so the plugin no longer uses
  Obsidian 1.13-only APIs; settings render via the classic `display()` on all supported versions.
- Bumped `minAppVersion` to **1.7.2** (the `revealLeaf` API used to focus the side panels is @since 1.7.2).

### Removed
- Deprecated `setDynamicTooltip()` calls (slider values now show inline) and a few redundant type assertions.

## [0.3.0] — 2026-06-21

### Added
- **Thinking on/off** — a quick toggle in the chat (with a default in settings) suppresses a reasoning
  model's thinking via cross-server-portable request params (`reasoning_effort: "none"`,
  `chat_template_kwargs.enable_thinking: false`, `reasoning_budget: 0`). A "Test" button in settings
  reports whether the selected model actually honours suppression; if a model keeps thinking, the
  thinking block stays visible so you can see that it didn't take.
- **Model capability hints** — settings show, best-effort, whether the selected chat model supports
  **vision** and/or **thinking**, layered from native metadata (Ollama `/api/show`, LM Studio), model-name
  heuristics, and live confirmation — with Lucide icons. Live signals only ever upgrade confidence.
- **Embedding model dropdown** — the embedding model is now a dropdown populated from the endpoint (with
  an offline text fallback), matching the chat model picker.
- **Inline endpoint test** — a "Test" button next to each endpoint reports the connection via a notice.
- **Multi-line chat input** — the chat input is an auto-growing textarea; Enter sends and Shift+Enter
  inserts a newline (configurable), with IME-composition handling for CJK input.
- **Context-budget ↔ model window** — the context-budget slider's ceiling follows the selected model's
  context window (read from LM Studio model details).

### Changed
- **Renamed** the plugin id to `vault-retrieval` and the display name to **Vault Retrieval** — the `vault-rag`
  id was already taken in the Obsidian community directory by an unrelated plugin. The GitHub/Codeberg repo
  keeps the `vault-rag` name; only the plugin identity changed.
- **Breaking:** IMG→MD (image transcription) has been split out into its own plugin,
  [`image-to-markdown`](https://git.jkaindl.de/jkaindl/vault-rag). vault-rag is now a focused RAG core
  (related notes, semantic search, chat). The IMG→MD sidebar, command and editor context-menu entry,
  along with the Vision settings, move there. Install `image-to-markdown` separately to keep that feature.
- **Settings layout** — reworked toward Obsidian's native conventions: sentence-case labels, one-line
  read-only info rows (value in the control slot), a consistent connection indicator placed next to the
  embedding settings, and a larger system-prompt field. The tab also implements Obsidian 1.13's
  declarative settings API (forward-compatible grouped layout) while keeping the classic renderer as a
  fallback for older versions.
- **Frontend capability display** — the chat shows only an actionable thinking toggle (vision is a
  settings-only model hint, since the chat itself is text-only).

## [0.2.0] — 2026-06-20

### Added
- **IMG→MD sidebar** — an interactive side panel for image transcription: a checkbox list of the active
  note's images (all selected by default, with a select/deselect-all toggle; unsupported formats like HEIC
  shown disabled), per-image live-**streaming** transcription into result cards (with an optional thinking
  block and a copy button), and deliberate writing — "Create note" per card or "Create all" at once
  (batched, single source-note write; re-scan after writing drops the handled image from the list). Built on
  a shared SSE transport (`streamSSE`, reused by chat and vision) and a shared batched writer
  (`writeTranscripts`, reused by the sidebar and the IMG→MD command). The IMG→MD command and editor
  context-menu entry remain as a one-click path.
- **Visible thinking in chat** — reasoning models' `reasoning_content` (and inline `<think>…</think>`
  tags via a chunk-robust `ThinkSplitter`) are captured during streaming and shown in a collapsible
  "💭 thinking" block above each answer: live-open while thinking, auto-collapsed once the answer
  arrives. Reasoning is ephemeral and never sent back to the LLM in multi-turn history. The working
  timer is phase-aware ("thinking…" → "generating…").
- **Copy answers** — a native copy button on each assistant message copies the answer to the clipboard.
- **Chat model UX** — a temperature slider and an editable system prompt; a model dropdown (populated from
  the server's `/v1/models`, with an offline text fallback); best-effort model details (context window,
  quantization) via LM Studio's `/api/v0/models`; an in-panel model switcher; and an input-position toggle
  (input pinned at the bottom or the top). All read live from settings.
- **Vision / IMG→MD** — transcribe a photo embedded in a note to structured Markdown with a local vision model.
  A command (all images in the active note) or an editor context-menu entry creates a new note (frontmatter source
  reference + the photo on top + the transcript) and replaces the image link in the source note with an embed of the
  new note. Own vision endpoint / model / prompt settings. The plugin's first vault-write feature — non-destructive
  (link replacement only) and idempotent; unsupported formats (e.g. HEIC) are skipped with a warning.

### Fixed
- Stream end is now drained cleanly — the `ThinkSplitter`'s buffered tag remainder and the
  `TextDecoder`'s pending bytes are flushed, preventing silent loss of the last characters.
- Chat view is now a bounded flex column — messages scroll, the input stays pinned, and the context panel
  is height-capped. Previously a long answer pushed the input off-screen.
- Chat reads its client / model / temperature / system-prompt live from settings, so endpoint and model
  changes take effect immediately in an open chat (fixes a stale-client reference after reconnect).
- Auto-scroll respects manual scroll-up — the view only follows the stream when you're already at the bottom.

## [0.1.0] — 2026-06-19

Pre-release. Local-only; not yet published to a forge or the Community Directory.

### Added
- **Slice A — related notes:** offline, cross-device side panel. Reads a note-level
  Matryoshka-256 int8 mini-index from `<vault>/_vaultrag/` and runs brute-force cosine locally.
- **Live indexing:** re-embed notes on save via a configurable Ollama/MLX endpoint; offline edits
  queue in a dirty-list and drain on reconnect.
- **Semantic search:** query the vault by meaning, reusing the cosine engine.
- **Slice B — RAG chat:** grounded, streaming answers from a local OpenAI-compatible LLM; editable
  live-context panel (auto-RAG + pinned notes), source chips, multi-turn (ephemeral), abortable.
