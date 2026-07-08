# Endpunkt-UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Endpunkt-Editor bietet Ein-Klick-Presets (LM Studio/Ollama), zeigt pro Endpunkt eine Klartext-Fehlerursache statt nur rot/grün, und warnt nicht-blockierend bei offensichtlich falschen Eingaben.

**Architecture:** Reine, node-testbare Logik (`ENDPOINT_PRESETS`, `classifyEndpointStatus`, `validateEndpointInput`) entsteht in `obsidian-kit/src/pure/endpoint_diagnostics.ts` und wird nach `vault-rag/src/vendor/kit/` vendored. Die obsidian-Schicht (`http.ts` `probeEndpoint`, `embedder`/`chat_client` `probe()`, `settings.ts`) verdrahtet sie hinter dem einzigen Netz-Import `requestUrl`.

**Tech Stack:** TypeScript (strict), vitest + happy-dom, esbuild, Obsidian Plugin API (`requestUrl`).

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Zwei Repos:** Tasks 1–2 arbeiten in `/Users/Shared/code/obsidian-plugins/obsidian-kit` (committen dort auf `main`, additiv/rückwärtskompatibel). Tasks 3–5 arbeiten in `/Users/Shared/code/obsidian-plugins/vault-rag` (Branch `feat/endpoint-ux`).
- **Alle Tests grün** nach jedem Task: vault-rag `npm test`, kit `npm test`. Kein `.only`/`.skip`.
- **UI-Texte deutsch.** Status/Warnungen **WCAG-redundant** (Icon-Form + Text/Tooltip, nicht nur Farbe — Johannes hat Rot-Grün-Sehschwäche).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Vendoring:** vendored Dateien tragen als erste Zeile `// vendored from obsidian-kit#<version>, src/pure/<datei>.ts`. Quelle ist die kit-Datei, Ziel `vault-rag/src/vendor/kit/`.

---

### Task 1: kit — `classifyEndpointStatus` + Typen

**Repo:** `obsidian-kit` (cwd `/Users/Shared/code/obsidian-plugins/obsidian-kit`)

**Files:**
- Create: `src/pure/endpoint_diagnostics.ts`
- Create: `tests/endpoint_diagnostics.test.ts`
- Modify: `src/pure/index.ts` (Export ergänzen)

**Interfaces:**
- Produces: `EndpointStatusKind`, `EndpointStatus`, `ProbeInput`, `classifyEndpointStatus(input: ProbeInput): EndpointStatus`.

- [ ] **Step 1: Failing test schreiben** — `tests/endpoint_diagnostics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyEndpointStatus } from "../src/pure/endpoint_diagnostics";

describe("classifyEndpointStatus", () => {
  it("ok: HTTP 200 mit {data:[…]}-Form ist erreichbar", () => {
    const s = classifyEndpointStatus({ kind: "response", status: 200, body: { data: [{ id: "m" }] } });
    expect(s.reachable).toBe(true);
    expect(s.kind).toBe("ok");
  });
  it("not-an-llm-api: HTTP 200 ohne data-Array (Fremd-Server)", () => {
    const s = classifyEndpointStatus({ kind: "response", status: 200, body: { foo: 1 } });
    expect(s.reachable).toBe(false);
    expect(s.kind).toBe("not-an-llm-api");
  });
  it("not-an-llm-api: HTTP 404 (falscher Pfad)", () => {
    expect(classifyEndpointStatus({ kind: "response", status: 404, body: undefined }).kind).toBe("not-an-llm-api");
  });
  it("refused: ECONNREFUSED (Node) und ERR_CONNECTION_REFUSED (Electron)", () => {
    expect(classifyEndpointStatus({ kind: "error", message: "connect ECONNREFUSED 127.0.0.1:1" }).kind).toBe("refused");
    expect(classifyEndpointStatus({ kind: "error", message: "net::ERR_CONNECTION_REFUSED" }).kind).toBe("refused");
  });
  it("unknown-host: ENOTFOUND", () => {
    expect(classifyEndpointStatus({ kind: "error", message: "getaddrinfo ENOTFOUND foo.invalid" }).kind).toBe("unknown-host");
  });
  it("timeout: eigenes Timeout-Signal", () => {
    expect(classifyEndpointStatus({ kind: "timeout" }).kind).toBe("timeout");
  });
  it("unknown: unbekannte Fehlermeldung wird roh durchgereicht", () => {
    const s = classifyEndpointStatus({ kind: "error", message: "irgendein seltsamer Fehler" });
    expect(s.kind).toBe("unknown");
    expect(s.raw).toBe("irgendein seltsamer Fehler");
    expect(s.klartext).toContain("irgendein seltsamer Fehler");
  });
});
```

- [ ] **Step 2: Test läuft, schlägt fehl**

Run: `npm test -- endpoint_diagnostics`
Expected: FAIL — `classifyEndpointStatus` nicht gefunden.

- [ ] **Step 3: Implementieren** — `src/pure/endpoint_diagnostics.ts`:

```ts
export type EndpointStatusKind =
  | "ok" | "refused" | "unknown-host" | "timeout" | "not-an-llm-api" | "unknown";

export interface EndpointStatus {
  reachable: boolean;         // true nur bei kind === "ok"
  kind: EndpointStatusKind;
  klartext: string;           // deutsche, handlungsleitende Meldung (Tooltip-Text)
  raw?: string;               // rohe Fehlermeldung, nur bei kind === "unknown"
}

/** Rohsignal einer Erreichbarkeits-Probe: erfolgreiche Response, gefangener Fehler, oder Timeout. */
export type ProbeInput =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "error"; message: string }
  | { kind: "timeout" };

const KLARTEXT: Record<Exclude<EndpointStatusKind, "unknown">, string> = {
  "ok": "Verbunden",
  "refused": "Verbindung abgelehnt — Server läuft nicht oder Port falsch.",
  "unknown-host": "Hostname unbekannt — Tippfehler in der Adresse?",
  "timeout": "Zeitüberschreitung — Netz nicht erreichbar (falsches Netz / VPN aus?).",
  "not-an-llm-api": "Antwortet, ist aber kein OpenAI-kompatibler Endpunkt — falscher Pfad/Dienst?",
};

function hasModelListForm(body: unknown): boolean {
  return Array.isArray((body as { data?: unknown } | null | undefined)?.data);
}

/** Übersetzt ein Probe-Rohsignal in einen benannten Status + Klartext.
 *  Lesson (vault-crews): bei einer Response ERST die valide API-Form prüfen → "ok";
 *  die Fehler-Klassifikation läuft nur auf dem Nicht-verwertbar-Pfad, nie über eine
 *  legitime Antwort. */
export function classifyEndpointStatus(input: ProbeInput): EndpointStatus {
  if (input.kind === "timeout") {
    return { reachable: false, kind: "timeout", klartext: KLARTEXT["timeout"] };
  }
  if (input.kind === "response") {
    if (input.status === 200 && hasModelListForm(input.body)) {
      return { reachable: true, kind: "ok", klartext: KLARTEXT["ok"] };
    }
    return { reachable: false, kind: "not-an-llm-api", klartext: KLARTEXT["not-an-llm-api"] };
  }
  const m = input.message;
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(m)) {
    return { reachable: false, kind: "refused", klartext: KLARTEXT["refused"] };
  }
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|getaddrinfo/i.test(m)) {
    return { reachable: false, kind: "unknown-host", klartext: KLARTEXT["unknown-host"] };
  }
  if (/ETIMEDOUT|ERR_CONNECTION_TIMED_OUT|timed out/i.test(m)) {
    return { reachable: false, kind: "timeout", klartext: KLARTEXT["timeout"] };
  }
  return { reachable: false, kind: "unknown", klartext: `Nicht erreichbar — ${m}`, raw: m };
}
```

- [ ] **Step 4: Test läuft, grün**

Run: `npm test -- endpoint_diagnostics`
Expected: PASS (alle classify-Tests).

- [ ] **Step 5: Export ergänzen** — in `src/pure/index.ts` nach der `endpoint`-Zeile einfügen:

```ts
export {
  type EndpointStatusKind, type EndpointStatus, type ProbeInput,
  classifyEndpointStatus,
} from "./endpoint_diagnostics";
```

- [ ] **Step 6: Typecheck + Commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/pure/endpoint_diagnostics.ts tests/endpoint_diagnostics.test.ts src/pure/index.ts
git commit -m "feat(endpoint): classifyEndpointStatus — Klartext-Diagnose (4 Klassen + Fallback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: kit — `validateEndpointInput` + `ENDPOINT_PRESETS`

**Repo:** `obsidian-kit`

**Files:**
- Modify: `src/pure/endpoint_diagnostics.ts` (erweitern)
- Modify: `tests/endpoint_diagnostics.test.ts` (erweitern)
- Modify: `src/pure/index.ts` (Exports ergänzen, `KIT_VERSION` bump)

**Interfaces:**
- Consumes: nichts aus Task 1 (dieselbe Datei, additiv).
- Produces: `EndpointPreset`, `ENDPOINT_PRESETS: EndpointPreset[]`, `EndpointWarning`, `validateEndpointInput(url: string): EndpointWarning[]`.

- [ ] **Step 1: Failing tests ergänzen** — ans Ende von `tests/endpoint_diagnostics.test.ts`:

```ts
import { validateEndpointInput, ENDPOINT_PRESETS } from "../src/pure/endpoint_diagnostics";

describe("ENDPOINT_PRESETS", () => {
  it("enthält LM Studio (:1234) und Ollama (:11434) als Base-URLs ohne /v1", () => {
    const byLabel = Object.fromEntries(ENDPOINT_PRESETS.map(p => [p.label, p.url]));
    expect(byLabel["LM Studio"]).toBe("http://localhost:1234");
    expect(byLabel["Ollama"]).toBe("http://localhost:11434");
  });
});

describe("validateEndpointInput", () => {
  it("keine Warnung bei sauberem lokalem Endpoint mit Port", () => {
    expect(validateEndpointInput("http://localhost:1234")).toEqual([]);
  });
  it("keine Warnung bei leerer Eingabe", () => {
    expect(validateEndpointInput("  ")).toEqual([]);
  });
  it("warnt bei fehlendem Schema", () => {
    expect(validateEndpointInput("localhost:1234").map(w => w.rule)).toContain("scheme");
  });
  it("warnt bei lokalem Host ohne Port", () => {
    expect(validateEndpointInput("http://localhost").map(w => w.rule)).toContain("port");
    expect(validateEndpointInput("http://192.168.178.20").map(w => w.rule)).toContain("port");
  });
  it("warnt NICHT bei https-Domain ohne Port (läuft auf 443)", () => {
    expect(validateEndpointInput("https://api.example.com")).toEqual([]);
  });
  it("warnt bei RFC-5737-Platzhalter-IPs und 0.0.0.0", () => {
    expect(validateEndpointInput("http://192.0.2.5:1234").map(w => w.rule)).toContain("placeholder-ip");
    expect(validateEndpointInput("http://198.51.100.1:1234").map(w => w.rule)).toContain("placeholder-ip");
    expect(validateEndpointInput("http://203.0.113.7:1234").map(w => w.rule)).toContain("placeholder-ip");
    expect(validateEndpointInput("http://0.0.0.0:1234").map(w => w.rule)).toContain("placeholder-ip");
  });
});
```

- [ ] **Step 2: Test läuft, schlägt fehl**

Run: `npm test -- endpoint_diagnostics`
Expected: FAIL — `validateEndpointInput`/`ENDPOINT_PRESETS` nicht gefunden.

- [ ] **Step 3: Implementieren** — ans Ende von `src/pure/endpoint_diagnostics.ts` anhängen:

```ts
export interface EndpointPreset { label: string; url: string; }

/** Benannte Ein-Klick-Presets für den Endpunkt-Editor. Base-URLs ohne /v1
 *  (normalizeEndpoint strippt es ohnehin). */
export const ENDPOINT_PRESETS: EndpointPreset[] = [
  { label: "LM Studio", url: "http://localhost:1234" },
  { label: "Ollama", url: "http://localhost:11434" },
];

export interface EndpointWarning { rule: string; message: string; }

const PLACEHOLDER_IP = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];

/** Nicht-blockierende Eingabe-Prüfung: gibt Hinweise, blockiert nie.
 *  Bewusst OHNE Reachability-Raten und OHNE "falsches Subnetz" (das ist der legitime
 *  LAN-Fallback-Fall). */
export function validateEndpointInput(url: string): EndpointWarning[] {
  const warnings: EndpointWarning[] = [];
  const v = url.trim();
  if (!v) return warnings;
  if (!/^https?:\/\//i.test(v)) {
    warnings.push({ rule: "scheme", message: "Adresse braucht http:// oder https://" });
    return warnings;   // ohne Schema lässt sich Host/Port nicht sinnvoll parsen
  }
  let host = "";
  let port = "";
  try {
    const u = new URL(v);
    host = u.hostname;
    port = u.port;
  } catch {
    warnings.push({ rule: "malformed", message: "Adresse ist keine gültige URL" });
    return warnings;
  }
  const isHttp = /^http:\/\//i.test(v);
  const isLocalOrIp = host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isHttp && isLocalOrIp && !port) {
    warnings.push({ rule: "port", message: "Lokale LLM-Server brauchen fast immer einen Port (z. B. :1234)" });
  }
  if (host === "0.0.0.0" || PLACEHOLDER_IP.some(re => re.test(host))) {
    warnings.push({ rule: "placeholder-ip", message: "Sieht aus wie eine Beispiel-/Platzhalter-Adresse" });
  }
  return warnings;
}
```

- [ ] **Step 4: Test läuft, grün**

Run: `npm test -- endpoint_diagnostics`
Expected: PASS (classify + validate + presets).

- [ ] **Step 5: Exports + KIT_VERSION** — in `src/pure/index.ts`: die `endpoint_diagnostics`-Export-Gruppe erweitern und `KIT_VERSION` bumpen:

```ts
export {
  type EndpointStatusKind, type EndpointStatus, type ProbeInput,
  classifyEndpointStatus,
  type EndpointPreset, ENDPOINT_PRESETS,
  type EndpointWarning, validateEndpointInput,
} from "./endpoint_diagnostics";
```

Und `KIT_VERSION` von `"0.4.0"` auf `"0.5.0"` setzen.

- [ ] **Step 6: Typecheck + Lint + Commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

```bash
git add src/pure/endpoint_diagnostics.ts tests/endpoint_diagnostics.test.ts src/pure/index.ts
git commit -m "feat(endpoint): ENDPOINT_PRESETS + validateEndpointInput (kit 0.5.0)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: vault-rag — vendor + `probeEndpoint` in `http.ts`

**Repo:** `vault-rag` (Branch `feat/endpoint-ux`)

**Files:**
- Create: `src/vendor/kit/endpoint_diagnostics.ts` (vendored Kopie)
- Modify: `src/http.ts`
- Create: `tests/http_probe.test.ts`

**Interfaces:**
- Consumes (aus Task 1): `classifyEndpointStatus`, `EndpointStatus`, `ProbeInput`.
- Produces: `probeEndpoint(baseUrl: string, timeoutMs?: number): Promise<EndpointStatus>` (aus `http.ts`).

- [ ] **Step 1: Vendoring** — Inhalt von `../obsidian-kit/src/pure/endpoint_diagnostics.ts` nach `src/vendor/kit/endpoint_diagnostics.ts` kopieren und als erste Zeile voranstellen:

```ts
// vendored from obsidian-kit#0.5.0, src/pure/endpoint_diagnostics.ts
```

- [ ] **Step 2: Failing test** — `tests/http_probe.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { probeEndpoint } from "../src/http";
import { requestUrl } from "obsidian";

afterEach(() => vi.mocked(requestUrl).mockReset());

describe("probeEndpoint", () => {
  it("ok bei 200 + {data:[…]}", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { data: [{ id: "m" }] } } as any);
    const s = await probeEndpoint("http://localhost:1234");
    expect(s.kind).toBe("ok");
    expect(s.reachable).toBe(true);
  });
  it("not-an-llm-api bei 200 + Fremd-Body", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { foo: 1 } } as any);
    expect((await probeEndpoint("http://192.168.178.27:1234")).kind).toBe("not-an-llm-api");
  });
  it("refused bei geworfenem ECONNREFUSED", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
    expect((await probeEndpoint("http://localhost:1243")).kind).toBe("refused");
  });
  it("unknown-host bei ENOTFOUND", async () => {
    vi.mocked(requestUrl).mockRejectedValue(new Error("getaddrinfo ENOTFOUND foo.invalid"));
    expect((await probeEndpoint("http://foo.invalid:1234")).kind).toBe("unknown-host");
  });
  it("timeout wenn requestUrl hängt", async () => {
    vi.mocked(requestUrl).mockImplementation(() => new Promise(() => {}) as any);
    expect((await probeEndpoint("http://192.0.2.1:1234", 20)).kind).toBe("timeout");
  });
});
```

- [ ] **Step 3: Test läuft, schlägt fehl**

Run: `npx vitest run tests/http_probe.test.ts`
Expected: FAIL — `probeEndpoint` nicht exportiert.

- [ ] **Step 4: Implementieren** — in `src/http.ts` ergänzen (nach `httpJson`), Import oben ergänzen:

```ts
import { classifyEndpointStatus, EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
```

```ts
/** Erreichbarkeits-Probe eines Endpunkts (GET <baseUrl>/v1/models) mit Klartext-Diagnose.
 *  baseUrl ist bereits normalisiert. Eigener Timeout via Promise.race, weil requestUrl
 *  weder ein timeout-Feld noch Abort kennt — gewinnt der Timer, läuft der echte Request
 *  im Hintergrund folgenlos weiter (reine Lese-Probe). */
export async function probeEndpoint(baseUrl: string, timeoutMs = 5000): Promise<EndpointStatus> {
  const url = `${baseUrl}/v1/models`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"__timeout__">(resolve => {
    timer = setTimeout(() => resolve("__timeout__"), timeoutMs);
  });
  try {
    const raced = await Promise.race([
      requestUrl({ url, throw: false }).then(r => {
        let body: unknown = undefined;
        try { body = r.json; } catch { /* nicht-JSON → body bleibt undefined */ }
        return { status: r.status, body } as const;
      }),
      timeout,
    ]);
    if (raced === "__timeout__") return classifyEndpointStatus({ kind: "timeout" });
    return classifyEndpointStatus({ kind: "response", status: raced.status, body: raced.body });
  } catch (e) {
    const message = String((e as { message?: string })?.message ?? e);
    return classifyEndpointStatus({ kind: "error", message });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Test läuft, grün**

Run: `npx vitest run tests/http_probe.test.ts`
Expected: PASS (5 Fälle).

- [ ] **Step 6: Volllauf + Commit**

Run: `npm test && npm run typecheck`
Expected: PASS (Gesamtsuite unverändert grün + neue Datei).

```bash
git add src/vendor/kit/endpoint_diagnostics.ts src/http.ts tests/http_probe.test.ts
git commit -m "feat(endpoint): probeEndpoint — Reachability-Probe mit Klartext-Diagnose + Timeout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: vault-rag — `probe()` in `embedder.ts` + `chat_client.ts`

**Repo:** `vault-rag`

**Files:**
- Modify: `src/embedder.ts:11-17` (ping → probe + ping-Wrapper)
- Modify: `src/chat_client.ts:24-26` (ping → probe + ping-Wrapper)
- Modify: `tests/embedder.test.ts` (bestehende ping-Tests an neue Semantik anpassen + probe-Test)
- Modify: `tests/chat_client.test.ts` (dito)

**Interfaces:**
- Consumes (aus Task 3): `probeEndpoint` aus `./http`, `EndpointStatus` aus `./vendor/kit/endpoint_diagnostics`.
- Produces: `EmbeddingClient.probe(): Promise<EndpointStatus>`, `ChatClient.probe(): Promise<EndpointStatus>`; `ping()` bleibt als Boolean-Wrapper erhalten.

**⚠️ Semantik-Bruch (beabsichtigt):** `ping()` gibt bisher `true` bei **jedem** HTTP 200 zurück. Neu: `true` nur bei 200 **plus** `{data:[…]}`-Form. Die bestehenden Tests mocken `ok({})` (= 200, leerer Body) und erwarten `true` — die müssen auf `ok({ data: [] })` umgestellt werden. Das ist genau der Kern der Slice (200 allein reicht nicht).

- [ ] **Step 1: Bestehende ping-Tests anpassen + probe-Test** — in `tests/embedder.test.ts` den `describe("ping")`-Block ersetzen durch:

```ts
  describe("ping", () => {
    it("true bei 200 mit gültiger Modell-Liste", async () => {
      vi.mocked(requestUrl).mockResolvedValue(ok({ data: [] }) as any);
      expect(await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").ping()).toBe(true);
    });
    it("false wenn 200 aber kein OpenAI-Body (Fremd-Server)", async () => {
      vi.mocked(requestUrl).mockResolvedValue(ok({}) as any);
      expect(await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").ping()).toBe(false);
    });
    it("false wenn nicht erreichbar", async () => {
      vi.mocked(requestUrl).mockRejectedValue(new Error("ECONNREFUSED"));
      expect(await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").ping()).toBe(false);
    });
    it("false bei HTTP 500", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 500 } as any);
      expect(await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").ping()).toBe(false);
    });
  });

  describe("probe", () => {
    it("liefert kind=refused mit Klartext bei ECONNREFUSED", async () => {
      vi.mocked(requestUrl).mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
      const s = await new EmbeddingClient("http://localhost:1243", "m").probe();
      expect(s.kind).toBe("refused");
      expect(s.klartext).toContain("Port");
    });
  });
```

- [ ] **Step 2: Test läuft, schlägt fehl**

Run: `npx vitest run tests/embedder.test.ts`
Expected: FAIL — `probe` nicht definiert; „false wenn 200 aber kein OpenAI-Body" schlägt noch fehl.

- [ ] **Step 3: Implementieren** — in `src/embedder.ts` den `ping`-Block (Zeilen 11–17) ersetzen; Import ergänzen:

```ts
import { probeEndpoint } from "./http";
import { EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
```

```ts
  /** Erreichbarkeit + Klartext-Diagnose des Endpunkts. */
  async probe(): Promise<EndpointStatus> {
    return probeEndpoint(this.endpoint);
  }

  async ping(): Promise<boolean> {
    return (await this.probe()).reachable;
  }
```

- [ ] **Step 4: Test läuft, grün**

Run: `npx vitest run tests/embedder.test.ts`
Expected: PASS.

- [ ] **Step 5: Dasselbe für `chat_client.ts`** — den bestehenden `describe("ping")`/ersten Reachability-Block in `tests/chat_client.test.ts` analog anpassen (mit `ChatClient` statt `EmbeddingClient`; falls dort `ok`-Helfer fehlt, `{ status: 200, json: { data: [] } }` inline nutzen). Dann in `src/chat_client.ts` die `ping`-Methode (Zeilen 24–26) ersetzen:

```ts
import { probeEndpoint } from "./http";
import { EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
```

```ts
  async probe(): Promise<EndpointStatus> {
    return probeEndpoint(this.endpoint);
  }

  async ping(): Promise<boolean> {
    return (await this.probe()).reachable;
  }
```

Prüfe zuerst `tests/chat_client.test.ts` auf bestehende ping/200-Annahmen (`ok({})`-Muster) und stelle sie auf `{ data: [] }` um — sonst brechen sie wie bei embedder.

- [ ] **Step 6: Volllauf + Commit**

Run: `npm test && npm run typecheck`
Expected: PASS (gesamte Suite).

```bash
git add src/embedder.ts src/chat_client.ts tests/embedder.test.ts tests/chat_client.test.ts
git commit -m "feat(endpoint): EmbeddingClient/ChatClient.probe() liefert EndpointStatus; ping verschärft (200 braucht /v1/models-Form)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: vault-rag — `settings.ts`-Verdrahtung + Default-Fix + CHANGELOG

**Repo:** `vault-rag`

**Files:**
- Modify: `src/settings.ts` (DEFAULT_SETTINGS:70, `buildEndpointList`:259-316, beide `build*EndpointList`:318-344)
- Modify: `tests/settings.test.ts` (Default-Guard) — falls nicht vorhanden, an bestehende Settings-Testdatei anhängen; sonst neuen `tests/settings_defaults.test.ts` anlegen
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `ENDPOINT_PRESETS`, `validateEndpointInput` aus `./vendor/kit/endpoint_diagnostics`; `EndpointStatus`; `applyEndpointEdit` (bestehend, `settings.ts`).
- Produces: keine neuen exportierten Symbole (nur UI-Verdrahtung + Default-Wert).

**Hinweis Testbarkeit:** Der DOM-Aufbau (`Setting`) ist nicht unit-getestet (bestehendes Muster). Nur der Default-Wert bekommt einen Guard-Test; Tooltip/Warn-Icon/Quick-Add sind Verdrahtung → GUI-Smoke (Task-übergreifende Handover-Note).

- [ ] **Step 1: Default-Guard-Test schreiben** — an die bestehende Settings-Testdatei anhängen (oder `tests/settings_defaults.test.ts` neu):

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("DEFAULT_SETTINGS Endpunkte", () => {
  it("Chat-Default ist LM Studio :1234", () => {
    expect(DEFAULT_SETTINGS.chatEndpoints).toEqual(["http://localhost:1234"]);
  });
  it("Embedding-Default bleibt Ollama :11434", () => {
    expect(DEFAULT_SETTINGS.embeddingEndpoints).toEqual(["http://localhost:11434"]);
  });
});
```

- [ ] **Step 2: Test läuft, schlägt fehl**

Run: `npx vitest run tests/settings_defaults.test.ts` (bzw. die gewählte Datei)
Expected: FAIL — Chat-Default ist noch `http://localhost:8080`.

- [ ] **Step 3: Default-Fix** — `src/settings.ts:70`:

```ts
  chatEndpoints: ["http://localhost:1234"],
```

- [ ] **Step 4: Test grün**

Run: `npx vitest run tests/settings_defaults.test.ts`
Expected: PASS.

- [ ] **Step 5: `buildEndpointList` verdrahten** — in `src/settings.ts`:

**(a)** Import ergänzen:
```ts
import { ENDPOINT_PRESETS, validateEndpointInput } from "./vendor/kit/endpoint_diagnostics";
import { EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
```

**(b)** In `buildEndpointList` den `opts`-Typ von `ping: (ep: string) => Promise<boolean>` auf `probe: (ep: string) => Promise<EndpointStatus>` ändern.

**(c)** Den Status-Block (aktuell Zeilen ~301-313, `opts.ping(ep).then(ok => …)`) ersetzen durch eine `probe`-Variante, die `klartext` als Tooltip nutzt:

```ts
      const ep = value.trim();
      if (!isAdder && ep) {
        setIcon(statusIcon, "loader"); statusIcon.setAttribute("title", "prüfe…");
        void opts.probe(ep).then(status => {
          statusIcon.empty();
          setIcon(statusIcon, status.reachable ? "circle-check" : "circle-x");
          statusIcon.toggleClass("is-ok", status.reachable);
          statusIcon.toggleClass("is-error", !status.reachable);
          const isActive = normalizeEndpoint(ep) === (opts.active() ?? "");
          statusIcon.toggleClass("is-active", isActive);
          statusIcon.setAttribute("title", status.klartext + (isActive ? " · aktiv" : ""));
        });
        // Eingabe-Prüfung: nicht-blockierendes Warn-Icon (WCAG-Form + Tooltip)
        const warnings = validateEndpointInput(ep);
        if (warnings.length) {
          const warnIcon = s.controlEl.createSpan({ cls: "vault-rag-ep-warn" });
          setIcon(warnIcon, "alert-triangle");
          warnIcon.setAttribute("title", warnings.map(w => w.message).join(" · "));
        }
      }
```

**(d)** Quick-Add-Zeile: den finalen `new Setting(...).addButton("Verbindung prüfen")`-Block (Zeile ~315) erweitern, sodass davor je ein Preset-Button steht:

```ts
    const actions = new Setting(opts.containerEl);
    ENDPOINT_PRESETS.forEach(preset => {
      actions.addButton(b => b
        .setButtonText(`+ ${preset.label}`)
        .setTooltip(`${preset.url} hinzufügen`)
        .onClick(() => {
          const cur = opts.get();
          opts.set(applyEndpointEdit(cur, cur.length, preset.url, true));
          void this.plugin.saveSettings()
            .then(() => opts.reconnect())
            .then(() => this.display());
        }));
    });
    actions.addButton(b => b.setButtonText("Verbindung prüfen").onClick(() => this.display()));
```

**(e)** In `buildEmbeddingEndpointList` und `buildChatEndpointList` den `ping:`-Key auf `probe:` umstellen:

```ts
      probe: (ep) => new EmbeddingClient(ep, this.plugin.settings.embeddingModel).probe(),
```
```ts
      probe: (ep) => new ChatClient(ep, this.plugin.settings.chatModel).probe(),
```

- [ ] **Step 6: Typecheck + Volllauf**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS. (Bei Lint-Fund `alert-triangle`/Klassen: bestehende `vault-rag-ep-status`-Muster spiegeln.)

- [ ] **Step 7: CHANGELOG** — unter `## [Unreleased]` in `CHANGELOG.md` ergänzen:

```markdown
### Added
- Endpunkt-Presets: Ein-Klick-Buttons „+ LM Studio" / „+ Ollama" mit korrekten Default-Ports.
- Klartext-Diagnose pro Endpunkt statt nur rot/grün (Verbindung abgelehnt / Hostname unbekannt / Zeitüberschreitung / kein LLM-API).
- Nicht-blockierende Eingabe-Prüfung (fehlendes Schema/Port, Platzhalter-IP).

### Changed
- Chat-Endpunkt-Default auf `http://localhost:1234` (LM Studio) geändert.
```

- [ ] **Step 8: Commit**

```bash
git add src/settings.ts tests/settings_defaults.test.ts CHANGELOG.md
git commit -m "feat(endpoint): Settings-Verdrahtung — Presets, Klartext-Diagnose-Tooltip, Eingabe-Warnungen, Chat-Default :1234

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Nach allen Tasks

1. **Finaler Opus-Whole-Branch-Review** (superpowers:requesting-code-review) über `feat/endpoint-ux` gegen `main`.
2. **GUI-Smoke via Handover-Note** (Memory `handover-note-for-multistep`): Quick-Add beider Presets, Platzhalter-IP-Warnung, Port-fehlt-Warnung, tote LAN-IP `192.168.178.27` → Klartext „kein LLM-API", Port-Tippfehler `:1243` → „Verbindung abgelehnt". Testdaten: die realen kaputten Endpunkte aus dem Slice-Auslöser.
3. Nach grünem Smoke: Merge nach `main` + Release-Entscheidung (separater Schritt).

## Self-Review (erledigt beim Schreiben)

- **Spec-Coverage:** Presets → T2/T5; Diagnose 4 Klassen → T1/T3; Eingabe-Prüfung → T2/T5; Default-Fix → T5; obsidian-kit-Registrierung → T1/T2 + Vendoring T3; `probe`-Umstellung → T4. Alle Spec-Abschnitte haben Tasks.
- **Placeholder:** keine — jeder Code-Step trägt vollständigen Code.
- **Typkonsistenz:** `EndpointStatus`/`ProbeInput`/`classifyEndpointStatus` in T1 definiert, in T3/T4 konsumiert; `probe()` konsistent benannt; `validateEndpointInput`/`ENDPOINT_PRESETS` in T2 definiert, in T5 konsumiert.
