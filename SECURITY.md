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

**Chat** and **embedding** endpoint API keys are stored in Obsidian's keychain (`app.secretStorage`), not in
`data.json`, and do not travel with settings sync. Keys found in `data.json` from older versions are moved
there when the plugin loads.
Secrets found in the text of a chat, Smart Apply or reformat request (tokens, bearer headers, private-key
blocks) are replaced by placeholders before the request is sent and restored in the answer. Treat the URLs and any credentials you put in the
settings as trusted local configuration — anyone with access to your vault folder or your synced settings
can read them.
