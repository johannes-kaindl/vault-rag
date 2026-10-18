# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../../workspace/_docs` relativ zu diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

**Profil:** `ts-node` · `obsidian-plugin`.

## Project character

**Projekt:** `vault-rag` (Repo-Slug) · Plugin-id **`vault-retrieval`**, Name **„Vault Retrieval"** — Obsidian-Plugin für **lokale, offline Related-Notes** aus einem gesyncten Embedding-Index. Autor: Johannes Kaindl. Die manifest-`id` weicht vom Repo-Namen ab, weil `vault-rag` in der Obsidian-Community-Directory belegt ist.

**Warum es existiert:** Drei AI-Plugins berechnen je eigene Embeddings über dasselbe Modell (`qwen3-embedding:8b`). `vault-rag` ersetzt sie durch **ein** Plugin mit **einem** Index, den es selbst aus dem Vault aufbaut (`_vaultrag/index.bin`, Reindex über den konfigurierten Embedding-Endpunkt). Retrieval läuft lokal (Brute-Force-Cosinus, auch auf dem iPhone) und ist von der Generierung getrennt. Das Warum der Entscheidungen steht in `docs/internal/decisions.md`.

## Architecture principles

**Obsidian-Grenze über `VaultAdapter`:** `src/index.ts` definiert das `VaultAdapter`-Interface (`read/readBinary/write/writeBinary/mkdir`). Alle Index-/Embedding-Module sprechen **nur** dieses Interface an, nie direkt die Obsidian-API → in Node testbar ohne DOM-Mock (PROF-OBS-03/04). **Dieses Interface nicht ohne Not ändern** — Tests und `LiveIndexer` hängen daran.

`obsidian` wird nur an der Kante importiert, erzwungen von `npm run check:pure` (Allowlist `EDGE` in `scripts/check-pure.mjs`, Teil von `npm run gate`; wer die Kante verschiebt, ändert beide Stellen). Die Wrapper an der Kante sind bewusst nicht unit-getestet; neue obsidian-Views folgen diesem Muster statt Tests mit DOM-Mocks. Netz geht nur über `http.ts` (`requestUrl`), Streaming über die Kit-Verbindung. `main.ts` orchestriert `file-Events → Debounce → embed → buildIndex → persist → refresh`. Die Kantendateien und das Modul-Layout stehen in `docs/internal/architecture.md`.

## Commands

```bash
npm install                       # Deps
npm run dev                       # esbuild watch
npm run build                     # baut main.js (gitignored)
npm run gate                      # lint + check:pure + typecheck + Tests + build
npm test                          # vitest run
npm run lint                      # eslint src (typescript-eslint + eslint-plugin-obsidianmd)
npm run check:pure                # obsidian-Import nur an der Kante
npm run typecheck                 # tsc --noEmit
npm run typecheck:test            # tsc -p tsconfig.test.json (Teil des Gates)
npx vitest run tests/<datei>      # eine Test-Datei
OBSIDIAN_PLUGIN_DIR=… npm run deploy   # build + main.js/manifest.json/styles.css in ein Vault-Plugin-Verzeichnis (jeder Vault trägt eine Kopie, auch der Arbeits-Vault)
npm run version-bump              # ../tools/release/version-bump.mjs (zentral)
npm run preflight <version>       # ../tools/release/preflight.mjs (Store-Checkliste)
npm run release                   # ../tools/release/release.mjs (zentral; nur der Master)
npm run fresh-vault -- --port <p> # Staging-Vault aus dem Fixture, Index aus dem Schnappschuss (baut das Plugin nicht)
npm run smoke:gui -- --port <p>   # GUI-Smoke auf einer Zweitinstanz, Port Pflicht (Rezept: docs/SMOKE.md)
npm run shots -- --only <bild>    # README-Bild aufnehmen (Vertrag: docs/images/README.md)
```

## Conventions

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Tests:** vitest + happy-dom; Obsidian-Mock ist der Kit-Mock (`tests/vendor/kit/obsidian-mock.ts`, vendort), `tests/__mocks__/obsidian.ts` re-exportiert ihn ohne Abweichung (sein `requestUrl` ist seit obsidian-kit 0.61.0 vi-kompatibel; kein echter
  obsidian-Import im Test). `describe/it/expect`, kein `.only`/`.skip` im Commit. Nach jeder
  Änderung müssen **alle Tests grün** bleiben.
- **`isEmbedding` immer via `try/finally`** klammern (kein vergessenes `finally`).
- **Status-Bar-Text:** `↻ embedding…` / `● N | ⏳ M` (N=embedded, M=pending) / `● N`.
- **Commits:** Conventional Commits (`feat/fix/docs/chore/refactor/test(scope): …`), deutsche
  Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer bei
  substanziellem AI-Beitrag (Version zum Commit-Zeitpunkt):
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Größere Features** laufen über die Superpowers-Kette
  brainstorming → writing-plans → subagent-driven-development → finishing; **TDD ist Default**.
  Specs und Pläne liegen im Vault-Cockpit unter `_SDD/` (CORE-META-14, siehe §Memory).

## Gotchas

Die Gotchas zu einem Bereich stehen in `.claude/rules/` und laden, sobald eine Datei dort gelesen wird (siehe Context index). Diese beiden gelten für das ganze Repo:

- **`data.json`** ist die von Obsidian persistierte Plugin-Konfig (`saveData`) — maschinen-/vault-spezifisch,
  daher git-ignored (nicht committen).
- **`main.js`** ist Build-Artefakt (gitignored) — nie von Hand editieren.

## Context index

- Bevor du Dateien unter `src/i18n/`, `tests/i18n/` änderst oder Text für Oberfläche, Fehler oder Prompt anlegst: `.claude/rules/i18n.md`.
- Bevor du Index-Format, `persist`, Modell-Bindung oder Prüfsumme (`src/index*.ts`, vendorte Index-Module) änderst: `.claude/rules/index-integritaet.md`.
- Bevor du Auto-Heal, leere Notizen, den Index-Ordner oder den Reindex (`src/main.ts`, `src/index_migrate.ts`) änderst: `.claude/rules/index-heilung.md`.
- Bevor du Chat-Verbindung, Endpunkt-Schlüssel oder Modellvorrang (`src/chat_*.ts`, `src/endpoint_config.ts`, `src/settings.ts`) änderst: `.claude/rules/chat-endpunkte.md`.
- Bevor du `src/plugin_api.ts`, `src/tool_provider.ts`, die Pause oder `src/mcp/` änderst: `.claude/rules/plugin-api.md`.
- Bevor du `src/reformat_*.ts` änderst: `.claude/rules/reformat.md`.
- Bevor du Smart Apply, Vorlagen, `styles.css` oder eine View änderst: `.claude/rules/smart-apply-ui.md`.
- Bevor du `src/integrator*.ts` oder `src/link_writer.ts` änderst: `.claude/rules/integrator.md`.
- Bevor du einen Treiber unter `scripts/` änderst oder einen Smoke fährst: `.claude/rules/gui-smoke.md` und `docs/SMOKE.md`.
- Bevor du Modul-Layout, Kantendateien oder gevendorte Kit-Module änderst: `docs/internal/architecture.md`.
- Bevor du eine Entscheidung „bewusst so" oder eine Abweichung von der Leitkonvention übernimmst: `docs/internal/decisions.md`.
- Vor einem Release oder einer Store-Einreichung: Skill `plugin-release-setup` und `../AGENTS.md` (Abschnitt Store-Einreichung).
- Vor README-Bildern: Skill `readme-shots`; vor dem Einrichten eines Treibers: Skill `gui-smoke-setup`.

## Memory

- **SDD-Artefakte liegen im Cockpit, nicht im Repo** (CORE-META-14): Specs, Pläne und Task-Reports unter `$VAULT/25_Coding/vault-rag/_SDD/`; das Repo behält die Design-Essenz in `docs/internal/decisions.md` und `CHANGELOG.md`.
- **Nie im Repo:** absolute Pfade außerhalb des Repos (`/Users/…`, Vault-Pfade) — Platzhalter nutzen (`$VAULT/…`, `~/…`, repo-relativ). Herkunftsnachweise als Repo-Name + `Datei:Zeile` sind erwünscht. Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`).
- **Coding-Cockpit (SSOT für Stand/Tasks/History):** `$VAULT/25_Coding/vault-rag/vault-rag.md` (maintainer-lokal), vom SessionEnd-Hook gestempelt. **Beim Start lesen, am Ende fortschreiben.**
- **Session-Handoff:** `.remember/` (gitignored).

## Abweichungen von der Leitkonvention

Begründete Abweichungen (comply-or-explain); Wortlaut und Herleitung in `docs/internal/decisions.md`.

- **CORE-META-07** — `LICENSING.md` ja, `CLA.md` bewusst nicht.
- **PROF-TS-04** — kein `tsconfig.build.json`-Split; sein Zweck ist über den Vitest-Alias schon erfüllt.
- **PROF-OBS-01** — manifest-`id` `vault-retrieval` ≠ Repo-Slug `vault-rag`; interne Bezeichner (`vault-rag-*`-CSS, `_vaultrag`-Index) bleiben.
- **PROF-OBS-02** — `npm run deploy` ist für jeden Vault nötig, auch den Arbeits-Vault; der Plugin-Ordner ist kein Symlink.
- **UI-STANDARD §1 (Ein-Frontend)** — ein Hub mit dauerhaft gemounteten Panels statt Render-from-scratch pro Tab (zustandsreiche Streams).

## UI-Abweichungen

Deklaration nach `UI-STANDARD.md` §1a — von einem verbindlichen §8-Baustein abzuweichen ist
erlaubt, stillschweigend abzuweichen nicht.

- **stream-area** — Grund: `chat_view.ts` nutzt NICHT `buildStreamArea` (Kit-Baustein
  „Streaming-Antwortbereich", §8). Formgrund, kein Uniformitäts-Grund: `buildStreamArea` baut
  EINEN Bereich für EINE laufende Antwort — `ChatPanel` rendert eine **Liste** von Nachrichten
  (`messages[]`), jede mit ihrem eigenen Gedankenblock, mehrere davon können gleichzeitig auf
  der Seite stehen (History). Der Kit-Baustein kennt keine Liste — ein Consumer, der ihn pro
  Nachricht neu aufbaut, verlöre den gemeinsamen Scroll-Container und müsste die
  Listen-Semantik ohnehin selbst tragen. Die reichere Scroll-Fassung (`atBottom`-Schwelle, dem
  Strom folgen, aber manuelles Hochscrollen respektieren) STAMMT von hier (`src/chat_view.ts:209`,
  Referenz im Kit-Dateikopf `stream-area.ts`) und bleibt hier lokal, weil der Bereich nicht
  adoptiert wird — sie ist kein Rückstand, sondern die Quelle.
  — gilt-solange: `src/chat_view.ts` enthaelt-nicht `buildStreamArea`

## Dach-Kontext (obsidian-plugins)

Dieses Repo liegt unter dem Koordinations-Dach `obsidian-plugins/` (das Verzeichnis `..` über diesem Repo).
**Vor dem Lösen eines Problems:** `../AGENTS.md` (Kit-first-Regel) und `../REGISTRY.md`
(Lösungs-Registry) prüfen — viele Probleme sind in Nachbar-Plugins oder im
`obsidian-kit` bereits gelöst.

**Vor jeder UI-Arbeit** (Views, Modals, Settings-Tabs, CSS): `../UI-STANDARD.md` ist
verbindlich (Obsidian-nativ first, ein Frontend pro Plugin, nur Theme-CSS-Variablen).
