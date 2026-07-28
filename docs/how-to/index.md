# How-to guides

> **Diátaxis: How-to.** Task-oriented: how to accomplish a specific thing. Assumes you have a
> working index — if not, start with the [Tutorial](../tutorial.md).

> **Interface language:** the UI is currently German only. Exact strings are given in `code`.

- [Set up grounded chat](#set-up-grounded-chat)
- [Reformat a selection](#reformat-a-selection)
- [Restructure a note into a template (Smart Apply)](#restructure-a-note-into-a-template-smart-apply)
- [Repair an index that lost notes](#repair-an-index-that-lost-notes)
- [Restore an index backup](#restore-an-index-backup)
- [Move the index folder](#move-the-index-folder)
- [Use your vault from Claude Code and other MCP clients](#use-your-vault-from-an-mcp-client)
- [Sync the index across devices](#sync-the-index-across-devices)

## Set up grounded chat

Chat needs a second endpoint: a local LLM that generates text (embeddings alone can't answer
questions). [LM Studio](https://lmstudio.ai) is a common choice.

1. Start your LLM server and note its address (LM Studio defaults to `http://localhost:1234`).
2. In **Settings → Vault Retrieval**, set the chat endpoint and pick a model — the dropdown
   populates from the server.
3. Open the sidebar (**layers** ribbon icon) and switch to the chat tab.

Ask a question. The plugin retrieves the most relevant notes, feeds them as context, and streams
the answer. The context panel above the conversation shows exactly which notes were used; you
can remove one and re-ask to see the difference.

**Enter behaviour** is configurable: by default Enter sends and Shift+Enter inserts a newline.

**Thinking models:** if the model emits reasoning, it appears in a collapsible block above the
answer and is never fed back into the conversation. To suppress it, turn on the thinking
suppression setting — a built-in test tells you whether your model actually honours the hint,
because not all of them do.

## Reformat a selection

Select a block of text, then run `Abschnitt umformatieren` from the command palette or the
editor's right-click menu. Alternatively use the reformat tab in the sidebar, which shows what
is currently selected.

Two kinds of transform:

- **Mechanical** (transpose a table, table → list, wrap in a callout) — computed locally,
  applied instantly, no LLM involved. Undo with Cmd/Ctrl+Z.
- **LLM-backed** (→ list, → prose, → table, → Mermaid, or a free-text instruction) — streamed
  into a preview window. Nothing is replaced until you click apply; you can regenerate first.

Reformatting requires editing mode. In reading mode Obsidian exposes no editor state, so the
buttons stay disabled and tell you why. If you edit the note while a preview is open, the
replacement is refused rather than applied at a position that has moved.

## Restructure a note into a template (Smart Apply)

Smart Apply is off by default. Enable it under **Settings → Vault Retrieval → Smart Apply**; it
then appears as an extra sidebar tab and adds the command `Smart Apply auf aktive Notiz`.

1. Put your templates in the configured template folder.
2. Open a messy note and the Smart Apply tab. The template list is ranked by relevance to the
   current note (cosine over the same index — no re-embedding) and updates as you switch notes.
3. Pick a template and generate. A diff gate shows what moves where.
4. Accept, regenerate, or pick a different template.

The body is rebuilt from **your** bytes — the model decides where blocks go, not what they say.
Templates can describe themselves to the model through `%%` comments, which are stripped from
the result.

## Repair an index that lost notes

If the index is missing notes — after a partial sync, an interrupted run, or a device that was
offline for a while — run `Index vervollständigen (fehlende Notizen)`.

This is a **delta** operation: it compares the vault against the index and embeds only what is
absent. It does not touch existing vectors, and it is much faster than a full reindex. Empty
notes are skipped rather than counted as failures, and the result message says plainly how many
were added, skipped and failed.

The plugin also offers this by itself when it notices a substantial gap on load.

## Restore an index backup

Run `Index aus Backup wiederherstellen` and pick a snapshot. The plugin keeps the last three
device-local copies (in the plugin folder, so they are **not** synced) and takes one after every
successful load and before risky operations.

> **Caveat worth knowing:** backups are taken from what is currently on disk. If a problem went
> unnoticed for a while, all three snapshots may already contain it. For a bad index the honest
> fallback is a full reindex or a filesystem-level backup (Time Machine, Borg, …).

## Move the index folder

Change the index folder in settings. The plugin **copies** the index to the new location, checks
that the copy is complete, and only then removes the old folder — and only if that folder
contains nothing but index files. If the copy is incomplete, nothing is deleted.

Note that `_vaultrag` is deliberately not a dot-folder: Obsidian Sync ignores dot-folders, and
the index is meant to travel with the vault.

## Use your vault from an MCP client

The plugin can expose its index to MCP clients (Claude Code, and others) through an in-plugin
HTTP server. Desktop only — the toggle is disabled on mobile.

1. Enable the MCP server in settings. A token is generated for you.
2. Use the "copy command" button to get a ready-made registration command:

```bash
claude mcp add --transport http vault-retrieval http://127.0.0.1:8123/mcp \
  --header "Authorization: Bearer <token>"
```

Three read-only tools are exposed: `search`, `related` and `read_note`. The server binds to
`127.0.0.1`, requires the bearer token on every request, runs only while Obsidian is open, and
never writes to your vault. Excluded folders are respected, and only real vault Markdown files
can be read.

## Sync the index across devices

The index is a normal folder in your vault, so any sync mechanism carries it. With **Obsidian
Sync**, enable **"Sync all other file types"** — otherwise `_vaultrag/` is skipped and your
other devices have no index.

On a device that receives the index by sync, retrieval works immediately and offline. No
endpoint is needed there unless you want that device to *update* the index too.

> **Known limitation:** the index is three files (`notes.i8`, `paths.json`, `manifest.json`) and
> sync resolves conflicts per file. A device writing while another syncs can produce a mixed
> state. The plugin detects this on load, refuses to write, and tells you — see
> [Explanation → Why the index defends itself](../explanation/index.md#why-the-index-defends-itself).
