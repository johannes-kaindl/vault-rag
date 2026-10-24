import { describe, it, expect, vi } from "vitest";
import { prepareChatAsk, sentFromMeta, type AskDeps } from "../src/chat_ask";

const deps = (over: Partial<AskDeps> = {}): AskDeps & { assemble: ReturnType<typeof vi.fn>; systemPreamble: ReturnType<typeof vi.fn> } => ({
  assemble: vi.fn(async () => ({ text: "## a.md\nINHALT", sources: ["a.md"] })),
  systemPreamble: vi.fn(() => "MEINPROMPT"),
  ...over,
}) as never;

describe("prepareChatAsk", () => {
  it("System-Prompt beginnt mit dem Preamble und trägt den Kontext; die Frage steht unverändert zuletzt", async () => {
    const d = deps();
    const r = await prepareChatAsk([{ role: "user", content: "  Frage? " }], ["a.md"], d);
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0]!.role).toBe("system");
    expect(r.messages[0]!.content).toBe("MEINPROMPT\n\n## a.md\nINHALT");
    expect(r.messages[1]).toEqual({ role: "user", content: "  Frage? " });   // nicht getrimmt: das Fenster übergibt die Frage, wie sie getippt wurde
    expect(d.assemble).toHaveBeenCalledWith(["a.md"]);
  });
  it("`preamble` ist nur der Prompt-Anteil (llm-lab `promptTemplate`), nie die Nachricht mit Kontext", async () => {
    const r = await prepareChatAsk([{ role: "user", content: "f" }], [], deps());
    expect(r.preamble).toBe("MEINPROMPT");
    expect(r.preamble).not.toContain("INHALT");
  });
  it("hasContext folgt den Quellen NACH dem Kürzen: mit Quellen true, ohne false", async () => {
    const d1 = deps(); await prepareChatAsk([{ role: "user", content: "f" }], ["a.md"], d1);
    const d2 = deps({ assemble: async () => ({ text: "", sources: [] }) }); await prepareChatAsk([{ role: "user", content: "f" }], [], d2);
    expect(d1.systemPreamble).toHaveBeenCalledWith(true);
    expect(d2.systemPreamble).toHaveBeenCalledWith(false);
  });
  it("ohne Kontext besteht die System-Nachricht nur aus dem Preamble (keine leeren Absätze)", async () => {
    const r = await prepareChatAsk([{ role: "user", content: "f" }], [], deps({ assemble: async () => ({ text: "", sources: [] }) }));
    expect(r.messages[0]!.content).toBe("MEINPROMPT");
  });
  it("frühere Runden gehen mit Frage und Antwort mit, nie mit erneutem Kontext; `tool`-Rollen fallen weg", async () => {
    const r = await prepareChatAsk([
      { role: "user", content: "eins" }, { role: "assistant", content: "Antwort eins" }, { role: "tool", content: "Werkzeug" }, { role: "user", content: "zwei" },
    ], ["a.md"], deps());
    expect(r.messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      "system:MEINPROMPT\n\n## a.md\nINHALT", "user:eins", "assistant:Antwort eins", "user:zwei",
    ]);
  });
  it("Quellen für die Anzeige sind die, die nach dem Kürzen wirklich mitgingen", async () => {
    const r = await prepareChatAsk([{ role: "user", content: "f" }], ["a.md", "unlesbar.md"], deps({ assemble: async () => ({ text: "x", sources: ["a.md"] }) }));
    expect(r.sent).toEqual({ sources: ["a.md"] });
  });
  it("ein Kontext, der nicht zu laden ist, wirft (das Fenster zeigt dann die Fehlerzeile der Runde)", async () => {
    await expect(prepareChatAsk([{ role: "user", content: "f" }], [], deps({ assemble: async () => { throw new Error("weg"); } }))).rejects.toThrow("weg");
  });
  it("ein Verlauf ohne Frage am Ende ist ein Programmfehler, kein stiller Leerlauf", async () => {
    await expect(prepareChatAsk([], [], deps())).rejects.toThrow(/question/);
    await expect(prepareChatAsk([{ role: "user", content: "f" }, { role: "assistant", content: "a" }], [], deps())).rejects.toThrow(/question/);
  });
});

describe("sentFromMeta", () => {
  it("liest die Quellen aus dem Meta einer Antwort zurück", () => {
    expect(sentFromMeta({ sources: ["a.md", "b/c.md"] })).toEqual({ sources: ["a.md", "b/c.md"] });
    expect(sentFromMeta({ sources: [] })).toEqual({ sources: [] });
  });
  it("jede andere Form ist null (das Meta ist nicht vertrauenswürdig typisiert)", () => {
    for (const bad of [null, undefined, "x", 3, [], { sources: "a.md" }, { sources: [1] }, {}]) expect(sentFromMeta(bad)).toBeNull();
  });
});
