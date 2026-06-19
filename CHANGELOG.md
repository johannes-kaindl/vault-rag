# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added
- **Visible thinking in chat** — reasoning models' `reasoning_content` (and inline `<think>…</think>`
  tags via a chunk-robust `ThinkSplitter`) are captured during streaming and shown in a collapsible
  "💭 thinking" block above each answer: live-open while thinking, auto-collapsed once the answer
  arrives. Reasoning is ephemeral and never sent back to the LLM in multi-turn history. The working
  timer is phase-aware ("thinking…" → "generating…").

### Fixed
- Stream end is now drained cleanly — the `ThinkSplitter`'s buffered tag remainder and the
  `TextDecoder`'s pending bytes are flushed, preventing silent loss of the last characters.

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
