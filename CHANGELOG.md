# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

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
