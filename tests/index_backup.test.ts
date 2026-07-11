import { describe, it, expect } from "vitest";
import { backupDirName, selectBackupsToDelete, sortBackupsNewestFirst, BACKUP_SUBDIR } from "../src/index_backup";

describe("backupDirName", () => {
  it("ersetzt : und . für dateisystem-sichere Namen", () => {
    expect(backupDirName("2026-07-09T17:10:05.123Z")).toBe("2026-07-09T17-10-05-123Z");
  });
});

describe("selectBackupsToDelete", () => {
  it("behält die keep neuesten, löscht den Rest (ältestzuerst)", () => {
    const names = ["2026-07-01T00-00-00-000Z", "2026-07-03T00-00-00-000Z", "2026-07-02T00-00-00-000Z", "2026-07-04T00-00-00-000Z"];
    const del = selectBackupsToDelete(names, 3);
    expect(del).toEqual(["2026-07-01T00-00-00-000Z"]);
  });
  it("weniger als keep → nichts löschen", () => {
    expect(selectBackupsToDelete(["a", "b"], 3)).toEqual([]);
  });
  it("genau keep → nichts löschen", () => {
    const names = ["2026-07-01T00-00-00-000Z", "2026-07-02T00-00-00-000Z", "2026-07-03T00-00-00-000Z"];
    expect(selectBackupsToDelete(names, 3)).toEqual([]);
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
