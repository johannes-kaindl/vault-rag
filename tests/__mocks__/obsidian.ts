export function makeFakeEl(): any {
  const children: any[] = [];
  const el: any = {
    children, empty: () => { children.length = 0; },
    createDiv: (o?: any) => { const c = makeFakeEl(); if (o?.cls) c.className = o.cls; if (o?.text) c.textContent = o.text; children.push(c); return c; },
    createEl: (t: string, o?: any) => { const c = makeFakeEl(); c.tagName = t.toUpperCase(); if (o?.text) c.textContent = o.text; if (o?.cls) c.className = o.cls; children.push(c); return c; },
    setText: (t: string) => { el.textContent = t; }, addClass: () => {}, addEventListener: () => {},
  };
  return el;
}
export class Plugin { app: any; manifest: any; constructor(app: any, m: any) { this.app = app; this.manifest = m; } async loadData() { return {}; } async saveData(_: any) {} addCommand(_: any) {} registerView(_: string, __: any) {} registerEvent(_: any) {} addSettingTab(_: any) {} addRibbonIcon(_: string, __: string, ___: any) { return makeFakeEl(); } }
export class ItemView { app: any; contentEl: any; constructor(public leaf: any) { this.app = leaf?.app || {}; this.contentEl = makeFakeEl(); } getViewType() { return "unknown"; } getDisplayText() { return ""; } async onOpen() {} async onClose() {} }
export class PluginSettingTab { app: any; plugin: any; containerEl: any; constructor(app: any, plugin: any) { this.app = app; this.plugin = plugin; this.containerEl = makeFakeEl(); } display() {} }
export class Setting { constructor(public containerEl: any) {} setName(_: string) { return this; } setDesc(_: string) { return this; } addText(cb: any) { cb({ setValue: () => ({ onChange: () => {} }), setPlaceholder: () => ({}) }); return this; } addSlider(cb: any) { cb({ setLimits: () => ({ setValue: () => ({ onChange: () => {} }) }) }); return this; } }
export class TFile { path = ""; basename = ""; extension = "md"; }
export function makeFakeApp(): any {
  return { vault: { adapter: { read: vi.fn().mockResolvedValue(""), readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)), exists: vi.fn().mockResolvedValue(true), stat: vi.fn().mockResolvedValue({ mtime: 0 }) } },
    workspace: { getActiveFile: vi.fn().mockReturnValue(null), getLeavesOfType: vi.fn().mockReturnValue([]), getRightLeaf: vi.fn().mockReturnValue({ setViewState: vi.fn() }), on: vi.fn() } };
}
