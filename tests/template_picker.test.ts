import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { pickTemplate, _lastPicker } from "../src/template_picker";

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.basename = path.split("/").pop()!.replace(/\.md$/, "");
  f.extension = "md";
  return f;
}

function appWith(paths: string[]): any {
  return { vault: { getMarkdownFiles: vi.fn(() => paths.map(tfile)) } };
}

describe("pickTemplate", () => {
  it("eine Auswahl löst mit deren Pfad auf", async () => {
    const app = appWith(["Templates/Buch.md", "Templates/Coding.md", "Notes/x.md"]);
    const p = pickTemplate(app, "Templates/", null);
    const picker = _lastPicker!;
    const chosen = picker.getItems().find(f => f.path === "Templates/Coding.md")!;
    picker.onChooseItem(chosen);
    picker.onClose(); // beide feuern bei echter Auswahl gemeinsam
    await expect(p).resolves.toBe("Templates/Coding.md");
  });

  it("getItems liefert nur Markdown-Dateien unter templateDir", async () => {
    const app = appWith(["Templates/Buch.md", "Notes/x.md", "Templates/sub/Tief.md", "Other/Templates.md"]);
    const p = pickTemplate(app, "Templates/", null);
    const picker = _lastPicker!;
    expect(picker.getItems().map(f => f.path)).toEqual(["Templates/Buch.md", "Templates/sub/Tief.md"]);
    picker.onChooseItem(picker.getItems()[0]);
    picker.onClose();
    await p; // Promise abräumen, kein Hänger
  });

  it("getItems schließt Folder Notes aus (Name === Ordner)", async () => {
    const app = appWith(["Templates/Buch.md", "Templates/Projekt/Projekt.md", "Templates/Projekt/Standup.md"]);
    const p = pickTemplate(app, "Templates/", null);
    const picker = _lastPicker!;
    expect(picker.getItems().map(f => f.path)).toEqual(["Templates/Buch.md", "Templates/Projekt/Standup.md"]);
    picker.onChooseItem(picker.getItems()[0]);
    picker.onClose();
    await p;
  });

  it("preselect wird per (Vorschlag)-Label markiert", async () => {
    const app = appWith(["Templates/Buch.md", "Templates/Coding.md"]);
    const p = pickTemplate(app, "Templates/", "Templates/Coding.md");
    const picker = _lastPicker!;
    // setQuery() lief beim open() (seedet die Sucheingabe); geprüft wird das verlässliche Label-Signal.
    const coding = picker.getItems().find(f => f.path === "Templates/Coding.md")!;
    const buch = picker.getItems().find(f => f.path === "Templates/Buch.md")!;
    expect(picker.getItemText(coding)).toContain("(Vorschlag)");
    expect(picker.getItemText(buch)).not.toContain("(Vorschlag)");
    picker.onChooseItem(coding);
    picker.onClose();
    await p;
  });

  it("Schließen ohne Auswahl löst mit null auf", async () => {
    const app = appWith(["Templates/Buch.md"]);
    const p = pickTemplate(app, "Templates/", null);
    const picker = _lastPicker!;
    picker.onClose(); // keine Auswahl
    await new Promise(r => setTimeout(r, 0)); // den setTimeout(0)-Tick durchlassen
    await expect(p).resolves.toBeNull();
  });

  it("Doppel-Settle ist geschützt: Auswahl gewinnt gegen nachgelagertes onClose-null", async () => {
    const app = appWith(["Templates/Buch.md"]);
    const p = pickTemplate(app, "Templates/", null);
    const picker = _lastPicker!;
    picker.onChooseItem(picker.getItems()[0]); // settle("Templates/Buch.md")
    picker.onClose();                          // plant settle(null) für den nächsten Tick
    await new Promise(r => setTimeout(r, 0));   // null-Versuch läuft, wird aber vom Guard verschluckt
    await expect(p).resolves.toBe("Templates/Buch.md");
  });
});
