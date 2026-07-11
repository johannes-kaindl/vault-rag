# MCP-Zugriff-DX — externen MCP-Server reibungslos anbindbar machen

**Datum:** 2026-07-12
**Status:** Design (brainstorming abgeschlossen, User-approved, autonome Umsetzung freigegeben)
**Slice-Ziel:** Der in 0.13.0 gebaute HTTP-MCP-Server wird von außen **out-of-the-box nutzbar** — für Claude Code, OpenCode, OpenClaw und generische Clients auf demselben Mac. Kein neues Netz-/Security-Modell.

## Motivation

0.13.0 hat den MCP-Server als in-Plugin-HTTP-Server gebaut, aber real angebunden ist bisher **nichts**.
Die Settings bieten heute nur **einen** Setup-Befehl (`claude mcp add …`) und einen unsichtbaren Token.
Für „gut von außen zugreifen" (Nutzer-Priorität) fehlt:

- Setup-Hilfe für **mehr als einen** Client (OpenCode, OpenClaw, generisch).
- Sichtbarkeit/Rotation des Bearer-Tokens.
- Ein **Verbindungstest**, der Ende-zu-Ende beweist, dass externer Zugriff funktioniert — bevor man
  überhaupt einen Client konfiguriert.
- Transparenz, **was** ein externer Agent über den Vault kann.
- Klartext-Diagnose beim Start-Fehlschlag.

Diese Slice ist die erste einer dekomponierten „Plugin-API"-Familie. **Nachgelagerte Slices** (eigene
Zyklen, nicht hier): interne Retrieval-API-Konsolidierung (Fundament), dann in-Process-Plugin-API für
andere Obsidian-Plugins. Eine REST-API ist gestrichen (YAGNI — HTTP-MCP deckt lokale Skript-Clients ab).

## Ziele

1. **Multi-Client-Setup-Snippets** für Claude Code, OpenCode, OpenClaw, generisch — je zum Kopieren.
2. **Token anzeigen + rotieren** (maskiert, aufdeckbar, neu generierbar).
3. **Verbindung testen** — Self-Check ruft den eigenen Loopback-Server auf und meldet Erfolg/Klartext-Fehler.
4. **Tool-Transparenz** — die drei read-only Tools (`search`/`related`/`read_note`) sichtbar auflisten.
5. **Start-Fehlerdiagnose schärfen** — konkrete Ursache statt pauschal „Port belegt?".

## Nicht-Ziele (bewusst geparkt)

- **LAN-/Remote-Zugriff, TLS.** Server bleibt Loopback-only (127.0.0.1). Clients laufen auf demselben Mac.
- **REST-API / Nicht-MCP-Transport.** HTTP-MCP genügt; erst bauen, wenn ein echter Nicht-MCP-Consumer auftaucht.
- **Mehrere Tokens / Scopes / OAuth.** Ein Bearer-Token, wie heute.
- **Interne API-Konsolidierung & in-Process-Plugin-API.** Eigene Folge-Slices.
- **Neue MCP-Tools / Write-Tools.** Verhalten der drei Tools unverändert.

## Architektur

Reine DX-Erweiterung: **zwei pure-core-Module** (obsidian-frei, in Node testbar — Muster wie
`endpoint_diagnostics.ts`) plus eine erweiterte Settings-Sektion. Kein Transport-/Server-Umbau; der
bestehende `http_server.ts`/`auth.ts`/`tools.ts`-Stack bleibt unangetastet außer der Fehler-Ursache-Erfassung.

### Modul 1 — `src/mcp/client_snippets.ts` (pure)

Kennt die vier Client-Formate; rein datengetrieben (URL + Token rein, String raus).

```
type McpClientId = "claude-code" | "opencode" | "openclaw" | "generic"
interface McpClient { id: McpClientId; label: string; hint: string }
const MCP_CLIENTS: McpClient[]                       // Reihenfolge fürs Dropdown
function buildClientSnippet(id: McpClientId, ctx: { url: string; token: string }): string
```

Ausgabeformate (alle mit `vault-retrieval` als Servername, `Authorization: Bearer <token>`):

- **claude-code** — CLI-Einzeiler:
  `claude mcp add --transport http vault-retrieval <url> --header "Authorization: Bearer <token>"`
- **opencode** — `opencode.json`-Fragment:
  `{ "mcp": { "vault-retrieval": { "type": "remote", "url": "<url>", "enabled": true, "headers": { "Authorization": "Bearer <token>" } } } }`
- **openclaw** — Config-Fragment (verifiziert an docs.openclaw.ai, `streamable-http` wird unterstützt):
  `{ "mcp": { "servers": { "vault-retrieval": { "url": "<url>", "transport": "streamable-http", "headers": { "Authorization": "Bearer <token>" } } } } }`
- **generic** — `.mcp.json`-Standardform:
  `{ "mcpServers": { "vault-retrieval": { "type": "http", "url": "<url>", "headers": { "Authorization": "Bearer <token>" } } } }`

JSON-Fragmente werden mit 2-Space-Einrückung und gültigem JSON erzeugt (Tests prüfen `JSON.parse`).

### Modul 2 — `src/mcp/self_check.ts` (pure Auswertung)

Die **Klassifikation** der Server-Antwort ist rein (Muster wie `classifyEndpointStatus`):

```
type SelfCheckResult = "ok" | "unauthorized" | "wrong-response" | "unreachable"
function classifySelfCheck(input: { status: number; body: string; networkError?: boolean }): SelfCheckResult
```

- `networkError` (kein Connect) → `unreachable`
- `status === 401` → `unauthorized`
- `status === 200` **und** Body ist eine gültige JSON-RPC-Antwort mit `result` (initialize/tools/list) → `ok`
- sonst → `wrong-response`

Der eigentliche HTTP-Call lebt in der obsidian-Schicht (Settings/Host) über den vorhandenen `http.ts`
(`requestUrl`): POST an `http://127.0.0.1:<port>/mcp` mit `Authorization: Bearer <token>`,
`Content-Type: application/json`, `Accept: application/json, text/event-stream` und einem echten
MCP-`initialize`-JSON-RPC-Body. Das Ergebnis geht durch `classifySelfCheck`.

> **Verifikationspunkt für den Plan (Task-Ebene, nicht raten):** Ob Obsidians `requestUrl` die
> StreamableHTTP-Antwort (potenziell `text/event-stream`) als Text sauber zurückgibt. Falls nicht,
> Fallback auf `XMLHttpRequest` (wie `streamSSE` in `sse.ts`) oder den Response-Content-Type
> serverseitig auf `application/json` zwingen. Der Self-Check nutzt genau denselben Loopback-Endpunkt
> wie externe Clients → er testet echt Ende-zu-Ende (Server läuft, Auth greift, Tools erreichbar).

### Settings-Sektion (`buildMcpSection` in `settings.ts`, erweitert)

Reihenfolge (bestätigtes Mockup, Dropdown-Variante):

1. **MCP-Server aktivieren** (Toggle) · **Port** · **Status** — wie heute.
2. **Token** — maskiert (`••••`), „Anzeigen"-Toggle zeigt Klartext; „Neu generieren" setzt
   `generateToken()`, `saveSettings()`, `restartMcpServer()`, refresht die UI/Snippets und zeigt eine
   **Notice-Warnung** „alte Clients müssen neu verbunden werden".
3. **Verbindung testen** — Knopf löst den Self-Check aus; Ergebnis inline:
   `ok` → „✓ 3 Tools erreichbar" (grün) · `unauthorized` → „Token stimmt nicht" ·
   `unreachable` → „Server nicht erreichbar (aus? Port?)" · `wrong-response` → „Antwort ist kein MCP".
4. **Angebotene Tools** — statische Zeile `search · related · read_note` (read-only) mit je kurzem Hinweis.
5. **Client-Setup** — Dropdown (`MCP_CLIENTS`) → ein read-only Monospace-Snippet-Feld + „Kopieren".
   Der Token wird im Feld **maskiert** dargestellt, aber **vollständig** in die Zwischenablage kopiert.
6. Nur sichtbar bei aktiviertem Server (wie heute die Verbinden-Zeile).

### Start-Fehlerdiagnose (`main.ts`)

Beim `startMcpServer`-Fehlschlag die Ursache erfassen statt zu verwerfen: `EADDRINUSE` → „Port belegt",
Mobile-Gate → „nur Desktop", fehlender Token → „kein Token". Der Status-String in den Settings nutzt
die erfasste Ursache. Der `server.once("error", reject)`-Pfad in `http_server.ts` liefert den Fehler
bereits — er muss im Host (`main.ts`) gemerkt und in `mcpServerRunning`/Status durchgereicht werden.

## Datenfluss

Token/Port/Adresse kommen aus `settings` bzw. den Host-Methoden (`mcpServerAddress`, `mcpServerRunning`,
`ensureMcpToken`, `restartMcpServer`). Snippet-Generierung ist rein funktional. Der Self-Check spricht
denselben Loopback-Endpunkt wie ein externer Client.

## Fehlerbehandlung

- Self-Check fängt **alle** Fehlerklassen (Netz/Status/Format) und mappt sie auf Klartext — nie roher Stacktrace.
- Token-Rotation: bei laufendem Server erst neu starten, dann UI refresh (kein Zustand, in dem der
  angezeigte Token ≠ dem Server-Token ist).
- Kopieren via `navigator.clipboard` + Notice (wie heute).

## Testing

- `client_snippets.test.ts` — jedes der 4 Formate korrekt; Token + URL eingebettet; JSON-Fragmente `JSON.parse`-bar.
- `self_check.test.ts` — `classifySelfCheck` für alle vier Ergebnisklassen (inkl. 200-aber-kein-MCP).
- Start-Fehler-Mapping pure getestet.
- Settings-UI (`buildMcpSection`) ist obsidian-gebunden → **GUI-Smoke** am Ende (Muster wie Endpoint-UX/MCP-Slices):
  Dropdown wechselt Snippet, Token-Reveal/Rotate, Verbindungstest grün gegen echten laufenden Server.
- Alle bestehenden Tests bleiben grün; `npm run lint` + `npm run typecheck` == 0.

## Nebenprodukt (separat, nicht Teil dieser Slice)

Der `openclaw`-Skill-Cache (`overview.md`) behauptet fälschlich „MCP nur per stdio". docs.openclaw.ai
belegt `streamable-http`-Support. Nach der Slice ein Atom unter `config/` im openclaw-Skill anlegen.
