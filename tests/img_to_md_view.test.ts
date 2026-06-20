import { describe, it, expect, vi } from "vitest";
import { ImgToMdView, VIEW_TYPE_IMGMD } from "../src/img_to_md_view";
import { ImgItem } from "../src/img_to_md_state";
import { makeFakeApp } from "./__mocks__/obsidian";

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}

const ITEMS: ImgItem[] = [
  { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true },
  { raw: "![[b.heic]]", link: "b.heic", ext: "heic", supported: false },
];

function mkView(over: any = {}) {
  const calls: any = { written: [], copied: [], opened: [] };
  const deps = {
    getActivePath: over.getActivePath ?? (() => "q.md"),
    scan: over.scan ?? (async () => ITEMS),
    transcribeStream: over.transcribeStream ?? (async (_sp: string, _it: ImgItem, onContent: any) => { onContent("Hal"); onContent("lo"); return { content: "Hallo", reasoning: "", model: "vm" }; }),
    writeTranscripts: over.writeTranscripts ?? (async (_sp: string, entries: any[]) => { calls.written.push(entries); return entries.map((_: any, i: number) => `note-${i}.md`); }),
    ping: over.ping ?? (async () => true),
    listModels: over.listModels ?? (async () => []),
    getModel: over.getModel ?? (() => "vm"),
    setModel: over.setModel ?? vi.fn(),
    openPath: (p: string) => calls.opened.push(p),
    copyText: over.copyText ?? ((t: string) => calls.copied.push(t)),
  };
  const view = new ImgToMdView({ app: makeFakeApp() } as any, deps);
  return { view, calls, deps };
}

describe("ImgToMdView — Gerüst + Liste", () => {
  it("getViewType ist VIEW_TYPE_IMGMD", () => {
    expect(mkView().view.getViewType()).toBe(VIEW_TYPE_IMGMD);
  });
  it("zeigt Verbindungsstatus nach onOpen", async () => {
    const okV = mkView({ ping: async () => true }); await okV.view.onOpen();
    expect(all(okV.view.contentEl, "vault-rag-img-status")[0].textContent).toContain("verbunden");
    const offV = mkView({ ping: async () => false }); await offV.view.onOpen();
    expect(all(offV.view.contentEl, "vault-rag-img-status")[0].textContent).toContain("offline");
  });
  it("listet erkannte Bilder mit Checkbox; unsupported ist disabled", async () => {
    const { view } = mkView(); await view.onOpen();
    const checks = all(view.contentEl, "vault-rag-img-check");
    expect(checks.length).toBe(2);
    expect(checks[0].checked).toBe(true);     // a.png unterstützt + default an
    expect(checks[1].disabled).toBe(true);    // b.heic nicht unterstützt
    expect(checks[1].checked).toBe(false);
  });
  it("Toggle-Button: alle an → 'Alle abwählen', nach Klick 'Alle auswählen'", async () => {
    const { view } = mkView(); await view.onOpen();
    const btn = () => all(view.contentEl, "vault-rag-img-toggle")[0];
    expect(btn().textContent).toBe("Alle abwählen");
    btn().click();
    expect(btn().textContent).toBe("Alle auswählen");
    expect(all(view.contentEl, "vault-rag-img-check")[0].checked).toBe(false);
  });
  it("Modell-Switcher ruft setModel bei Auswahl", async () => {
    const setModel = vi.fn();
    const { view } = mkView({ setModel, listModels: async () => ["x", "y"] });
    await view.onOpen();
    const sel = all(view.contentEl, "vault-rag-img-model")[0];
    sel.value = "y";
    (sel._listeners["change"] ?? []).forEach((cb: any) => cb());
    expect(setModel).toHaveBeenCalledWith("y");
  });
  it("ohne aktive Notiz: leere Liste, Hinweis", async () => {
    const { view } = mkView({ getActivePath: () => null });
    await view.onOpen();
    expect(all(view.contentEl, "vault-rag-img-check").length).toBe(0);
    expect(all(view.contentEl, "vault-rag-img-empty").length).toBe(1);
  });
});
