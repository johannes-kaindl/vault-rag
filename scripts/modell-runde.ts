/**
 * Messpunkte der Modell-Runde (Welle 22, 2026-10-14): Pause gegen ein ECHTES Ollama, Vanilla-Chat gegen ein echtes Chat-Modell,
 * search()/Selbstfindung ohne Stub. Fährt gegen eine Zweitinstanz mit dem frisch gebauten Staging-Vault (`npm run fresh-vault`,
 * Index aus dem Schnappschuss). KEIN Smoke: kein Stub, keine Bilanz, nur Messwerte.
 *
 * Regeln der Runde: jede Anfrage geht an genau `--chat-model` (Chat) bzw. `--embedding-model` (Embedding); das Skript bricht ab, wenn
 * die Chat-Zeile des Vaults ein anderes Modell trägt (eine andere ID lädt in LM Studio ein weiteres Modell).
 *
 *   npm run modell-runde -- --port 9420 --chat-model google/gemma-4-e4b --embedding-model qwen3-embedding:8b
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { attachTo, bereiteInstanzVor, pollUntil } from "../../tools/obsidian-cdp/cdp.js";

const PLUGIN_ID = "vault-retrieval";
const arg = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const port = Number(arg("port"));
const CHAT = arg("chat-model") ?? "";
const EMB = arg("embedding-model") ?? "";
if (!Number.isInteger(port) || CHAT === "" || EMB === "") { console.error("--port, --chat-model und --embedding-model sind Pflicht"); exit(2); }

const ollamaPs = (): string => { try { return execFileSync("ollama", ["ps"], { encoding: "utf8" }).trim(); } catch (e) { return `ollama ps: ${String(e)}`; } };
/** POST /v1/embeddings-Zeilen des Ollama-Logs ab `seit` (HH:MM:SS) — Lesen einer Datei, keine Anfrage. Zählt ALLE Sessions. */
function logZaehler(seit: string): number {
  const text = readFileSync(join(homedir(), ".ollama/logs/server.log"), "latin1");
  return text.split("\n").filter((l) => l.includes('POST') && l.includes('"/v1/embeddings"') && (l.match(/- (\d\d:\d\d:\d\d)/)?.[1] ?? "") >= seit).length;
}
const jetzt = (): string => new Date().toTimeString().slice(0, 8);

const main = await attachTo("workspace", port, "vault-rag");
if (!main) { console.error("kein Obsidian-Fenster für vault-rag"); exit(1); }
await bereiteInstanzVor(main, { pluginIds: [PLUGIN_ID], nurVault: "vault-rag", sprache: "en" });
const P = `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`;

// ── Vorbedingung: nur die erlaubten Modelle in den Chat- und Embedding-Zeilen ───────────────────────────────────────────
const zeilen = await main.evaluate<{ chat: string; emb: string; chatUrl: string; embUrl: string; paused: boolean; indexed: number }>(`${P}
  p.setEmbeddingPaused(false);
  return { chat: p.settings.chatEndpoints[0].model, emb: p.settings.embeddingEndpoints[0].model, chatUrl: p.settings.chatEndpoints[0].url, embUrl: p.settings.embeddingEndpoints[0].url, paused: p.embeddingPaused(), indexed: p.index ? p.index.paths.length : 0 };`);
console.log(`Zeilen: Chat ${zeilen.chatUrl} ${zeilen.chat} · Embedding ${zeilen.embUrl} ${zeilen.emb} · Index ${zeilen.indexed} Notizen`);
if (zeilen.chat !== CHAT || zeilen.emb !== EMB) { console.error(`ABBRUCH: die Zeilen tragen nicht ${CHAT} / ${EMB} — eine andere ID würde ein Modell laden.`); exit(2); }

// ── optional: Voll-Reindex mit dem echten Modell (Index aus einem Vault, in dem je ein Stub-Lauf stand, trägt Stub-Vektoren) ──────
if (argv.includes("--neu-indizieren")) {
  const t = jetzt();
  const r = await main.evaluate<{ notes: number }>(`${P} await p.reindexVault(); return { notes: p.index ? p.index.paths.length : 0 };`);
  console.log(`Voll-Reindex mit ${EMB}: ${r.notes} Notizen im Index · Ollama-Log POST /v1/embeddings seit ${t} (alle Sessions): ${logZaehler(t)}`);
}

// ── Punkt 1: Pause gegen echtes Ollama ─────────────────────────────────────────────────────────────────────────────────
console.log("\n== (1) Pause ==");
console.log("ollama ps vorher:\n" + ollamaPs());
const summe = `${P} return p.embedCounter.snapshot().reduce((n, x) => n + x.requests, 0);`;
const z0 = await main.evaluate<number>(summe);
const t0 = jetzt();
const log0 = logZaehler(t0);
const sb = await main.evaluate<{ paused: boolean; text: string }>(`${P}
  app.commands.executeCommandById("vault-retrieval:pause-embedding"); await new Promise(r => setTimeout(r, 500));
  return { paused: p.embeddingPaused(), text: p.statusBarEl ? p.statusBarEl.textContent : "" };`);
console.log(`pausiert=${sb.paused} · Statusleiste „${sb.text}“`);
const api1 = await main.evaluate<unknown>(`${P} return await p.api.search("similarity between vectors");`);
console.log("api.search während der Pause:", JSON.stringify(api1));
await main.evaluate(`${P}
  await p.openHub("search"); await new Promise(r => setTimeout(r, 400));
  const i = document.querySelector(".vault-rag-search-input"); i.value = "cosine similarity of embeddings"; i.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 900));
  await p.openHub("chat"); await new Promise(r => setTimeout(r, 400));
  const ta = document.querySelector(".vault-rag-chat-input"); ta.value = "Wie funktioniert Cosinus-Aehnlichkeit?"; ta.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 1200)); return true;`);
await new Promise((r) => setTimeout(r, 2500));
const z1 = await main.evaluate<number>(summe);
const logWaehrend = logZaehler(t0) - log0;
console.log(`Plugin-Zähler während der Pause: ${z0} → ${z1} (Soll: gleich) · Ollama-Log POST /v1/embeddings aller Sessions im Fenster: ${logWaehrend}`);
console.log("ollama ps nach der Pause:\n" + ollamaPs());
const t1 = jetzt();
const log1 = logZaehler(t1);
await main.evaluate(`${P} app.commands.executeCommandById("vault-retrieval:resume-embedding"); await new Promise(r => setTimeout(r, 400)); return true;`);
const api2 = await main.evaluate<{ ok: boolean; hits?: { path: string; score: number }[]; reason?: string }>(`${P} return await p.api.search("similarity between vectors");`);
const z2 = await main.evaluate<number>(summe);
await new Promise((r) => setTimeout(r, 1500));
console.log(`nach Fortsetzen: api.search ok=${api2.ok} Treffer: ${(api2.hits ?? []).slice(0, 3).map((h) => `${h.path.split("/").pop()} (${h.score.toFixed(2)})`).join(", ") || api2.reason} · Zähler ${z1} → ${z2} (Soll: höher) · Ollama-Log seit Fortsetzen: ${logZaehler(t1) - log1}`);
console.log("ollama ps nach Fortsetzen:\n" + ollamaPs());

// ── Punkt 5: search() semantisch + Selbstfindung ohne Stub ──────────────────────────────────────────────────────────────
console.log("\n== (5) search() und Selbstfindung ohne Stub ==");
const semantisch = await main.evaluate<{ query: string; top: string[] }[]>(`${P}
  const qs = ["similarity between vectors", "how do I connect ideas across notes", "running language models on my own computer"];
  const out = [];
  for (const q of qs) { const r = await p.api.search(q); out.push({ query: q, top: r.ok ? r.hits.slice(0, 3).map(h => h.path.split("/").pop() + " " + h.score.toFixed(2)) : ["reason=" + r.reason] }); }
  return out;`);
for (const s of semantisch) console.log(`  „${s.query}“ → ${s.top.join(" · ")}`);
await main.evaluate(`${P}
  window.__selfFind = null;
  (async () => {
    const strip = (t) => t.replace(/^---\\s*\\n[\\s\\S]*?\\n---\\s*\\n/, "").trim();
    const cands = [];
    for (const f of app.vault.getMarkdownFiles()) {
      if (cands.length >= 6) break;
      let body; try { body = strip(await app.vault.cachedRead(f)); } catch { continue; }
      if (body.length <= 200 || body.length > 800) continue;
      const r = await p.api.related(f.path); if (!r.ok && r.reason === "not-indexed") continue;
      cands.push({ path: f.path, query: body.slice(0, 300) });
    }
    const tried = [];
    for (const c of cands) { const res = await p.api.search(c.query); if (!res.ok) continue; const hits = res.hits ?? []; tried.push({ path: c.path, rank: hits.findIndex(h => h.path === c.path), top: hits[0] ? hits[0].path : null }); }
    window.__selfFind = { tried };
  })().catch(e => { window.__selfFind = { tried: [], error: String(e) }; });
  return true;`);
const sf = await pollUntil<{ tried: { path: string; rank: number; top: string | null }[]; error?: string }>(main, "return window.__selfFind;", 240_000, 2_000);
if (!sf || sf.error) console.log("Selbstfindung: " + (sf?.error ?? "keine Antwort in 240 s"));
else console.log(`Selbstfindung: ${sf.tried.filter((t) => t.rank === 0).length}/${sf.tried.length} auf Rang 0 · ${sf.tried.map((t) => `${t.path.split("/").pop()}: Rang ${t.rank}`).join(" · ")}`);

// ── Punkt 2: Vanilla gegen das Chat-Modell ─────────────────────────────────────────────────────────────────────────────
console.log("\n== (2) Vanilla: Kontext-Notizen = Aus ==");
await main.evaluate(`
  window.__bodies = []; window.__send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) { try { const j = JSON.parse(String(body)); if (j && Array.isArray(j.messages)) window.__bodies.push(j); } catch {} return window.__send.apply(this, arguments); };
  return true;`);
try {
  const z3 = await main.evaluate<number>(summe);
  await main.evaluate(`${P}
    await p.openHub("chat"); await new Promise(r => setTimeout(r, 500));
    document.querySelector(".vault-rag-chat-new")?.click();
    for (let i = 0; i < 12; i++) document.querySelector(".vault-rag-ctx-kdec")?.click();
    await new Promise(r => setTimeout(r, 300));
    const ta = document.querySelector(".vault-rag-chat-input"); ta.value = "Antworte in einem Satz: Worauf stuetzt du dich bei deinen Antworten?";
    ta.dispatchEvent(new Event("input", { bubbles: true })); await new Promise(r => setTimeout(r, 1200));
    window.__tp = { seen: 0, ticks: 0, reasoningSeen: false };
    window.__tpTimer = setInterval(() => {
      window.__tp.ticks++;
      const a = document.querySelector(".vault-rag-chat-msg.is-assistant");
      if (a && /Thinking Process|<channel\\|>/.test(a.textContent)) window.__tp.seen++;
      if (document.querySelector(".vault-rag-chat-messages .okit-stream-reasoning pre")?.textContent?.trim()) window.__tp.reasoningSeen = true;
    }, 40);
    document.querySelector(".vault-rag-chat-send").click(); return true;`);
  const antwort = await pollUntil<{ text: string; k: string; sendLabel: string }>(main, `
    const a = document.querySelector(".vault-rag-chat-msg.is-assistant");
    const send = document.querySelector(".vault-rag-chat-send");
    if (!a || !a.textContent.trim() || (send && send.textContent.trim() !== "Send")) return null;
    return { text: a.textContent.trim(), k: document.querySelector(".vault-rag-ctx-kval")?.textContent ?? "", sendLabel: send ? send.textContent : "" };`, 240_000, 2_000);
  const bodies = await main.evaluate<{ model: string; system: string; n: number }[]>(`return window.__bodies.map(b => ({ model: b.model, system: (b.messages.find(m => m.role === "system") || {}).content || "", n: b.messages.length }));`);
  const z4 = await main.evaluate<number>(summe);
  const tp = await main.evaluate<{ seen: number; ticks: number; reasoningSeen: boolean }>(`clearInterval(window.__tpTimer); return window.__tp;`);
  console.log(`Denktext im ANGEZEIGTEN Antworttext während des Streams: ${tp.seen} von ${tp.ticks} Messungen (alle 40 ms) · Denkblock zeigt Text: ${tp.reasoningSeen} · „Thinking Process“/<channel|> in der fertigen Antwort: ${/Thinking Process|<channel\|>/.test(antwort?.text ?? "")}`);
  console.log(`Auto-Anzeige: „${antwort?.k}“ · Anfragen an den Chat-Endpunkt: ${bodies.length} (Modell: ${[...new Set(bodies.map((b) => b.model))].join(", ")})`);
  console.log(`System-Prompt gesendet: „${bodies[0]?.system.slice(0, 200)}“`);
  console.log(`Embedding-Anfragen während des Chats (Plugin-Zähler): ${z3} → ${z4}`);
  console.log(`Antwort (${antwort?.text.length ?? 0} Zeichen): ${antwort?.text.slice(0, 900) ?? "KEINE"}`);
} finally {
  await main.evaluate(`XMLHttpRequest.prototype.send = window.__send; document.querySelector(".vault-rag-chat-new")?.click(); return true;`).catch(() => undefined);
  await main.evaluate(`${P} p.setEmbeddingPaused(true); await p.pendingQueue.clear(); return true;`).catch(() => undefined);
}
console.log("\nfertig. ollama ps:\n" + ollamaPs());
main.close();
