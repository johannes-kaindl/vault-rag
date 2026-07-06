import { describe, it, expect } from "vitest";
import { VaultRetrievalView } from "../src/hub_view";
import { makeFakeEl } from "./__mocks__/obsidian";
import type { HubPanel, TabId } from "../src/hub_panel";

function fakePanel(id: TabId): HubPanel & { log: string[] } {
  const log: string[] = [];
  return {
    id, label: id, icon: "x", log,
    mount(c: HTMLElement) { log.push("mount"); (c as any).createDiv({ cls: `p-${id}` }); },
    onShow() { log.push("show"); },
    onHide() { log.push("hide"); },
    onFileOpen(p) { log.push(`file:${p ?? "null"}`); },
    destroy() { log.push("destroy"); },
  } as HubPanel & { log: string[] };
}

// Panel-Div per data-tab finden — children-Traversal + getAttribute (kein querySelector).
function panelDiv(root: any, tab: TabId): any {
  const content = root.children.find((c: any) => c.className?.includes("vault-rag-hub-content"));
  return content.children.find((c: any) => c.getAttribute?.("data-tab") === tab);
}

describe("VaultRetrievalView.buildInto", () => {
  it("mountet alle Panels, zeigt nur den Default-Tab", () => {
    const panels = [fakePanel("related"), fakePanel("chat")];
    const root = makeFakeEl();
    VaultRetrievalView.buildInto(root, panels, "related");   // reine Aufbau-Logik, siehe Step 3
    expect(panels.every(p => (p as any).log.includes("mount"))).toBe(true);
    expect(panelDiv(root, "related").className.includes("is-hidden")).toBe(false);
    expect(panelDiv(root, "chat").className.includes("is-hidden")).toBe(true);
  });

  it("Default-Panel bekommt initial onShow, das andere nicht", () => {
    const panels = [fakePanel("related"), fakePanel("chat")];
    VaultRetrievalView.buildInto(makeFakeEl(), panels, "related");
    expect((panels[0] as any).log).toContain("show");
    expect((panels[1] as any).log).not.toContain("show");
  });

  it("Tab-Wechsel: altes Panel hide, neues show, Sichtbarkeit getauscht", () => {
    const panels = [fakePanel("related"), fakePanel("chat")];
    const root = makeFakeEl();
    const ctrl = VaultRetrievalView.buildInto(root, panels, "related");
    ctrl.setTab("chat");
    expect((panels[0] as any).log).toContain("hide");
    expect((panels[1] as any).log).toContain("show");
    expect(panelDiv(root, "chat").className.includes("is-hidden")).toBe(false);
    expect(panelDiv(root, "related").className.includes("is-hidden")).toBe(true);
  });

  it("Kontextwechsel ruft onFileOpen auf allen Panels", () => {
    const panels = [fakePanel("related"), fakePanel("chat")];
    const root = makeFakeEl();
    const ctrl = VaultRetrievalView.buildInto(root, panels, "related");
    ctrl.notifyFileOpen("Note.md");
    expect((panels[0] as any).log).toContain("file:Note.md");
    expect((panels[1] as any).log).toContain("file:Note.md");
  });
});
