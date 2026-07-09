# Vault Retrieval

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/vault-rag?gitea_url=https%3A%2F%2Fcodeberg.org&label=release)](https://codeberg.org/jkaindl/vault-rag/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.4%2B%20·%20desktop%20%26%20mobile-7c3aed)

**Retrieval over your own vault — related notes, semantic search, and grounded chat — running locally and offline.**

Vault Retrieval turns your notes into a searchable knowledge base without sending anything to the cloud. It reads a small embedding index that ships with your vault and answers three questions: *What else have I written about this? Where did I say something like that? What does my vault know about X?* Generation (chat) runs against a local LLM endpoint you control.

## Features

- **Related notes** — a side panel ranks the notes most similar to the one you're reading. Cosine similarity over a compact note-level index, computed on-device — works fully offline, including on mobile.
- **Semantic search** — find notes by *meaning*, not just keywords.
- **Grounded RAG chat** — ask your vault a question and get an answer grounded in retrieved notes, streamed token-by-token from your local LLM. An editable live-context panel shows exactly which notes feed the answer, with source chips that link back.
- **Visible thinking, with an off switch** — for reasoning models, the live "💭 thinking" stream appears in a collapsible block above the answer and folds away once it arrives (and is never sent back into the conversation history). A toggle suppresses thinking when you want faster answers — via cross-server-portable hints — and a settings test tells you whether your model actually honours it.
- **Model capability hints** — settings show, best-effort, whether the selected chat model supports vision and/or thinking, so you can pick the right one. Each endpoint has an inline connection test, and the model pickers populate from the server.
- **Live indexing** — notes are re-embedded on save; edits made offline queue up and catch up automatically on reconnect.
- **Smart Apply — restructure a note into a template** *(opt-in)* — pick a template and a local LLM reorganises a messy note into its sections, routing your *original* blocks under the right headings. It never invents content — a diff gate shows exactly what moves where before you apply, and the body is rebuilt from your own bytes. Templates self-describe through `%%` guidance comments, and a relevance-ranked template list (cosine over the same index — reusing the stored vectors, no re-embedding) preselects the best fit and updates live as you switch notes. Enable it under **Settings → Smart Apply**.

## Requirements

- **Obsidian 1.4+** (desktop or mobile).
- An **embedding index** in `<vault>/_vaultrag/` (default path; configurable in settings and hidden in the file explorer by default) — produced by your indexing backend and synced with the vault. The related-notes panel and semantic search need only this index; no running server.
- For **chat** (and live re-indexing): an **OpenAI-compatible local LLM endpoint** ([Ollama](https://ollama.com) for embeddings, [LM Studio](https://lmstudio.ai) for chat). New to local LLMs? The **[local LLM setup guide](https://uplink.jkaindl.de/llm-setup)** walks you through it. Configurable in settings; nothing leaves your machine.

## Install

### Community Plugins

In Obsidian, open **Settings → Community plugins → Browse**, search for **Vault Retrieval**, then install and enable it.

### Manual

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://codeberg.org/jkaindl/vault-rag/releases), drop them into `<vault>/.obsidian/plugins/vault-retrieval/`, then enable **Settings → Community plugins → Vault Retrieval**.

### BRAT (beta)

Add the GitHub mirror `johannes-kaindl/vault-rag` in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to track pre-release builds.

### From source

```bash
git clone https://codeberg.org/jkaindl/vault-rag
cd vault-rag
npm install
npm run build      # → main.js
# copy main.js, manifest.json, styles.css into <vault>/.obsidian/plugins/vault-retrieval/
```

## Usage

1. Enable the plugin and open a note. The **Related notes** panel (ribbon: 🔍) populates automatically.
2. Open **Semantic search** (ribbon: 🔭) to query the vault by meaning.
3. Open **Vault Chat** (ribbon: 💬), point the chat endpoint at your local LLM in settings, and ask away. Edit the live-context list to control which notes ground the answer.
4. *(Optional)* Enable **Smart Apply** in settings, then open its cockpit (ribbon: 🪄). Pick a template from the relevance-ranked list and apply it to the active note — review the diff, then accept, re-generate, or pick another template.

### Configuration

| Setting | What it does | Default |
|---|---|---|
| Embedding endpoint / model | Re-embeds notes on save | `http://localhost:11434` · `qwen3-embedding:8b` |
| Chat endpoint / model | LLM for RAG chat | `http://localhost:8080` · `qwen3` |
| Index folder | Where the synced index lives. Cross-device sync (including iPhone) requires the Obsidian Sync option "Sync all other file types" | `_vaultrag` |
| Hide index folder in file explorer | Hides the index folder from the file explorer for a cleaner workspace (cosmetic; data and sync are unaffected) | on |
| Similarity / top-k | Retrieval thresholds | tunable |
| Excluded folders | Paths skipped by indexing | `Templates/`, `Archive/` |
| Context budget | Max characters fed as context (ceiling follows the model window) | `12000` |
| Suppress thinking | Default for new chats; also a per-chat toggle in the panel | off |
| Enter sends | On: Enter sends, Shift+Enter newlines · Off: reversed | on |

> **Endpoint tip:** enter the base URL *without* a trailing `/v1` — the plugin appends it. Both forms are accepted.

## How it works

Your indexing backend exports a portable note-level **Matryoshka-256 int8 mini-index** (~1.4 MB) into `<vault>/_vaultrag/`. The plugin loads it and runs **brute-force cosine locally** — no daemon, no VPN, no on-device LLM needed for retrieval. Only chat talks to an LLM, over an endpoint you configure. The portable index is what makes retrieval work identically across all your synced devices.

Architecture, module layout and contributor conventions live in [`AGENTS.md`](AGENTS.md).

## MCP server (use your index from Claude Code & other agents)

The plugin's embedding index doubles as a retrieval backend for MCP clients
(Claude Code, OpenClaw, …). A bundled stdio server exposes three read-only tools:

| Tool | What it does | Needs endpoint? |
|---|---|---|
| `search` | Semantic search over the vault (query → `{path, score}` hits) | yes (embeds the query) |
| `related` | Notes related to a given note (straight from the index) | no — works offline |
| `read_note` | Full markdown text of a note (`.md` only, excludes respected) | no — works offline |

Build once (`npm run build` produces `mcp-server.js`), then register it,
e.g. in Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "vault-retrieval": {
      "command": "node",
      "args": ["/path/to/vault-rag/mcp-server.js", "/path/to/your/vault"]
    }
  }
}
```

Configuration (endpoints, index folder, excludes) is read at server startup
from the plugin's own settings (`.obsidian/plugins/vault-retrieval/data.json`).
Restart the MCP server to apply settings changes — the index itself is picked up
live (the server reloads it whenever the plugin rewrites it). Env overrides:
`VAULT_RAG_EMBEDDING_ENDPOINT`, `VAULT_RAG_EMBEDDING_MODEL`, `VAULT_RAG_INDEX_DIR`.
One server instance per vault. The server never writes to your vault.

Note: `read_note` enforces exclude prefixes case-insensitively (safe on case-insensitive filesystems like APFS/NTFS), while `search`/`related` filter result paths case-sensitively — they expose only paths and scores, never content.

## Related

Image transcription (handwriting/screenshots → Markdown) lives in the sibling plugin **[image-to-markdown](https://codeberg.org/jkaindl/image-to-markdown)**.

## Contributing

Issues and pull requests are welcome on [Codeberg](https://codeberg.org/jkaindl/vault-rag). The project is test-driven — every change ships with tests (`npm test`), and larger features go through a brainstorm → spec → plan → TDD flow ([`docs/superpowers/`](docs/superpowers/)). See [`AGENTS.md`](AGENTS.md) for conventions.

## License

- **Code:** GNU Affero General Public License v3.0 or later ([`LICENSE`](LICENSE)). A commercial dual-license is available on request if the AGPL's copyleft doesn't fit your use case.
- **Documentation & text:** Creative Commons Attribution-ShareAlike 4.0 ([`LICENSE-DOCS`](LICENSE-DOCS)).

Copyright © 2026 Johannes Kaindl.
