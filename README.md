# Vault Retrieval

> 🇬🇧 English · [🇩🇪 Deutsch](https://github.com/johannes-kaindl/vault-rag/blob/main/README.de.md)

**Retrieval over your own vault — related notes, semantic search, and grounded chat — running locally and offline.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/vault-rag?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/vault-rag/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.12.7%2B%20·%20desktop%20%26%20mobile-7c3aed)

Vault Retrieval turns your notes into a searchable knowledge base without sending anything to the cloud. It keeps a small embedding index inside your vault — synced along with it, readable on every device — and answers three questions: *What else have I written about this? Where did I say something like that? What does my vault know about X?* Embedding and generation run against local LLM endpoints you control.

> **Interface language:** the plugin's UI is currently **German only** — labels, commands and notices are not yet localised. English localisation is in progress. Where you need an exact string to find something in Obsidian (command palette, settings), this README gives it in `code`.

## Features

Everything lives in **one sidebar view** with tabs: related notes, search, chat, reformat, plus Smart Apply once you enable it. Panels stay mounted, so a running chat stream or a pending Smart Apply survives switching tabs.

- **Related notes** — a side panel ranks the notes most similar to the one you're reading. Cosine similarity over a compact note-level index, computed on-device — works fully offline, including on mobile.
- **Semantic search** — find notes by *meaning*, not just keywords.
- **Grounded RAG chat** — ask your vault a question and get an answer grounded in retrieved notes, streamed token-by-token from your local LLM. An editable live-context panel shows exactly which notes feed the answer, with source chips that link back.
- **Visible thinking, with an off switch** — for reasoning models, the live "💭 thinking" stream appears in a collapsible block above the answer and folds away once it arrives (and is never sent back into the conversation history). A toggle suppresses thinking when you want faster answers — via cross-server-portable hints — and a settings test tells you whether your model actually honours it.
- **Model capability hints** — settings show, best-effort, whether the selected chat model supports vision and/or thinking, so you can pick the right one. Each endpoint has an inline connection test, and the model pickers populate from the server.
- **Live indexing** — notes are re-embedded on save; edits made offline queue up and catch up automatically on reconnect. A full **reindex** command builds the whole index from your vault, so you can start from nothing with just an embedding endpoint.
- **An index that defends itself** — the index is your data, and losing it costs an hour of re-embedding. So: writes that would shrink it are refused rather than performed, a truncated index (half-finished sync download) is detected on load and switches the plugin to read-only instead of overwriting good data, device-local backups are rotated automatically and can be restored from the command palette, and a **self-heal** command re-embeds only the notes the index is actually missing. Empty notes are never counted as missing.
- **Smart Apply — restructure a note into a template** *(opt-in)* — pick a template and a local LLM reorganises a messy note into its sections, routing your *original* blocks under the right headings. It never invents content — a diff gate shows exactly what moves where before you apply, and the body is rebuilt from your own bytes. Templates self-describe through `%%` guidance comments, and a relevance-ranked template list (cosine over the same index — reusing the stored vectors, no re-embedding) preselects the best fit and updates live as you switch notes. Enable it under **Settings → Smart Apply**.
- **Reformat a selection** — select any block of text and run the reformat command (command palette or editor context menu) to reshape it. Mechanical transforms (transpose a table, table → list, wrap in a callout) apply instantly, no LLM involved. Shape-changing transforms (→ list, → prose, → table, → Mermaid diagram, or your own free-text instruction) stream a preview from your local chat LLM that you review and can regenerate before applying. Every transform is also available from the reformat tab in the sidebar, which shows what is currently selected and greys the buttons out (with the reason) when it cannot run.

## Requirements

- **Obsidian 1.12.7+** (desktop or mobile). On 1.13+ the settings tab renders through Obsidian's native, searchable settings API; on older versions it draws the same structure imperatively.
- An **embedding endpoint** — an OpenAI-compatible local server such as [Ollama](https://ollama.com) — to build and maintain the index. Run the full-reindex command once and the plugin embeds your vault into `<vault>/_vaultrag/` itself; from then on notes are re-embedded on save. Alternatively, drop in an index produced by an external backend and synced with the vault — the format is the same.
- **Nothing else for retrieval.** Once the index exists, related notes and semantic search run entirely on-device — no server, no daemon, offline, including on mobile.
- For **chat**, **Smart Apply** and LLM-backed reformatting: an **OpenAI-compatible local LLM endpoint** ([LM Studio](https://lmstudio.ai), for example). New to local LLMs? The **[local LLM setup guide](https://uplink.jkaindl.de/llm-setup)** walks you through it. Configurable in settings; nothing leaves your machine.

## Install

### Community Plugins

In Obsidian, open **Settings → Community plugins → Browse**, search for **Vault Retrieval**, then install and enable it.

### Manual

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://git.jkaindl.de/jkaindl/vault-rag/releases), drop them into `<vault>/.obsidian/plugins/vault-retrieval/`, then enable **Settings → Community plugins → Vault Retrieval**.

### BRAT (beta)

Add the GitHub mirror `johannes-kaindl/vault-rag` in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to track pre-release builds.

### From source

```bash
git clone https://git.jkaindl.de/jkaindl/vault-rag
cd vault-rag
npm install
npm run build      # → main.js
# copy main.js, manifest.json, styles.css into <vault>/.obsidian/plugins/vault-retrieval/
```

## Usage

1. Point the **embedding endpoint** at your local server in settings, then run the full-reindex command from the command palette. (Skip this if you already have an index in `_vaultrag/`.)
2. Click the **layers** ribbon icon to open the sidebar. Open a note — the related-notes tab populates automatically.
3. Switch to the search tab to query the vault by meaning.
4. Switch to the chat tab, point the chat endpoint at your local LLM in settings, and ask away. Edit the live-context list to control which notes ground the answer.
5. *(Optional)* Enable **Smart Apply** in settings — it then appears as an extra tab. Pick a template from the relevance-ranked list and apply it to the active note; review the diff, then accept, re-generate, or pick another template.
6. Select a block of text, then run the reformat command from the command palette or the editor right-click menu — or use the reformat tab and click a transform. Mechanical ones apply immediately; LLM ones open a streamed preview to review before applying. Reformatting needs editing mode; in reading mode the buttons stay disabled and say so. If you edit the note while a preview is open, the replacement is refused rather than applied at the wrong spot.

### Commands

Until the UI is localised, the command palette lists these in German — the middle column is what you type to find them.

| Command | In the command palette | What it does |
|---|---|---|
| Open sidebar (per tab) | `Verwandte Notizen öffnen` · `Semantische Suche öffnen` · `Vault Chat öffnen` · `Umformatieren-Panel öffnen` | Opens the sidebar on that tab |
| Reformat selection | `Abschnitt umformatieren` | Reshapes the current selection (see step 6) |
| Smart Apply on active note | `Smart Apply auf aktive Notiz` | Restructures the active note into a template |
| Reindex vault | `Vault neu indizieren` | Rebuilds the whole index from the vault |
| Complete the index | `Index vervollständigen (fehlende Notizen)` | Embeds only what the index is missing |
| Restore index backup | `Index aus Backup wiederherstellen` | Restores a device-local index backup |

### Configuration

| Setting | What it does | Default |
|---|---|---|
| Embedding endpoint / model | Re-embeds notes on save | `http://localhost:11434` · `qwen3-embedding:8b` |
| Chat endpoint / model | LLM for RAG chat, Smart Apply and reformatting | `http://localhost:1234` · `qwen3` |
| Index folder | Where the synced index lives. Cross-device sync (including iPhone) requires the Obsidian Sync option "Sync all other file types" | `_vaultrag` |
| Hide index folder in file explorer | Hides the index folder from the file explorer for a cleaner workspace (cosmetic; data and sync are unaffected) | on |
| Similarity / top-k | Retrieval thresholds | `0.3` · `20` |
| Excluded folders | Paths skipped by indexing (dot-folders are always skipped) | `Templates/`, `Archive/` |
| Status bar | Shows embedding progress (`● indexed \| ⏳ pending`); revealed automatically during a reindex | off |
| Re-embed delay | How long after a save the note is re-embedded | `3000` ms |
| Smart Apply | Off by default; enabling it adds the tab, the command and the template settings | off |
| Context budget | Max characters fed as context (ceiling follows the model window) | `12000` |
| Suppress thinking | Default for new chats; also a per-chat toggle in the panel | off |
| Enter sends | On: Enter sends, Shift+Enter newlines · Off: reversed | on |

> **Endpoint tip:** enter the base URL *without* a trailing `/v1` — the plugin appends it. Both forms are accepted.

## How it works

The index in `<vault>/_vaultrag/` is a portable note-level **Matryoshka-256 int8 mini-index** — one 256-dimensional int8 vector per note, roughly 1.4 MB for a few thousand notes. Small enough to sync with the vault, which is the whole point: the plugin loads it and runs **brute-force cosine locally**, so retrieval works identically on every synced device — no daemon, no VPN, no on-device LLM. Only chat, Smart Apply and LLM reformatting talk to an endpoint, and only one you configure.

The plugin writes that index itself, as a single container file (`_vaultrag/index.bin`, CRC-checked on every load — one file instead of several means a sync service can never deliver a mixed generation), and reads any index in the same format — including one exported by an external backend such as HyperForge.

Architecture, module layout and contributor conventions live in [`AGENTS.md`](https://github.com/johannes-kaindl/vault-rag/blob/main/AGENTS.md).

## Documentation

Full guides live in [`docs/`](https://github.com/johannes-kaindl/vault-rag/tree/main/docs), organised along [Diátaxis](https://diataxis.fr):

| | |
|---|---|
| **[Tutorial](https://github.com/johannes-kaindl/vault-rag/blob/main/docs/tutorial.md)** | From zero to your first related notes — start here |
| **[How-to guides](https://github.com/johannes-kaindl/vault-rag/blob/main/docs/how-to/index.md)** | Chat setup, reformatting, Smart Apply, repairing an index, MCP, cross-device sync |
| **[Reference](https://github.com/johannes-kaindl/vault-rag/blob/main/docs/reference/index.md)** | Every command, setting, default, MCP tool and the index format |
| **[Explanation](https://github.com/johannes-kaindl/vault-rag/blob/main/docs/explanation/index.md)** | Why the index looks the way it does, and where its guarantees end |

## MCP server (use your index from Claude Code & other agents, desktop only)

The plugin's embedding index doubles as a retrieval backend for MCP clients
(Claude Code, OpenClaw, …). An in-plugin HTTP server (Streamable HTTP, loopback-only)
exposes three read-only tools:

| Tool | What it does | Needs endpoint? |
|---|---|---|
| `search` | Semantic search over the vault (query → `{path, score}` hits) | yes (embeds the query) |
| `related` | Notes related to a given note (straight from the index) | no — works offline |
| `read_note` | Full markdown text of a note (`.md` only, excludes respected) | no — works offline |

Enable it in the plugin settings under "MCP-Server" (desktop only — the toggle and server
are disabled on mobile). The server binds to `127.0.0.1` on a configurable port (default
`8123`) and requires a Bearer token on every request. The settings section has a "copy
command" button that generates the registration command for you, e.g.:

```bash
claude mcp add --transport http vault-retrieval http://127.0.0.1:8123/mcp \
  --header "Authorization: Bearer <token>"
```

Configuration (endpoints, index folder, excludes) is read from the plugin's own settings —
no separate config file. The server only runs while Obsidian is open and picks up index
changes live (reloads whenever the plugin rewrites the index). One server instance per
vault. The server never writes to your vault.

Note: `read_note` enforces exclude prefixes case-insensitively (safe on case-insensitive filesystems like APFS/NTFS), while `search`/`related` filter result paths case-sensitively — they expose only paths and scores, never content.

## Related

Image transcription (handwriting/screenshots → Markdown) lives in the sibling plugin **[image-to-markdown](https://git.jkaindl.de/jkaindl/image-to-markdown)**.

## Contributing

Issues and pull requests are welcome on [Forgejo](https://git.jkaindl.de/jkaindl/vault-rag) (canonical; GitHub is a mirror). The project is test-driven — every change ships with tests (`npm test`), and larger features go through a brainstorm → spec → plan → TDD flow ([`docs/superpowers/`](https://github.com/johannes-kaindl/vault-rag/tree/main/docs/superpowers)). See [`AGENTS.md`](https://github.com/johannes-kaindl/vault-rag/blob/main/AGENTS.md) for architecture and conventions.

## License

- **Code:** GNU Affero General Public License v3.0 or later ([`LICENSE`](LICENSE)). A commercial dual-license is available on request if the AGPL's copyleft doesn't fit your use case.
- **Documentation & text:** Creative Commons Attribution-ShareAlike 4.0 ([`LICENSE-DOCS`](LICENSE-DOCS)).

Copyright © 2026 Johannes Kaindl.
