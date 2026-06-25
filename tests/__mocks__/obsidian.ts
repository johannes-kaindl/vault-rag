export function makeFakeEl(): any {
  const children: any[] = [];
  const attrs: Record<string, string> = {};
  let _ownText = "";
  const el: any = {
    children, empty: () => { children.length = 0; _ownText = ""; },
    createDiv: (o?: any) => { const c = makeFakeEl(); if (o?.cls) c.className = o.cls; if (o?.text) c.textContent = o.text; children.push(c); return c; },
    createEl: (t: string, o?: any) => { const c = makeFakeEl(); c.tagName = t.toUpperCase(); if (o?.text) c.textContent = o.text; if (o?.cls) c.className = o.cls; if (o?.attr) for (const k of Object.keys(o.attr)) attrs[k] = String(o.attr[k]); children.push(c); return c; },
    setText: (t: string) => { _ownText = t; }, addClass: () => {}, removeClass: () => {},
    createSpan: (o?: any) => { const c = makeFakeEl(); if (o?.cls) c.className = o.cls; if (o?.text) c.textContent = o.text; children.push(c); return c; },
    toggleClass: (cls: string, on: boolean) => {
      const parts = String(el.className ?? "").split(" ").filter(Boolean).filter((p: string) => p !== cls);
      if (on) parts.push(cls);
      el.className = parts.join(" ");
    },
    setAttribute: (k: string, v: string) => { attrs[k] = String(v); },
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
    style: { setProperty: (_prop: string, _val: string) => {} },
    setCssStyles: (_s: any) => {},
    _listeners: {} as Record<string, Function[]>,
    addEventListener: (event: string, cb: Function) => { if (!el._listeners[event]) el._listeners[event] = []; el._listeners[event].push(cb); },
    click: () => { (el._listeners["click"] ?? []).forEach((cb: Function) => cb()); },
  };
  Object.defineProperty(el, "textContent", {
    get: () => {
      const childText = children.map((c: any) => c.textContent ?? "").join("");
      return _ownText + childText;
    },
    set: (v: string) => { _ownText = v; },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(el, "innerHTML", {
    get: () => {
      const tag = (el.tagName ?? "div").toLowerCase();
      const cls = el.className ? ` class="${el.className}"` : "";
      const inner = children.map((c: any) => c.innerHTML ?? "").join("");
      return `<${tag}${cls}>${_ownText}${inner}</${tag}>`;
    },
    enumerable: true,
    configurable: true,
  });
  return el;
}
export class Plugin { app: any; manifest: any; constructor(app: any, m: any) { this.app = app; this.manifest = m; } async loadData() { return {}; } async saveData(_: any) {} addCommand(_: any) {} registerView(_: string, __: any) {} registerEvent(_: any) {} addSettingTab(_: any) {} addRibbonIcon(_: string, __: string, ___: any) { return makeFakeEl(); } }
export class ItemView { app: any; contentEl: any; constructor(public leaf: any) { this.app = leaf?.app || {}; this.contentEl = makeFakeEl(); } getViewType() { return "unknown"; } getDisplayText() { return ""; } async onOpen() {} async onClose() {} registerEvent(_: any) {} }
export class PluginSettingTab { app: any; plugin: any; containerEl: any; constructor(app: any, plugin: any) { this.app = app; this.plugin = plugin; this.containerEl = makeFakeEl(); } display() {} }
export class Setting { constructor(public containerEl: any) {} setName(_: string) { return this; } setDesc(_: string) { return this; } addText(cb: any) { cb({ setValue: () => ({ onChange: () => {} }), setPlaceholder: () => ({}) }); return this; } addSlider(cb: any) { cb({ setLimits: () => ({ setValue: () => ({ onChange: () => {} }) }) }); return this; } }
export class TFile { path = ""; basename = ""; extension = "md"; }
export class TFolder { path = ""; }
export abstract class AbstractInputSuggest<T> {
  constructor(protected app: any, protected inputEl: HTMLInputElement) {}
  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  selectSuggestion(_value: T, _evt?: any): void { this.close(); }
  setValue(_v: string): void {}
  getValue(): string { return ""; }
  onSelect(_cb: (value: T, evt?: any) => any): this { return this; }
  open(): void {}
  close(): void {}
}
export class WorkspaceLeaf { view: any = null; async setViewState(_s: any) {} getViewState() { return {}; } detach() {} }
export class FuzzySuggestModal<T> {
  app: any;
  inputEl: { value: string } = { value: "" };
  // Test-Affordanz: letzte konstruierte Instanz, damit ein Test choose/close treiben kann.
  static __instance: any = null;
  constructor(app: any) { this.app = app; (this.constructor as any).__instance = this; FuzzySuggestModal.__instance = this; }
  setPlaceholder(_s: string): this { return this; }
  getItems(): T[] { return []; }
  getItemText(item: T): string { return String(item); }
  onChooseItem(_item: T, _evt?: any): void {}
  open(): void {}
  onClose(): void {}
  // Test-Affordanzen (nicht im echten Obsidian): simuliere Auswahl bzw. Verwerfen.
  __choose(item: T): void { this.onChooseItem(item); }
  __close(): void { this.onClose(); }
}
export function setIcon(el: any, name: string): void { el?.setAttribute?.("data-icon", name); }
export class Notice { constructor(_message: string) {} }
import { vi } from "vitest";

export const requestUrl = vi.fn();

export function makeFakeApp(): any {
  return {
    vault: {
      adapter: {
        read: vi.fn().mockResolvedValue(""),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        write: vi.fn().mockResolvedValue(undefined),
        writeBinary: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        stat: vi.fn().mockResolvedValue({ mtime: 0 }),
      },
      on: vi.fn().mockReturnValue({ id: "mock-event" }),
    },
    workspace: {
      getActiveFile: vi.fn().mockReturnValue(null),
      getLeavesOfType: vi.fn().mockReturnValue([]),
      getRightLeaf: vi.fn().mockReturnValue({ setViewState: vi.fn() }),
      on: vi.fn(),
      revealLeaf: vi.fn(),
    },
  };
}
