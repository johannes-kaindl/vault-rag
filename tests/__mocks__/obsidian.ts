export const Platform = { isMobile: false, isDesktop: true };

export function makeFakeEl(): any {
  const children: any[] = [];
  const attrs: Record<string, string> = {};
  let _ownText = "";
  const el: any = {
    children, empty: () => { children.length = 0; _ownText = ""; },
    createDiv: (o?: any) => { const c = makeFakeEl(); if (o?.cls) c.className = o.cls; if (o?.text) c.textContent = o.text; if (o?.attr) for (const k of Object.keys(o.attr)) c.setAttribute(k, o.attr[k]); children.push(c); return c; },
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
  return el;
}
export class Plugin { app: any; manifest: any; constructor(app: any, m: any) { this.app = app; this.manifest = m; } async loadData() { return {}; } async saveData(_: any) {} addCommand(_: any) {} registerView(_: string, __: any) {} registerEvent(_: any) {} addSettingTab(_: any) {} addRibbonIcon(_: string, __: string, ___: any) { return makeFakeEl(); } }
export class ItemView { app: any; contentEl: any; constructor(public leaf: any) { this.app = leaf?.app || {}; this.contentEl = makeFakeEl(); } getViewType() { return "unknown"; } getDisplayText() { return ""; } async onOpen() {} async onClose() {} registerEvent(_: any) {} }
export class PluginSettingTab { app: any; plugin: any; containerEl: any; constructor(app: any, plugin: any) { this.app = app; this.plugin = plugin; this.containerEl = makeFakeEl(); } display() {} update() {} }
class FakeSlider {
  setLimits() { return this; }
  setValue() { return this; }
  setDynamicTooltip() { return this; }
  onChange(_cb: (v: number) => void) { return this; }
}
class FakeToggle {
  setValue() { return this; }
  onChange(_cb: (v: boolean) => void) { return this; }
  setDisabled() { return this; }
}
class FakeText {
  inputEl = makeFakeEl();
  setPlaceholder() { return this; }
  setValue() { return this; }
  getValue() { return ""; }
  onChange(_cb: (v: string) => void) { return this; }
}
class FakeDropdown {
  addOption() { return this; }
  setValue() { return this; }
  onChange(_cb: (v: string) => void) { return this; }
}
export class ButtonComponent {
  buttonEl = makeFakeEl();
  constructor(_containerEl?: any) {}
  setButtonText() { return this; }
  setClass() { return this; }
  setCta() { return this; }
  setDisabled() { return this; }
  setIcon() { return this; }
  setTooltip() { return this; }
  setWarning() { return this; }
  onClick(_cb: (evt?: any) => any) { return this; }
}
class FakeExtraButton {
  extraSettingsEl = makeFakeEl();
  setIcon() { return this; }
  setTooltip() { return this; }
  setDisabled() { return this; }
  onClick(_cb: () => void) { return this; }
}
export class Setting {
  settingEl: any;
  controlEl: any;
  nameEl: any;
  descEl: any;
  constructor(public containerEl: any) {
    this.settingEl = makeFakeEl();
    this.controlEl = makeFakeEl();
    this.nameEl = makeFakeEl();
    this.descEl = makeFakeEl();
  }
  setName(_: string) { return this; }
  setDesc(_: string) { return this; }
  setHeading() { return this; }
  setClass() { return this; }
  addText(cb: (c: FakeText) => void) { cb(new FakeText()); return this; }
  addTextArea(cb: (c: FakeText) => void) { cb(new FakeText()); return this; }
  addSlider(cb: (c: FakeSlider) => void) { cb(new FakeSlider()); return this; }
  addToggle(cb: (c: FakeToggle) => void) { cb(new FakeToggle()); return this; }
  addDropdown(cb: (c: FakeDropdown) => void) { cb(new FakeDropdown()); return this; }
  addButton(cb: (c: ButtonComponent) => void) { cb(new ButtonComponent()); return this; }
  addExtraButton(cb: (c: FakeExtraButton) => void) { cb(new FakeExtraButton()); return this; }
}
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
export class Modal { app: any; contentEl: any; constructor(app: any) { this.app = app; this.contentEl = makeFakeEl(); } open(): void {} close(): void {} onOpen(): void {} onClose(): void {} }
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
export function setTooltip(el: any, text: string): void { el?.setAttribute?.("aria-label", text); }
export class Notice { constructor(_message: string) {} }
export class FileSystemAdapter { getBasePath() { return ""; } read() { return Promise.resolve(""); } }
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
