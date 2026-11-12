/**
 * Hält die Panels des Hubs über das Schließen eines Blatts hinweg.
 *
 * Der Verlauf des Chats, der Suchtext und der Stand von Umformatieren und Smart Apply leben im Panel, nicht im Blatt. `registerView` ruft die Fabrik bei
 * jeder View-Erzeugung; baute sie die Panels jedes Mal neu, ging der Zustand mit dem Blatt verloren (gemessen 2026-11-03: der Chat war nach Schließen und
 * erneutem Öffnen leer). Der Pool legt die Panels beim Schließen zurück und gibt sie der nächsten View.
 *
 * Ein Panel passt nur in einen Container: ist schon ein Blatt offen, das die Panels hält, bekommt das zweite eigene. Schließen beide, behält der Pool den
 * Satz des Blatts, das zuletzt schloss (dort wurde zuletzt gearbeitet); der andere wird verworfen.
 *
 * `key` fasst zusammen, was beim Bauen aus den Einstellungen gelesen wird (nicht als Getter): ändert er sich, sind die zurückgelegten Panels veraltet und
 * werden verworfen.
 */
export class PanelPool<P> {
  private parked: { panels: P; key: string } | null = null;

  constructor(private readonly build: () => P) {}

  /** Panels für eine neue View: die zurückgelegten, solange der Schlüssel passt, sonst frisch gebaute. */
  take(key: string): P {
    const held = this.parked;
    this.parked = null;
    return held && held.key === key ? held.panels : this.build();
  }

  /** Beim Schließen der View: die Panels zurücklegen; ein bereits zurückgelegter Satz weicht dem späteren. */
  give(panels: P, key: string): void {
    this.parked = { panels, key };
  }
}
