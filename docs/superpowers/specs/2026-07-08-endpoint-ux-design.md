# Endpunkt-UX: Presets + Klartext-Diagnose + Eingabe-Prüfung

**Datum:** 2026-07-08
**Status:** Design abgenommen, bereit für writing-plans
**Branch:** `feat/endpoint-ux` (von `main`)

## Problem

Johannes' Chat- und Embedding-Endpunkte waren alle rot, obwohl LM Studio gesund auf
`localhost:1234` lief. Ursachen, die das rein rot/grüne Status-UI verbarg:

- Chat-Endpunkt-Port-Tippfehler (`1243` statt `1234`).
- Beide Fallback-Listen verließen sich sonst auf die **tote LAN-IP** `192.168.178.27`
  (die embeddingEndpoints-Liste enthielt **nur** diese).
- Eine **Platzhalter-IP** `192.0.0.2` blieb unbemerkt in der Liste.

Das UI zeigte nur „erreichbar / nicht erreichbar" — nie das **Warum**. Deshalb rutschten die
Fehler mehrfach durch. Ein Spike (2026-07-08) bestätigte zudem: die „tote" LAN-IP
`192.168.178.27` antwortet im aktuellen Netz mit **HTTP 200** (irgendein Gerät/Router im LAN) —
reine Erreichbarkeit lügt also, der zuverlässige Signalgeber ist die Antwort-**Form**.

## Ziel

Der Endpunkt-Editor in den Settings hilft aktiv beim korrekten Einrichten und macht
Fehlerursachen in Klartext sichtbar:

1. **Presets** — Ein-Klick-Hinzufügen korrekt vorausgefüllter LM-Studio-/Ollama-Endpunkte.
2. **Klartext-Diagnose** — pro Endpunkt die konkrete Fehlerursache statt nur rot/grün.
3. **Eingabe-Prüfung** — nicht-blockierende Warnungen bei offensichtlich falschen Eingaben.

## Nicht-Ziele (bewusst raus, YAGNI)

- **Kein** Host/Port-Split — ein einziges Base-URL-Feld bleibt (Marktstandard; getrennte Felder
  nutzt laut Recherche kein Obsidian-LLM-Plugin).
- **Kein** globaler Provider-Typ-Wähler — Embedding (Ollama) und Chat (LM Studio) können getrennte
  Server sein; die Liste hält **Netz-Fallbacks für denselben Server**, nicht verschiedene Provider.
- **Kein** Reachability-Raten beim Tippen — die Diagnose nach dem Speichern ist zuverlässiger.
- **Keine** Änderung am Fallback-Listen-Datenmodell (geordnete Liste freier URL-Strings bleibt) →
  `normalizeEndpoint` / `resolveActiveEndpoint` / `parseEndpointList` unangetastet.
- **Keine** „IP nicht im aktuellen Subnetz"-Warnung — das ist genau der legitime
  LAN-Fallback-Fall (Adresse fürs andere Netz), eine Warnung wäre hier ein Fehlalarm.

## Was bereits existiert (0.7.0) — nicht neu bauen

- Geordnete Fallback-Liste (`embeddingEndpoints` / `chatEndpoints`), erster erreichbarer gewinnt,
  Auto-Reconnect mit 1 Retry, pro Endpunkt ein WCAG-Status-Icon (`circle-check` / `circle-x`).
- Automatische Modellerkennung: `listModels()` (`/v1/models`) füllt ein Dropdown; Fallback auf
  Textfeld + „Modelle laden" bei leerer Liste.
- Geteilte pure Endpunkt-Logik in `obsidian-kit/src/pure/endpoint.ts`, nach vault-rag vendored.

Dieses Feature erweitert diesen Bestand — es ersetzt ihn nicht.

## Architektur

### Pure Logik → `obsidian-kit/src/pure` (dann nach vault-rag vendored)

Neue Datei `endpoint_diagnostics.ts` (hält `endpoint.ts` fokussiert), pure + node-testbar,
app-/UI-frei:

**1. `ENDPOINT_PRESETS`** — benannte Tabelle:

```ts
export interface EndpointPreset { label: string; url: string; }
export const ENDPOINT_PRESETS: EndpointPreset[] = [
  { label: "LM Studio", url: "http://localhost:1234" },
  { label: "Ollama",    url: "http://localhost:11434" },
];
```

Base-URLs ohne `/v1` (`normalizeEndpoint` strippt es ohnehin).

**2. `classifyEndpointStatus(input) → EndpointStatus`** — die 4 Klassen + roher Fallback.
Nimmt entweder eine **gefangene Exception** oder eine **erfolgreiche Response** entgegen:

```ts
export type EndpointStatusKind =
  | "ok"              // erreichbar, valides OpenAI-kompatibles API
  | "refused"         // ECONNREFUSED → Server läuft nicht / Port falsch
  | "unknown-host"    // ENOTFOUND → Hostname-Tippfehler
  | "timeout"         // eigener Timeout → Netz nicht erreichbar
  | "not-an-llm-api"  // antwortet, aber Body hat nicht die OpenAI-Form
  | "unknown";        // Fallback — rohe Fehlermeldung durchreichen

export interface EndpointStatus {
  reachable: boolean;      // true nur bei "ok"
  kind: EndpointStatusKind;
  klartext: string;        // deutsche, handlungsleitende Meldung (Tooltip-Text)
  raw?: string;            // rohe Fehlermeldung (nur bei "unknown", nie verschluckt)
}
```

Klartext-Meldungen:
- `refused` → „Verbindung abgelehnt — Server läuft nicht oder Port falsch."
- `unknown-host` → „Hostname unbekannt — Tippfehler in der Adresse?"
- `timeout` → „Zeitüberschreitung — Netz nicht erreichbar (falsches Netz / VPN aus?)."
- `not-an-llm-api` → „Antwortet, ist aber kein OpenAI-kompatibler Endpunkt — falscher Pfad/Dienst?"
- `unknown` → „Nicht erreichbar — <rohe Fehlermeldung>."

**Klassifikations-Reihenfolge (Lesson `vault-crews`: Body-Sniff nur auf dem Fehlerpfad):**
Bei einer erfolgreichen Response **erst** die valide API-Form prüfen (`/v1/models` liefert
`{ data: [...] }`) → bei Erfolg sofort `kind: "ok"` zurück. Die `not-an-llm-api`-Klassifikation
läuft **nur**, wenn keine verwertbare API-Form da ist — nie über eine legitime Antwort.
Bei einer Exception die Message best-effort gegen bekannte Substrings matchen
(Node: `ECONNREFUSED`/`ENOTFOUND`; Electron: `net::ERR_CONNECTION_REFUSED` etc.); greift kein
Muster → `kind: "unknown"` mit roher Message.

**3. `validateEndpointInput(url) → EndpointWarning[]`** — die 3 Regeln, nicht-blockierend:

```ts
export interface EndpointWarning { rule: string; message: string; }
```

- **Fehlendes Schema** (kein `http://` / `https://`) → „Adresse braucht `http://`".
- **Fehlender Port bei lokalem Host** — nur `http://` + `localhost`/IP **ohne** Port →
  „Lokale LLM-Server brauchen fast immer einen Port (z.B. `:1234`)." (Domains / `https` **nicht**
  warnen — die laufen legitim auf 80/443.)
- **Platzhalter-/Beispiel-IP** — RFC-5737-TEST-NET-Bereiche (`192.0.2.0/24`, `198.51.100.0/24`,
  `203.0.113.0/24`) + `0.0.0.0` → „Sieht aus wie eine Beispiel-/Platzhalter-Adresse."

### vault-rag (obsidian-Schicht)

- **`http.ts`** — neuer `probeEndpoint(url) → Promise<EndpointStatus>`: `requestUrl` mit einem
  selbst-kontrollierten Timeout (`Promise.race` gegen einen Timer, deterministisch und
  plattformunabhängig), try/catch um den geworfenen Netzwerkfehler, dann `classifyEndpointStatus`.
  Kapselt weiter den einzigen obsidian-Netz-Import. **Gotcha:** `RequestUrlParam` hat kein
  `timeout`-Feld und `requestUrl` keinen Abort — gewinnt der Timer das `Promise.race`, läuft der
  echte Request im Hintergrund folgenlos weiter (reine Lese-Probe, kein Nebeneffekt); wir werten
  ihn als `timeout`.
- **`embedder.ts` / `chat_client.ts`** — `ping(): Promise<boolean>` wird zu
  `probe(): Promise<EndpointStatus>` (nutzt `probeEndpoint` gegen `/v1/models` und prüft die
  Body-Form für Fall `not-an-llm-api`). Aufrufer, die nur ein Boolean brauchen, lesen
  `status.reachable`.
- **`settings.ts`:**
  - `DEFAULT_SETTINGS.chatEndpoints`: `["http://localhost:8080"]` → `["http://localhost:1234"]`
    (LM Studio; verbreiteter als MLX). `embeddingEndpoints` bleibt `["http://localhost:11434"]`
    (Ollama). Betrifft nur Neu-Installs, kein Migrationsrisiko.
  - `buildEndpointList`: Status-Icon trägt jetzt den `klartext` als Tooltip (statt nur
    „verbunden / offline"); zusätzliches Warn-Icon (`alert-triangle`, WCAG-Form) pro Zeile aus
    `validateEndpointInput` mit den Warnungen als Tooltip.
  - Neue **Quick-Add-Button-Zeile** unter der Liste: ein Button pro `ENDPOINT_PRESETS`-Eintrag
    („+ LM Studio :1234", „+ Ollama :11434"); Klick hängt die Preset-URL als neue Zeile an
    (via bestehendem `applyEndpointEdit` / Save / Reconnect / Re-Render).

## Fehlerbehandlung & Robustheit

- Fälle `timeout` (eigener Timer) und `not-an-llm-api` (Body-Form) sind **plattformunabhängig** —
  der robuste Kern der Diagnose.
- Fälle `refused` / `unknown-host` sind best-effort per Message-Substring; die Substrings
  unterscheiden sich Node ↔ Electron ↔ Mobile. Deshalb sauberer `unknown`-Fallback mit roher
  Message und Verifikation der echten Desktop-Electron-Messages im GUI-Smoke.
- Validierung ist **nie** blockierend — der Nutzer kann jede Eingabe speichern; Warnungen sind
  sichtbare Hinweise (Icon-Form + Tooltip, WCAG-redundant), kein Riegel.

## Testing

- **Pure kit-Funktionen (TDD, node):** `classifyEndpointStatus` mit synthetischen Exceptions
  (Node- und Electron-Message-Formen) und Responses (valide `{data}`-Form, HTTP-200-Fremd-Body);
  `validateEndpointInput` mit URL-Fixtures (Schema fehlt, lokaler Host ohne Port, https-Domain
  ohne Port = keine Warnung, TEST-NET-IPs, `0.0.0.0`); `ENDPOINT_PRESETS`-Form.
- **`settings.ts`-Verdrahtung:** bleibt GUI-Smoke — die Desktop-Electron-Fehlermessages (Fall
  `refused` / `unknown-host`) lassen sich nicht in Node reproduzieren.
- **GUI-Smoke / Handover-Note** (siehe Memory `handover-note-for-multistep`): Quick-Add beider
  Presets, Platzhalter-IP-Warnung, Port-fehlt-Warnung, tote LAN-IP `192.168.178.27` → Klartext
  `not-an-llm-api`, Port-Tippfehler `:1243` → `refused`. Testdaten: die realen kaputten Endpunkte.

## Prozess

brainstorming (dieses Dokument) → writing-plans → subagent-driven-development (TDD Default) →
finaler Opus-Whole-Branch-Review → GUI-Smoke → Merge nach `main` → Release.
