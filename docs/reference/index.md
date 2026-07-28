# Reference

> **Diátaxis: Reference.** Information-oriented: what exists, what it is called, what the
> defaults are. For narrative see the [Tutorial](../tutorial.md) and
> [How-to guides](../how-to/index.md).

> **Interface language:** the UI is currently German only. Command and label strings below are
> given as they appear in the app.

## Commands

| Command | In the command palette | Notes |
|---|---|---|
| Open sidebar — related notes | `Verwandte Notizen öffnen` | Opens the hub on the related tab |
| Open sidebar — search | `Semantische Suche öffnen` | |
| Open sidebar — chat | `Vault Chat öffnen` | |
| Open sidebar — reformat | `Umformatieren-Panel öffnen` | |
| Reformat selection | `Abschnitt umformatieren` | Also in the editor context menu |
| Smart Apply on active note | `Smart Apply auf aktive Notiz` | Only when Smart Apply is enabled |
| Reindex vault | `Vault neu indizieren` | Full rebuild; needs the embedding endpoint |
| Complete the index | `Index vervollständigen (fehlende Notizen)` | Delta-only; embeds what is missing |
| Restore index backup | `Index aus Backup wiederherstellen` | Picks from the last three snapshots |

Commands carry no default hotkeys — assign your own under **Settings → Hotkeys**.

## Ribbon and sidebar

One ribbon icon (**layers**) opens a single sidebar view containing all panels as tabs: related,
search, chat, reformat, and Smart Apply when enabled. Panels stay mounted when you switch tabs,
so a streaming answer or a pending Smart Apply is not thrown away.

## Settings

### Retrieval

| Setting | Effect | Default |
|---|---|---|
| Top-k | How many results the related/search panels return | `20` |
| Minimum similarity | Cosine floor below which hits are discarded | `0.3` |
| Excluded folders | Path prefixes skipped by indexing and retrieval | `Templates/`, `Archive/` |

Dot-folders (`.obsidian/`, `.trash/`, …) are always skipped and need no exclude entry.

### Embedding

| Setting | Effect | Default |
|---|---|---|
| Embedding endpoints | OpenAI-compatible servers; each row has a connection test | `http://localhost:11434` |
| Embedding model | Must stay constant — vectors from different models aren't comparable | `qwen3-embedding:8b` |
| Re-embed delay | Debounce between saving a note and re-embedding it | `3000` ms |
| Status bar | Shows embedding progress; revealed automatically during a reindex | off |

### Index

| Setting | Effect | Default |
|---|---|---|
| Index folder | Where the index lives inside the vault | `_vaultrag` |
| Hide index folder | Cosmetic hiding in the file explorer; data and sync unaffected | on |

### Index robustness

| Item | Effect |
|---|---|
| Index state | Read-only summary: how many notes are indexed vs. present |
| Restore from backup | Opens the snapshot picker (last three, device-local) |
| Reindex vault | Full rebuild — the last resort |

### Chat

| Setting | Effect | Default |
|---|---|---|
| Chat endpoints / model | LLM used for chat, Smart Apply and LLM reformatting | `http://localhost:1234` · `qwen3` |
| Context notes (k) | How many retrieved notes are offered as context | `5` |
| Context budget | Maximum characters of context; ceiling follows the model window | `12000` |
| Temperature | Sampling temperature for chat | `0.7` |
| System prompt | Grounding instruction sent with every conversation | see settings |
| Input position | Composer above or below the transcript | bottom |
| Suppress thinking | Default for new chats; also a per-chat toggle | off |
| Enter sends | On: Enter sends, Shift+Enter newline · Off: reversed | on |

### Smart Apply *(opt-in)*

| Setting | Effect | Default |
|---|---|---|
| Enable Smart Apply | Adds the tab and the command | off |
| Template folder | Where templates are read from | `Templates/` |
| Model | Overrides the chat model for Smart Apply | chat model |
| Temperature | Sampling temperature | `0` |
| Max tokens | Output cap for a restructuring run | `4096` |
| Default mode | `deterministisch` · `additiv` · `transformativ` | `deterministisch` |
| Suppress thinking | Independent of the chat setting | off |

### MCP server *(desktop only)*

| Setting | Effect | Default |
|---|---|---|
| Enable MCP server | Starts the loopback HTTP server while Obsidian runs | off |
| Port | Listening port on `127.0.0.1` | `8123` |
| Token | Bearer token required on every request | generated |

## MCP tools

| Tool | Returns | Needs the embedding endpoint |
|---|---|---|
| `search` | Semantic search over the vault → `{path, score}` | yes (embeds the query) |
| `related` | Notes related to a given note | no — served from the index |
| `read_note` | Full Markdown of a note (`.md` only, excludes respected) | no |

Read access is limited to real vault Markdown files; deleted notes (`.trash/`) and paths outside
the vault are refused. The server never writes.

## Index format

`<vault>/<index folder>/` holds three files:

| File | Contents |
|---|---|
| `notes.i8` | Int8 matrix, one row per note, `count × 256` bytes |
| `paths.json` | Vault paths, same order as the matrix rows |
| `manifest.json` | Metadata: model, dimensions, count, build time |

Fixed properties: **256** dimensions (Matryoshka-truncated), int8 quantisation with scale
**127**, one vector per note aggregated as the **mean** of its chunk vectors. `manifest.json` is
written **last** — it is the reload trigger, and its presence means the other two files are
complete.

On load, `count` is checked against both the number of paths and the byte length of the matrix.
A mismatch is treated as damage: the plugin refuses to write and says so, rather than
overwriting good data. See
[Explanation → Why the index defends itself](../explanation/index.md#why-the-index-defends-itself).

## Files and locations

| Path | What it is | Synced |
|---|---|---|
| `<vault>/_vaultrag/` | The index (configurable location) | yes, if your sync includes non-Markdown files |
| `<vault>/_vaultrag/pending.json` | Notes queued for re-embedding while offline | yes |
| `<plugin folder>/index-backups/` | Last three index snapshots | no — device-local by design |
| `<plugin folder>/data.json` | Your settings | depends on your sync configuration |

## Architecture

Module layout, invariants and contributor conventions live in
[`AGENTS.md`](https://github.com/johannes-kaindl/vault-rag/blob/main/AGENTS.md).
