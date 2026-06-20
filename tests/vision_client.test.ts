import { describe, it, expect, vi, afterEach } from "vitest";
import { VisionClient } from "../src/vision_client";

describe("VisionClient", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("transcribe schickt text+image_url, non-streaming, und parst content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "# Titel" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await new VisionClient("http://x", "vm").transcribe("data:image/jpeg;base64,AAAA", "Transkribiere");
    expect(out).toBe("# Titel");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("vm");
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Transkribiere" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
  });
  it("transcribe wirft bei HTTP-Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(new VisionClient("http://x", "vm").transcribe("d", "p")).rejects.toThrow("500");
  });
  it("transcribe liefert '' bei fehlendem content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) }));
    expect(await new VisionClient("http://x", "vm").transcribe("d", "p")).toBe("");
  });
});
