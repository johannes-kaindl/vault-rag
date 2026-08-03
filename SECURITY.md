# Security Policy

## Supported versions

The most recently released version receives security fixes.

## Reporting a vulnerability

Please do **not** report security issues as public issues. Instead, email **code@jkaindl.de**
(PGP-encrypted if you like). You'll get a prompt acknowledgement and updates on the fix.

## Scope notes

Vault Retrieval runs locally and offline for retrieval: search and related notes read only the synced
index and never leave your device. Chat and embedding talk only to **endpoints you configure** — by
default a local or VPN-reachable server, but an endpoint may also be a hosted third-party provider
(OpenAI-compatible) if you add an API key. In that case, whatever you send as a request — note context
for chat, note text for embedding — does leave your machine, to whichever provider you configured; the
plugin sends nothing anywhere else.

API keys are stored **unencrypted** in the plugin's `data.json`, like every other setting, and travel
with Obsidian's settings sync if you have it enabled. Treat the URLs and any credentials you put in the
settings as trusted local configuration — anyone with access to your vault folder or your synced settings
can read them.
