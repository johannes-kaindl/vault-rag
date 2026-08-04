# Security Policy

## Supported versions

The most recently released version receives security fixes.

## Reporting a vulnerability

Please do **not** report security issues as public issues. Instead, email **code@jkaindl.de**
(PGP-encrypted if you like). You'll get a prompt acknowledgement and updates on the fix.

## Scope notes

Retrieval — search and related notes — always runs on your device: it reads only the synced index and
never leaves your vault. Chat and embedding talk to whatever **endpoint you configure** — by default
one under your control, local or on your own network. Add a third-party provider's API key, and the
relevant request content (chat context, note text) goes to that provider instead; the plugin sends
nothing anywhere else.

API keys are stored **unencrypted** in the plugin's `data.json`, like every other setting, and travel
with Obsidian's settings sync if you have it enabled. Treat the URLs and any credentials you put in the
settings as trusted local configuration — anyone with access to your vault folder or your synced settings
can read them.
