# Troubleshooting

Each entry starts with what you see — the wording is the plugin's own English text — then the cause and what to do. If yours is not here, see [Getting help](#getting-help). Deeper index repairs are step-by-step in the [how-to guides](how-to/index.md#repair-an-index-that-lost-notes).

## No related notes, or "No index"

> No related notes (or note not indexed yet).
> No index — create it with the "Reindex vault" command.

**Cause:** the index in `_vaultrag/` does not exist yet, or the open note is not in it (empty notes and notes that hold only frontmatter are deliberately not indexed).

**Fix:** run the command **Reindex vault** once, with the embedding server running. Afterwards notes are re-embedded as you save them.

## Embedder unreachable

> Embedder unreachable (local/VPN).
> Embedding endpoint unreachable — vault indexing aborted.

**Cause:** none of the **Embedding endpoints** answers. Related notes still work from the index; searching (which embeds your query) and indexing do not. In the settings each row shows its own status:

| Row status | Meaning |
|---|---|
| Connection refused — server not running or wrong port. | The server is off, or the port in the address is wrong. |
| Unknown hostname — typo in the address? | The host name does not resolve. |
| Timeout — network unreachable (wrong network / VPN off?). | The machine is not reachable from here. |
| Responds, but is not an OpenAI-compatible endpoint — wrong path/service? | Something answers, but it is not an embeddings server. |
| Access denied — key missing or invalid. | The server wants an API key. Enter it on that row. |

**Fix:** start the server (for Ollama: `ollama serve`) and check the row. Enter the base URL without a trailing `/v1`, with a port for local servers.

## The endpoint is skipped: model does not match the index

> Embedding endpoint skipped: {endpoint} does not match the index's model ({model}). Changing the embedding model requires a full index rebuild.
> ⚠ Vault Retrieval: This endpoint's embedding model does not match the index — nothing will be written (write protection).

**Cause:** vectors from different models cannot be compared, so the plugin refuses to mix them: a mismatched endpoint may still answer searches but is not marked active and nothing is written to the index. See [Why an endpoint's model has to match](explanation/index.md#why-an-endpoints-model-has-to-match).

**Fix:** enter an endpoint that serves the index's model, or — if you meant to switch models — run **Reindex vault** with the new one.

## No model selected for an endpoint

> Vault Retrieval: {endpoint} skipped — no model selected for this endpoint yet. Pick one in the settings under "Embedding endpoints".

**Cause:** an endpoint row without a model. Every row carries its own model.

**Fix:** open the settings, choose the model in that row's dropdown (the server must be running for the list to load).

## Search index corrupted

> ⚠ Search index corrupted
> ⚠ Vault Retrieval: The embedding index for similarity search is damaged — your notes are untouched, only the search index. Write protection active; automatic recovery is being attempted.

**Cause:** the index file failed its integrity check on load (a sync that delivered half a file, a full disk). Your notes are never touched. While the index is damaged the plugin stops writing to it, so a bad copy cannot be synced over a good one.

**Fix:** wait for the automatic recovery, which restores the newest intact local backup. If it cannot, a notice says why — "Automatic recovery not possible (embedding endpoint unreachable)" or "(no intact local backup found)" — and the way out is under **Settings → Vault Retrieval → Index robustness**: **Restore from backup**, or **Reindex vault**. On a device that cannot repair it ("The index is damaged and this device cannot repair it"), repair it on your desktop and let the fixed index sync back. Step by step: [Restore an index backup](how-to/index.md#restore-an-index-backup).

## Notes are missing from the index

> vault-rag: {n} of {total} notes are missing from the index.

**Cause:** notes were added while the endpoint was offline, or on a device that could not embed them.

**Fix:** run **Complete index (missing notes)** — it embeds only what is missing and leaves the rest untouched. See [Repair an index that lost notes](how-to/index.md#repair-an-index-that-lost-notes).

## Notes that cannot be found, or are out of date

> vault-rag: {n} notes are in the index but carry an unusable vector — they cannot be found. Queued for re-embedding.
> vault-rag: {n} notes have changed since they were indexed — their search results are out of date. Queued for re-embedding.

**Cause:** the plugin found damaged or outdated vectors at load time.

**Fix:** none needed — they are re-embedded in the background once the embedding endpoint answers.

## The chat does not answer

> ○ Chat LLM offline — check the settings
> Chat LLM unreachable — server down, wrong address, or network/VPN not connected.
> Empty response from the chat LLM — check the endpoint/model in the settings.
> Access denied (HTTP 401/403) — API key missing, invalid or expired.
> Chat path not found (HTTP 404) — check the endpoint address.

**Cause:** the **Chat endpoints** are separate from the embedding endpoints. The server is off, the address or key is wrong, or no model is chosen.

**Fix:** open **Settings → Vault Retrieval → Chat**, check the row's status and model. Set up chat: [How-to](how-to/index.md#set-up-grounded-chat). "Too many requests (HTTP 429)" and "Server error at the chat endpoint" come from the server; try again later.

## Reformat says it is not possible

> Formatting not possible in reading mode — switch to editing mode.
> Nothing selected.
> The selection has changed — please re-select.

**Cause:** reformatting works on a selection in editing mode, and refuses to write if the note changed while a preview was open.

**Fix:** switch the note to editing mode, select the text again, run the transform again.

## Smart Apply is missing or fails

> Smart Apply is disabled
> No template in {folder} — create one
> The note changed in the meantime (e.g. by a linter) — regenerate?

**Cause:** Smart Apply is off by default; without a template file in the template folder there is nothing to apply; a note that changed since the proposal was made is not overwritten.

**Fix:** enable **Enable Smart Apply** in the settings (it applies the next time the plugin reloads), put a template into the **Template folder**, or press **Regenerate & apply**.

## The MCP server does not start

> ⚠ MCP server could not start: {reason}

**Cause:** the port is taken or the server cannot bind on `127.0.0.1`.

**Fix:** change **Port** in the MCP section (default 8123; changing it restarts the server) and use **Test connection**. Setup for clients: [How-to](how-to/index.md#use-your-vault-from-an-mcp-client).

## Getting help

Still stuck? [Open an issue](https://github.com/johannes-kaindl/vault-rag/issues) with your Obsidian version, the plugin version (Settings → Community plugins), the embedding server and model you use, and the exact message you saw.
