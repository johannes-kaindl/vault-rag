# Chat- & Settings-UX-Politur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Chat- & Settings-UI vor der Community-Einreichung nach aktuellen Best Practices abrunden: mehrzeilige Auto-Grow-Eingabe, Embedding-Modell-Dropdown, Inline-Endpoint-Test, Capability-Anzeige (Vision/Thinking) und ein Thinking-Toggle mit sauberer Cross-Server-Suppression.

**Architecture:** Neue Logik lebt in zwei reinen, voll testbaren Modulen (`reasoning.ts`, `capabilities.ts`); View/Settings/main verdrahten nur. SSOT für den Thinking-Schalter ist `settings.suppressThinking` (Frontend-Toggle und Settings-Default lesen/schreiben denselben Wert über Live-Getter, wie beim Chat-Modell etabliert). `VaultAdapter`-Grenze und Index-Format bleiben unangetastet.

**Tech Stack:** TypeScript strict, Obsidian Plugin API, vitest + happy-dom. Fetch wird in Tests via `vi.stubGlobal("fetch", …)` gemockt (Bestandsmuster). View-Tests laufen gegen den `tests/__mocks__/obsidian.ts`-Fake-DOM (kein echtes DOM, kein `scrollHeight`).

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Nach jeder Änderung müssen alle Tests grün bleiben** (`npm test`) und `npx tsc --noEmit` sauber sein.
- **Keine Inline-Styles** — alle Styles als CSS-Klassen in `styles.css` mit Obsidian-Variablen (`--text-success`, `--text-error`, `--text-muted`, `--background-modifier-border`).
- **Nur berührte Dateien stagen — nie `git add -A`.**
- **Conventional Commits**, deutsche Beschreibung erlaubt; Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Footgun-Invarianten (aus der Recherche):** `reasoning_effort` **nie** als Boolean und **nie** `"minimal"` senden (Ollama lehnt beides ab); nur `"none"`. Native Capability-Pfade (`/api/show`, `/api/v1/models`, `/api/v0/models`) liegen außerhalb des `/v1`-Namespace → an die Basis-URL hängen. `this.endpoint` der Clients ist via `normalizeEndpoint` bereits die Basis-URL ohne `/v1` (kein neuer Helper nötig).
- **Confidence-Semantik:** `"no"` heißt „kein Nachweis", **nicht** „definitiv nein". Live-Signale stufen nur HOCH, nie runter.

---

### Task 1: Reines Modul `reasoning.ts`

**Files:**
- Create: `src/reasoning.ts`
- Test: `tests/reasoning.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `export type ThinkingSupport = "none" | "hybrid" | "always"`
  - `export function suppressParams(suppress: boolean): Record<string, unknown>`
  - `export function reasoningHappened(content: string, reasoning: string | undefined): boolean`
  - `export function isAlwaysOnThinker(model: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/reasoning.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { suppressParams, reasoningHappened, isAlwaysOnThinker } from "../src/reasoning";

describe("suppressParams", () => {
  it("liefert leeres Objekt wenn nicht unterdrückt", () => {
    expect(suppressParams(false)).toEqual({});
  });
  it("liefert die Cross-Server-Union wenn unterdrückt", () => {
    expect(suppressParams(true)).toEqual({
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false },
      reasoning_budget: 0,
    });
  });
  it("sendet reasoning_effort nie als Boolean und nie 'minimal'", () => {
    const p = suppressParams(true);
    expect(typeof p.reasoning_effort).toBe("string");
    expect(p.reasoning_effort).not.toBe("minimal");
  });
});

describe("reasoningHappened", () => {
  it("true bei nicht-leerem reasoning-Feld", () => {
    expect(reasoningHappened("Antwort", "weil X")).toBe(true);
  });
  it("false bei leerem reasoning und reinem Content", () => {
    expect(reasoningHappened("Antwort", "")).toBe(false);
    expect(reasoningHappened("Antwort", undefined)).toBe(false);
  });
  it("true bei inline <think> im Content", () => {
    expect(reasoningHappened("<think>weil</think>Antwort", "")).toBe(true);
  });
  it("false bei leerem <think></think> ohne Inhalt", () => {
    expect(reasoningHappened("<think>  </think>Antwort", undefined)).toBe(false);
  });
});

describe("isAlwaysOnThinker", () => {
  it("true für gpt-oss / Harmony", () => {
    expect(isAlwaysOnThinker("gpt-oss-20b")).toBe(true);
  });
  it("false für gewöhnliche Modelle", () => {
    expect(isAlwaysOnThinker("qwen3")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reasoning.test.ts`
Expected: FAIL mit „Cannot find module '../src/reasoning'".

- [ ] **Step 3: Write minimal implementation**

Create `src/reasoning.ts`:

```ts
export type ThinkingSupport = "none" | "hybrid" | "always";

/** Union-Params zum Abschalten von Reasoning über viele lokale Server hinweg.
 *  Leeres Objekt, wenn nicht unterdrückt werden soll.
 *  - reasoning_effort:"none"         → Ollama, vLLM, OpenAI-Standard
 *  - chat_template_kwargs.enable_*   → llama.cpp, MLX, LM Studio (passthrough), Qwen3
 *  - reasoning_budget:0              → llama.cpp belt-and-suspenders
 *  WICHTIG: reasoning_effort nie als Boolean / nie "minimal" (Ollama lehnt beides ab). */
export function suppressParams(suppress: boolean): Record<string, unknown> {
  if (!suppress) return {};
  return {
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
    reasoning_budget: 0,
  };
}

const THINK_TAG = /<think>([\s\S]*?)<\/think>/;

/** Hat das Modell real gedacht? (separates reasoning-Feld ODER inline <think> mit Inhalt).
 *  Dient dazu, „Suppress hat nicht gegriffen" ehrlich zu erkennen. */
export function reasoningHappened(content: string, reasoning: string | undefined): boolean {
  if (reasoning && reasoning.trim() !== "") return true;
  const m = THINK_TAG.exec(content);
  return !!m && m[1].trim() !== "";
}

const ALWAYS_ON = /\b(gpt-oss|harmony)\b/i;

/** Modelle, die sich prinzipiell nicht vollständig abschalten lassen (nur low/medium/high). */
export function isAlwaysOnThinker(model: string): boolean {
  return ALWAYS_ON.test(model);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reasoning.test.ts`
Expected: PASS (alle Cases grün).

- [ ] **Step 5: Commit**

```bash
git add src/reasoning.ts tests/reasoning.test.ts
git commit -m "feat(reasoning): suppressParams + reasoningHappened + isAlwaysOnThinker (pure)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reines Modul `capabilities.ts`

**Files:**
- Create: `src/capabilities.ts`
- Test: `tests/capabilities.test.ts`

**Interfaces:**
- Consumes: `ThinkingSupport` aus `./reasoning`.
- Produces:
  - `export type Confidence = "no" | "likely" | "confirmed"`
  - `export interface ThinkingState { support: ThinkingSupport; confidence: Confidence }`
  - `export interface Capabilities { vision: Confidence; thinking: ThinkingState }`
  - `export function guessFromName(model: string): Capabilities`
  - `export function parseOllamaShow(json: unknown): Capabilities | null`
  - `export function parseLmStudioV1(json: unknown, model: string): Capabilities | null`
  - `export function parseLmStudioV0(json: unknown, model: string): Capabilities | null`
  - `export function mergeCapability(base: Capabilities | null, nameGuess: Capabilities, live: { thinking?: boolean; vision?: boolean }): Capabilities`
  - `export function resolveCapabilities(meta: Capabilities | null, model: string, live?: { thinking?: boolean; vision?: boolean }): Capabilities`

- [ ] **Step 1: Write the failing test**

Create `tests/capabilities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  guessFromName, parseOllamaShow, parseLmStudioV1, parseLmStudioV0,
  mergeCapability, resolveCapabilities, Capabilities,
} from "../src/capabilities";

describe("guessFromName", () => {
  it("erkennt Vision an *-vl", () => {
    expect(guessFromName("qwen2.5-vl-7b").vision).toBe("likely");
  });
  it("erkennt Vision an llava/pixtral/moondream", () => {
    expect(guessFromName("llava:13b").vision).toBe("likely");
    expect(guessFromName("pixtral-12b").vision).toBe("likely");
  });
  it("gemma3 ist Vision, gemma3:1b aber nicht (version-gated)", () => {
    expect(guessFromName("gemma3:4b").vision).toBe("likely");
    expect(guessFromName("gemma3:1b").vision).toBe("no");
  });
  it("glm-4 ohne v ist keine Vision, glm-4v schon", () => {
    expect(guessFromName("glm-4").vision).toBe("no");
    expect(guessFromName("glm-4v").vision).toBe("likely");
  });
  it("deepseek-r1 ist always-on thinking", () => {
    const t = guessFromName("deepseek-r1:8b").thinking;
    expect(t.support).toBe("always");
    expect(t.confidence).toBe("likely");
  });
  it("qwen3 ist hybrid thinking", () => {
    expect(guessFromName("qwen3").thinking.support).toBe("hybrid");
  });
  it("qwen3-instruct-2507 ist non-thinking trotz qwen3-Prefix", () => {
    expect(guessFromName("qwen3-instruct-2507").thinking.support).toBe("none");
  });
  it("reines Textmodell: keine Caps", () => {
    const c = guessFromName("mistral-small");
    expect(c.vision).toBe("no");
    expect(c.thinking.support).toBe("none");
  });
});

describe("parseOllamaShow", () => {
  it("liest capabilities[] (vision + thinking)", () => {
    const c = parseOllamaShow({ capabilities: ["completion", "vision", "thinking"] });
    expect(c?.vision).toBe("confirmed");
    expect(c?.thinking.support).toBe("hybrid");
    expect(c?.thinking.confidence).toBe("confirmed");
  });
  it("ohne vision/thinking → 'no' (Absence ist kein Nachweis)", () => {
    const c = parseOllamaShow({ capabilities: ["completion"] });
    expect(c?.vision).toBe("no");
    expect(c?.thinking.support).toBe("none");
  });
  it("null bei unbrauchbarem JSON", () => {
    expect(parseOllamaShow({})).toBeNull();
    expect(parseOllamaShow(null)).toBeNull();
  });
});

describe("parseLmStudioV1", () => {
  it("liest capabilities.vision/reasoning", () => {
    const j = { data: [{ id: "m", capabilities: { vision: true, reasoning: { default: false } } }] };
    const c = parseLmStudioV1(j, "m");
    expect(c?.vision).toBe("confirmed");
    expect(c?.thinking.support).toBe("hybrid");
    expect(c?.thinking.confidence).toBe("confirmed");
  });
  it("null wenn Modell fehlt", () => {
    expect(parseLmStudioV1({ data: [{ id: "andere" }] }, "m")).toBeNull();
  });
});

describe("parseLmStudioV0", () => {
  it("type vlm → Vision confirmed; thinking unbekannt", () => {
    const c = parseLmStudioV0({ data: [{ id: "m", type: "vlm" }] }, "m");
    expect(c?.vision).toBe("confirmed");
    expect(c?.thinking.support).toBe("none");
  });
  it("type llm → keine Vision", () => {
    expect(parseLmStudioV0({ data: [{ id: "m", type: "llm" }] }, "m")?.vision).toBe("no");
  });
});

describe("mergeCapability", () => {
  const none: Capabilities = { vision: "no", thinking: { support: "none", confidence: "no" } };
  it("Name hebt fehlende Metadaten an", () => {
    const r = mergeCapability(none, guessFromName("qwen2.5-vl"), {});
    expect(r.vision).toBe("likely");
  });
  it("Metadaten schlagen schwache Name-Heuristik (confirmed bleibt)", () => {
    const base: Capabilities = { vision: "confirmed", thinking: { support: "none", confidence: "no" } };
    expect(mergeCapability(base, guessFromName("foo"), {}).vision).toBe("confirmed");
  });
  it("Live-Signal stuft auf confirmed hoch", () => {
    const r = mergeCapability(none, guessFromName("foo"), { thinking: true });
    expect(r.thinking.confidence).toBe("confirmed");
    expect(r.thinking.support).not.toBe("none");
  });
  it("Live-Absence stuft nicht runter", () => {
    const base: Capabilities = { vision: "confirmed", thinking: { support: "always", confidence: "confirmed" } };
    const r = mergeCapability(base, none, { thinking: false, vision: false });
    expect(r.vision).toBe("confirmed");
    expect(r.thinking.confidence).toBe("confirmed");
  });
  it("Name 'always' gewinnt über Basis-'hybrid'", () => {
    const base: Capabilities = { vision: "no", thinking: { support: "hybrid", confidence: "confirmed" } };
    expect(mergeCapability(base, guessFromName("deepseek-r1"), {}).thinking.support).toBe("always");
  });
});

describe("resolveCapabilities", () => {
  it("kombiniert Metadaten + Name + live", () => {
    const r = resolveCapabilities(null, "qwen2.5-vl", {});
    expect(r.vision).toBe("likely");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capabilities.test.ts`
Expected: FAIL mit „Cannot find module '../src/capabilities'".

- [ ] **Step 3: Write minimal implementation**

Create `src/capabilities.ts`:

```ts
import { ThinkingSupport } from "./reasoning";

export type Confidence = "no" | "likely" | "confirmed";
export interface ThinkingState { support: ThinkingSupport; confidence: Confidence }
export interface Capabilities { vision: Confidence; thinking: ThinkingState }

const RANK: Record<Confidence, number> = { no: 0, likely: 1, confirmed: 2 };
const stronger = (a: Confidence, b: Confidence): Confidence => (RANK[a] >= RANK[b] ? a : b);

const norm = (m: string): string => m.toLowerCase();

// ── L2: Name-Heuristik ───────────────────────────────────────────────
// Vision (high-reliability Substrings/Token); version-gated Ausnahmen separat.
const VISION = [
  "llava", "bakllava", "vision", "pixtral", "moondream", "minicpm-v", "internvl",
  "smolvlm", "cogvlm", "molmo", "nvlm", "aya-vision", "kimi-vl", "ovis", "multimodal",
];
const VISION_TOKEN = /(^|[-_:/. ])vl([-_:/. ]|$)/;        // qwen2-vl, qwen3-vl
const GLM_V = /glm-4(\.\d+)?v/;                            // glm-4v, glm-4.1v, glm-4.5v
const GEMMA3_VISION = /gemma3/;                            // ≥4B; 1b/270m sind text-only
const GEMMA3_TEXT = /gemma3:(1b|270m)/;
const MISTRAL_VISION = /mistral-small.*(3\.1|3\.2)/;

// Thinking always-on
const ALWAYS = [
  "deepseek-r1", "qwq", "-thinking", "magistral", "gpt-oss", "phi-4-reasoning",
  "phi-4-mini-reasoning", "exaone-deep", "glm-z1", "minimax-m1", "seed-oss-thinking",
  "marco-o1", "openthinker",
];
// Thinking hybrid (toggelbar) — Ausnahme: qwen3-instruct-2507 ist non-thinking
const HYBRID = [
  "qwen3", "deepseek-v3.1", "deepseek-v3.2", "granite3.2", "granite3.3",
  "nemotron", "cogito", "glm-4.5", "glm-4.6", "kimi-k2",
];
const QWEN3_NONTHINK = /qwen3-instruct-2507/;

function guessVision(m: string): Confidence {
  if (GEMMA3_TEXT.test(m)) return "no";
  if (GEMMA3_VISION.test(m)) return "likely";
  if (MISTRAL_VISION.test(m)) return "likely";
  if (/mistral-small/.test(m)) return "no";
  if (GLM_V.test(m)) return "likely";
  if (VISION_TOKEN.test(m)) return "likely";
  if (VISION.some(v => m.includes(v))) return "likely";
  return "no";
}

function guessThinking(m: string): ThinkingState {
  if (QWEN3_NONTHINK.test(m)) return { support: "none", confidence: "no" };
  if (ALWAYS.some(a => m.includes(a))) return { support: "always", confidence: "likely" };
  if (HYBRID.some(h => m.includes(h))) return { support: "hybrid", confidence: "likely" };
  return { support: "none", confidence: "no" };
}

export function guessFromName(model: string): Capabilities {
  const m = norm(model);
  return { vision: guessVision(m), thinking: guessThinking(m) };
}

// ── L1: Metadaten-Parser ─────────────────────────────────────────────
export function parseOllamaShow(json: unknown): Capabilities | null {
  const caps = (json as { capabilities?: unknown })?.capabilities;
  if (!Array.isArray(caps)) return null;
  const arr = caps.filter((x): x is string => typeof x === "string");
  const vision: Confidence = arr.includes("vision") ? "confirmed" : "no";
  const canThink = arr.includes("thinking");
  return {
    vision,
    thinking: canThink ? { support: "hybrid", confidence: "confirmed" } : { support: "none", confidence: "no" },
  };
}

function findModel(json: unknown, model: string): Record<string, unknown> | null {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return null;
  const hit = data.find(x => (x as { id?: unknown })?.id === model);
  return (hit as Record<string, unknown>) ?? null;
}

export function parseLmStudioV1(json: unknown, model: string): Capabilities | null {
  const m = findModel(json, model);
  if (!m) return null;
  const caps = (m.capabilities ?? {}) as { vision?: unknown; reasoning?: unknown };
  const vision: Confidence = caps.vision === true ? "confirmed" : "no";
  const canThink = caps.reasoning != null;
  return {
    vision,
    thinking: canThink ? { support: "hybrid", confidence: "confirmed" } : { support: "none", confidence: "no" },
  };
}

export function parseLmStudioV0(json: unknown, model: string): Capabilities | null {
  const m = findModel(json, model);
  if (!m) return null;
  const vision: Confidence = m.type === "vlm" ? "confirmed" : "no";
  return { vision, thinking: { support: "none", confidence: "no" } }; // thinking in v0 nicht erkennbar
}

// ── Merge (Monotonie: Live nur hoch) ─────────────────────────────────
export function mergeCapability(
  base: Capabilities | null,
  nameGuess: Capabilities,
  live: { thinking?: boolean; vision?: boolean },
): Capabilities {
  let vision = stronger(base?.vision ?? "no", nameGuess.vision);
  if (live.vision) vision = "confirmed";

  let support: ThinkingSupport;
  if (nameGuess.thinking.support === "always") support = "always";
  else if ((base && base.thinking.support !== "none") || nameGuess.thinking.support === "hybrid") support = "hybrid";
  else support = "none";
  if (live.thinking && support === "none") support = "hybrid";

  let tconf = stronger(base?.thinking.confidence ?? "no", nameGuess.thinking.confidence);
  if (live.thinking) tconf = "confirmed";
  if (support === "none") tconf = "no";

  return { vision, thinking: { support, confidence: tconf } };
}

export function resolveCapabilities(
  meta: Capabilities | null,
  model: string,
  live: { thinking?: boolean; vision?: boolean } = {},
): Capabilities {
  return mergeCapability(meta, guessFromName(model), live);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + Commit**

Run: `npx tsc --noEmit` → keine Fehler.

```bash
git add src/capabilities.ts tests/capabilities.test.ts
git commit -m "feat(capabilities): geschichtete Vision/Thinking-Erkennung (Metadaten→Name→live)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Client-Metadaten — `listModels` + `fetchCapabilities`

**Files:**
- Modify: `src/embedder.ts` (neue Methoden `listModels`, `fetchCapabilities`)
- Modify: `src/chat_client.ts` (neue Methode `fetchCapabilities`)
- Test: `tests/embedder.test.ts`, `tests/chat_client.test.ts`

**Interfaces:**
- Consumes: `Capabilities`, `parseOllamaShow`, `parseLmStudioV1`, `parseLmStudioV0` aus `./capabilities`.
- Produces:
  - `EmbeddingClient.listModels(): Promise<string[]>`
  - `EmbeddingClient.fetchCapabilities(model: string): Promise<Capabilities | null>`
  - `ChatClient.fetchCapabilities(model: string): Promise<Capabilities | null>`

> **Hinweis:** `this.endpoint` ist via `normalizeEndpoint` bereits die Basis-URL ohne `/v1`. Native Pfade direkt anhängen: `${this.endpoint}/api/show` usw.

- [ ] **Step 1: Write the failing tests**

Ergänze in `tests/embedder.test.ts` innerhalb `describe("EmbeddingClient", …)`:

```ts
  describe("listModels", () => {
    it("parst data[].id und sortiert", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "b" }, { id: "a" }] }) }));
      const c = new EmbeddingClient("http://localhost:11434", "m");
      expect(await c.listModels()).toEqual(["a", "b"]);
    });
    it("gibt [] bei Fehler", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      expect(await new EmbeddingClient("http://x", "m").listModels()).toEqual([]);
    });
  });

  describe("fetchCapabilities", () => {
    it("liest Ollama /api/show capabilities", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ capabilities: ["completion"] }) }));
      const c = await new EmbeddingClient("http://localhost:11434", "m").fetchCapabilities("m");
      expect(c).not.toBeNull();
    });
    it("gibt null wenn keine Metadaten verfügbar", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      expect(await new EmbeddingClient("http://x", "m").fetchCapabilities("m")).toBeNull();
    });
  });
```

Ergänze in `tests/chat_client.test.ts` innerhalb `describe("ChatClient Modelle", …)`:

```ts
  it("fetchCapabilities liest LM Studio /api/v1/models", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/api/show")) return { ok: false, status: 404 };
      if (url.endsWith("/api/v1/models")) return { ok: true, json: async () => ({ data: [{ id: "m", capabilities: { vision: true } }] }) };
      return { ok: false, status: 404 };
    }));
    const c = await new ChatClient("http://localhost:1234", "m").fetchCapabilities("m");
    expect(c?.vision).toBe("confirmed");
  });
  it("fetchCapabilities gibt null wenn nichts greift", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await new ChatClient("http://x", "m").fetchCapabilities("m")).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/embedder.test.ts tests/chat_client.test.ts`
Expected: FAIL („listModels is not a function" / „fetchCapabilities is not a function").

- [ ] **Step 3: Implement on `EmbeddingClient`**

In `src/embedder.ts` oben ergänzen:

```ts
import { Capabilities, parseOllamaShow, parseLmStudioV1, parseLmStudioV0 } from "./capabilities";
```

Und innerhalb der Klasse `EmbeddingClient` (nach `ping`) einfügen:

```ts
  async listModels(): Promise<string[]> {
    try {
      const r = await fetch(`${this.endpoint}/v1/models`);
      if (!r.ok) return [];
      const j = await r.json() as { data?: { id?: string }[] };
      return (j.data ?? []).map(m => m.id).filter((x): x is string => typeof x === "string").sort();
    } catch { return []; }
  }

  /** Best-effort native Capability-Metadaten (Ollama /api/show, LM Studio /api/v1|v0).
   *  null wenn nichts Verwertbares verfügbar. this.endpoint ist bereits die Basis-URL. */
  async fetchCapabilities(model: string): Promise<Capabilities | null> {
    return fetchCapabilities(this.endpoint, model);
  }
```

In `src/chat_client.ts`:

```ts
import { Capabilities, parseOllamaShow, parseLmStudioV1, parseLmStudioV0 } from "./capabilities";
```

und Methode innerhalb `ChatClient`:

```ts
  async fetchCapabilities(model: string): Promise<Capabilities | null> {
    return fetchCapabilities(this.endpoint, model);
  }
```

Damit die Logik **nicht dupliziert** wird (DRY), eine geteilte Helper-Funktion in `capabilities.ts` ergänzen (am Dateiende) **und exportieren**:

```ts
/** Probiert native Capability-Endpoints gegen eine Basis-URL (ohne /v1). */
export async function fetchCapabilities(baseUrl: string, model: string): Promise<Capabilities | null> {
  // 1) Ollama
  try {
    const r = await fetch(`${baseUrl}/api/show`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }),
    });
    if (r.ok) { const c = parseOllamaShow(await r.json()); if (c) return c; }
  } catch { /* weiter */ }
  // 2) LM Studio v1
  try {
    const r = await fetch(`${baseUrl}/api/v1/models`);
    if (r.ok) { const c = parseLmStudioV1(await r.json(), model); if (c) return c; }
  } catch { /* weiter */ }
  // 3) LM Studio v0
  try {
    const r = await fetch(`${baseUrl}/api/v0/models`);
    if (r.ok) { const c = parseLmStudioV0(await r.json(), model); if (c) return c; }
  } catch { /* weiter */ }
  return null;
}
```

Die Imports in `embedder.ts`/`chat_client.ts` entsprechend auf `import { Capabilities, fetchCapabilities } from "./capabilities";` reduzieren (nur die zwei Namen, die wirklich genutzt werden — die Parser bleiben intern in `capabilities.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/embedder.test.ts tests/chat_client.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + Commit**

Run: `npx tsc --noEmit`

```bash
git add src/embedder.ts src/chat_client.ts src/capabilities.ts tests/embedder.test.ts tests/chat_client.test.ts
git commit -m "feat(clients): EmbeddingClient.listModels + fetchCapabilities (Ollama/LM Studio)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Thinking-Suppression im Stream + Session

**Files:**
- Modify: `src/chat_client.ts` (`stream` opts um `suppressThinking`)
- Modify: `src/chat_session.ts` (`params()` um `suppressThinking`; an `stream` durchreichen)
- Test: `tests/chat_client.test.ts`, `tests/chat_session.test.ts`

**Interfaces:**
- Consumes: `suppressParams` aus `./reasoning`.
- Produces:
  - `ChatClient.stream(..., opts?: { model?; temperature?; suppressThinking?: boolean })`
  - `ChatSessionDeps.params: () => { model: string; temperature: number; suppressThinking: boolean }`

- [ ] **Step 1: Write the failing tests**

Ergänze in `tests/chat_client.test.ts` (im ersten `describe("ChatClient", …)`):

```ts
  it("stream mischt Suppress-Params in den Body wenn suppressThinking", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamRes(['data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n']));
    vi.stubGlobal("fetch", fetchMock);
    await new ChatClient("http://x", "m").stream(
      [{ role: "user", content: "hi" }], () => {}, () => {}, undefined, { suppressThinking: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("none");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.reasoning_budget).toBe(0);
  });
  it("stream ohne suppressThinking sendet keine Suppress-Keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamRes(['data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n']));
    vi.stubGlobal("fetch", fetchMock);
    await new ChatClient("http://x", "m").stream([{ role: "user", content: "hi" }], () => {}, () => {});
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect("reasoning_effort" in body).toBe(false);
  });
```

Ergänze in `tests/chat_session.test.ts` einen Test, der prüft, dass `params().suppressThinking` an den Client-Stream durchgereicht wird. Muster (an die bestehende Test-Struktur in der Datei anpassen — `params` im Deps-Objekt setzen):

```ts
  it("reicht suppressThinking aus params an client.stream durch", async () => {
    let seenOpts: any = null;
    const client: any = { stream: vi.fn(async (_m: any, _c: any, _r: any, _s: any, opts: any) => { seenOpts = opts; return { content: "A", reasoning: "" }; }) };
    const session = new ChatSession({
      client: () => client,
      assemble: async () => ({ text: "", sources: [] }),
      systemPreamble: () => "",
      params: () => ({ model: "m", temperature: 0.5, suppressThinking: true }),
    });
    await session.send("frage", [], () => {});
    expect(seenOpts.suppressThinking).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/chat_client.test.ts tests/chat_session.test.ts`
Expected: FAIL (Suppress-Keys fehlen / `suppressThinking` undefined).

- [ ] **Step 3: Implement**

In `src/chat_client.ts` oben:

```ts
import { suppressParams } from "./reasoning";
```

`stream`-Signatur + Body anpassen:

```ts
  async stream(
    messages: ChatMessage[],
    onContent: (t: string) => void,
    onReasoning: (t: string) => void,
    signal?: AbortSignal,
    opts?: { model?: string; temperature?: number; suppressThinking?: boolean },
  ): Promise<{ content: string; reasoning: string }> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts?.model ?? this.model,
        messages,
        stream: true,
        ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
        ...suppressParams(opts?.suppressThinking ?? false),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Chat HTTP ${res.status}`);
    const { content, reasoning } = await streamSSE(res, onContent, onReasoning);
    return { content, reasoning };
  }
```

In `src/chat_session.ts`: `ChatSessionDeps.params` Typ erweitern und beim Stream-Aufruf durchreichen:

```ts
  params: () => { model: string; temperature: number; suppressThinking: boolean };
```

und im `send`:

```ts
      const result = await this.deps.client().stream(
        sent,
        c => { assistant.content += c; onToken(c); },
        r => { assistant.reasoning = (assistant.reasoning ?? "") + r; onToken(r); },
        this.controller.signal,
        { model: p.model, temperature: p.temperature, suppressThinking: p.suppressThinking },
      );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/chat_client.test.ts tests/chat_session.test.ts`
Expected: PASS. (Bestehende chat_session-Tests, die `params` setzen, ggf. um `suppressThinking: false` ergänzen, falls der strict-Typ sie sonst rot macht — dabei nur das Feld hinzufügen.)

- [ ] **Step 5: Typecheck + Commit**

Run: `npx tsc --noEmit`

```bash
git add src/chat_client.ts src/chat_session.ts tests/chat_client.test.ts tests/chat_session.test.ts
git commit -m "feat(chat): Thinking-Suppression durch stream + session (params.suppressThinking)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Settings-Defaults (`suppressThinking`, `enterSends`)

**Files:**
- Modify: `src/settings.ts` (`VaultRagSettings` + `DEFAULT_SETTINGS`)
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `VaultRagSettings.suppressThinking: boolean`, `VaultRagSettings.enterSends: boolean`.

- [ ] **Step 1: Write the failing test**

Ergänze in `tests/settings.test.ts`:

```ts
  it("hat UX-Politur-Defaults", () => {
    expect(DEFAULT_SETTINGS.suppressThinking).toBe(false);
    expect(DEFAULT_SETTINGS.enterSends).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL („expected undefined to be false").

- [ ] **Step 3: Implement**

In `src/settings.ts` das Interface `VaultRagSettings` um zwei Felder ergänzen:

```ts
  suppressThinking: boolean;
  enterSends: boolean;
```

und in `DEFAULT_SETTINGS`:

```ts
  suppressThinking: false,
  enterSends: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): Defaults suppressThinking=false, enterSends=true

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Settings-UI — Embedding-Dropdown, Endpoint-Test, Capabilities, System-Prompt, Suppress-Test, Enter-Toggle

**Files:**
- Modify: `src/settings.ts` (`display()`)
- Modify: `styles.css` (Status-Punkt-Klassen)

> **Test-Hinweis:** `SettingTab.display()` ist gegen den minimalen Obsidian-Mock nicht unit-testbar (kein `addDropdown`/`addButton`/`addTextArea` im Fake). Deliverable wird über `npx tsc --noEmit` + `npm run build` + einen manuellen Smoke verifiziert. Reine Logik (Capabilities/Reasoning) ist bereits in Task 1–4 getestet.

**Interfaces:**
- Consumes: `EmbeddingClient.listModels/fetchCapabilities`, `ChatClient.fetchCapabilities`, `resolveCapabilities`, `suppressParams`, `reasoningHappened`, `isAlwaysOnThinker`.

- [ ] **Step 1: Embedding-Modell-Dropdown (analog zum Chat-Modell)**

In `src/settings.ts` den bestehenden „Embedding Modell"-`Setting`-Block (reines Textfeld) durch das Dropdown-mit-Fallback-Muster ersetzen (Vorbild: Chat-Modell-Block weiter unten in derselben Datei). Konkret:

```ts
    const embModelSetting = new Setting(containerEl)
      .setName("Embedding-Modell")
      .setDesc("Modellname wie auf dem Endpoint verfügbar");
    void this.plugin.embedder?.listModels().then((models: string[]) => {
      const cur = this.plugin.settings.embeddingModel;
      if (models.length) {
        const list = models.includes(cur) ? models : [cur, ...models];
        embModelSetting.addDropdown(d => {
          list.forEach((m: string) => d.addOption(m, m));
          d.setValue(cur).onChange(async (v: string) => {
            this.plugin.settings.embeddingModel = v;
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          });
        });
      } else {
        embModelSetting.addText(t =>
          t.setPlaceholder("qwen3-embedding:8b").setValue(cur).onChange(async (v: string) => {
            this.plugin.settings.embeddingModel = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }));
        embModelSetting.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.display()));
      }
    });
```

- [ ] **Step 2: Inline-Endpoint-Test + Status-Punkt (Embedding + Chat)**

Pro Endpoint-Feld einen „Testen"-Button (`addButton`) und einen Status-`<span>` direkt am `Setting` ergänzen. Helper am Anfang von `display()` definieren:

```ts
    const statusDot = (setting: Setting): HTMLElement => {
      const dot = setting.controlEl.createSpan({ cls: "vault-rag-status-dot" });
      dot.setText("·");
      return dot;
    };
    const showPing = (dot: HTMLElement, ok: boolean): void => {
      dot.toggleClass("is-ok", ok);
      dot.toggleClass("is-error", !ok);
      dot.setText(ok ? "● verbunden" : "○ offline");
    };
```

Am Embedding-Endpoint-`Setting` nach dem Textfeld:

```ts
      .addButton(b => b.setButtonText("Testen").onClick(async () => {
        b.setDisabled(true);
        const ok = await this.plugin.embedder?.ping();
        showPing(embDot, !!ok);
        b.setDisabled(false);
      }));
    const embDot = statusDot(embEndpointSetting);
```

(Die Setting-Variable `embEndpointSetting` entsprechend benennen; `embDot` muss nach der Setting-Erstellung deklariert werden — ggf. `let embDot: HTMLElement;` vor dem Block und Zuweisung danach, um die Closure-Reihenfolge sauber zu halten.)

Analog am Chat-Endpoint-`Setting` (ersetzt den separaten „Chat-Verbindung"-Sammelblock unten — diesen entfernen). Der bisherige `pingChat()`-Mechanismus wird durch den Inline-Button + Dot ersetzt.

- [ ] **Step 3: Capability-Anzeige an Modell-Dropdowns**

Nach erfolgreichem Setzen des Chat-Modell-Dropdowns (im bestehenden `listModels().then(...)`-Block) die Capabilities best-effort nachladen und in die Desc schreiben. Helper:

```ts
    const capLabel = (c: { vision: string; thinking: { support: string; confidence: string } }): string => {
      const parts: string[] = [];
      if (c.vision !== "no") parts.push(c.vision === "confirmed" ? "👁 Vision" : "👁 Vision?");
      if (c.thinking.support !== "none") {
        const t = c.thinking.support === "always" ? "💭 Thinking (immer an)" : "💭 Thinking";
        parts.push(c.thinking.confidence === "confirmed" ? t : t + "?");
      }
      return parts.length ? parts.join(" · ") : "keine besonderen Fähigkeiten erkannt";
    };
```

und im `showInfo(model)` (oder einem neuen `showCaps`) zusätzlich:

```ts
    const showCaps = (model: string): void => {
      void this.plugin.chatClient?.fetchCapabilities(model).then((meta: any) => {
        const caps = resolveCapabilities(meta, model, {});
        capSetting.setDesc(capLabel(caps));
      });
    };
```

mit einem neuen `const capSetting = new Setting(containerEl).setName("Fähigkeiten").setDesc("…");` direkt unter „Modell-Details" und Aufruf `showCaps(this.plugin.settings.chatModel)` initial + bei `onChange` des Modell-Dropdowns. Import oben: `import { resolveCapabilities } from "./capabilities";`.

- [ ] **Step 4: System-Prompt-Textarea vergrößern**

Den bestehenden System-Prompt-`addTextArea`-Block um Größe ergänzen:

```ts
      .addTextArea(t => {
        t.setValue(this.plugin.settings.chatSystemPrompt)
          .onChange(async (v: string) => {
            this.plugin.settings.chatSystemPrompt = v;
            await this.plugin.saveSettings();
          });
        t.inputEl.rows = 8;
        t.inputEl.addClass("vault-rag-prompt-textarea");
      });
```

- [ ] **Step 5: Thinking-Default-Toggle + „Suppress testen"-Button + Enter-Toggle**

Im Chat-Abschnitt ergänzen (z. B. nach „Temperatur"):

```ts
    new Setting(containerEl)
      .setName("Thinking unterdrücken")
      .setDesc("Standard für neue Chats. Sendet Suppress-Hints (reasoning_effort/enable_thinking). Pro Chat im Panel umschaltbar.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.suppressThinking).onChange(async (v: boolean) => {
          this.plugin.settings.suppressThinking = v;
          await this.plugin.saveSettings();
        }));

    const suppressTest = new Setting(containerEl)
      .setName("Suppress testen")
      .setDesc("Prüft, ob das aktuelle Modell Thinking wirklich abschaltet.");
    suppressTest.addButton(b => b.setButtonText("Testen").onClick(async () => {
      const model = this.plugin.settings.chatModel;
      if (isAlwaysOnThinker(model)) { suppressTest.setDesc("⚠ Dieses Modell denkt immer (nur low/medium/high)."); return; }
      b.setDisabled(true);
      suppressTest.setDesc("teste…");
      try {
        const res = await this.plugin.chatClient.stream(
          [{ role: "user", content: "Antworte in genau einem Wort: Hallo." }],
          () => {}, () => {}, undefined, { model, suppressThinking: true });
        const happened = reasoningHappened(res.content, res.reasoning);
        suppressTest.setDesc(happened ? "⚠ Modell denkt trotz „aus"." : "✓ wird unterdrückt.");
      } catch {
        suppressTest.setDesc("○ Endpoint nicht erreichbar.");
      } finally { b.setDisabled(false); }
    }));

    new Setting(containerEl)
      .setName("Enter sendet")
      .setDesc("An: Enter sendet, Shift+Enter macht eine neue Zeile. Aus: umgekehrt.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.enterSends).onChange(async (v: boolean) => {
          this.plugin.settings.enterSends = v;
          await this.plugin.saveSettings();
        }));
```

Imports oben ergänzen: `import { reasoningHappened, isAlwaysOnThinker } from "./reasoning";`.

- [ ] **Step 6: Styles ergänzen**

In `styles.css` anhängen:

```css
.vault-rag-status-dot { margin-left: 8px; font-size: 11px; color: var(--text-muted); }
.vault-rag-status-dot.is-ok { color: var(--text-success); }
.vault-rag-status-dot.is-error { color: var(--text-error); }
.vault-rag-prompt-textarea { width: 100%; min-height: 8rem; resize: vertical; }
```

- [ ] **Step 7: Verify (tsc + build) + Commit**

Run: `npx tsc --noEmit` → keine Fehler.
Run: `npm run build` → `main.js` ohne Fehler erzeugt.
Run: `npm test` → alle bestehenden Tests grün.

```bash
git add src/settings.ts styles.css
git commit -m "feat(settings): Embedding-Dropdown, Inline-Endpoint-Test, Capabilities, größerer System-Prompt, Thinking-/Enter-Optionen + Suppress-Test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Chat-View — Auto-Grow-Textarea, IME-Guard, Enter-Logik, Thinking-Toggle, Capability-Chips

**Files:**
- Modify: `src/chat_view.ts`
- Modify: `styles.css`
- Test: `tests/chat_view.test.ts`

**Interfaces:**
- Consumes: `isAlwaysOnThinker` aus `./reasoning`; `resolveCapabilities`, `Capabilities` aus `./capabilities`.
- Produces (neue `ChatViewDeps`-Felder, in Task 8 von `main.ts` verdrahtet):
  - `getSuppress: () => boolean`
  - `setSuppress: (v: boolean) => void`
  - `enterSends: () => boolean`
  - `fetchCapabilities: (model: string) => Promise<Capabilities>`

- [ ] **Step 1: Write the failing tests**

Im `mkView`-Helper in `tests/chat_view.test.ts` die neuen Deps mit Defaults ergänzen (sonst Compile-Fehler):

```ts
    getSuppress: opts.getSuppress ?? (() => false),
    setSuppress: opts.setSuppress ?? vi.fn(),
    enterSends: opts.enterSends ?? (() => true),
    fetchCapabilities: opts.fetchCapabilities ?? (async () => ({ vision: "no", thinking: { support: "none", confidence: "no" } })),
```

(und die `opts`-Typsignatur der Helper-Funktion entsprechend um diese Felder erweitern.)

Neue Tests im `describe("ChatView", …)`:

```ts
  it("Eingabe ist eine Textarea", async () => {
    const { view } = mkView();
    await view.onOpen();
    expect(String((view as any).inputEl.tagName)).toBe("TEXTAREA");
  });
  it("Enter sendet, Shift+Enter nicht (enterSends=true)", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    (view as any).inputEl.value = "frage";
    const ta = (view as any).inputEl;
    const ev = (over: any) => ({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, preventDefault: () => {}, ...over });
    (ta._listeners["keydown"] ?? []).forEach((cb: any) => cb(ev({ shiftKey: true })));
    expect(session.send).not.toHaveBeenCalled();
    (ta._listeners["keydown"] ?? []).forEach((cb: any) => cb(ev({})));
    expect(session.send).toHaveBeenCalled();
  });
  it("sendet nicht während IME-Komposition", async () => {
    const { view, session } = mkView();
    await view.onOpen();
    (view as any).inputEl.value = "字";
    const ta = (view as any).inputEl;
    (ta._listeners["keydown"] ?? []).forEach((cb: any) =>
      cb({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: true, preventDefault: () => {} }));
    expect(session.send).not.toHaveBeenCalled();
  });
  it("enterSends=false: Enter macht keine Sendung, Shift+Enter schon", async () => {
    const { view, session } = mkView({ enterSends: () => false });
    await view.onOpen();
    (view as any).inputEl.value = "frage";
    const ta = (view as any).inputEl;
    const ev = (over: any) => ({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, preventDefault: () => {}, ...over });
    (ta._listeners["keydown"] ?? []).forEach((cb: any) => cb(ev({})));
    expect(session.send).not.toHaveBeenCalled();
    (ta._listeners["keydown"] ?? []).forEach((cb: any) => cb(ev({ shiftKey: true })));
    expect(session.send).toHaveBeenCalled();
  });
  it("Thinking-Toggle ruft setSuppress", async () => {
    const setSuppress = vi.fn();
    const { view } = mkView({ setSuppress, getSuppress: () => false });
    await view.onOpen();
    const toggle = all(view.contentEl, "vault-rag-chat-think-toggle")[0];
    expect(toggle).toBeTruthy();
    toggle.click();
    expect(setSuppress).toHaveBeenCalledWith(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/chat_view.test.ts`
Expected: FAIL (Textarea/Toggle fehlen; Keydown-Logik unvollständig).

- [ ] **Step 3: Implement — Textarea + Keydown**

In `src/chat_view.ts`:
- Import oben: `import { isAlwaysOnThinker } from "./reasoning"; import { resolveCapabilities, Capabilities } from "./capabilities";`
- `ChatViewDeps` um die vier neuen Felder erweitern (siehe Interfaces oben).
- Feld-Typ ändern: `private inputEl: HTMLTextAreaElement | null = null;`
- In `buildInput()` das `<input>` durch eine Textarea ersetzen:

```ts
      const input = row.createEl("textarea", { cls: "vault-rag-chat-input" }) as HTMLTextAreaElement;
      input.rows = 3; input.placeholder = "Frag deinen Vault…";
      this.inputEl = input;
      input.addEventListener("input", () => { this.autoGrow(); this.scheduleQuery(input.value ?? ""); });
      input.addEventListener("keydown", (e: KeyboardEvent) => this.onKeydown(e));
```

- Neue Methoden:

```ts
  private autoGrow(): void {
    const el = this.inputEl; if (!el) return;
    // Fake-DOM in Tests hat kein scrollHeight → defensiv.
    const sh = (el as unknown as { scrollHeight?: number }).scrollHeight;
    if (typeof sh !== "number") return;
    el.style.height = "auto";
    el.style.height = `${Math.min(sh, 180)}px`;
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.running) { this.deps.session.abort(); return; }
    if (e.isComposing || e.key === "Process") return;          // IME-Guard
    if (e.key !== "Enter") return;
    const plain = !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    const sends = this.deps.enterSends() ? plain : e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (sends) { e.preventDefault(); void this.submit(); }
  }
```

> **Hinweis zu `el.style.height`:** Der Obsidian-Fake-`createEl` hat kein `style`-Objekt — `autoGrow` returnt in Tests früh (kein `scrollHeight`). Für die echte Laufzeit ist `style` vorhanden. Falls `tsc` `style` am Fake-Typ bemängelt: `inputEl` ist `HTMLTextAreaElement`, hat also `.style` — kein Cast nötig.

- [ ] **Step 4: Implement — Thinking-Toggle + Capability-Chips**

In `onOpen()` neben dem Modell-Dropdown einen Toggle + Chip-Container anlegen. Nach `this.modelSel = …` ergänzen:

```ts
    this.thinkToggleEl = c.createEl("button", { cls: "vault-rag-chat-think-toggle clickable-icon" });
    this.thinkToggleEl.addEventListener("click", () => {
      this.deps.setSuppress(!this.deps.getSuppress());
      this.renderThinkToggle();
    });
    this.capEl = c.createDiv({ cls: "vault-rag-chat-caps" });
```

Felder deklarieren:

```ts
  private thinkToggleEl: HTMLElement | null = null;
  private capEl: HTMLElement | null = null;
```

Render-Methoden:

```ts
  private renderThinkToggle(): void {
    const el = this.thinkToggleEl; if (!el) return;
    const model = this.deps.getModel();
    const always = isAlwaysOnThinker(model);
    const suppressed = this.deps.getSuppress();
    const label = always ? "💭 immer an" : suppressed ? "💭 aus" : "💭 an";
    el.setText(label);
    el.setAttribute("aria-label", always
      ? "Dieses Modell denkt immer (nicht abschaltbar)"
      : suppressed ? "Thinking ist aus — klicken zum Einschalten" : "Thinking ist an — klicken zum Ausschalten");
    el.toggleClass("is-disabled", always);
  }

  private renderCaps(caps: Capabilities): void {
    const el = this.capEl; if (!el) return;
    el.empty();
    if (caps.vision !== "no") el.createSpan({ cls: `vault-rag-chat-cap is-${caps.vision}`, text: "👁 Vision" });
    if (caps.thinking.support !== "none") {
      const t = caps.thinking.support === "always" ? "💭 Thinking (immer)" : "💭 Thinking";
      el.createSpan({ cls: `vault-rag-chat-cap is-${caps.thinking.confidence}`, text: t });
    }
  }

  private async refreshCaps(): Promise<void> {
    const model = this.deps.getModel();
    const caps = await this.deps.fetchCapabilities(model);
    this.renderCaps(caps);
    this.renderThinkToggle();
  }
```

In `onOpen()` am Ende `this.renderThinkToggle(); await this.refreshCaps();` aufrufen. Im `modelSel`-`change`-Listener nach `setModel` zusätzlich `void this.refreshCaps();`.

> **Live-Upgrade (L3, optional aber im Scope):** In `submit()` nach `await pending`, wenn die letzte Assistenten-Nachricht `reasoning` trägt, die Caps hochstufen:
> ```ts
>     const msgs = this.deps.session.messages;
>     const last = msgs[msgs.length - 1];
>     if (last?.role === "assistant" && (last.reasoning ?? "")) {
>       this.renderCaps(resolveCapabilities(null, this.deps.getModel(), { thinking: true }));
>     }
> ```
> (Reicht für „live bestätigt"; die Metadaten/Name-Caps werden beim nächsten `refreshCaps` ohnehin neu gemischt.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/chat_view.test.ts`
Expected: PASS (alle neuen + bestehenden View-Tests).

- [ ] **Step 6: Styles**

In `styles.css` anhängen / die Eingabe-Klasse anpassen:

```css
.vault-rag-chat-input { flex: 1; resize: none; min-height: 60px; max-height: 180px; overflow-y: auto; }
.vault-rag-chat-think-toggle { font-size: 12px; margin-bottom: 6px; }
.vault-rag-chat-think-toggle.is-disabled { opacity: 0.6; pointer-events: none; }
.vault-rag-chat-caps { display: flex; gap: 6px; margin-bottom: 6px; }
.vault-rag-chat-cap { font-size: 11px; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--background-modifier-border); }
.vault-rag-chat-cap.is-likely { opacity: 0.6; }
```

(Die bestehende `.vault-rag-chat-input { flex: 1; }`-Regel durch die obige ersetzen.)

- [ ] **Step 7: Verify + Commit**

Run: `npx tsc --noEmit` · `npm test` · `npm run build` → alle grün.

```bash
git add src/chat_view.ts styles.css tests/chat_view.test.ts
git commit -m "feat(chat-view): Auto-Grow-Textarea, IME-Guard, Enter-Logik, Thinking-Toggle, Capability-Chips

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `main.ts`-Verdrahtung + Smoke

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: alle neuen Deps/Methoden aus Task 3–7.

> **Test-Hinweis:** `main.ts` ist die Verdrahtungsschicht (kein eigener Unit-Test im Bestand). Deliverable über `npx tsc --noEmit` + `npm run build` + manuellen Smoke verifiziert.

- [ ] **Step 1: ChatSession.params um `suppressThinking` erweitern**

Im `new ChatSession({...})`-Block:

```ts
        params: () => ({
          model: this.settings.chatModel,
          temperature: this.settings.chatTemperature,
          suppressThinking: this.settings.suppressThinking,
        }),
```

- [ ] **Step 2: Neue ChatView-Deps verdrahten**

Im `new ChatView(leaf, { … })`-Block ergänzen:

```ts
      getSuppress: () => this.settings.suppressThinking,
      setSuppress: (v: boolean) => { this.settings.suppressThinking = v; void this.saveSettings(); },
      enterSends: () => this.settings.enterSends,
      fetchCapabilities: async (model: string) => {
        const meta = await this.chatClient.fetchCapabilities(model);
        return resolveCapabilities(meta, model, {});
      },
```

Import oben ergänzen: `import { resolveCapabilities } from "./capabilities";`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → keine Fehler.
Run: `npm test` → alle Tests grün.
Run: `npm run build` → `main.js` erzeugt.

- [ ] **Step 4: Manueller Smoke (im echten Vault)**

Plugin neu laden (in-place Plugin-Dev) und prüfen:
1. Chat-Eingabe ist mehrzeilig, wächst mit dem Text, Enter sendet / Shift+Enter macht Zeile.
2. Thinking-Toggle neben dem Modell zeigt Zustand und schaltet um; bei einem r1/gpt-oss-Modell „immer an".
3. Capability-Chips erscheinen am Chat (Vision/Thinking, je nach Modell).
4. Settings: Embedding-Modell ist ein Dropdown; „Testen" an beiden Endpoints zeigt verbunden/offline; System-Prompt-Feld ist groß; „Suppress testen" meldet ✓/⚠; Enter-Toggle vorhanden.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): UX-Politur-Deps verdrahten (suppress, enterSends, fetchCapabilities)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Whole-Branch-Review + AGENTS/Cockpit-Nachzug

**Files:**
- Modify: `AGENTS.md` (Modul-Layout um `reasoning.ts`/`capabilities.ts`; Test-Zahl aktualisieren)
- ggf. Modify: betroffene Dateien nach Review-Findings

- [ ] **Step 1: Gesamttest + Build**

Run: `npm test` (alle grün, neue Zahl notieren) · `npx tsc --noEmit` · `npm run build`.

- [ ] **Step 2: Code-Review**

Adversariale Review des gesamten Branch-Diffs (z. B. via `superpowers:requesting-code-review`). Findings beheben, Tests grün halten.

- [ ] **Step 3: AGENTS.md nachziehen**

Im Modul-Layout `reasoning.ts` (Suppress-Params + Reasoning-Erkennung) und `capabilities.ts` (Vision/Thinking-Erkennung) ergänzen; Test-Anzahl in der Commands-Sektion aktualisieren.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): reasoning.ts + capabilities.ts im Modul-Layout, Testzahl aktualisiert

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (gegen die Spec)

**Spec-Coverage:**
- Mehrzeilige Auto-Grow-Eingabe → Task 7 ✓
- System-Prompt größer → Task 6 (Step 4) ✓
- Embedding-Modell-Dropdown → Task 3 (listModels) + Task 6 (Step 1) ✓
- Endpoint-Setup vereinfachen + Inline-Test/Status → Task 6 (Step 2) ✓
- Verbindungsstatus an Endpoint **und** Modell → Task 6 (Step 2 + 3) ✓
- Capability-Anzeige Settings **und** Frontend → Task 6 (Step 3) + Task 7 (Step 4) ✓
- Thinking-Toggle (Suppress, Block nicht ausblenden) → Task 4 (stream) + Task 7 (Toggle) ✓
- Settings-Default + „Suppress testen" → Task 5 + Task 6 (Step 5) ✓
- Saubere Cross-Server-Suppression (Union, kein Boolean/„minimal") → Task 1 ✓
- Capability-Schichtung L1→L2→L3, Monotonie → Task 2 ✓
- `normalizeEndpoint`/native Pfade → Task 3 (Basis-URL) ✓
- Enter konfigurierbar (Default senden) → Task 5 + Task 7 ✓
- IME-Guard, Escape-Stop, Senden-disabled-bei-leer, Autofocus → Task 7 (bestehender Empty-Guard bleibt; Autofocus optional in Step 4 ergänzbar) ✓
- Guideline-Konformität (CSS-Klassen, aria, clickable-icon) → Task 6/7 + Task 9 ✓

**Placeholder-Scan:** keine TBD/TODO; alle Code-Schritte enthalten vollständigen Code.

**Typ-Konsistenz:** `Capabilities`/`Confidence`/`ThinkingState` durchgängig identisch; `params()` überall `{model,temperature,suppressThinking}`; `fetchCapabilities`-Signaturen konsistent (Client → `Capabilities|null`, View-Dep → `Capabilities`).

**Bewusst nicht abgedeckt (YAGNI, in Spec als Nicht-Ziel):** Lexical/@-Mentions, Vision-Bild-Probe, Personas, Top-p/max_tokens.
