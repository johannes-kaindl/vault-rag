import { describe, it, expect } from "vitest";
import { Platform, Setting } from "obsidian";

describe("obsidian mock erweitert", () => {
  it("Platform hat isMobile/isDesktop (Default desktop)", () => {
    expect(Platform.isMobile).toBe(false);
    expect(Platform.isDesktop).toBe(true);
  });
  it("Setting ist fluent mit setHeading/addToggle/addButton", () => {
    const s = new Setting({} as unknown as HTMLElement);
    expect(s.setHeading()).toBe(s);
    expect(s.addToggle(() => {})).toBe(s);
    expect(s.addButton(() => {})).toBe(s);
  });
});
