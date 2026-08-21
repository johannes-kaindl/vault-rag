# Aufnahme-Vertrag — README-Bilder

Dieser Ordner hält die Bilder, die `README.md` und `README.de.md` einbetten. Diese Datei ist
der **Vertrag** dafür: welche Bilder es gibt, was jedes zeigen muss, in welcher Klasse es
steht — und wie man sie reproduzierbar neu aufnimmt.

Geprüft wird der Vertrag automatisch: `readme_lint.py` (Workspace-Werkzeug) gleicht
**Vertrag ↔ Dateien ↔ README-Einbettungen** in alle Richtungen ab. Ein Eintrag ohne Datei,
eine Datei ohne Eintrag und eine Einbettung ohne Vertragszeile sind je ein Befund.

> **Warum überhaupt Bilder:** CORE-META-03 war für dieses Repo die letzte offene
> Goldstandard-Lücke — `readme_lint` meldete sonst null Befunde. Die Begründung dafür lautete
> jahrelang „Screenshots brauchen eine laufende GUI und sind agentenseitig nicht erzeugbar".
> Mit `npm run shots` ist das ein Kommando.

## Status

**Stand 2026-08-21: sieben von acht Bildern stehen.** Offen ist `smart-apply.png`, und zwar
aus einem Grund am Prüfling — siehe unten. `npm run shots:check` ist die Wahrheit über den
Bestand: was hier in Prosa steht, kann veralten, die Prüfung nicht.

## Die Bilder

| Datei | Klasse | referenziert von | muss zeigen |
| --- | --- | --- | --- |
| `hero.png` | hero | README (oben) | Ganzes Fenster: eine Notiz links, der Sidebar-Hub rechts auf dem Tab **Related** mit gefüllter Trefferliste. Das Bild muss ohne Bildunterschrift erklären, was das Plugin ist — Notiz und thematisch verwandte Notizen nebeneinander. |
| `search.png` | feature | README § Features | Den Tab **Search** mit einer Anfrage, die *nach Bedeutung* trifft: die Suchzeile enthält keine der Wörter, die in den Titeln der Treffer stehen. Genau das ist die Aussage — sonst zeigt das Bild eine Volltextsuche. |
| `chat.png` | feature | README § Features | Den Tab **Chat** mit einer fertigen, gestreamten Antwort *und* dem Live-Kontext-Panel darüber: welche Notizen die Antwort tragen, als anklickbare Chips. Beide Hälften müssen im Bild sein — die Antwort allein wäre ein beliebiges Chat-Fenster. |
| `thinking.png` | feature | README § Features | Den aufgeklappten `💭 Thoughts`-Block **von oben** — Label sichtbar, Gedanken lesbar — **und** den Thinking-Schalter der Kopfzeile. Aussage: das Denken ist sichtbar, und es ist abschaltbar. Bewusst **ohne** die Antwort: beides zusammen passt nicht unter `max_ratio`, und `chat.png` trägt Antwort und Quellen bereits. Zwei Bilder, zwei Aussagen. |
| `reformat.png` | feature | README § Features | Die Reformat-Vorschau: oben der Ur-Text, darunter das gestreamte Ergebnis, dazu die Knöpfe zum Anwenden/Neu/Verwerfen. Das Bild trägt die Kernzusage „ansehen, bevor es ersetzt wird". |
| `endpoints.png` | feature | README § Configuration | Die Endpunkt-Liste mit **mindestens zwei Zeilen unterschiedlicher Rolle** — eine *in use*, eine andere *reachable, but position 2* oder *unreachable*. Ein Bild mit nur einer Zeile zeigt die Aussage nicht: dass Erreichbarkeit und Verwendung zwei verschiedene Dinge sind. |
| `smart-apply.png` | feature | README § Features | **OFFEN — siehe unten.** Soll das Diff-Gate vor dem Anwenden zeigen: die relevanz-sortierte Vorlagenliste und die Gegenüberstellung, welcher Block unter welche Überschrift wandert. Es muss erkennbar sein, dass hier **verschoben** und nicht neu geschrieben wird. |
| `settings.png` | detail | README § Configuration | Den Einstellungs-Tab **ganz**, als klickbare 380-px-Vorschau auf die Vollauflösung. Zweck ist der Umfangs-Eindruck, nicht die Lesbarkeit einzelner Zeilen. |

### Offen: `smart-apply.png`

**Zugesagt, nicht aufgenommen — und der Grund ist ein Befund am Prüfling, kein Aufnahmefehler.**
Das Bild soll das Diff-Gate zeigen: welcher Block unter welche Überschrift wandert. Gemessen am
2026-08-21 ordnet Smart Apply auf `Team sync 2026-03-12.md` gegen `Templates/Meeting note.md`
aber **0 von 8 Blöcken** zu — „Ready to apply · 0/8 blocks assigned · 8 remaining · 0 fields
set", alle acht landen unter *unassigned*. Die Vorlage wird dabei korrekt erkannt
(`Template: meeting · detected automatically`) und die Relevanz-Rangliste stimmt
(Meeting note 100 % · Project note 85 % · Literature note 69 %); es scheitert erst an der
Zuordnung.

Reproduziert mit **zwei** Modellen (`qwen/qwen3.6-27b`, `qwen/qwen3.8-27b`), Modus
*Deterministic* — es ist also kein Modell-Zufall. Ein Bild davon würde die Zusage der README
(„routing your *original* blocks under the right headings") widerlegen statt sie zu zeigen.

Unbestätigte Spur, die zuerst geprüft gehört: der Smart-Apply-Prompt ist **hart deutsch**
(`note_restructurer.ts:320/337/353` — `## Vorlagen-Struktur (Überschriften + Anleitung)`,
`Die \`Anleitung:\`-Zeilen …`), während Notiz und Vorlage englisch sind. Das ist dieselbe
Wurzel wie beim Chat-System-Prompt, der am selben Tag behoben wurde (`effectiveSystemPrompt`,
`settings_core.ts`) — nur ungleich größer, weil der Prompt-Bau daran hängt.

`npm run shots:check` meldet dieses Bild bei jedem Lauf als fehlend. Das ist Absicht: die
Lücke soll sichtbar bleiben, bis sie geschlossen ist.

Klassen und Grenzen kommen aus dem zentralen Bild-Standard
(`_docs/readme/readme-spec.json`, Block `images`) und werden hier **nicht** wiederholt —
ändert sich dort etwas, gilt es hier beim nächsten Lauf.

## Was der Lauf voraussetzt

Anders als in den meisten Nachbar-Repos ist die Aufnahme hier nicht mit einem laufenden
Obsidian getan. Vier der acht Bilder brauchen echte Server, und zwar aus einem Grund, der
auch für den Nutzer gilt: **dieses Plugin rechnet nichts vor, es ruft ab.**

1. **Ein Embedding-Endpunkt** (`http://localhost:11434`, Ollama, Modell
   `qwen3-embedding:8b`). Ohne ihn gibt es keinen Index, und ohne Index sind `hero.png`,
   `search.png`, `chat.png` und `smart-apply.png` leere Panels. Der Aufnahme-Lauf baut den
   Index selbst (`--setup` legt die Notizen, der Reindex-Befehl embedded sie) — bei achtzehn
   Fixture-Notizen dauert das Sekunden.
2. **Ein Chat-Endpunkt** (`http://localhost:1234`, LM Studio) **mit aktiviertem CORS**:
   ```bash
   lms server start --cors
   ```
   Das ist keine Bequemlichkeit. `ChatClient.stream` läuft als `XMLHttpRequest` **im
   Renderer** und sendet damit zwingend `Origin: app://obsidian.md`; ein Server ohne CORS
   weist den Preflight ab, während der Verbindungstest der Einstellungen weiter grün meldet
   (der nimmt `requestUrl` im Hauptprozess und sendet keinen `Origin`). Dieselbe Falle hat in
   `yijing-oracle` und `vault-crews` je einen halben Tag gekostet. **Nach der Aufnahme
   zurückstellen** — sonst dokumentiert das Bild eine Umgebung, die es beim Leser nicht gibt.
3. **Ein denkendes Modell** für `thinking.png` und ein zügiges für den Rest. Das Modell ist
   deshalb ein Argument des Rezepts (`--modell`), keine Konstante: nicht jede Maschine lädt
   jedes.

Fehlt eine dieser Voraussetzungen, bricht das betroffene Rezept **mit Klartext** ab, statt
ein leeres Panel aufzunehmen.

## Das Fixture

`fixture/notes/` ist ein kleiner Wissens-Vault zum Thema Notizarbeit und Retrieval —
achtzehn Notizen in zwei semantischen Inseln (Zettelkasten-Praxis · Embeddings/RAG), die
sich gegenseitig verlinken, plus drei Vorlagen und eine bewusst unaufgeräumte
Besprechungsnotiz.

Drei Eigenschaften sind **load-bearing**, nicht Dekoration:

- **Zwei Inseln, die sich berühren.** Related Notes und semantische Suche zeigen nur dann
  etwas, wenn es Nähe *und* Ferne gibt. Ein Vault, in dem alles gleich ähnlich ist, liefert
  eine Trefferliste ohne Aussage.
- **Eine Anfrage ohne Wortüberlappung.** `Semantic search.md` und `Spaced repetition.md`
  beantworten „how do I stop forgetting what I read", ohne die Wörter zu enthalten. Genau
  daran hängt `search.png`.
- **Eine unaufgeräumte Notiz mit `type: meeting`.** `Team sync 2026-03-12.md` ist absichtlich
  Fließtext ohne Struktur, in dem Entscheidungen, Offenes und Geplaudertes durcheinander
  stehen — das Material, das Smart Apply in `Templates/Meeting note.md` einsortiert. Eine
  bereits saubere Notiz hätte kein Diff.

Alles darin ist **englisch und erfunden**: keine echten Personen, Firmen, Werke oder Zahlen.
Die Beispiel-Namen in der Besprechungsnotiz sind Vornamen ohne Bezug.

`Templates/` bleibt im Auslieferungszustand **von der Indizierung ausgeschlossen** — die
Vorlagen-Rangliste embedded nicht-indexierte Vorlagen on-the-fly (`template_ranker.ts`), das
Bild zeigt also den Zustand, den ein neuer Nutzer bekommt.

## Reproduzieren

```bash
export STAGING_VAULTS_DIR="$HOME/StagingVaults"   # einmalig
npm run build && npm run shots -- --setup         # Vault aus dem Fixture bauen

osascript -e 'quit app "Obsidian"'                # Handarbeit: Debug-Port
open -a Obsidian --args --remote-debugging-port=9222
#   ... den Aufnahme-Vault oeffnen und einmalig als vertrauenswuerdig markieren
#   ... einmalig: Reindex-Befehl aus der Befehlspalette

npm run shots                                     # alles aufnehmen
npm run shots -- --only hero.png                  # ein Bild nachziehen
npm run shots -- --list                           # Vertrag anzeigen
npm run shots:check                               # Bild-Standard pruefen
```

**Vor jedem Aufnahme-Lauf `npm run build` und das Plugin im laufenden Obsidian neu laden.**
`npm run shots` nimmt auf, was im Vault installiert ist, nicht was im Arbeitsbaum liegt — und
der Lauf meldet dabei Erfolg. Die beiden Stände laufen genau dann auseinander, wenn man
gerade etwas geändert hat, also immer, wenn man Bilder neu aufnimmt.

Die CDP-Brücke liegt zentral im Dach (`tools/obsidian-cdp/`) und wird importiert, nicht
kopiert. Was ihr fehlt, wird **dort** ergänzt.

## Wenn ein Bild nicht zustande kommt

Dann gehört es **mit Begründung** hierher, nicht stillschweigend gestrichen — `shots:check`
meldet es dann bei jedem Lauf. Und die Frage davor lohnt sich: *antwortet der Prüfling
gerade?* Ein Bild verlangt, dass ein Feature wirklich durchläuft; Unit-Tests,
Endpunkt-Proben und Hand-Smokes können das alle umgehen. Wer beim Aufnehmen auf einen leeren
Kasten stößt, hat deshalb vermutlich keinen Aufnahme-Fehler gefunden, sondern einen Befund.
