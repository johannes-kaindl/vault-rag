# Tutorial — from zero to your first related notes

> **Diátaxis: Tutorial.** Learning-oriented: one guaranteed-to-work pass from nothing to a
> working index. Not a complete reference — see [Reference](reference/index.md) for that.

By the end of this you will have an embedding index in your vault and a sidebar that shows,
for any note you open, which other notes are about the same thing. Everything runs on your
machine.

**Time:** ~10 minutes of setup, plus one unattended indexing run (minutes to an hour, depending
on vault size and hardware).

> **Interface language:** the plugin's UI is currently German only. Exact strings you need to
> type or click are given in `code` below.

## Step 1 — Get an embedding server running

The plugin does not ship a model. It talks to an OpenAI-compatible endpoint on your own
machine. The simplest route is [Ollama](https://ollama.com):

```bash
ollama pull qwen3-embedding:8b   # the plugin's default model
ollama serve                     # listens on http://localhost:11434
```

Any server that speaks the same API works — the model just has to produce embeddings.

> **Smaller machine?** A smaller embedding model is fine. Whatever you choose, stay with it:
> vectors from different models are not comparable, so switching later means reindexing.

## Step 2 — Install and enable the plugin

Install **Vault Retrieval** from **Settings → Community plugins → Browse**, then enable it.

## Step 3 — Point the plugin at your endpoint

Open **Settings → Vault Retrieval**. In the embedding section, check that the endpoint matches
your server (default `http://localhost:11434`) and that the model name matches what you pulled.
Each endpoint row has an inline connection test — use it now. If it fails, nothing later will
work, and you want to know that here rather than halfway through indexing.

## Step 4 — Build the index

Open the command palette and run `Vault neu indizieren` ("reindex vault").

The plugin reads every Markdown note, splits it into chunks, embeds them, averages each note's
chunks into a single vector, and writes the result to `_vaultrag/` inside your vault. Progress
appears in a notice and in the status bar.

This is the long step. It only happens once — from here on, notes are re-embedded individually
as you save them.

> **Notes that stay out:** empty notes and notes that are only frontmatter produce no chunks
> and are deliberately not indexed. They are not missing — the plugin tracks them separately so
> they never show up as a gap.

## Step 5 — See it work

Click the **layers** icon in the left ribbon. The sidebar opens with the related-notes tab
active. Open any note — the panel fills with the notes closest to it, most similar first.

Click a result to jump to it. Switch to the search tab and type a phrase to find notes by
meaning rather than by keyword: try describing an idea in words you never actually wrote down.

## What you have now

- A portable index in `_vaultrag/` (roughly 1.4 MB for a few thousand notes) that syncs with
  your vault and works on every device, including mobile, **without** a server.
- Live indexing: saving a note re-embeds it. Edits made offline queue up and catch up when the
  endpoint is reachable again.

## Where to go next

- Ask questions of your vault: [How-to → Set up chat](how-to/index.md#set-up-grounded-chat)
- Understand what is actually stored: [Explanation → The index](explanation/index.md)
- Every command and setting: [Reference](reference/index.md)
