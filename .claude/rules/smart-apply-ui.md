---
paths:
  - "src/smart_apply*.ts"
  - "src/note_restructurer.ts"
  - "src/template_*.ts"
  - "src/*_view.ts"
  - "src/*_panel.ts"
  - "styles.css"
---

# Smart Apply und Oberfläche — Gotchas

Gotchas zu Vorlagen, Smart Apply und gesperrten Knöpfen (`src/smart_apply*.ts`, `styles.css`).

- **Eine Vorlage ohne erkennbare Überschriften ist ein Daten-Defekt, der wie ein Modell-Defekt
  aussieht.** `parseTemplate` erkennt Überschriften **zeilenweise** (`^(#{1,6})\s+(.+?)\s*$`). Eine
  Vorlage, deren `##`-Zeilen nicht je am Zeilenanfang stehen — etwa weil `%%`-Anleitungen und
  Überschriften auf **einer** Zeile liegen —, liefert `tpl.sections === []`. Der Prompt nennt dann
  keine einzige Ziel-Überschrift, und `reconcileAssignment` verwirft anschließend **jede** Zuordnung
  des Modells, auch eine fehlerfreie. Sichtbar wurde davon nur „0 von N zugeordnet · N übrig" — nicht
  von einem Modell-Versagen zu unterscheiden. Gemessen 2026-08-22 an den README-Fixture-Vorlagen (alle
  drei einzeilig angelegt): dieselben zwei Modelle liefern **0/8** gegen die kaputte und **8/8** gegen
  die reparierte Vorlage. Die Fehldiagnose kostete zwei Modell-Durchläufe und eine Sprach-Hypothese,
  bevor jemand `tpl.sections.length` ansah.
  **Die Lehre ist nicht der Fixture-Fix, sondern der Guard:** ein Zustand, in dem ein Ergebnis
  strukturell leer sein MUSS, darf nicht als leeres Ergebnis angezeigt werden. `smart_apply.ts`
  (Step 5b) bricht deshalb vor dem Modell ab und meldet `template-no-sections`; `sectionDiff` und
  `unassigned` bleiben leer, damit die Summenzeile keine Zuordnung behauptet, die nie versucht wurde.

- **Obsidians Theme rendert `.is-disabled` auf `<button>` NICHT — die Klasse allein sperrt nur den
  Code, nicht den Blick.** Gemessen 2026-09-11 (1.14.0, Gegenproben-Task): der Anwenden-Knopf von
  Smart Apply trug `is-disabled` (Unit-Test pinnt die Klasse) und hatte Computed Style `opacity 1 ·
  cursor default · pointer-events auto`, gesperrt sah im Screenshot exakt aus wie aktiv. Was das
  Theme kennt, ist **`aria-disabled="true"`** (dimmt von selbst auf 0.7); die volle Sperr-Grammatik
  (0.5, `not-allowed`, `pointer-events: none`) kommt aus der eigenen Regel in `styles.css`, wie bei
  den Modus-Knöpfen. Regel für neue Knöpfe: `toggleClass("is-disabled")` **plus** `aria-disabled`
  **plus** eine Regel für die Klasse — und der Beleg ist der Computed Style (Smoke-Punkt 7d), nie die
  Klasse. ⚠️ Beim Messen: `enablePlugin` auf ein aktives Plugin ist ein **No-op** — wer CSS neu laden
  will, braucht `disablePlugin` + `enablePlugin`, sonst misst er den alten Stand und die Gegenprobe
  sieht grün aus.
