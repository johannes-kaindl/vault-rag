# Vault RAG

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Obsidian](https://img.shields.io/badge/obsidian-1.4.0%2B-purple)](https://obsidian.md)

One Obsidian plugin for **local, offline retrieval over your vault** — related notes, semantic search, and a grounded RAG chat — all from a single shared embedding index.

**Target platform:** Obsidian 1.4.0+, desktop and mobile. No telemetry, no remote services required for retrieval — the related-notes panel runs entirely offline, on every device.

> **Status: pre-release (0.1.0), local-only.** Slice A (related notes) is built and in daily use; Slice B (RAG chat) is feature-complete. Not yet published to a forge or the Obsidian Community Directory. See [`CHANGELOG.md`](CHANGELOG.md).

---

## Why

Three AI plugins (Similar Notes, Local GPT, Smart Composer) each compute **their own** embeddings over the same model — redundant and resource-hungry, and one of them writes a synced chat database into the vault. **Vault RAG** replaces all three with **one** plugin on **one** shared retrieval backend, and keeps retrieval (offline, on-device) cleanly separate from generation (your local LLMs).

## What it does

- **Related notes** — a side panel shows the notes most similar to the one you're reading. Brute-force cosine over a tiny note-level index, computed locally — works offline on every device, including mobile.
- **Semantic search** — query your vault by meaning, not just keywords; reuses the same cosine engine.
- **RAG chat** — ask your vault questions. Answers are grounded in retrieved notes, streamed token-by-token from your local LLM (OpenAI-compatible endpoint, e.g. LM Studio). An editable live-context panel shows exactly which notes feed the answer; source chips link back to them.
- **Visible thinking** — for reasoning models, the live "💭 thinking" stream is shown in a collapsible block above each answer, then folds away when the answer arrives. Reasoning stays out of the conversation history sent back to the model.
- **Live indexing** — edits are re-embedded on save (configurable Ollama/MLX endpoint); offline edits queue in a dirty-list and catch up on reconnect.

## How it works

A companion backend exports a note-level **Matryoshka-256 int8 mini-index** (~1.4 MB) into `<vault>/_vaultrag/` on reindex. The plugin reads it and runs **brute-force cosine locally** — no daemon, no VPN, no on-device LLM needed for the related-notes panel. Generation (chat) is the only part that talks to an LLM, over an endpoint you configure. The portable index format is the reason this works across all your devices and is publishable on its own.

---

## Install

> Pre-release — not yet on a forge or in the Community Directory. Build from source:

```bash
git clone <repo>            # planned home: https://codeberg.org/jkaindl/vault-rag
cd vault-rag
npm install
npm run build               # produces main.js
# copy main.js, manifest.json, styles.css into <vault>/.obsidian/plugins/vault-rag/
```

Then enable **Settings → Community plugins → Installed → Vault RAG**, and point the embedding/chat endpoints at your local LLM in the plugin settings.

---

## Development

```bash
npm run dev                 # esbuild watch
npm run build               # production bundle → main.js
npm test                    # vitest run (115 tests)
npx vitest run tests/<file> # a single test file
npx tsc --noEmit            # typecheck
```

The codebase is strict TDD — every change is backed by a failing test first. Larger features run through the brainstorm → spec → plan → TDD → review chain; specs and plans live under [`docs/superpowers/`](docs/superpowers/).

### Architecture

The Obsidian boundary is a single `VaultAdapter` interface in `src/index.ts`. All index/embedding modules speak **only** that interface — never the Obsidian API directly — so they're unit-testable in Node without a DOM mock. Only `main.ts`, `view.ts`, `chat_view.ts`, `search_view.ts` and `settings.ts` import `obsidian`.

```
src/
├── index.ts          VaultAdapter · IndexManifest · parseIndex · IndexLoader (reads _vaultrag/)
├── retriever.ts      brute-force cosine top-k over normalized vectors
├── chunker.ts        frontmatter-strip + heading-split
├── embedder.ts       EmbeddingClient → Ollama/MLX HTTP endpoint
├── embed_vector.ts   shared embed → index-vector helper
├── live_indexer.ts   note-level vector map; update/remove/rename · build · persist
├── pending_queue.ts  dirty-list; drain-on-reconnect
├── chat_client.ts    OpenAI-compatible SSE streaming (content + reasoning channels)
├── think_splitter.ts pulls <think>…</think> out of the content stream (chunk-robust)
├── chat_session.ts   multi-turn, ephemeral; reasoning kept out of LLM history
├── context_panel.ts  editable live-context list (auto-RAG + pins)
├── context_source.ts buildContext(paths) → grounded system prompt
├── chat_view.ts      RAG chat panel (streaming, sources, thinking block)
├── search_view.ts    semantic search panel
├── view.ts           related-notes side panel
├── settings.ts       settings tab
└── main.ts           plugin entry — events, debounce, drain, status bar
```

---

## Documentation

- [`CHANGELOG.md`](CHANGELOG.md) — per-release notes (Keep-A-Changelog).
- [`AGENTS.md`](AGENTS.md) — orientation for contributors and AI agents; architecture, conventions, gotchas.
- [`docs/superpowers/specs/`](docs/superpowers/specs) — design specs (brainstormed before implementation).
- [`docs/superpowers/plans/`](docs/superpowers/plans) — checkbox implementation plans (task-by-task, TDD).

## Hosting

Planned primary home: **Codeberg** (`codeberg.org/jkaindl/vault-rag`), with GitHub as a release mirror for the Obsidian Community Directory. Currently local-only (pre-release).

---

## License

- **Code:** GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) — see [`LICENSE`](LICENSE). A commercial dual-license is available on request if the AGPL's copyleft doesn't fit your use case.
- **Documentation/text:** Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0) — see [`LICENSE-DOCS`](LICENSE-DOCS).

---

Copyright © 2026 Johannes Kaindl. Code: AGPL-3.0-or-later · Docs: CC BY-SA 4.0.
