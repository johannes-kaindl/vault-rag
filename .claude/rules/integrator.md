---
paths:
  - "src/integrator*.ts"
  - "src/link_writer.ts"
---

# Integrator — Gotchas

Gotchas zum Verlinken mit Review-Inbox (`src/integrator*.ts`, `src/link_writer.ts`).

- **`fileManager.processFrontMatter` schreibt den ganzen Block neu** — Kommentare weg, Formatierung
  fremder Felder umgeschrieben (mailstone hat es 2026-08-30 an einem echten Postfach gemessen, aus
  `to: [adresse]` wurde eine Blockliste). Der Integrator schreibt Frontmatter deshalb **zeilenweise**
  (`appendFrontmatterLink`): nur die Zeilen des einen Schluessels aendern sich. Preis: ein Schluessel als
  Block-Skalar (`>`/`|`) wird nicht angefasst, sondern als Code gemeldet; ein `---` innerhalb eines
  fremden Block-Skalars schliesst den Block vorzeitig (Grenze des zeilenbasierten Designs). Wer je
  auf die Obsidian-API zurueckfaellt, tauscht Byte-Erhalt gegen Vollstaendigkeit — bewusst, nicht nebenbei.

- **Ein Vorschlag des Integrators haengt am Notiztext zur Berechnungszeit** (djb2-Hash). Aendert sich die
  Notiz dazwischen, verweigert `acceptLink` das Schreiben und markiert die Karte als veraltet — dieselbe
  Bauart wie der Stale-Guard von Smart Apply. Nach dem eigenen Schreiben wird der Hash auf den neuen
  Stand gesetzt, sonst waere der zweite Klick auf derselben Karte immer „veraltet".

- **Eine Nutzernotiz wird nie mit `adapter.read` + `adapter.write` geändert** (Welle 34). Dazwischen liegt ein `await`; was dort in der Notiz geschieht, geht verloren, und die Prüfung gilt für einen Stand, den es beim Schreiben nicht mehr gibt. Der Weg ist `applyLinkAtomic` (`src/link_apply.ts`): Hash-Guard und Rechnung laufen im `vault.process`-Callback, bei einer im Quellmodus offenen Notiz auf dem Editorstand (nur die geänderte Spanne wird ersetzt). Ausnahme CRLF: `vault.process`. Rot-Probe: `main.ts` auf den alten Stand setzen, dann sind drei Tests in `tests/link_schreiben_atomar.test.ts` rot. Nach einem Editor-Schreiben wartet `applyLinkAtomic` bis zu 3 s auf die Platte (der Editor wird erst nach rund 2 s gespeichert); ohne das war der Smoke-Punkt „Hotkey-Commands“ rot, weil er die Platte nach 800 ms las.
