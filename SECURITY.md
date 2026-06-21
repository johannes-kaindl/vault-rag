# Security Policy

## Supported versions

The most recently released version receives security fixes.

## Reporting a vulnerability

Please do **not** report security issues as public issues. Instead, email **code@jkaindl.de**
(PGP-encrypted if you like). You'll get a prompt acknowledgement and updates on the fix.

## Scope notes

Vault RAG runs locally and offline: retrieval reads a synced index from your vault, and chat/embedding
talk only to **endpoints you configure** (local or VPN-reachable). The plugin sends nothing to third-party
cloud services. Treat the URLs and any credentials you put in the settings as trusted local configuration.
