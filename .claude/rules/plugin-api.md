---
paths:
  - "src/plugin_api.ts"
  - "src/tool_provider.ts"
  - "src/retrieval_facade.ts"
  - "src/embedding_pause.ts"
  - "src/embed_counter.ts"
  - "src/mcp/**"
---

# Plugin-API, Pause und MCP — Gotchas

Gotchas zu Pause-Zustand, MCP-Server und -Token (`src/embedding_pause.ts`, `src/mcp/`).

- **Pause ist eine Entscheidung, kein Fehler — `paused` nie als `offline` anzeigen** (Spec 2026-09-17). Die Hülle `RetrievalFacade` (`retrieval_facade.ts`, Komposition statt Unterklasse, weil ein zusätzlicher Ergebnis-Zustand den Rückgabetyp der Kit-Basis erweitern würde) antwortet mit `{kind:"paused"}` VOR dem Ready-Check; Plugin-API `reason: "paused"` + `status().paused`, MCP-Klartext, Werkzeug-Anbieter `unavailable`/`detail: "paused"`, Such-Tab-Empty-State mit einem CTA. `handleModify` legt bei Pause in die Pending-Queue (vor `embedderReady`), der automatische Integrator-Auslöser ruht. `handleDelete`/`handleRename` brauchen kein Embedding und laufen weiter. Der Zustand liegt in `window.localStorage` (nicht `App#saveLocalStorage`: das ist je Vault, die knappe Ressource ist die Maschine).

- **Das MCP-Token liegt im Schlüsselbund, nicht in `data.json` (seit Welle 22, Kit `secret-value`).** `settings.mcpToken` ist nur der Speicherwert; `saveSettings()` schreibt `mcpTokenInFile` (`""`, solange der Schlüsselbund das Token hält). Jeder Weg, der Settings serialisiert, muss darüber laufen — wer `saveData(this.settings)` schriebe, trüge das Token beim nächsten Speichern zurück in die Datei (Smoke-Punkt „MCP-Token liegt im Schlüsselbund“, Mutationsprobe rot). Erzeugt wird nur bei leerem Stand (`ensureMcpToken`); der Schlüsselbund ist je Gerät, `data.json` wird synchronisiert: ein zweites Gerät erzeugt sein eigenes Token.

- **MCP-Server läuft in-Plugin (HTTP)** statt als separater stdio-CLI: desktop-only via
  `Platform.isMobile`-Gate, Loopback (`127.0.0.1`) + Bearer-Token, läuft nur solange Obsidian
  offen ist (kein eigenständiger Prozess); Spec im Vault-Cockpit unter `_SDD/`: `2026-07-09-mcp-server-design.md`.
