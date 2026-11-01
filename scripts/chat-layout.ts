/**
 * Layout-Messung des Chats am Handy (Welle 29, Kit 0.74.0): Mobil-Emulation 390 × 844 (Faktor 2) mit und ohne die Höhe einer iOS-Tastatur (844 − 336 = 508),
 * Standardtheme hell und dunkel, Bild und Maße je Zustand. Muster ist `settings-assistant/scripts/chat-layout.ts`. Gemessen wird GEOMETRISCH (Rechtecke), nie aus der
 * Reihenfolge im DOM: die Modellzeile steht im DOM nach der Eingabe, das CSS stellt sie davor oder daneben.
 *
 * Das Skript hängt sich an eine LAUFENDE Zweitinstanz mit dem Staging-Vault `vault-rag` (Vault und Profil wie im Smoke-Rezept, `docs/SMOKE.md`; `npm run build` und
 * `npm run fresh-vault -- --port <p>` vorher). Es setzt selbst die Stub-Lage (Chat und Embedding auf den zentralen Stub, Zeile 1 beider Listen), stellt sie danach zurück
 * und schaltet die Mobil-Emulation wieder ab.
 *
 * ```bash
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label vault-rag --intent "chat-layout <tag>" --exclusive focus --port <PORT> --ttl 300 --warten 540
 * npm run chat-layout -- --port <PORT> --tag nachher [--out /tmp/vr-w29]
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py release --port <PORT>
 * ```
 *
 * Grenze: die Emulation verkleinert den Viewport um die Tastaturhöhe; sie ersetzt weder das Verhalten von WKWebView noch die Schublade von Obsidian Mobile am Gerät.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

import { Cdp, attachTo, bereiteInstanzVor, pollUntil, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
import { startLlmStub, type LlmStub } from "../../tools/obsidian-cdp/llm-stub.js";
import { capture } from "../../tools/obsidian-cdp/shot.js";

const STAGING_VAULT = "vault-rag";
const PLUGIN_ID = "vault-retrieval";
const BREITE = 390;
const HOEHE = 844;
/** iOS-Tastatur mit Vorschlagsleiste, iPhone 6,1 Zoll, hochkant. */
const TASTATUR = 336;
const q = (s: string): string => JSON.stringify(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ANTWORT = [
  "Die Notiz **Chunking strategies** erklärt, wie lange Notizen in Abschnitte zerlegt werden, und **Vector embeddings** beschreibt die Ähnlichkeit zweier Vektoren.",
  "",
  "- Abschnitte von etwa 500 Zeichen",
  "- Kosinus-Ähnlichkeit als Maß",
  "",
  "Mehr steht in den beiden Quellen unter dieser Antwort.",
].join("\n");

interface Box { x: number; y: number; w: number; h: number; bottom: number; right: number }
interface Messung {
  zustand: string;
  viewport: [number, number];
  isMobile: boolean;
  teile: Record<string, Box | null>;
  /** Paare von Teilen, deren Rechtecke sich überdecken (mehr als 1 px in beide Richtungen). */
  ueberdeckungen: string[];
  /** Tippflächen in px (Breite × Höhe), Soll mobil mindestens 44 × 44. */
  tippflaechen: Record<string, [number, number] | null>;
  zeilen: { logZeilen: number; zeilenhoehe: number; logHoehe: number };
  abstandUnten: number;
  reihenfolgeVonOben: string[];
  zustandszeile: string;
  modellzeileSichtbar: boolean | null;
}

const MESS_JS = `
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); if (b.width === 0 && b.height === 0) return null;
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1), right: +b.right.toFixed(1) }; };
  const root = document.querySelector(".okit-chat.vault-rag-chat");
  const f = (sel) => root ? root.querySelector(sel) : null;
  const teile = {
    chat: box(root), verlauf: box(f(".okit-chat-log")), kontext: box(f(".vault-rag-chat-context")), eingabe: box(f(".okit-chat-input")),
    knopfreihe: box(f(".okit-chat-buttons-start") || f(".okit-chat-buttons")), neu: box(f(".okit-chat-new")), verlaufKnopf: box(f(".okit-chat-archive")), senden: box(f(".okit-chat-send")),
    modellzeile: box(f(".okit-model-bar")), dropdown: box(f(".okit-model-bar-select")), denkstufe: box(f(".okit-thinking-control")), neuLaden: box(f(".okit-model-bar-refresh")),
    zustandszeile: box(f(".okit-chat-statusbar")), quellen: box(f(".vault-rag-chat-sources")),
  };
  const nachRect = (b) => b ? [b.w, b.h] : null;
  const log = f(".okit-chat-log");
  const body = f(".okit-stream-body") || log;
  const cs = body ? getComputedStyle(body) : null;
  let lh = cs ? parseFloat(cs.lineHeight) : NaN; if (!Number.isFinite(lh)) lh = cs ? parseFloat(cs.fontSize) * 1.5 : 20;
  const namen = Object.keys(teile).filter((k) => !["chat", "verlauf", "knopfreihe"].includes(k) && teile[k]);
  const ue = [];
  for (let i = 0; i < namen.length; i++) for (let j = i + 1; j < namen.length; j++) {
    const a = teile[namen[i]], b = teile[namen[j]];
    const dx = Math.min(a.right, b.right) - Math.max(a.x, b.x), dy = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
    const innen = (x, y) => x.x >= y.x - 1 && x.right <= y.right + 1 && x.y >= y.y - 1 && x.bottom <= y.bottom + 1;
    if (dx > 1 && dy > 1 && !innen(a, b) && !innen(b, a)) ue.push(namen[i] + " × " + namen[j] + " (" + dx.toFixed(0) + "×" + dy.toFixed(0) + " px)");
  }
  const unten = Object.entries(teile).filter(([k, b]) => b && k !== "chat" && k !== "verlauf").map(([, b]) => b.bottom);
  const tiefster = unten.length ? Math.max(...unten) : 0;
  const mb = f(".okit-model-bar");
  return {
    viewport: [innerWidth, innerHeight], isMobile: document.body.classList.contains("is-mobile"),
    teile, ueberdeckungen: ue,
    tippflaechen: { neu: nachRect(teile.neu), verlaufKnopf: nachRect(teile.verlaufKnopf), senden: nachRect(teile.senden), neuLaden: nachRect(teile.neuLaden) },
    zeilen: { logZeilen: teile.verlauf ? +(teile.verlauf.h / lh).toFixed(1) : 0, zeilenhoehe: +lh.toFixed(2), logHoehe: teile.verlauf ? teile.verlauf.h : 0 },
    abstandUnten: +(innerHeight - tiefster).toFixed(1),
    reihenfolgeVonOben: Object.entries(teile).filter(([k, b]) => b && !["chat", "verlauf", "knopfreihe"].includes(k)).sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x).map(([k, b]) => k + "@" + Math.round(b.y)),
    zustandszeile: (f(".okit-chat-status")?.textContent || "").trim(),
    modellzeileSichtbar: mb ? getComputedStyle(mb).visibility !== "hidden" : null,
  };
`;

async function messe(cdp: Cdp, zustand: string): Promise<Messung> {
  const m = await cdp.evaluate<Omit<Messung, "zustand">>(MESS_JS);
  return { zustand, ...m };
}

function kurz(m: Messung): string {
  const b = (x: Box | null): string => (x ? `${x.y}–${x.bottom} (${x.w}×${x.h})` : "—");
  const t = m.teile;
  return [
    `${m.zustand}: Viewport ${m.viewport.join("×")} mobil ${String(m.isMobile)}`,
    `  Antwortbereich ${m.zeilen.logHoehe} px = ${m.zeilen.logZeilen} Zeilen à ${m.zeilen.zeilenhoehe} px · Abstand tiefstes Element zum unteren Rand ${m.abstandUnten} px`,
    `  Tippflächen (B×H): ${Object.entries(m.tippflaechen).map(([k, v]) => `${k} ${v ? v.join("×") : "—"}`).join(" · ")}`,
    `  Überdeckungen: ${m.ueberdeckungen.length === 0 ? "keine" : m.ueberdeckungen.join("; ")}`,
    `  Kontext ${b(t.kontext)} · Eingabe ${b(t.eingabe)} · Knopfreihe ${b(t.knopfreihe)} · Senden ${b(t.senden)} · Modellzeile ${b(t.modellzeile)} (${m.modellzeileSichtbar === null ? "—" : m.modellzeileSichtbar ? "sichtbar" : "ausgeblendet"}) · Dropdown ${b(t.dropdown)} · Zustandszeile „${m.zustandszeile}“ ${b(t.zustandszeile)}`,
    `  Reihenfolge von oben: ${m.reihenfolgeVonOben.join(" > ")}`,
  ].join("\n");
}

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function stubLage(cdp: Cdp, stub: LlmStub): Promise<unknown> {
  return cdp.evaluate(`
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    const gesichert = { emb: JSON.parse(JSON.stringify(p.settings.embeddingEndpoints)), chat: JSON.parse(JSON.stringify(p.settings.chatEndpoints)), keep: p.settings.chatKeep };
    if (p.settings.embeddingEndpoints[0]) p.settings.embeddingEndpoints[0].url = ${q(stub.url)};
    if (p.settings.chatEndpoints[0]) p.settings.chatEndpoints[0].url = ${q(stub.url)};
    await p.saveSettings(); await p.resolveAndReconnectChat(); await p.resolveAndReconnectEmbedder(); p.setEmbeddingPaused(false);
    return gesichert;`);
}

async function main(): Promise<void> {
  const port = Number(flag("--port"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port <1024-65535> ist Pflicht (9222 gehoert der regulaeren Instanz).");
  const tag = flag("--tag") ?? "lauf";
  const out = flag("--out") ?? "/tmp/vr-w29";
  mkdirSync(out, { recursive: true });

  let cdp: Cdp | null = await attachTo("workspace", port, STAGING_VAULT);
  if (!cdp) throw new Error(`Kein Obsidian-Fenster fuer Vault "${STAGING_VAULT}" auf Port ${port}`);
  await requireVisible(cdp);
  await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: STAGING_VAULT, sprache: "en" });
  const messungen: Messung[] = [];
  let gesichert: { emb: unknown; chat: unknown; keep: number } | null = null;
  // Der Vektor des Stubs: der gespeicherte Vektor einer indexierten Notiz, sonst fände die Kontextsuche keine Chips.
  const vektor = await cdp.evaluate<number[] | null>(`
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    const f = p.index ? app.vault.getMarkdownFiles().find((x) => p.index.vectorFor(x.path)) : null;
    return f ? Array.from(p.index.vectorFor(f.path)) : null;`);
  const stub = await startLlmStub({ models: ["fake-model"], embeddings: { vektor: vektor ?? Array.from({ length: 256 }, () => 0.0625) }, lmStudioV1: true, antwort: () => ANTWORT });
  try {
    gesichert = (await stubLage(cdp, stub)) as { emb: unknown; chat: unknown; keep: number };
    // Mobil-Emulation: laedt Obsidian neu (der Aufruf endet mit „Execution context was destroyed“), danach neu anhaengen.
    await cdp.evaluate(`app.emulateMobile(true); return true;`).catch(() => undefined);
    try { cdp.close(); } catch { /* Kontext schon weg */ }
    await sleep(4000);
    const neu = await attachTo("workspace", port, STAGING_VAULT);
    if (!neu) throw new Error("nach dem Neuladen kein Fenster");
    cdp = neu;
    await requireVisible(cdp);
    await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: STAGING_VAULT, sprache: "en" });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: BREITE, height: HOEHE, deviceScaleFactor: 2, mobile: true });
    await sleep(1200);
    if (!(await cdp.evaluate<boolean>(`return document.body.classList.contains("is-mobile");`))) throw new Error("is-mobile nach emulateMobile(true) nicht gesetzt");

    // Chat öffnen, eine Frage stellen (Chips entstehen beim Tippen), die Antwort abwarten.
    await cdp.evaluate(`const p = app.plugins.plugins[${q(PLUGIN_ID)}]; await p.openHub("chat"); await new Promise(r => setTimeout(r, 1200)); return true;`);
    const da = await cdp.evaluate<boolean>(`for (let i = 0; i < 40 && !document.querySelector(".okit-chat-input"); i++) await new Promise((r) => setTimeout(r, 250)); return !!document.querySelector(".okit-chat-input");`);
    if (!da) throw new Error("Chat-Ansicht oeffnet sich nicht");
    await cdp.evaluate(`const ta = document.querySelector(".okit-chat-input"); ta.value = "Welche Notiz erklaert Chunking und Kosinus-Aehnlichkeit?"; ta.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
    const chips = await pollUntil<number>(cdp, `const n = document.querySelectorAll(".vault-rag-ctx-chip").length; return n > 0 ? n : null;`, 20_000, 250).catch(() => 0);
    if (!chips) console.log("WARNUNG: keine Kontext-Chips entstanden");
    await cdp.evaluate(`document.querySelector(".okit-chat-send").click(); return true;`);
    const fertig = await pollUntil<boolean>(cdp, `
      const s = document.querySelector(".okit-chat-status");
      return document.querySelector(".vault-rag-chat .okit-chat-turn.is-assistant .okit-stream-body") && s && s.textContent.trim().toLowerCase() === "done" ? true : null;`, 60_000, 300).catch(() => false);
    await sleep(800);
    if (!fertig) console.log("WARNUNG: die Antwort wurde nicht fertig");
    if (!(await cdp.evaluate<boolean>(`return !!document.querySelector(".vault-rag-chat-sources");`))) console.log("WARNUNG: keine Quellen unter der Antwort");

    for (const [schema, name] of [["moonstone", "hell"], ["obsidian", "dunkel"]] as const) {
      await cdp.evaluate(`app.vault.setConfig("theme", ${q(schema)}); app.updateTheme(); app.workspace.trigger("css-change"); await new Promise((r) => setTimeout(r, 600)); return true;`);
      for (const mitTastatur of [false, true]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: BREITE, height: mitTastatur ? HOEHE - TASTATUR : HOEHE, deviceScaleFactor: 2, mobile: true });
        await cdp.evaluate(mitTastatur ? `document.querySelector(".okit-chat-input")?.focus(); return true;` : `document.activeElement?.blur?.(); return true;`);
        await sleep(900);
        const zustand = `${tag}-${name}-${mitTastatur ? "tastatur" : "ohne"}`;
        const m = await messe(cdp, zustand);
        messungen.push(m);
        console.log(kurz(m));
        const pfad = join(out, `${zustand}.png`);
        writeFileSync(pfad, await capture(cdp, undefined, 1));
        console.log(`  Bild ${pfad}`);
      }
    }
    writeFileSync(join(out, `${tag}-messung.json`), JSON.stringify(messungen, null, 2));
  } finally {
    if (cdp) {
      await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
      await cdp.evaluate(`
        const p = app.plugins.plugins[${q(PLUGIN_ID)}];
        ${gesichert ? `p.settings.embeddingEndpoints = ${JSON.stringify(gesichert.emb)}; p.settings.chatEndpoints = ${JSON.stringify(gesichert.chat)}; p.settings.chatKeep = ${gesichert.keep}; await p.saveSettings();` : ""}
        app.vault.setConfig("theme", "moonstone"); app.emulateMobile(false); return true;`).catch(() => undefined);
      await sleep(1500);
      cdp.close();
    }
    await stub.stop().catch(() => undefined);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
