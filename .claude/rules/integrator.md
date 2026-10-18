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
