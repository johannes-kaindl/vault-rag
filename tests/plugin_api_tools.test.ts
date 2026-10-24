import { describe, it, expect } from "vitest";
import { createVaultRetrievalApi, VAULT_RETRIEVAL_API_VERSION } from "../src/plugin_api";
import { RetrievalFacade } from "../src/retrieval_facade";
import { parseIndex, VectorIndex } from "../src/vendor/kit/vector-index";
import { getLang, setLang } from "../src/vendor/kit/i18n";
import { runTool, TOOL_REGISTRY } from "../src/tool_provider";
import { isToolProviderApi, toolProviderRejection, TOOL_PROVIDER_API_VERSION } from "../src/vendor/kit/tool-provider";
import "../src/i18n/strings";

function idx(): VectorIndex {
  const m = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 3, granularity: "note", quant: "int8" };
  return parseIndex(m, ["a.md", "b.md", "c.md"], new Int8Array([127, 0, 117, 50, 0, 127]).buffer);
}

function api(over: Record<string, unknown> = {}) {
  const deps = {
    getIndex: () => idx(),
    embedderReady: async () => true,
    embed: async () => [new Float32Array([1, 0])],
    settings: () => ({ k: 5, minSim: 0, exclude: ["Templates/"] }),
    readVault: async (r: string) => `INHALT ${r}`,
    ...over,
  } as ConstructorParameters<typeof RetrievalFacade>[0];
  return createVaultRetrievalApi(new RetrievalFacade(deps), deps.getIndex, () => false, {
    enabled: () => true,
    propose: async () => ({ kind: "nothing-new" }),
    apply: async () => ({ ok: true, changed: true }),
  });
}

/** Koda reicht die Pfade aus dem Modell seit koda-w25 (`ffdb103`) unverändert an `related_notes` weiter; Kodas eigenes `resolveNotePath` ist
 *  weg. Der Schutz liegt hier: `related` schlägt den Pfad als EXAKTEN Schlüssel im Index nach und liest keine Datei (kein `readVault`).
 *  Die Tests pinnen das — ein Pfad, der nicht im Index steht, ist `not-indexed`, nie ein Treffer, nie ein Dateizugriff — und die Regel
 *  des Ausschlusses: ein Pfad unter `exclude` ist wie `readNote` nicht abfragbar, auch wenn ein alter Index ihn noch trägt. */
describe("Plugin-API — related_notes: Pfade aus dem Modell", () => {
  function idxMitAusgeschlossen(): VectorIndex {
    const m = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 4, granularity: "note", quant: "int8" };
    // a=[1,0] b=[0.92,0.39] c=[0,1] Templates/t=[1,0] (ein veralteter Eintrag aus der Zeit vor dem Ausschluss)
    return parseIndex(m, ["a.md", "b.md", "c.md", "Templates/t.md"], new Int8Array([127, 0, 117, 50, 0, 127, 127, 0]).buffer);
  }
  const HOSTILE = ["../a.md", "a/../../a.md", "/a.md", "/etc/passwd", "a\0.md", "a\b.md", "a\\b.md", "..\\a.md", "C:\\a.md", "a\u0000.md", "\u0000", "a/../a.md", " ../a.md", "a/.. /a.md"];

  it("Gegenprobe: ein gültiger Pfad liefert Treffer — sonst wäre „kein Treffer“ unten wertlos", async () => {
    const r = await api({ getIndex: idxMitAusgeschlossen }).executeTool("related_notes", { path: "a.md" }, { lang: "en" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).toContain("b.md");
  });

  for (const path of HOSTILE) {
    it(`weist ${JSON.stringify(path)} ab: not-indexed, kein Treffer, kein Dateizugriff`, async () => {
      let gelesen = 0;
      const a = api({ getIndex: idxMitAusgeschlossen, readVault: async () => { gelesen++; return ""; } });
      const direkt = await a.related(path);
      expect(direkt).toEqual({ ok: false, reason: "not-indexed", path });
      const werkzeug = await a.executeTool("related_notes", { path }, { lang: "en" });
      expect(werkzeug.ok).toBe(false);
      expect(JSON.stringify(werkzeug)).not.toContain("hits");
      expect(gelesen).toBe(0);
    });
  }

  it("ein Pfad unter exclude ist nicht abfragbar, auch wenn ein alter Index ihn noch trägt (wie readNote)", async () => {
    const a = api({ getIndex: idxMitAusgeschlossen });
    expect(await a.related("Templates/t.md")).toEqual({ ok: false, reason: "not-indexed", path: "Templates/t.md" });
    expect(await a.related("templates/t.md")).toEqual({ ok: false, reason: "not-indexed", path: "templates/t.md" });
    const w = await a.executeTool("related_notes", { path: "Templates/t.md" }, { lang: "en" });
    expect(w.ok).toBe(false);
    expect(JSON.stringify(w)).not.toContain("hits");
  });
});

describe("Plugin-API — Werkzeug-Anbieter: tools()", () => {
  it("liefert search und related als OpenAI-Function-Definitionen (name/description/parameters)", () => {
    const defs = api().tools();
    expect(defs.map(d => d.name)).toEqual(["semantic_search", "related_notes"]);
    for (const d of defs) {
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.parameters.type).toBe("object");
      expect(Object.keys(d.parameters.properties).length).toBeGreaterThan(0);
      expect(d.parameters.required.length).toBeGreaterThan(0);
    }
    expect(defs[0]!.parameters.required).toEqual(["query"]);
    expect(defs[1]!.parameters.required).toEqual(["path"]);
  });

  it("kennzeichnet beide als nicht schreibend; applyLink ist in dieser Runde bewusst kein Werkzeug", () => {
    const defs = api().tools();
    expect(defs.every(d => d.writes === false)).toBe(true);
    expect(defs.some(d => /apply|link/i.test(d.name))).toBe(false);
  });

  it("ist JSON-tauglich (geht so ans Modell)", () => {
    const defs = api().tools();
    expect(JSON.parse(JSON.stringify(defs))).toEqual(defs);
  });

  it("liefert ohne Index keine Werkzeuge — ein Werkzeug, das nicht laufen kann, kostet nur Kontext", () => {
    expect(api({ getIndex: () => null }).tools()).toEqual([]);
  });

  it("uebersetzt die Beschreibung zur Aufrufzeit in die Oberflaechensprache", () => {
    const a = api();
    setLang("en");
    const en = a.tools()[0]!.description;
    setLang("de");
    const de = a.tools()[0]!.description;
    setLang("en");
    expect(de).not.toBe(en);
  });

  it("bleibt additiv: apiVersion 1, die bisherigen fuenf Schluessel sind alle noch da", () => {
    const a = api();
    expect(a.apiVersion).toBe(VAULT_RETRIEVAL_API_VERSION);
    expect(VAULT_RETRIEVAL_API_VERSION).toBe(1);
    for (const k of ["apiVersion", "status", "search", "related", "proposeLinks", "applyLink"]) expect(k in a).toBe(true);
  });

  it("traegt version: 1 und executeTool (Vertrag obsidian-kit ToolProviderApi), kein execute", () => {
    const a = api() as unknown as Record<string, unknown>;
    expect(a.version).toBe(1);
    expect(typeof a.executeTool).toBe("function");
    expect("execute" in a).toBe(false);
    expect(a.version).toBe(TOOL_PROVIDER_API_VERSION);
  });

  it("besteht den Anbieter-Guard des Wirts (Kit isToolProviderApi), und eine Ablehnung hätte einen Grund", () => {
    const a = api();
    expect(toolProviderRejection(a)).toBeNull();
    expect(isToolProviderApi(a)).toBe(true);
    const ohneVersion = { ...a } as Record<string, unknown>;
    delete ohneVersion.version;
    expect(toolProviderRejection(ohneVersion)?.reason).toBe("version");
  });
});

describe("Plugin-API — Werkzeug-Anbieter: executeTool()", () => {
  it("semantic_search liefert Text fuers Modell plus die Treffer als data", async () => {
    const a = api();
    const r = await a.executeTool("semantic_search", { query: "x" }, { lang: "de" });
    const raw = await a.search("x");
    expect(r.ok).toBe(true);
    if (!r.ok || !raw.ok) throw new Error("erwartet ok");
    expect(r.content.startsWith("Inhaltlich ähnlich")).toBe(true);
    expect(r.content).toContain("b.md (0.92)");
    expect(r.data).toEqual({ hits: raw.hits });
  });

  it("related_notes liefert Koda-Text, in der gewaehlten Sprache", async () => {
    const a = api();
    const de = await a.executeTool("related_notes", { path: "a.md" }, { lang: "de" });
    const en = await a.executeTool("related_notes", { path: "a.md" }, { lang: "en" });
    expect(de.ok && de.content.startsWith("Verwandt zu a.md:\n")).toBe(true);
    expect(en.ok && en.content.startsWith("Related to a.md:\n")).toBe(true);
  });

  it("ohne lang gilt die Oberflaechensprache, und sie ist danach unveraendert", async () => {
    setLang("de");
    const r = await api().executeTool("related_notes", { path: "a.md" }, { lang: "en" });
    expect(getLang()).toBe("de");
    const r2 = await api().executeTool("related_notes", { path: "a.md" });
    setLang("en");
    expect(r.ok && r.content.startsWith("Related")).toBe(true);
    expect(r2.ok && r2.content.startsWith("Verwandt")).toBe(true);
  });

  it("die Sprache wird nie ueber ein await hinweg umgestellt (Oberflaeche sieht sie waehrend der Quelle nicht)", async () => {
    setLang("de");
    let during = "";
    const p = api({ embed: async () => { during = getLang(); return [new Float32Array([1, 0])]; } })
      .executeTool("semantic_search", { query: "x" }, { lang: "en" });
    await p;
    setLang("en");
    expect(during).toBe("de");
  });

  it("reicht k durch", async () => {
    const r = await api().executeTool("semantic_search", { query: "x", k: 1 });
    expect(r.ok && (r.data as { hits: unknown[] }).hits.length).toBe(1);
  });

  it("leere Trefferliste ist ein ok-Ergebnis mit Text, kein Fehler", async () => {
    const r = await api({ settings: () => ({ k: 5, minSim: 2, exclude: [] }) }).executeTool("semantic_search", { query: "x" }, { lang: "de" });
    expect(r).toMatchObject({ ok: true, content: "Es wurde nichts inhaltlich Ähnliches gefunden." });
  });

  it("unbekanntes Werkzeug ist ein Wert mit Text, keine Ausnahme", async () => {
    await expect(api().executeTool("nope", {}, { lang: "en" })).resolves.toEqual({ ok: false, reason: "unknown-tool", message: "Unknown tool: nope." });
  });

  it("fehlende oder falsch typisierte Argumente nennen das Feld", async () => {
    const a = api();
    const field = async (n: string, args: unknown) => {
      const r = await a.executeTool(n, args as Record<string, unknown>);
      return r.ok === false && r.reason === "bad-args" ? r.field : `anders: ${JSON.stringify(r)}`;
    };
    expect(await field("semantic_search", {})).toBe("query");
    expect(await field("semantic_search", { query: "   " })).toBe("query");
    expect(await field("semantic_search", { query: 5 })).toBe("query");
    expect(await field("semantic_search", { query: "x", k: 0 })).toBe("k");
    expect(await field("semantic_search", { query: "x", k: 1.5 })).toBe("k");
    expect(await field("related_notes", {})).toBe("path");
    expect(await field("related_notes", null)).toBe("path");
    expect(await field("related_notes", "a.md")).toBe("path");
  });

  it("paused heißt unavailable mit detail paused und eigenem Text (nicht offline)", async () => {
    const r = await api({ isPaused: () => true }).executeTool("semantic_search", { query: "x" }, { lang: "en" });
    expect(r).toMatchObject({ ok: false, reason: "unavailable", detail: "paused" });
    expect((r as { message: string }).message).toMatch(/paused/);
  });
  it("no-index und offline heissen unavailable (Voraussetzung fehlt), mit detail und Text", async () => {
    await expect(api({ getIndex: () => null }).executeTool("related_notes", { path: "a.md" }, { lang: "de" }))
      .resolves.toMatchObject({ ok: false, reason: "unavailable", detail: "no-index", message: expect.stringContaining("kein Index") });
    await expect(api({ embedderReady: async () => false }).executeTool("semantic_search", { query: "x" }, { lang: "de" }))
      .resolves.toMatchObject({ ok: false, reason: "unavailable", detail: "offline", message: "Semantischer Index: Endpunkt nicht erreichbar." });
  });

  it("eine unbekannte Notiz heisst not-indexed samt Pfad, ohne Ursache (die Datei gibt es nicht)", async () => {
    const r = await api({ readVault: async () => { throw new Error("ENOENT"); } }).executeTool("related_notes", { path: "missing.md" }, { lang: "de" });
    expect(r).toMatchObject({ ok: false, reason: "not-indexed", path: "missing.md", message: expect.stringContaining("missing.md") });
    expect("cause" in r).toBe(false);
    expect((r as { message: string }).message).toBe("\"missing.md\" ist nicht im Index — verwandte Notizen lassen sich dafür nicht bestimmen.");
  });

  it("wirft nie: ein Fehler im Retrieval wird zu reason failed", async () => {
    // Die Facade macht aus einem werfenden Embedder schon `offline`; ein Bruch im Index-Zugriff
    // selbst laeuft dagegen als Ausnahme durch und muss am Werkzeugweg aufgefangen werden.
    const r = await api({ getIndex: () => { throw new Error("boom"); } }).executeTool("related_notes", { path: "a.md" });
    expect(r).toMatchObject({ ok: false, reason: "failed" });
  });

  it("laesst die Ausschluss-Liste des Nutzers auch ueber args nicht ueberschreiben", async () => {
    const r = await api({ settings: () => ({ k: 5, minSim: 0, exclude: ["a"] }) })
      .executeTool("semantic_search", { query: "x", exclude: [] });
    expect(r.ok && (r.data as { hits: { path: string }[] }).hits.some(h => h.path === "a.md")).toBe(false);
  });
});

describe("Werkzeug-Anbieter: Registry und Bestaetigung", () => {
  it("Werkzeugnamen sind je Anbieter eindeutig", () => {
    const names = TOOL_REGISTRY.map(i => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("tools({lang}) uebersetzt die Beschreibung unabhaengig von der Oberflaeche", () => {
    setLang("en");
    const a = api();
    const de = a.tools({ lang: "de" })[0]!.description;
    const en = a.tools({ lang: "en" })[0]!.description;
    expect(de).not.toBe(en);
    expect(de).toContain("Bedeutung");
  });

  // Ein schreibendes Werkzeug gibt es noch nicht (applyLink bleibt draussen); der Vertrag steht
  // trotzdem schon, und ein Test-Werkzeug beweist ihn ohne UI.
  const written: string[] = [];
  const schreiber = {
    name: "write_probe", writes: true,
    define: () => ({ description: "d", parameters: { type: "object" as const, properties: {}, required: [] } }),
    check: () => null,
    preview: () => ({ summary: "schreibt x", paths: ["x.md"] }),
    run: async () => { written.push("x"); return { ok: true as const, hits: [] }; },
    render: () => ({ ok: true as const, content: "geschrieben" }),
  };
  const target = { search: async () => ({ ok: true as const, hits: [] }), related: async () => ({ ok: true as const, hits: [] }) };

  it("ein writes-Werkzeug ohne confirm endet mit needs-confirm und schreibt nichts", async () => {
    written.length = 0;
    const r = await runTool("write_probe", {}, target, undefined, [schreiber]);
    expect(r).toMatchObject({ ok: false, reason: "needs-confirm" });
    expect(written).toEqual([]);
  });

  it("confirm bekommt die nebenwirkungsfreie Vorschau; false heisst needs-confirm, nichts geschrieben", async () => {
    written.length = 0;
    let preview: unknown;
    const r = await runTool("write_probe", {}, target, { confirm: async (p) => { preview = p; return false; } }, [schreiber]);
    expect(preview).toEqual({ summary: "schreibt x", paths: ["x.md"] });
    expect(r).toMatchObject({ ok: false, reason: "needs-confirm" });
    expect(written).toEqual([]);
  });

  it("nur bei confirm=true laeuft das Werkzeug", async () => {
    written.length = 0;
    const r = await runTool("write_probe", {}, target, { confirm: async () => true }, [schreiber]);
    expect(r).toEqual({ ok: true, content: "geschrieben" });
    expect(written).toEqual(["x"]);
  });

  it("lesende Werkzeuge rufen confirm nie", async () => {
    let called = false;
    await api().executeTool("related_notes", { path: "a.md" }, { confirm: async () => { called = true; return true; } });
    expect(called).toBe(false);
  });
});

/** `related_notes` unterscheidet bei `not-indexed` zwei Fälle, die verschieden zu behandeln sind (Befund koda-w25: Koda tat es durch Dateilesen und
 *  hat sein eigenes Werkzeug entfernt). Das Datei-Lesen passiert nur in `run` des Werkzeugs, hinter dem Pfad-Guard (`resolveNotePath`); die öffentliche
 *  API (`related()`, `reason: "not-indexed"`) bleibt unverändert und liest nie eine Datei. */
describe("Plugin-API — related_notes: not-indexed unterscheidet zwei Ursachen", () => {
  const FM_ONLY = "---\ntitle: Neu\ntags: [x]\n---\n";
  const reads = (map: Record<string, string>, log: string[] = []) => async (p: string): Promise<string> => {
    log.push(p);
    if (p in map) return map[p]!;
    throw new Error("ENOENT");
  };

  it("nur Frontmatter: bleibt dauerhaft draußen — erst Inhalt schreiben (cause frontmatter-only), EN und DE", async () => {
    const a = api({ readVault: reads({ "neu.md": FM_ONLY }) });
    const en = await a.executeTool("related_notes", { path: "neu.md" }, { lang: "en" });
    expect(en).toMatchObject({ ok: false, reason: "not-indexed", path: "neu.md", cause: "frontmatter-only" });
    expect((en as { message: string }).message).toContain("neu.md");
    expect((en as { message: string }).message).toMatch(/no text yet/);
    expect((en as { message: string }).message).toMatch(/write some content/);
    const de = await a.executeTool("related_notes", { path: "neu.md" }, { lang: "de" });
    expect((de as { message: string }).message).toMatch(/noch keinen Text/);
    expect((de as { message: string }).message).toMatch(/Inhalt schreiben/);
  });

  it("eine leere Datei zählt wie nur Frontmatter", async () => {
    const r = await api({ readVault: reads({ "leer.md": "" }) }).executeTool("related_notes", { path: "leer.md" }, { lang: "en" });
    expect(r).toMatchObject({ reason: "not-indexed", cause: "frontmatter-only" });
  });

  it("mit Text: der Indexer zieht gleich nach — nochmal versuchen (cause pending), EN und DE", async () => {
    const a = api({ readVault: reads({ "frisch.md": "# Frisch\n\nEin Absatz mit Inhalt." }) });
    const en = await a.executeTool("related_notes", { path: "frisch.md" }, { lang: "en" });
    expect(en).toMatchObject({ ok: false, reason: "not-indexed", path: "frisch.md", cause: "pending" });
    expect((en as { message: string }).message).toMatch(/try again/);
    const de = await a.executeTool("related_notes", { path: "frisch.md" }, { lang: "de" });
    expect((de as { message: string }).message).toMatch(/gleich noch einmal versuchen/);
    expect((en as { message: string }).message).not.toBe((await a.executeTool("related_notes", { path: "neu.md" }, { lang: "en" }) as { message: string }).message);
  });

  it("die Maschinen-Felder bleiben: reason, path und message stehen in jedem Fall da, `cause` ist nur ein Zusatz", async () => {
    const a = api({ readVault: reads({ "neu.md": FM_ONLY, "frisch.md": "Text" }) });
    for (const p of ["neu.md", "frisch.md", "weg.md"]) {
      const r = await a.executeTool("related_notes", { path: p }, { lang: "en" });
      expect(r).toMatchObject({ ok: false, reason: "not-indexed", path: p, message: expect.stringContaining(p) });
    }
  });

  it("unavailable/no-index bleibt wie es war, ohne ein Datei-Lesen", async () => {
    const log: string[] = [];
    const r = await api({ getIndex: () => null, readVault: reads({ "neu.md": FM_ONLY }, log) }).executeTool("related_notes", { path: "neu.md" }, { lang: "en" });
    expect(r).toMatchObject({ ok: false, reason: "unavailable", detail: "no-index" });
    expect("cause" in r).toBe(false);
    expect(log).toEqual([]);
  });

  it("ein Pfad im Index liest keine Datei: Treffer wie bisher", async () => {
    const log: string[] = [];
    const r = await api({ readVault: reads({}, log) }).executeTool("related_notes", { path: "a.md" }, { lang: "en" });
    expect(r.ok).toBe(true);
    expect(log).toEqual([]);
  });

  it("der Pfad-Guard steht davor: feindliche und ausgeschlossene Pfade bleiben ohne Ursache und ohne Dateizugriff", async () => {
    const log: string[] = [];
    const a = api({ readVault: reads({ "Templates/t.md": "Text", "../a.md": "Text", "/etc/passwd": "x" }, log) });
    for (const p of ["../a.md", "a/../../a.md", "/etc/passwd", "a\0.md", "Templates/t.md", "templates/t.md", "notiz.txt"]) {
      const r = await a.executeTool("related_notes", { path: p }, { lang: "en" });
      expect(r).toMatchObject({ ok: false, reason: "not-indexed", path: p });
      expect("cause" in r).toBe(false);
    }
    expect(log).toEqual([]);
  });

  it("die öffentliche API ändert sich nicht: related() liefert wie bisher nur reason und path und liest nie eine Datei", async () => {
    const log: string[] = [];
    const a = api({ readVault: reads({ "neu.md": FM_ONLY }, log) });
    expect(await a.related("neu.md")).toEqual({ ok: false, reason: "not-indexed", path: "neu.md" });
    expect(log).toEqual([]);
  });

  it("die Oberfläche der API bleibt: kein neues Feld am Anbieter-Objekt", () => {
    expect(Object.keys(api()).sort()).toEqual(["apiVersion", "applyLink", "executeTool", "proposeLinks", "related", "search", "status", "tools", "version"]);
  });
});
