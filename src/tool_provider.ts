import { getLang, setLang, t } from "./vendor/kit/i18n";
import type { ApiHit, ApiOverrides, ApiResult } from "./plugin_api";

/** Werkzeug-Anbieter (Branch feat/tool-provider): vault-rag beschreibt seine Fähigkeiten als
 *  LLM-Werkzeuge, ein Wirt (koda-agent) montiert sie, statt sie nachzubauen. Form:
 *  OpenAI-Function-Calling (`name`/`description`/`parameters` als JSON-Schema). Obsidian-frei.
 *
 *  Festlegungen mit dem Wirt (2026-09-25): der Name ist Wire-Identität, der Wirt benennt nie um
 *  (Eindeutigkeit je Anbieter garantiert dieses Modul); `content`/`message` sind der Text, den das
 *  Modell sieht — die Sätze wohnen hier und sind i18n; ein schreibendes Werkzeug ruft `confirm`
 *  mit einer nebenwirkungsfreien Vorschau und endet ohne `confirm` oder bei `false` mit
 *  `needs-confirm`. `applyLink` ist noch kein Werkzeug: nur die Signatur und der Test stehen. */

export type ToolLang = "de" | "en";

export interface ToolSchemaProperty {
  type: "string" | "integer";
  description: string;
  minimum?: number;
  maximum?: number;
}
export interface ToolObjectSchema {
  type: "object";
  properties: Record<string, ToolSchemaProperty>;
  required: string[];
}
export interface ApiToolDefinition {
  name: string;
  description: string;
  parameters: ToolObjectSchema;
  writes: boolean;
}

/** `paths` ist die vollständige Obergrenze der Schreibwirkung im Vault, `outside` nennt Wirkungen außerhalb. */
export interface ToolConfirmPreview { summary: string; paths: string[]; outside?: string[] }
export interface ToolCallOptions {
  lang?: ToolLang;
  /** Pflicht für jedes `writes:true`-Werkzeug. Ohne sie oder bei `false`: `needs-confirm`. */
  confirm?: (preview: ToolConfirmPreview) => Promise<boolean>;
}
export interface ToolsOptions { lang?: ToolLang }

/** `content`/`message` sind Text für das Modell in der gewählten Sprache. `data` ist für die
 *  Oberfläche des Wirts (Quellen-Chips), nicht für das Modell. */
export type ApiToolResult =
  | { ok: true; content: string; data?: unknown }
  | { ok: false; reason: "unknown-tool"; message: string }
  | { ok: false; reason: "bad-args"; field: string; message: string }
  | { ok: false; reason: "failed"; message: string }
  | { ok: false; reason: "needs-confirm"; message: string }
  /** Anbieter geladen, Voraussetzung fehlt: `detail` nennt sie (`no-index`, `offline`). */
  | { ok: false; reason: "unavailable"; detail: "no-index" | "offline" | "paused"; message: string }
  | { ok: false; reason: "not-indexed"; path: string; message: string };

/** Gleiche Obergrenze wie der Slider `k` in den Einstellungen. */
const K_MAX = 50;

export interface ToolTarget {
  search(query: string, opts?: ApiOverrides): Promise<ApiResult>;
  related(path: string, opts?: ApiOverrides): Promise<ApiResult>;
}

/** Ein Werkzeug: Definition, Argumentprüfung, Ausführung. Die Registry unten ist die EINZIGE
 *  Stelle, an der Namen entstehen — dadurch ist Eindeutigkeit prüfbar (Test). */
interface ToolImpl {
  name: string;
  writes: boolean;
  define(): Omit<ApiToolDefinition, "name" | "writes">;
  /** null = Argumente ok, sonst das fehlerhafte Feld. */
  check(args: Record<string, unknown>): string | null;
  /** Nebenwirkungsfreie Vorschau — nur für `writes:true`. */
  preview?(args: Record<string, unknown>): ToolConfirmPreview;
  /** Rechnet OHNE Text zu formulieren (die Sprache darf sich über ein await nicht ändern). */
  run(args: Record<string, unknown>, target: ToolTarget): Promise<ApiResult>;
  /** Formuliert das Ergebnis synchron — nur hier wird `t()` aufgerufen. */
  render(r: ApiResult, args: Record<string, unknown>): ApiToolResult;
}

const score = (n: number): string => n.toFixed(2);

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function hitLines(hits: ApiHit[]): string {
  return hits.map(h => `${h.path} (${score(h.score)})`).join("\n");
}

/** Erwartbare Zustände der Quelle → Text fürs Modell (die Sätze aus koda-agents
 *  `formatRelatedResult`, dort deutsch hartkodiert, hier übersetzt). */
function failure(r: Exclude<ApiResult, { ok: true }>): ApiToolResult {
  switch (r.reason) {
    case "no-index": return { ok: false, reason: "unavailable", detail: "no-index", message: t("tools.msg.noIndex") };
    case "offline": return { ok: false, reason: "unavailable", detail: "offline", message: t("tools.msg.offline") };
    case "paused": return { ok: false, reason: "unavailable", detail: "paused", message: t("tools.msg.paused") };
    case "not-indexed": return { ok: false, reason: "not-indexed", path: r.path, message: t("tools.msg.notIndexed", r.path) };
  }
}

const SEARCH: ToolImpl = {
  name: "semantic_search",   // i18n-exempt: Werkzeug-Kennung im Protokoll, kein Anzeigetext
  writes: false,
  define() {
    return {
      description: t("tools.search.description"),
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: t("tools.search.query") },
          k: { type: "integer", description: t("tools.search.k"), minimum: 1, maximum: K_MAX },
        },
        required: ["query"],
      },
    };
  },
  check(args) {
    if (!nonEmptyString(args.query)) return "query";
    if (args.k !== undefined && (typeof args.k !== "number" || !Number.isInteger(args.k) || args.k < 1 || args.k > K_MAX)) return "k";
    return null;
  },
  run: (args, target) => target.search(args.query as string, args.k === undefined ? undefined : { k: args.k as number }),
  render(r) {
    if (!r.ok) return failure(r);
    if (r.hits.length === 0) return { ok: true, content: t("tools.search.none"), data: { hits: r.hits } };
    return { ok: true, content: `${t("tools.search.head")}\n${hitLines(r.hits)}`, data: { hits: r.hits } };
  },
};

const RELATED: ToolImpl = {
  name: "related_notes",   // i18n-exempt: Werkzeug-Kennung im Protokoll, kein Anzeigetext
  writes: false,
  define() {
    return {
      description: t("tools.related.description"),
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: t("tools.related.path") } },
        required: ["path"],
      },
    };
  },
  check: (args) => (nonEmptyString(args.path) ? null : "path"),
  run: (args, target) => target.related(args.path as string),
  render(r, args) {
    const path = args.path as string;
    if (!r.ok) return failure(r);
    if (r.hits.length === 0) return { ok: true, content: t("tools.related.none", path), data: { hits: r.hits } };
    return { ok: true, content: `${t("tools.related.head", path)}\n${hitLines(r.hits)}`, data: { hits: r.hits } };
  },
};

export const TOOL_REGISTRY: readonly ToolImpl[] = [SEARCH, RELATED];

/** Führt `fn` in der gewünschten Sprache aus und stellt danach die Oberflächensprache wieder
 *  her. `fn` ist synchron — nur dann ist der Wechsel des globalen Sprachstands sicher. */
function inLang<T>(lang: ToolLang | undefined, fn: () => T): T {
  if (!lang) return fn();
  const before = getLang();
  setLang(lang);
  try { return fn(); } finally { setLang(before); }
}

export function toolDefinitions(opts?: ToolsOptions, registry: readonly ToolImpl[] = TOOL_REGISTRY): ApiToolDefinition[] {
  return inLang(opts?.lang, () => registry.map(i => ({ name: i.name, writes: i.writes, ...i.define() })));
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** Führt ein Werkzeug aus. Wirft nie. Gelesen werden nur die im Schema genannten Felder — auch
 *  ein `exclude`, das ein Modell mitschicken könnte, erreicht die Quelle nicht (Nutzergrenze).
 *  Text entsteht ausschließlich synchron in `inLang`: die Sprache wird nie über ein await hinweg
 *  umgestellt, sonst sähe die Oberfläche währenddessen die Werkzeugsprache. */
export async function runTool(
  name: string, args: unknown, target: ToolTarget, opts?: ToolCallOptions,
  registry: readonly ToolImpl[] = TOOL_REGISTRY,
): Promise<ApiToolResult> {
  const lang = opts?.lang;
  try {
    const impl = registry.find(i => i.name === name);
    if (!impl) return inLang(lang, () => ({ ok: false, reason: "unknown-tool", message: t("tools.msg.unknownTool", name) }));
    const a = isRecord(args) ? args : {};
    // Kein Objekt (null, Text, Liste): das erste Pflichtfeld ist das, was fehlt.
    const bad = isRecord(args) ? impl.check(a) : (impl.define().parameters.required[0] ?? "args");
    if (bad !== null) return inLang(lang, () => ({ ok: false, reason: "bad-args", field: bad, message: t("tools.msg.badArgs", bad) }));
    if (impl.writes) {
      const denied = (): ApiToolResult => inLang(lang, () => ({ ok: false, reason: "needs-confirm", message: t("tools.msg.needsConfirm") }));
      if (!opts?.confirm || !impl.preview) return denied();
      if ((await opts.confirm(impl.preview(a))) !== true) return denied();
    }
    const raw = await impl.run(a, target);
    return inLang(lang, () => impl.render(raw, a));
  } catch {
    return inLang(lang, () => ({ ok: false, reason: "failed", message: t("tools.msg.failed") }));
  }
}
