# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Changed
- **Breaking:** IMG→MD (image transcription) has been split out into its own plugin,
  [`image-to-markdown`](https://codeberg.org/jkaindl/vault-rag). vault-rag is now a focused RAG core
  (related notes, semantic search, chat). The IMG→MD sidebar, command and editor context-menu entry,
  along with the Vision settings, move there. Install `image-to-markdown` separately to keep that feature.

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
