# Contributing

Thanks for helping out! Issues and pull requests are welcome on
[Codeberg](https://codeberg.org/jkaindl/vault-rag) (the GitHub repo is a mirror). This repo follows the
workspace conventions documented in [`AGENTS.md`](AGENTS.md); the short version:

## Branch model
- `main` is always green. Do feature work on `feat/<name>` branches and merge with `git merge --no-ff`.
- Direct pushes to `main` only with explicit authorization.

## Commits
- **Conventional Commits:** `feat|fix|docs|chore|refactor|test(scope): …` (German descriptions are fine).
- When a change has substantial AI authorship, add a trailer, e.g.
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Stage only the files you touched — never `git add -A`.**

## Quality gate (before every commit)
- `npm test` green (vitest), `npx tsc --noEmit` clean, `npm run build` succeeds.
- **TDD is the default**, and larger features go through brainstorm → spec → plan → TDD
  ([`docs/superpowers/`](docs/superpowers/)).
- Tests verify real behaviour, not mocks; no `.only`/`.skip` in commits.

## UI conventions
- Settings and views use the standard Obsidian APIs and CSS variables — no hardcoded styling on
  `.setting-item` (see the workspace standard `PROF-OBS-06`). Sentence-case labels, one-sentence
  descriptions.

## Versioning & remotes
- SemVer **without** a `v` prefix (`0.3.0`). Tag releases match `manifest.json`/`versions.json`.
- Codeberg (`origin`) is canonical; GitHub is a push-mirror.

## License of contributions
By contributing you agree that your **code** is licensed under **AGPL-3.0-or-later** and your
**documentation/text** under **CC BY-SA 4.0** (see [`LICENSE`](LICENSE) / [`LICENSE-DOCS`](LICENSE-DOCS)).
A commercial dual-license is available on request.
