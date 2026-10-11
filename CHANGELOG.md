# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Changed

- **The embedding endpoint list takes its three richer status texts from the kit** ("Timed out — network unreachable", "not an OpenAI-compatible endpoint", "Not reachable" without a dangling dash) instead of overriding them; the wording does not change. Only the skipped-model state still overrides the kit text, because it names the index.
- **The chat model choice goes through the connection** (kit `setModel`/`modelInUse`, obsidian-kit 0.53.0) instead of the plugin's own copy. Behaviour is unchanged: with the LLM Endpoint Manager the choice is stored in the plugin's endpoint choice, without it in the row of the active endpoint. The settings tab now refreshes once per model change.
- **The index core now comes from code-kit** (chunker, container codec, index guards, `LiveIndexer`, search facade, embeddings client) instead of vault-rag's own copies — the second user is Oneiron. Existing indexes load unchanged (the golden index, related notes and searches give the same top five with the same scores, a rebuild with a fake embedder writes the same bytes). Visible differences: the header field `source_dim` now holds the real length of the vectors the model returned (it was a constant 256), a search vector shorter than the index returns no hits instead of garbage, console messages no longer carry a "vault-rag" prefix, and the quadratic Markdown expressions for frontmatter and think blocks are linear (a note with tens of thousands of line breaks after `---` no longer stalls an edit).
- **The embedding endpoint list uses the kit's embedding connection** (obsidian-kit 0.54.0) instead of vault-rag's own resolution; the index check stays vault-rag's (a rule over the loaded index's model). Same list, same wording. Differences you can see: with no reachable endpoint the plugin no longer keeps the first row wired "for later" — the embedder reports no endpoint until one answers (searches then say offline, as before); with a reachable endpoint whose model does not match the index and no matching one, the first reachable endpoint with a model is used and the notice names it; a row without a model is only reported when it is the one chosen.
- **The search result rows come from the kit** (`renderHitList`) — same look; when a row carries buttons (Integrator), only the title shows the pointer cursor.
- Kit pin `obsidian-kit` 0.51.3 → 0.54.0 (`code-kit` 0.22.1). Also visible: Mermaid fences in model answers that could load remote sources are shown as text (obsidian-kit 0.53.0).
- Kit pin `code-kit` 0.17.0 → 0.22.1 (see above for obsidian-kit). The kit's token redaction masks more (`Bearer` followed by eight or more characters, any case), so prose such as "Bearer authentication" in a lab log becomes `Bearer [redacted-token]`.

## [0.39.0] — 2026-10-10

### Changed

- **Embedding endpoint API keys move into Obsidian's keychain** (Settings → Keychain), like the chat keys since 0.38.0. When the plugin loads, a key found in `data.json` — in the embedding or the chat list — is moved there, also with the LLM Endpoint Manager installed; `data.json` keeps only a reference. Keys do not travel with settings sync any more — enter them again on other devices. Without a keychain (Obsidian older than 1.11.4) existing keys keep working and the key field is locked.
- **The embedding endpoint list uses the same state wording as the chat list** (kit texts): "active — this one is used" / "reachable — fallback N" / "not reachable — skipped"; the skipped-model state still names the index. Error tooltips for "Timed out" and "not an OpenAI-compatible endpoint" keep their hint on what to check. Address warnings come from the kit.
- **Index backups are rotated grandfather-father-son instead of keeping only the last three:** the six newest of today, the oldest of each of the last seven days, four weeks and six months — at most 23 (about 71 MB with a 3 MB index). The newest backup and the one just taken are never removed. The settings text and the docs say so; backup folders whose name carries no readable timestamp are never deleted.
- Kit pin `code-kit` 0.15.4 → 0.17.0 (all modules on one ref); `rowModel` and the migration of the old global model field now come from the kit.

### Documentation

- The README and the reference no longer describe an external HyperForge export as the way the index comes into being: the plugin builds the index itself, and any index in the container format is read.

## [0.38.0] — 2026-10-09

### Changed

- **The chat connection now comes from the kit** (`createLlmConnection`, obsidian-kit 0.51.3 / code-kit 0.15.4): endpoint choice, request parameters per mode, client with deadlines, response check and the settings sections "Endpoints" and "Request" are one component now. The embedding path is unchanged (own resolution, index guard). **Visible consequences:**
  - **Chat endpoint API keys move into Obsidian's keychain** (Settings → Keychain). The first time the chat resolves its endpoint, a key found in `data.json` is moved there; `data.json` keeps only a reference. Keys do not travel with settings sync any more — enter them again on other devices. Embedding endpoint keys stay in `data.json`.
  - **No reachable chat endpoint is an error of its own now:** "No chat endpoint is reachable. Check the endpoints in the settings (or the LLM Endpoint Manager)." Before, the first row was tried anyway and failed with a network error.
  - **The chat endpoint list uses the kit's wording:** "Test connection", "Try this endpoint first", row status "active — this one is used" / "reachable — fallback N" / "not reachable — skipped", failures such as "Timed out — network unreachable." The embedding list keeps its wording. The "Request" section now sits right below the chat endpoint list (inside the Chat group).
  - **Secret masking before sending:** tokens, bearer headers, private-key blocks and similar secrets in chat, Smart Apply and reformat requests are replaced by placeholders (`[redacted-token-1]`) and put back in the answer; Smart Apply's JSON result is restored with escaping. The LLM Lab log now records the masked text, i.e. what the server actually saw. Images are not masked.
  - Deadlines are unchanged (600 s until the first chunk, 120 s of silence) but fixed values of the kit now; a "cut off after N s" message names that value.
  - Kit pin `obsidian-kit` 0.43.0 → 0.51.3, `code-kit` 0.7.0 → 0.15.4 (all modules on one ref); the kit CSS for the request section and the streaming area in `styles.css` is updated and checked by a test. `minAppVersion` stays 1.12.7.

### Fixed

- **The settings rows "Model details" and "Capabilities" follow an endpoint change made in the list** (the kit re-resolves the endpoint itself; the tab used to keep showing the old model until it was reopened).
- **Loading the endpoint lists keeps `id` and `secretId` of a row.** A local copy of the list migration dropped both fields; with keys in the keychain that would have cut the link to the key at the second start. The migration now comes from the kit, and the "no silent field loss" test covers both fields.

## [0.37.1] — 2026-10-03

### Changed

- The changelog is now written entirely in English.
- Internal design notes moved out of the repository; the user documentation is unchanged.

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
- **GitHub exit: both READMEs pointed nowhere, all eight images were dead.** Measured
  2026-09-03: `github.com/johannes-kaindl` answers with **404**, and with it every one of the 16
  `raw.githubusercontent.com` embeds — the READMEs were visibly broken for users, not merely
  incompletely linked. All 39 GitHub URLs now point to Forgejo
  (`raw/branch/main` for images, `src/branch/main` for files); every replaced URL has been
  checked individually for 200, not just rewritten.
- **`authorUrl` → `https://jkaindl.de`.** The field is clickable in Obsidian's plugin list and
  pointed to an abandoned profile. The old rule ("never the own domain") had the
  store review as its reason, and that no longer takes place for this plugin.
- **Installation route replaced: plugin catalogue instead of the community directory.** Both previous
  routes were dead — the store listing has disappeared, and BRAT requires the GitHub mirror.
  In their place stands the own catalogue via
  [AnySource Sideloader](https://git.jkaindl.de/jkaindl/anysource-sideloader); the
  BRAT section is removed without replacement. The manual route and building from source remain.

### Removed
- **CI badge from both READMEs.** GitHub Actions is no longer reachable, and no runner runs on the
  Forgejo instance. That is the same reasoning as at its introduction
  (CORE-META-02): a badge that does not point to a real run is worse than none.

### Internal
- GUI smoke: now runs entirely in the staging vault on a second instance (34/34, recipe in
  `docs/SMOKE.md`). The fixture carries plugin settings with two endpoint rows each
  (`docs/images/fixture/plugin/settings.json`), the tally counts skipped checks separately
  and with a reason, and a new check proves that the reformat preview is
  closed after discarding. Five driver findings fixed (waiting in the renderer, language source, collapsed
  sidebar, cold chat endpoint, backslash in the template string) — none in the plugin.
- **`scripts/index-probe.ts`** — self-retrieval sample over the running index as a
  repeatable tool. Measures whether a short note finds itself at rank 0 via its *own* wording,
  and evaluates by modification date. First run against 6,952 paths: 35/40 at
  rank 0; the staircase-shaped row offset from 2026-08-30 is gone, three remaining leftovers
  carry a constant offset of 4 rows. Not shipped code — a maintenance tool.
- **Release runs with `--no-github`.** The store route and the mirror-driven store release no longer exist
  for this plugin; distribution goes via the Forgejo release and the
  AnySource Sideloader catalogue.

## [0.29.0] — 2026-08-30

### Added
- **The index now says when its vectors no longer belong to its notes.** Until now
  it could be structurally perfect — CRC32 green, note count plausible, `indexed: true` — and
  still return for every note the similarity of a *different* note. The hit lists did not
  look broken, but trustworthy: high scores, unrelated notes. Two
  guards close the gap:
  - Notes that are in the index but carry an unusable vector are reported on load
    and queued for re-embedding. Before, they were doubly invisible: never
    findable, and counted as present by the completeness display.
  - The GUI smoke checks whether a short note finds itself at place 1 via its own wording.
    That is the only probe that sees this class of damage at all.

### Changed
- **"Reindex vault" no longer loses the whole run on an abort.** Until now
  the new index was written only at the very end — if the operation aborted before that, all the
  computing time was lost, even if it was close to the goal. Now an intermediate state is saved every 250 notes;
  an abort costs at most that last stage, the rest is kept
  and picked up at the next start.
  The intermediate state is always **complete**: the notes already recomputed, supplemented by
  those not yet reached from the previous index. During the run search keeps
  delivering the previous state, so that results do not shift in the middle of use.
  If the embedding model is changed, the intermediate states are deliberately dropped — there a
  mixed index would contain two incomparable vector spaces.
- **The connection to "LLM Lab" now requires its apiVersion 3** (the stable part of the
  system prompt is reported as `promptTemplate`, so that the lab can form a prompt
  **version** from it instead of a single call — chat, reformatting and Smart Apply
  each report their own stable part for this). If "LLM Lab" is still on the old contract
  (apiVersion 2, before its next release), vault-rag reports **nothing at all** to the lab
  from this release on — just as without an installed lab, only silently, until "LLM Lab" catches up.

## [0.28.0] — 2026-08-27

### Changed
- **Five local versions are replaced by the modules from obsidian-kit 0.27.0** — the
  error body cascade, the callout builder, the hub tab bar and both copy spots. Four of them
  were sources of the kit extraction; they kept running here while the fixes that arose during
  the merge did not arrive. Vendoring now runs through `tools/sync-kit.sh`
  instead of by hand copy, and both vendor directories carry a uniform pin.
- **"Wrap in callout" writes `>` instead of `> ` for blank lines** (without a trailing
  space). Obsidian renders both identically, in the document the difference is only visible
  with visible whitespace — it is mentioned anyway, because the command writes into the user's
  notes and an unnamed change has no place there.

### Fixed
- **"Copied" no longer appears when nothing was copied at all.** Both copy buttons (MCP port
  in the chat panel, MCP configuration in the settings) showed the success message unconditionally,
  without waiting for the result. If the clipboard refuses — loss of focus or missing
  permission, the normal case in an unfocused window —, "Copied" appeared with an empty
  clipboard. Now the message appears after a successful write, and a failure
  reports itself as such.
- **An error body with an empty error text now shows the raw text instead of nothing.** With a
  response like `{"error":""}` the server's explanation used to drop out completely: the empty string counted
  as a hit, and the fallback to the raw text therefore did not kick in.
- **Switching to a disabled panel's tab no longer empties the hub.** With Smart Apply
  disabled, the command could activate a tab whose panel was never built — an empty hub
  became visible. The switch is now ineffective instead of destructive.

### Accessibility
- **The hub tab bar is a real ARIA tablist.** Tabs report `role`/`aria-selected` and
  point to their panel via `aria-controls`; navigation works with arrow keys, Home and End
  (roving tabindex). ⚠️ As a result, inactive tabs are **no longer reachable with the Tab key** — that is
  the standard behaviour of a tablist, but a change compared with before.

## [0.27.0] — 2026-08-24

### Fixed
- **Gemma models are no longer wrongly shown as "no vision".** The detection
  only knew the Ollama spelling (`gemma3:4b`). LM Studio delivers the same model as
  `google/gemma-3-4b-it`, and the entire Gemma 4 series fell through as well — both were listed as
  without vision although they understand images. The small text models (`3-1b`, `3-270m`)
  remain correctly detected as without vision, now for the right reason instead of by accident.
- **"Apply to active note" is disabled as long as no template has been determined.** Whoever clicked
  while the template detection was still running started a run without a template; the panel then fell
  silently back to its initial state. From outside that was indistinguishable
  from Smart Apply still computing — which can legitimately take ten minutes. Whoever had
  clicked a second later would have got a correct result.
- **Opening the settings no longer writes the configuration.** While drawing, the
  plugin adjusted the upper limit of the context budget to the model and thereby triggered a complete
  save without anyone having changed anything. That cemented a faulty
  state onto the disk immediately and made "the configuration file was written" worthless
  as a hint when debugging. A real adjustment of the value is still saved.
- **An aborted chat records the text received up to that point** (only with "LLM Lab"
  installed). Until now a run ended with "Stop" was reported with empty content — that is,
  without exactly what one looks it up for.

### Changed
- **The gate now runs on every change to `main`, no longer only at release.**
  In addition it newly checks that the Obsidian dependency stays restricted to the files provided for it
  — the architecture rule behind it was previously only in the documentation.
- **The connection to "LLM Lab" now requires its apiVersion 2** (endpoint key for
  exact masking, context paths for a folder filter). If "LLM Lab" is still on the
  old contract (apiVersion 1, before its release 0.3.0), vault-rag reports
  **nothing at all** to the lab from this release on — just as without an installed lab, only silently, until "LLM Lab" is
  updated to 0.3.0.

## [0.26.0] — 2026-08-23

### Fixed
- **A template whose headings Smart Apply does not see is reported as such — instead of
  as an empty result.** If the `##` headings of a template are not each on a line of their own,
  the plugin recognises none at all. Until now the complete path ran through anyway: the
  model was asked, and because there was no target heading, *every*
  block ended up under "rest" afterwards. The result read as "0 of 8 assigned" and could not be
  distinguished from a model failure — it even triggered exactly that misdiagnosis. Smart
  Apply now aborts before the request, names the template as the cause and the necessary action,
  and does not claim an assignment that was never attempted.
- **Smart Apply instructs the model in the language of the interface.** The prompt that describes the
  template and the note blocks was built in German throughout — down to the
  placeholders in the answer schema. Whoever ran Obsidian in English thereby had an English
  note tidied up following a German work instruction. It is the same spot as with the
  chat prompt: a text that does not go into the interface but into the model. The
  confidence words that the model is supposed to return deliberately remained part of the
  translation — they are evaluated, and an English prompt that demands German
  words would have let every addition silently fall to "low". What ends up in the note
  (the catch-all heading, the provenance markers) stays unchanged: it already
  stands in existing notes.
- **The chat answers in the language of the interface, no longer always in German.**
  The shipped system prompt demanded literally "Answer briefly and in German." — whoever ran
  Obsidian in English asked an English question and got a German answer. The
  prompt is now resolved only at request time and follows the configured language. A system prompt
  written by yourself stays untouched; whoever never changed the old default text
  will find the field empty from now on — empty means "the built-in default applies", and the
  field description now says so, too.

### Added
- **The plugin's LLM calls can be recorded — if you install the plugin "LLM Lab".**
  Vault Retrieval reports chat, reformatting and Smart Apply to its API as soon as
  it is there; without the neighbour plugin nothing happens, and the endpoint test button is excluded
  by default. A single hook point (`ChatClient.stream`) captures all three paths, and every
  call carries its feature identifier.
- **The README is illustrated** (eight screenshots: related notes, search, chat, visible
  thinking, reformat preview, endpoint roles, settings and the Smart Apply diff gate).
  They are recorded reproducibly via `npm run shots` against a running Obsidian; the
  recording contract is in `docs/images/README.md`.

## [0.25.0] — 2026-08-21

### Fixed
- **A response that ran into the token limit is no longer reported as a content error.**
  Whoever ran into the self-configured budget with Smart Apply read "LLM response does not contain a valid
  assignment JSON" and looked for the error in the model — while the cause
  is called "Smart Apply max tokens" and is a setting further up in the same interface.
  The checklist now names the abort and quantifies the limit reached. The finding
  accompanies only a real failure: a truncated response that can be fully
  used stays error-free.
- **The reformat preview points out a truncated result**, instead of showing it
  silently shorter. The result remains applicable — the hint only explains why it ends where it
  ends (the token budget of reformatting is hard-wired and not configurable).

### Changed
- The vendored SSE parser is back on the kit version with `finish_reason` (obsidian-kit 0.3.0).
  Without the field, an abort at the token limit cannot be distinguished from a response that is
  useless in content — both look identical at the receiver.
- **The self-healing of the index now has a check that measures its effect for the first time.** Until now only
  the decision whether to heal was tested — but the August error lay elsewhere, in the
  execution. The new GUI check actually produces the damage case against a running Obsidian
  and proves that the index comes back from the backup without a reachable endpoint.

## [0.24.0] — 2026-08-18

### Changed
- **Diagnostic messages now follow the language choice** (i18n part 3). The language layer from 0.21.0/
  0.22.0 covered every text that is written *directly* into a display. If a text instead arises
  as the **return value** of a function and is displayed only later, there is
  no longer a literal spot in between — invisible to the automatic guard. This mainly affected
  the most common case of all: whoever set the interface to English got a German tooltip
  for **every** unreachable endpoint. In addition the checklist under a Smart Apply suggestion
  and the message of a failed MCP server start.
- **Error messages of the MCP server are now English throughout** — and stay so regardless
  of the configured language. They are read by an agent via the loopback channel, not
  by a human in a localised interface; coupling them to the UI language of the vault
  would be wrong.

### Fixed
- **The index is now also restored automatically from a backup when the
  embedding endpoint is not reachable.** Until now the self-healing first checked the endpoint and
  only then looked for a backup — whoever was offline (or had a wrongly entered endpoint)
  stayed permanently at "no index", although the backup lay locally next to it and only had to be
  imported by hand. Adopting a backup needs no network; only adding the notes that have
  come in since needs one.
- **Nothing happens on the iPhone in the process.** A device without an embedding endpoint of its own can
  never close the gap itself — and because the index folder syncs along, the older state would have travelled from there back to
  all devices. There it therefore stays at write protection, and the message now says
  that the repair happens on the desktop and arrives via sync.
- **The promised follow-up now really takes place.** After a restore without an
  endpoint, the plugin reported that the notes added since would be supplemented automatically
  as soon as the endpoint answers — but that was never triggered. These notes now land in the
  queue that the plugin works through every minute anyway.
- **A restored index again carries the name of the model it was built with**,
  instead of that of the currently entered endpoint. Otherwise the protection that prevents the mixing of
  two embedding models in one index could no longer
  recognise it at the next save.
- The message of a failed MCP server start named the reason twice
  (`(boom): boom`) — it now shows it once.

## [0.23.0] — 2026-08-13

### Added
- **Plugin API for other Obsidian plugins** (`app.plugins.plugins["vault-retrieval"]?.api`).
  Retrieval used to be reachable only inside the plugin itself and via the MCP server — neighbour plugins
  had to build an embedding index of their own to do the same. The new surface is
  deliberately narrow: `apiVersion` (1), `status()` (synchronous and network-free — for the question "can I
  offer retrieval at all?"), `search(query)` and `related(path)`. Reading notes and raw
  embedding vectors are explicitly **not** included: a plugin reads the vault via
  Obsidian's own API, and vectors would bind callers to index dimension, model and quantisation
  — exactly the internals that this plugin must be free to change.
  Expected states are **values instead of exceptions** (`{ok:true,hits}` or `{ok:false,reason}`
  with `reason` from `"no-index"`/`"offline"`/`"not-indexed"`), and `reason` is a
  machine-readable code without translated text — a foreign plugin cannot import our TypeScript types
  and must be able to touch the discriminator at runtime. The exclusion list
  from the settings cannot be overridden (user boundary, not a tuning parameter); scores
  come back unrounded, the caller decides on the presentation.
  No consent gate: a plugin that can call this API already runs with full
  vault access — a gate would protect nothing real and only cost clicks.
  New module `src/plugin_api.ts` (obsidian-free, thin adapter over the shared
  `RetrievalFacade`, exactly following the pattern of `mcp/tools.ts`), 17 tests. Documented in both
  READMEs and under `docs/reference/`.

### Notes
- The contract is versioned, but young: **version 1 counts as experimental** until a second
  consumer has confirmed its shape (the first is `koda-agent`). The version field exists from the
  start because it could not be introduced afterwards without a break — the stability promise
  is the expensive half and can follow later.
- `npm run smoke:gui` has six new checks that call the API via CDP in the renderer —
  that is, the same way a foreign plugin does, not via internal code. One of them guards
  the boundary specifically: if `readNote` or `embedQuery` shows up in the surface, the contract
  has been softened.

## [0.22.0] — 2026-08-09

### Added
- **English user interface complete for the regular user interface** (panels,
  settings, commands, messages, status bar, error texts). The second round of the
  language switch (see the 0.21.0 note) lifts the remaining hard-coded German spots onto the
  language layer: endpoint rows and roles, backup management, status bar,
  complete dialog, chat error texts, Smart Apply panel (incl. block count), the
  reformat preview, the context panel of the chat and the client selection in the MCP setup. Around
  250 strings across 14 files are now routed through `t()`.
- **Regression protection for the language layer:** a structural guard test
  (`tests/i18n/no_german_ui.test.ts`) runs over all `src/**/*.ts` files and reports every
  text sink (setting name, tooltip, button text, `aria-label`, `text:`/`label:` property) that
  a string literal reaches without going through `t()` — language-independent instead of via a
  word list that would be outdated tomorrow (`tests/i18n/sink_guard.ts`, from task 7 of this slice).

### Notes
- A handful of hard-coded German diagnostic strings remain reachable: Smart Apply guard details
  (`note_restructurer.ts`), tooltips from the vendored `endpoint_diagnostics.ts`, error texts from
  the vendored `frontmatter.ts` and the MCP start error message — follow-up slice.
- Two spots deliberately stayed German: the `Confidence` values `hoch`/`mittel`/`niedrig` in
  `src/frontmatter.ts` (frontmatter data of real notes, not UI) and the MCP tool descriptions
  in `src/mcp/register_tools.ts` (read by an agent, not a human — they belong in English, but in
  a small commit of their own outside this slice).
- The three removed hard-coded German `toLocaleString("de-DE")` calls (status bar) now format
  numbers without a forced locale — the thousands separator thus follows the **operating system**,
  not the Obsidian interface language: a German Obsidian on an en-US machine shows
  `● 1,000` within German sentences. Not a regression bug, should this be noticed later.

## [0.21.0] — 2026-08-07

### Added
- **English user interface — vault-rag now speaks two languages.** Until now the
  entire interface was hard-coded German, regardless of the language setting in Obsidian. Now
  the plugin follows `Obsidian → Settings → About → Language`: **English is the
  canonical version**, German is shipped, every other language falls back to English. Converted
  are the settings, all commands of the command palette, the messages
  (notices) of the plugin as well as the text building blocks for the index delta and reformat readiness.

### Changed
- **Numbers are formatted in the language of the interface** instead of strictly following the German
  convention — an English interface shows `1,234` instead of `1.234`.

### Notes
- The language switch is **not yet complete**: some of the settings rows, the
  status bar and some state texts in the Smart Apply area are still hard-coded German.
  These remainders follow in a second round.

## [0.20.0] — 2026-08-05

### Added
- **Endpoint priority can be changed without deleting:** every endpoint row (from position 2) gets a
  "Use first" button that moves it to the top of the fallback list. Since the list itself
  is the priority (the first reachable endpoint wins), reordering used to be possible only by
  deleting and recreating. Every row also shows its current role as text
  ("active" / "reachable, but position N" / "unreachable" / "skipped — model does not match
  the index"), so that it is never unclear which endpoint is actually being used right now.

### Fixed
- **The active endpoint was never visually marked:** the highlighting set `font-weight` on the
  status icon container — but that carries only an SVG, on which `font-weight` has no effect. The
  active row therefore looked just like any other reachable one. The marking now sits on
  the row's new role text, where it actually becomes visible.
- **Errors of the chat endpoint are reported in plain text:** until now every failure was replaced by
  "Chat LLM unreachable (local/VPN)." — even an HTTP 401 with an explanation from the
  server. With a hosted endpoint this guess additionally pointed in the wrong
  direction. Now the message names the status and the server's explanation ("Access denied (HTTP 401)
  — API key missing, invalid or expired. — Server: …"), so that address, key,
  path and model name become distinguishable.
- **The role text did not follow the model override:** if the model of an endpoint row was
  changed, the role display stayed at its old state — an embedding endpoint that the
  model guard already skips kept reporting "reachable, but position N". It became correct
  only after a rebuild of the settings tab.

## [0.19.0] — 2026-08-05

### Added
- **External LLM providers:** endpoints can now carry an API key and a model of their own.
  This allows OpenAI-compatible services (OpenRouter, Groq, Together, Mistral,
  OpenAI …) to be entered into the endpoint list just like local servers — the list remains a
  fallback chain, the first reachable one wins. The key is entered masked and, like
  all settings, is stored unencrypted in `data.json`.
- **Model selection as a dropdown instead of free text:** all four model name fields of the settings
  (embedding model, chat model, Smart Apply model, per-endpoint-row model override) now
  show a list of the models reported by the endpoint instead of a text field — until now the
  endpoint override was the only free text of these four and thus prone to typos. If the
  endpoint is not reachable, the stored value stays visible but locked; if it returns
  no model list, it stays a free-text field.
- **Model protection for the embedding index:** since an index is bound to the model it was
  built with, the endpoint resolver skips every candidate whose embedding model does not
  match the index, and every write operation (live embedding, "Complete index") is
  blocked when container model and embedder model diverge — search and reading continue
  unchanged. A deliberate model change runs exclusively via
  "Reindex vault" (full rebuild). Affects only embedding endpoints; a model change on
  chat endpoints remains without consequences.

### Fixed
- **Backup rotation left empty folders behind:** when cleaning up old index backups, an empty folder
  stayed behind each time — over weeks 1309 of them accumulated. Cause: Obsidian's
  adapter can remove a directory only with `recursive: true`; the previous call failed
  on **every** directory and the error was silently discarded. Removal
  now happens in one go, and failures are logged instead of swallowed. The same
  broken call form was in the clean-up of the old index folder after a path change.

## [0.18.0] — 2026-07-29

### Changed
- **Index format:** the sync index is now ONE container file `_vaultrag/index.bin`
  (previously three: `notes.i8`/`paths.json`/`manifest.json`). Obsidian Sync can thereby no longer produce
  inconsistent mixed states of two generations — the root of the
  recurring index corruption (incidents of 19.07./22.07.) is eliminated, not just detected.
  Existing indexes are migrated automatically and losslessly at the first start.
  **Mixed-version note:** a device that still runs an older plugin version shows "no index" until
  its update (no data loss — notes are untouched).

### Added
- **Automatic recovery:** if the index is corrupted on load (e.g. a half
  sync download), the plugin restores it by itself from the newest device-local backup verified by checksum
  and supplements missing notes via
  delta reindex — provided the embedding endpoint is reachable. Otherwise as before:
  write protection + message.

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
- Endpoint presets: one-click buttons "+ LM Studio" / "+ Ollama" with correct default ports.
- Plain-language diagnosis per endpoint instead of just red/green (connection refused / unknown hostname / timeout / no LLM API).
- Non-blocking input validation (missing scheme/port, placeholder IP).

### Changed
- Chat endpoint default changed to `http://localhost:1234` (LM Studio).

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
