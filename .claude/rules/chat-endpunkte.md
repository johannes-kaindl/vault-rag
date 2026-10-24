---
paths:
  - "src/chat_*.ts"
  - "src/connection_options.ts"
  - "src/request_*.ts"
  - "src/endpoint_config.ts"
  - "src/settings.ts"
  - "src/http.ts"
  - "src/vendor/kit/sse.ts"
  - "src/vendor/kit/endpoint*.ts"
---

# Chat-Verbindung und Endpunkte — Gotchas

Gotchas zu Chat-Verbindung, Endpunkt-Schlüsseln und Modellvorrang (`src/chat_*.ts`, `src/endpoint_config.ts`, `src/settings.ts`).

- **Die Chat-Verbindung ist seit Welle 15 die Kit-Verbindung (`createLlmConnection`), `ChatClient` bleibt die lokale Fassade.** Parameter und Antwortprüfung entscheidet die Verbindung je Modus (`opts.mode`: Chat `grounded`, Smart Apply `structured` mit `restoreContent: "json"`, Umformen `transform`); die Fassade übersetzt das Kit-`kind` zurück in die Fehler, die die Aufrufer kennen: `http`/`overflow` → `ChatHttpError`, `timeout` → `ChatTimeoutError`, `aborted` → `AbortError`, `no-endpoint` → `error.noEndpoint`, sonst der Netzfehlertext; „abgeschnitten ohne Text“ bleibt ein Ergebnis mit `finishReason: "length"`. Fristen sind statisch (Idle 120 s, erster Chunk 600 s). Schlüssel der Chat-Zeilen liegen im Obsidian-Schlüsselbund (`secretId` statt `apiKey` in `data.json`; das Laden der Listen muss `id`/`secretId` durchreichen, sonst ist der Verweis beim nächsten Start weg). Das Kit schwärzt Geheimnisse vor dem Senden umkehrbar; das Lab-Log bekommt den GESENDETEN (geschwärzten) Text (`reportToLab`). `resolveAndReconnectChat` ruft `resolve({ force: true })` ohne `invalidate()` (sonst ist `source()` bis zur neuen Auflösung neutral) und lässt nur den jüngsten Lauf schreiben. Lokal bleibt vom Lab nur `newTurnId`; der Smoke-Stub liest die `apiVersion` aus dem vendorten `lab-client.ts`.

- **Ein Endpunkt-API-Schlüssel muss an ALLE fünf Netzwege**, nicht nur den Chat-/Embed-POST:
  Probe (`probeEndpoint`/`.probe()`/`.ping()`), `listModels`, `embed`/Chat-POST, der Kit-Chat-Client
  (Chat-Streaming) und `fetchCapabilities`. Alle gehen über `authHeaders(apiKey)`
  (`endpoint_config.ts`) — fehlt der Schlüssel an der **Probe**, gilt der Endpunkt nie als
  erreichbar und `resolveAndReconnectEmbedder`/`resolveAndReconnectChat` überspringen ihn
  stillschweigend (kein Ping-Erfolg); das Feature wirkt dann wie tot, ohne Fehlermeldung, weil
  ein reiner Ping-Fehlschlag keine Notice auslöst (anders als der Modell-Guard oben, der explizit
  meldet).

- **Beide Endpunkt-Listen halten ihre Schlüssel im Schlüsselbund (Embedding seit Welle 16).** `onload` migriert beide Listen mit `migrateLocalEndpoints`, unabhängig vom Manager (mit Manager migrieren weder der Kit-Resolver noch die Listen-UI), und speichert bei `changed`. Jeder Client für die Embedding-Liste bekommt den Schlüssel aus `hydratedEmbeddingEndpoints()` bzw. `hydrateLocalEndpoints`; die hydrierten Kopien werden nie in `settings.*` zurückgeschrieben, sonst steht der Schlüssel beim nächsten `saveSettings()` wieder in `data.json`. Die Plugin-Id ist `this.manifest.id` (`vault-retrieval`). Der Smoke prüft nicht nur „kein apiKey in data.json" (das besteht auch bei einem schlüssellosen Embedder), sondern den Bearer an Probe und `embed` nach Neustarts samt Gegenprobe mit einer nicht hydrierten Zeile.

- **Ein Feature-Modell (`smartApplyModel`) schlägt seit 0.31.0 das Zeilen-Modell.** Bis 0.30.0
  war es umgekehrt, und damit war das Feld tot, sobald die Zeile ein Modell trug — sichtbar nur
  als Widerspruch zwischen Einstellung und Verhalten (gemessen 2026-09-07). Wer den Vorrang je
  wieder dreht, macht das Feld erneut still wirkungslos.

- **`finish_reason` ist die EINZIGE Stelle, an der ein Token-Limit-Abbruch von einer schlechten
  Antwort zu unterscheiden ist** — und die Unterscheidung darf nicht zum Blocker werden.
  `parseSSE` (`src/vendor/kit/sse.ts`, obsidian-kit#0.3.0) liest es, der Kit-Chat-Client und
  `ChatClient.stream` reichen es durch. Wer es unterwegs fallen lässt, macht aus einem
  „dein Budget war zu klein" wieder ein „das Modell hat Unsinn geliefert" — genau die
  Fehldiagnose, die bis 2026-08-21 im Repo stand (Vendor-Pin hing auf 0.2.0, das
  `finish_reason` still verwarf). **Die zweite Hälfte der Regel:** abgeschnitten ist nicht
  automatisch kaputt (Entscheidung aus vault-crews 0.9.3). `output-truncated` ist deshalb ein
  reiner Begleit-Befund — er steht nicht in `CheckId`s hardOk-Formel und erscheint nur, wenn
  ohnehin ein Check fehlgeschlagen ist; eine verwertbare abgeschnittene Antwort bleibt
  fehlerfrei, und die Reformat-Vorschau bleibt anwendbar.

- **Die Modellzeilen laden ihre Liste nach einer Auflösung nur bei einem Wechsel des aktiven Endpunkts neu (`applyChatResolution`, seit Welle 26).** Der Abruf der Liste (`llm.models()`) löst selbst auf, und jede Auflösung ruft `applyChatResolution` zurück: lädt dort jede Auflösung die Liste neu, läuft das mit einem Manager ohne Endpunkt in eine Endlosschleife aus Mikrotasks und friert Obsidian ein (Smoke-Punkt „Schlüsselbund (Embedding) mit installiertem Manager“, `Runtime.evaluate` brach nach der Frist ab; ohne die Bedingung hängt der Teillauf `--only w15,w16`, mit ihr nicht). `saveSettings` und `active-leaf-change` zeichnen die Zeilen nur neu (`bar.update()`, ohne Abruf).

