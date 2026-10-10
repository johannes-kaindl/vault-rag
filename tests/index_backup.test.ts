import { describe, it, expect } from "vitest";
import { backupDirName, selectBackupsToDelete, sortBackupsNewestFirst, BACKUP_SUBDIR } from "../src/index_backup";
import { stampedName, utcCalendar } from "../src/vendor/kit/rotation";

describe("backupDirName", () => {
  it("ersetzt : und . für dateisystem-sichere Namen", () => {
    expect(backupDirName("2026-07-09T17:10:05.123Z")).toBe("2026-07-09T17-10-05-123Z");
  });
});

describe("backupDirName — Stempel mit Millisekunden, damit die Rotation ihn lesen kann", () => {
  it("normalisiert einen Stempel ohne Millisekunden und mit Offset auf UTC mit Millisekunden", () => {
    expect(backupDirName("2026-07-09T17:10:05Z")).toBe("2026-07-09T17-10-05-000Z");
    expect(backupDirName("2026-07-09T19:10:05.250+02:00")).toBe("2026-07-09T17-10-05-250Z");
  });
  it("ein nicht lesbarer Stempel bleibt, wie er war (nur Zeichen ersetzt) — die Rotation löscht ihn dann nie", () => {
    expect(backupDirName("kein:datum.x")).toBe("kein-datum-x");
  });
});

describe("selectBackupsToDelete — Großvater-Vater-Sohn", () => {
  // Fester Kalender: der Standard hängt an der Zeitzone des Rechners.
  const cal = utcCalendar;
  const at = (iso: string): string => stampedName(Date.parse(iso));
  const now = Date.parse("2026-09-30T12:00:00.000Z");   // Mittwoch

  it("Golden-Tabelle: ein Backup je Tag über 60 Tage → 12 bleiben, 48 gehen", () => {
    const names: string[] = [];
    for (let i = 0; i < 60; i++) names.push(at(new Date(Date.parse("2026-08-02T08:00:00.000Z") + i * 86_400_000).toISOString()));
    expect(names).toHaveLength(60);
    // Von Hand aus der Policy 6/7/4/6 (ISO-Wochen, Montag): Tage 24.–30.9. (7), je ältester der
    // letzten vier Wochen (Mo 7., 14., 21., 28.9.; der 28. liegt schon bei den Tagen), je ältester der
    // letzten sechs Monate (2.8., 1.9.).
    const kept = ["2026-08-02", "2026-09-01", "2026-09-07", "2026-09-14", "2026-09-21",
      "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"].map((d) => at(`${d}T08:00:00.000Z`));
    const del = selectBackupsToDelete(names, now, { calendar: cal });
    expect(del).toHaveLength(48);
    expect(names.filter((n) => !del.includes(n)).sort()).toEqual(kept.sort());
  });

  it("mehrere Stempel an einem Tag: die sechs neuesten von heute und der älteste des Tages bleiben", () => {
    const names = [1, 2, 3, 4, 5, 6, 7, 8].map((h) => at(`2026-09-30T0${h}:00:00.000Z`));
    expect(selectBackupsToDelete(names, now, { calendar: cal })).toEqual([at("2026-09-30T02:00:00.000Z")]);
  });

  it("built_at älter als now: das jüngste Backup fällt nie heraus (ohne den Schutz fiele es)", () => {
    const names = ["2026-10-08T07:00:00.000Z", "2026-10-09T09:00:00.000Z", "2026-10-09T15:00:00.000Z", "2026-10-09T21:00:00.000Z"].map(at);
    const now2 = Date.parse("2026-10-10T12:00:00.000Z");
    const del = selectBackupsToDelete(names, now2, { calendar: cal });
    expect(del).toEqual([at("2026-10-09T15:00:00.000Z")]);
    expect(del).not.toContain(at("2026-10-09T21:00:00.000Z"));
  });

  it("protect: das gerade angelegte Backup bleibt, auch wenn es nicht das jüngste ist", () => {
    const names = ["2026-10-09T09:00:00.000Z", "2026-10-09T15:00:00.000Z", "2026-10-09T21:00:00.000Z"].map(at);
    const now2 = Date.parse("2026-10-10T12:00:00.000Z");
    const del = selectBackupsToDelete(names, now2, { calendar: cal, protect: [at("2026-10-09T15:00:00.000Z")] });
    expect(del).not.toContain(at("2026-10-09T15:00:00.000Z"));
  });

  it("ein Name ohne lesbaren Stempel wird nie gelöscht", () => {
    const names = ["notizen", "2026-07-01T00-00-00Z", at("2026-01-01T00:00:00.000Z"), at("2026-09-30T08:00:00.000Z")];
    const del = selectBackupsToDelete(names, now, { calendar: cal });
    expect(del).not.toContain("notizen");
    expect(del).not.toContain("2026-07-01T00-00-00Z");
  });

  it("leere Liste und ein einzelnes Backup → nichts löschen", () => {
    expect(selectBackupsToDelete([], now, { calendar: cal })).toEqual([]);
    expect(selectBackupsToDelete([at("2020-01-01T00:00:00.000Z")], now, { calendar: cal })).toEqual([]);
  });

  it("höchstens 23 bleiben, auch bei sehr dichter Sicherung", () => {
    const names: string[] = [];
    for (let i = 0; i < 400; i++) names.push(stampedName(now - i * 3 * 3_600_000));
    const del = selectBackupsToDelete(names, now, { calendar: cal });
    expect(names.length - del.length).toBeLessThanOrEqual(23);
  });
});

describe("sortBackupsNewestFirst", () => {
  it("neueste zuerst (lexikografisch absteigend über ISO-Namen)", () => {
    const r = sortBackupsNewestFirst([
      { name: "2026-07-01T00-00-00-000Z", count: 10 },
      { name: "2026-07-03T00-00-00-000Z", count: 30 },
      { name: "2026-07-02T00-00-00-000Z", count: 20 },
    ]);
    expect(r.map(e => e.count)).toEqual([30, 20, 10]);
  });
});

describe("BACKUP_SUBDIR", () => {
  it("ist index-backups", () => { expect(BACKUP_SUBDIR).toBe("index-backups"); });
});
