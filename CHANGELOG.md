# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

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
  [`image-to-markdown`](https://codeberg.org/jkaindl/vault-rag). vault-rag is now a focused RAG core
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
