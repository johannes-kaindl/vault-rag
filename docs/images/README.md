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

**Stand 2026-08-22: sieben von acht Bildern stehen.** Offen ist `smart-apply.png` — der
Grund am Prüfling ist gefunden und behoben, es fehlt nur noch der Aufnahme-Lauf (siehe unten). `npm run shots:check` ist die Wahrheit über den
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

**Aufnehmbar, aber noch nicht aufgenommen.** Bis zum 2026-08-22 stand hier ein Befund am
Prüfling: Smart Apply ordnete auf `Team sync 2026-03-12.md` gegen `Templates/Meeting note.md`
**0 von 8 Blöcken** zu, mit zwei Modellen reproduziert, und ein Bild davon hätte die
README-Zusage widerlegt statt sie zu zeigen.

**Die Ursache lag im Fixture — nicht am Modell und nicht an der Prompt-Sprache.** Die drei
Vorlagen unter `Templates/` waren einzeilig angelegt: sämtliche `##`-Überschriften und
`%%`-Anleitungen standen auf **einer** Zeile. `parseTemplate` erkennt Überschriften zeilenweise
(`^(#{1,6})\s+…`), fand also keine einzige, und `reconcileAssignment` verwarf mangels
Ziel-Überschriften jede Zuordnung des Modells — auch eine fehlerfreie.

Gemessen am 2026-08-22 gegen dieselben zwei Modelle, vorher gegen nachher:

| Vorlage | `tpl.sections` | zugeordnet |
| --- | --- | --- |
| einzeilig (Stand `92ad5ed`) | 0 | **0/8** |
| repariert | 6 | **8/8** |

Die Vorlagen sind repariert. Zusätzlich bricht Smart Apply eine Vorlage ohne erkennbare
Überschriften jetzt **vor** dem Modell ab und nennt den Grund (`template-no-sections`), statt
eine Null zu zeigen, die von einem Modell-Versagen nicht zu unterscheiden ist — genau diese
Anzeige hatte die Fehldiagnose ausgelöst.

Es fehlt nur der Aufnahme-Lauf gegen ein laufendes Obsidian.

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
