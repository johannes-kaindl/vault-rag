import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings_core";

describe("MCP settings defaults", () => {
  it("Server ist per Default aus, Port 8123, Token leer", () => {
    expect(DEFAULT_SETTINGS.mcpEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.mcpPort).toBe(8123);
    expect(DEFAULT_SETTINGS.mcpToken).toBe("");
  });
});
