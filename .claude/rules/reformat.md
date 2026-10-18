---
paths:
  - "src/reformat_*.ts"
---

# Umformatieren — Gotchas

Gotchas zu Editor-Auswahl, Commands und Markdown-Transforms (`src/reformat_*.ts`).

- **`editorCallback` blendet einen Command aus der Palette aus**, sobald kein Markdown-Editor
  fokussiert ist — Lesemodus, Fokus in der Sidebar, Canvas/Graph/PDF/Settings. Für den Nutzer sieht
  das aus, als wäre der Command **verschwunden** (real passiert, Slice C.2). Wenn ein Command auch
  ohne Editor auffindbar bleiben soll: `callback` nehmen und den Grund per Notice erklären
  (`readinessMessage` in `reformat_selection_state.ts` ist dafür die eine Wahrheit). Im Lesemodus
  ist Umformatieren **grundsätzlich** unmöglich — Obsidian stellt dort keinen Editor-State bereit,
  die sichtbare Markierung ist eine DOM-Selektion.

- **Ein `Editor` gehört zur View, nicht zur Datei.** Öffnet man im selben Pane eine andere Notiz,
  bleibt **dieselbe** `Editor`-Instanz bestehen. Wer sich eine Auswahl merkt, darf sich deshalb
  nicht auf die Editor-Identität verlassen: bei zufällig passendem Text (Template-Notizen,
  Boilerplate-Header) landet die Ersetzung sonst in der **falschen Notiz**. `captureIsLive`
  (`main.ts`) prüft daher Editor-Identität **und** `getMode() === "source"` **und** `file.path`.

- **Escapte Pipes müssen beim Rendern re-escaped werden.** `\|` in einer Markdown-Tabellenzelle wird
  beim Parsen zu `|`; schreibt man es un-escaped zurück, zerfällt eine Zelle in zwei, Header- und
  Delimiter-Spaltenzahl divergieren und der Inhalt ist beim nächsten Edit dauerhaft zerrissen.
  Besonders heikel, weil mechanische Transforms **ohne Vorschau sofort** ersetzen. `renderTable`
  (`reformat_mechanical.ts`) escapet; ein Round-Trip-Test pinnt die Parse/Render-Symmetrie.
