# Vault Retrieval

> [🇬🇧 English](https://github.com/johannes-kaindl/vault-rag/blob/main/README.md) · 🇩🇪 Deutsch

**Retrieval über dein eigenes Vault — verwandte Notizen und semantische Suche, immer on-device — dazu gegroundeter Chat mit dem LLM-Endpunkt, den du einträgst.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/vault-rag?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/vault-rag/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.12.7%2B%20·%20Desktop%20%26%20Mobil-7c3aed)

Vault Retrieval macht deine Notizen durchsuchbar. Retrieval — verwandte Notizen, semantische Suche — läuft immer auf deinem Gerät. Es hält einen kleinen Embedding-Index **im Vault** — synct mit ihm, lesbar auf jedem Gerät — und beantwortet drei Fragen: *Was habe ich sonst dazu geschrieben? Wo habe ich sowas mal gesagt? Was weiß mein Vault über X?* Embedding und Chat sprechen den LLM-Endpunkt an, den du einträgst — standardmäßig einen unter deiner Kontrolle, lokal oder im eigenen Netz. Trägst du den Schlüssel eines Anbieters ein, gehen diese Inhalte an ihn.

> **Sprache der Oberfläche:** die UI folgt Obsidians eigener Spracheinstellung — Deutsch bei deutschem Obsidian, sonst Englisch. Eine Handvoll Diagnose-Texte (Endpunkt-Tooltips, Smart-Apply-Guard-Details) ist noch fest deutsch; das wird nachgezogen.

## Features

Alles lebt in **einer Sidebar-Ansicht** mit Tabs: Ähnlich, Suche, Chat, Umformatieren — dazu Smart Apply, sobald du es aktivierst. Die Panels bleiben gemountet: ein laufender Chat-Stream oder ein offener Smart-Apply-Vorgang überlebt den Tab-Wechsel.

- **Verwandte Notizen** — ein Panel zeigt die Notizen, die der gerade geöffneten am ähnlichsten sind. Cosinus-Ähnlichkeit über einen kompakten Notiz-Index, on-device gerechnet — vollständig offline, auch mobil.
- **Semantische Suche** — Notizen nach *Bedeutung* finden, nicht nach Stichwort.
- **Gegroundeter RAG-Chat** — eine Frage ans Vault stellen und eine Antwort bekommen, die in den gefundenen Notizen verankert ist, Token für Token gestreamt vom Chat-LLM. Ein editierbares Kontext-Panel zeigt, welche Notizen die Antwort speisen, mit Quellen-Chips zum Zurückspringen.
- **Sichtbares Denken, mit Ausschalter** — bei Reasoning-Modellen erscheint der „💭 thinking"-Strom in einem einklappbaren Block über der Antwort und klappt weg, sobald sie da ist (und geht nie zurück in den Verlauf). Ein Schalter unterdrückt das Denken für schnellere Antworten — über servertyp-übergreifende Hinweise —, und ein Test in den Einstellungen sagt dir, ob dein Modell sich daran hält.
- **Modell-Fähigkeiten auf einen Blick** — die Einstellungen zeigen nach bestem Wissen, ob das gewählte Chat-Modell Vision und/oder Thinking beherrscht. Jeder Endpunkt hat einen Verbindungstest, die Modell-Auswahl füllt sich vom Server.
- **Die Endpunkt-Liste ist eine sichtbare, änderbare Rangfolge** — der erste erreichbare Endpunkt gewinnt, die Reihenfolge entscheidet also. Jede Zeile sagt im Klartext, welche Rolle sie spielt (*aktiv* / *erreichbar, aber Platz N* / *nicht erreichbar* / *übersprungen — Modell passt nicht zum Index*), und ein Klick holt einen Endpunkt nach vorn. Erreichbar heißt nicht benutzt — jetzt ist der Unterschied auch zu sehen.
- **Live-Indizierung** — Notizen werden beim Speichern neu eingebettet; offline entstandene Änderungen sammeln sich und werden bei Wiederverbindung nachgezogen. Ein Voll-Reindex baut den Index komplett aus dem Vault — du kannst also bei Null anfangen, ein Embedding-Endpunkt genügt.
- **Ein Index, der sich wehrt** — der Index ist deine Arbeit, und ihn zu verlieren kostet eine Stunde Rechenzeit. Also: Schreibvorgänge, die ihn schrumpfen würden, werden verweigert statt ausgeführt; ein abgeschnittener Index (halb fertiger Sync-Download) wird beim Laden erkannt und schaltet das Plugin auf Nur-Lesen, statt gute Daten zu überschreiben; geräte-lokale Backups rotieren automatisch und lassen sich aus der Befehlspalette zurückholen; ein Selbstheilungs-Befehl bettet nur die Notizen ein, die dem Index tatsächlich fehlen. Das schützt auch vor einer subtileren Gefahr: ein Embedding-Index ist an das Modell gebunden, mit dem er gebaut wurde — ein Embedding-Endpunkt mit einem anderen Modell wird automatisch übersprungen, und jeder Schreibvorgang, der Vektoren zweier Modelle mischen würde, wird verweigert; ein bewusster Modellwechsel verlangt einen vollständigen Neuaufbau des Index. Leere Notizen zählen dabei nie als fehlend.
- **Smart Apply — eine Notiz in ein Template umbauen** *(opt-in)* — Template wählen, und das Chat-LLM sortiert eine unaufgeräumte Notiz in dessen Abschnitte ein, wobei deine *originalen* Blöcke unter die passenden Überschriften wandern. Es erfindet nichts: ein Diff-Gate zeigt vorher, was wohin geht, und der Fließtext wird aus deinen eigenen Bytes wieder zusammengesetzt. Templates beschreiben sich selbst über `%%`-Kommentare, und eine nach Relevanz sortierte Template-Liste (Cosinus über denselben Index, ohne neu zu embedden) schlägt die beste Passung vor und aktualisiert sich beim Notizwechsel.
- **Auswahl umformatieren** — einen Abschnitt markieren und den Umformatieren-Befehl ausführen (Befehlspalette oder Kontextmenü). Mechanische Transformationen (Tabelle kippen, Tabelle → Liste, in Callout einpacken) laufen sofort und ohne LLM. Formverändernde (→ Liste, → Fließtext, → Tabelle, → Mermaid oder eine eigene Freitext-Anweisung) streamen eine Vorschau vom Chat-LLM, die du prüfst und neu erzeugen lassen kannst. Alle Transformationen gibt es auch im Umformatieren-Tab, der die aktuelle Auswahl anzeigt und die Buttons mit Begründung ausgraut, wenn gerade nichts geht.

## Voraussetzungen

- **Obsidian 1.12.7+** (Desktop oder Mobil). Ab 1.13 rendert der Einstellungs-Tab über Obsidians native, durchsuchbare Settings-API; darunter zeichnet er dieselbe Struktur imperativ.
- Ein **Embedding-Endpunkt** — ein OpenAI-kompatibler Server, lokal wie [Ollama](https://ollama.com) oder ein gehosteter Anbieter, wenn du einen API-Schlüssel einträgst — um den Index zu bauen und zu pflegen. Einmal `Vault neu indizieren` ausführen, und das Plugin bettet dein Vault selbst nach `<vault>/_vaultrag/` ein; danach wird beim Speichern nachgezogen. Alternativ einen extern erzeugten Index desselben Formats ins Vault legen.
- **Sonst nichts fürs Retrieval.** Sobald der Index existiert, laufen verwandte Notizen und semantische Suche vollständig on-device — kein Server, kein Daemon, offline, auch mobil.
- Für **Chat**, **Smart Apply** und LLM-gestütztes Umformatieren: ein **OpenAI-kompatibler LLM-Endpunkt** — ein lokaler Server wie [LM Studio](https://lmstudio.ai), oder ein gehosteter Anbieter, wenn du einen API-Schlüssel einträgst. Neu bei lokalen LLMs? Der **[Setup-Guide](https://uplink.jkaindl.de/llm-setup)** führt dich durch. In den Einstellungen konfigurierbar — spricht den Endpunkt an, den du einträgst, und erreicht einen Drittanbieter nur, wenn du dessen API-Schlüssel einträgst.

## Installation

### Community Plugins

In Obsidian **Einstellungen → Community-Plugins → Durchsuchen** öffnen, nach **Vault Retrieval** suchen, installieren und aktivieren.

### Manuell

`main.js`, `manifest.json` und `styles.css` aus dem [letzten Release](https://git.jkaindl.de/jkaindl/vault-rag/releases) nach `<vault>/.obsidian/plugins/vault-retrieval/` legen, dann unter **Einstellungen → Community-Plugins** aktivieren.

### BRAT (Beta)

Den GitHub-Mirror `johannes-kaindl/vault-rag` in [BRAT](https://github.com/TfTHacker/obsidian42-brat) eintragen, um Vorab-Builds zu verfolgen.

### Aus dem Quellcode

```bash
git clone https://git.jkaindl.de/jkaindl/vault-rag
cd vault-rag
npm install
npm run build      # → main.js
# main.js, manifest.json, styles.css nach <vault>/.obsidian/plugins/vault-retrieval/ kopieren
```

## Benutzung

1. Den **Embedding-Endpunkt** in den Einstellungen auf deinen lokalen Server zeigen lassen, dann `Vault neu indizieren` aus der Befehlspalette ausführen. (Entfällt, wenn schon ein Index in `_vaultrag/` liegt.)
2. Auf das **layers**-Symbol in der Ribbon-Leiste klicken. Eine Notiz öffnen — der Ähnlich-Tab füllt sich automatisch.
3. In den Suche-Tab wechseln, um das Vault nach Bedeutung zu durchsuchen.
4. In den Chat-Tab wechseln, den Chat-Endpunkt in den Einstellungen setzen und fragen. Über die Kontext-Liste steuerst du, welche Notizen die Antwort tragen.
5. *(Optional)* **Smart Apply** in den Einstellungen aktivieren — es erscheint dann als weiterer Tab. Template aus der Relevanz-Liste wählen, auf die aktive Notiz anwenden, Diff prüfen, dann übernehmen, neu erzeugen oder ein anderes Template nehmen.
6. Einen Textblock markieren, dann `Abschnitt umformatieren` aus der Befehlspalette oder dem Rechtsklick-Menü — oder den Umformatieren-Tab benutzen. Mechanische Transformationen greifen sofort; LLM-gestützte öffnen eine gestreamte Vorschau. Umformatieren braucht den Bearbeitungsmodus; im Lesemodus bleiben die Buttons deaktiviert und sagen warum. Wird die Notiz geändert, während eine Vorschau offen ist, wird die Ersetzung verweigert statt an der falschen Stelle angewendet.

### Befehle

Die Namen unten sind die deutschen — auf einem englischen Obsidian heißen die Befehle entsprechend englisch.

| Befehl | Wirkung |
|---|---|
| `Verwandte Notizen öffnen` · `Semantische Suche öffnen` · `Vault Chat öffnen` · `Umformatieren-Panel öffnen` | Öffnet die Sidebar auf dem jeweiligen Tab |
| `Abschnitt umformatieren` | Formt die aktuelle Auswahl um (siehe Schritt 6) |
| `Smart Apply auf aktive Notiz` | Baut die aktive Notiz in ein Template um |
| `Vault neu indizieren` | Baut den kompletten Index neu aus dem Vault |
| `Index vervollständigen (fehlende Notizen)` | Bettet nur ein, was dem Index fehlt |
| `Index aus Backup wiederherstellen` | Holt ein geräte-lokales Backup zurück |

### Konfiguration

| Einstellung | Wirkung | Default |
|---|---|---|
| Embedding-Endpunkt / Modell | Bettet Notizen beim Speichern neu ein; eine Fallback-Liste, jede Zeile optional mit eigenem API-Schlüssel und Modell | `http://localhost:11434` · `qwen3-embedding:8b` |
| Chat-Endpunkt / Modell | LLM für Chat, Smart Apply und Umformatieren; dieselbe Fallback-Listen-Form wie Embedding | `http://localhost:1234` · `qwen3` |
| Index-Ordner | Wo der gesyncte Index liegt. Geräteübergreifender Sync (auch iPhone) braucht die Obsidian-Sync-Option „Alle anderen Dateitypen synchronisieren" | `_vaultrag` |
| Index-Ordner ausblenden | Versteckt den Ordner im Datei-Explorer (kosmetisch; Daten und Sync bleiben unberührt) | an |
| Ähnlichkeit / Top-k | Retrieval-Schwellen | `0.3` · `20` |
| Ausgeschlossene Ordner | Pfade, die nicht indiziert werden (Dot-Ordner immer) | `Templates/`, `Archive/` |
| Statusleiste | Zeigt den Embedding-Fortschritt; beim Reindex automatisch eingeblendet | aus |
| Verzögerung | Wie lange nach dem Speichern neu eingebettet wird | `3000` ms |
| Smart Apply | Standardmäßig aus; aktiviert Tab, Befehl und Template-Einstellungen | aus |
| Kontext-Budget | Maximale Zeichenzahl als Kontext (Obergrenze folgt dem Modellfenster) | `12000` |
| Denken unterdrücken | Default für neue Chats; zusätzlich pro Chat umschaltbar | aus |
| Enter sendet | An: Enter sendet, Shift+Enter für Zeilenumbruch · Aus: umgekehrt | an |

> **Endpunkt-Tipp:** die Basis-URL *ohne* abschließendes `/v1` eintragen — das Plugin hängt es an. Beide Formen werden akzeptiert.

> **Externe Anbieter:** jede Endpunkt-Zeile kann einen API-Schlüssel und einen Modellnamen tragen — damit wird sie zu einem gehosteten OpenAI-kompatiblen Anbieter (OpenRouter, Groq, Together, Mistral, OpenAI, …), der in derselben Fallback-Liste wie lokale Server steht. Schlüssel liegen unverschlüsselt in der Plugin-`data.json` — wie jede andere Einstellung — und wandern mit dem Einstellungs-Sync mit.

## Wie es funktioniert

Der Index in `<vault>/_vaultrag/` ist ein portabler **Matryoshka-256-int8-Mini-Index** auf Notiz-Ebene — ein 256-dimensionaler int8-Vektor pro Notiz, rund 1,4 MB für einige tausend Notizen. Klein genug, um mit dem Vault zu synchronisieren, und genau darum geht es: das Plugin lädt ihn und rechnet **Brute-Force-Cosinus lokal**, sodass Retrieval auf jedem gesyncten Gerät identisch funktioniert — kein Daemon, kein VPN, kein On-Device-LLM. Was das Gerät verlässt, ist Text: jede gespeicherte Notiz geht zum Neu-Einbetten an den **Embedding-Endpunkt**, und Chat, Smart Apply und LLM-Umformatierung schicken Prompt und Kontext an den **Chat-Endpunkt**. Beides sind Endpunkte, die du einträgst — standardmäßig welche unter deiner Kontrolle — und bei einem Drittanbieter landet davon erst etwas, sobald du dessen API-Schlüssel hinterlegst.

Das Plugin schreibt diesen Index selbst, als eine einzige Container-Datei (`_vaultrag/index.bin`, bei jedem Laden per CRC geprüft — eine Datei statt mehrerer heißt: ein Sync-Dienst kann nie eine gemischte Generation ausliefern), und liest jeden Index desselben Formats — auch einen extern erzeugten.

Architektur, Modul-Layout und Mitwirkenden-Konventionen stehen in [`AGENTS.md`](https://github.com/johannes-kaindl/vault-rag/blob/main/AGENTS.md).

## Dokumentation

Die ausführlichen Guides liegen in [`docs/`](https://github.com/johannes-kaindl/vault-rag/tree/main/docs) — auf Englisch, gegliedert nach [Diátaxis](https://diataxis.fr):

| | |
|---|---|
| **[Tutorial](https://github.com/johannes-kaindl/vault-rag/blob/main/docs/tutorial.md)** | Von Null zu den ersten verwandten Notizen — hier anfangen |
| **[How-to](https://github.com/johannes-kaindl/vault-rag/blob/main/docs/how-to/index.md)** | Chat einrichten, Umformatieren, Smart Apply, Index reparieren, MCP, Geräte-Sync |
| **[Referenz](https://github.com/johannes-kaindl/vault-rag/blob/main/docs/reference/index.md)** | Alle Befehle, Einstellungen, Defaults, MCP-Tools und das Index-Format |
| **[Hintergrund](https://github.com/johannes-kaindl/vault-rag/blob/main/docs/explanation/index.md)** | Warum der Index so aussieht, wie er aussieht — und wo seine Garantien enden |

## MCP-Server (Index aus Claude Code & anderen Agenten nutzen, nur Desktop)

Der Embedding-Index taugt auch als Retrieval-Backend für MCP-Clients. Ein Plugin-interner HTTP-Server (Streamable HTTP, nur Loopback) stellt drei nur-lesende Tools bereit:

| Tool | Wirkung | Braucht Endpunkt? |
|---|---|---|
| `search` | Semantische Suche über das Vault (Query → `{path, score}`) | ja (bettet die Anfrage ein) |
| `related` | Notizen, die einer gegebenen ähneln (direkt aus dem Index) | nein — offline |
| `read_note` | Volltext einer Notiz (`.md`, Ausschlüsse werden respektiert) | nein — offline |

In den Einstellungen unter „MCP-Server" aktivieren (nur Desktop). Der Server bindet an `127.0.0.1` auf einem konfigurierbaren Port (Default `8123`) und verlangt bei jeder Anfrage einen Bearer-Token. Ein Knopf erzeugt den fertigen Registrierungs-Befehl:

```bash
claude mcp add --transport http vault-retrieval http://127.0.0.1:8123/mcp \
  --header "Authorization: Bearer <token>"
```

Die Konfiguration kommt aus den Plugin-Einstellungen — keine zweite Config-Datei. Der Server läuft nur, solange Obsidian offen ist, zieht Index-Änderungen live nach und **schreibt nie** ins Vault.

## Plugin-API (für andere Obsidian-Plugins)

Retrieval steht auch **innerhalb von Obsidian** bereit — ohne MCP-Server und ohne Netzwerkweg.
Jedes Plugin kann dieses hier nach semantischen Treffern fragen, statt einen eigenen
Embedding-Index aufzubauen:

```js
const api = app.plugins.plugins["vault-retrieval"]?.api;   // undefined, wenn nicht installiert/aktiv
if (api?.apiVersion === 1 && api.status().indexed) {
  const r = await api.search("was hatte ich zum Index-Format entschieden?");
  if (r.ok) for (const hit of r.hits) console.log(hit.path, hit.score);
  else console.log("nicht verfügbar:", r.reason);          // "no-index" | "offline"
}
```

| Element | Signatur | Anmerkung |
|---|---|---|
| `apiVersion` | `number` | `1`. Vor jedem Verlass auf die Form darunter prüfen. |
| `status()` | `{ apiVersion, indexed, noteCount }` | Synchron und **netzfrei** — gedacht für „kann ich Retrieval überhaupt anbieten?". Sagt nichts über die Erreichbarkeit des Endpunkts; das ginge nur mit einer Anfrage. |
| `search(query, opts?)` | `Promise<Result>` | Text → semantisch ähnliche Notizen. Braucht einen erreichbaren Embedding-Endpunkt. |
| `related(path, opts?)` | `Promise<Result>` | Notiz → verwandte Notizen. Direkt aus dem Index: kein Netz, offline und mobil nutzbar. |

`Result` ist entweder `{ ok: true, hits: [{ path, score }] }` oder `{ ok: false, reason }` mit
`reason` aus `"no-index"`, `"offline"` oder `"not-indexed"` (letzteres trägt den `path` mit).
**Diese Aufrufe werfen nie** — erwartbare Zustände sind Werte, und `reason` ist ein
maschinenlesbarer Code, nie übersetzter Fließtext: die Formulierung gehört dem Aufrufer.

`opts` nimmt `k` (Trefferzahl) und `minSim` (Ähnlichkeits-Untergrenze), beide mit deinen
Einstellungen als Vorgabe. Die **Ausschluss-Liste ist nicht überschreibbar** — sie ist eine
Grenze, die du setzt, kein Tuning-Regler für ein fremdes Plugin. Scores kommen roh und
ungerundet zurück; die Darstellung entscheidet der Aufrufer.

Bewusst **nicht** enthalten sind Notiz-Lesen und rohe Embedding-Vektoren: ein Plugin liest das
Vault über Obsidians eigene API, und Vektoren würden Aufrufer an Index-Dimension, Modell und
Quantisierung binden — genau die Interna, die dieses Plugin frei ändern können muss.

*Stand: der Vertrag ist versioniert, aber jung. Version 1 gilt als experimentell, bis ein
zweiter Konsument ihre Form bestätigt hat.*

## Verwandt

Bild-Transkription (Handschrift/Screenshots → Markdown) liegt im Schwester-Plugin **[image-to-markdown](https://git.jkaindl.de/jkaindl/image-to-markdown)**.

## Mitwirken

Issues und Pull Requests gerne auf [Forgejo](https://git.jkaindl.de/jkaindl/vault-rag) (kanonisch; GitHub ist ein Mirror). Das Projekt ist testgetrieben — jede Änderung kommt mit Tests (`npm test`), größere Features laufen über brainstorming → Spec → Plan → TDD. Konventionen in [`AGENTS.md`](https://github.com/johannes-kaindl/vault-rag/blob/main/AGENTS.md).

## Lizenz

- **Code:** GNU Affero General Public License v3.0 oder später ([`LICENSE`](LICENSE)). Eine kommerzielle Dual-Lizenz gibt es auf Anfrage, falls die AGPL-Copyleft nicht passt.
- **Dokumentation & Texte:** Creative Commons Attribution-ShareAlike 4.0 ([`LICENSE-DOCS`](LICENSE-DOCS)).

Copyright © 2026 Johannes Kaindl.
