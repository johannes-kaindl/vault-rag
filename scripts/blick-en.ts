/**
 * Layout-Blick auf die englische Oberfläche (Task „Oberfläche einmal auf Englisch ansehen“, Welle 34): Aufnahmen und Maße
 * der Einstellungen (mit den Endpunkt-Zeilen und dem Diagnose-Text bei falschem Endpunkt) und der fünf Hub-Tabs, damit jemand
 * die Bilder ansieht. Kein Smoke: es gibt keinen Soll-Wert, der Treiber zählt Überlauf und schreibt Bilder; die Bewertung ist
 * Sache des Blicks. Läuft gegen eine Zweitinstanz mit `--lang=en-US` (Rezept: `tools/obsidian-cdp/messlauf.sh` mit
 * `RUNNER=blick:en`, Port und Lock wie im Dach), nie gegen die reguläre Instanz.
 *
 *   npm run blick:en -- --port <p> --bilder <ordner>
 *
 * Ein Wert, der „Überlauf“ heißt, ist ein Element, dessen Inhalt breiter ist als es selbst (`scrollWidth > clientWidth + 1`) und das
 * den Überlauf nicht verbirgt, oder dessen Text mit „…“ gekürzt wird. Die Liste ist ein Hinweis, kein Urteil: ein Tab-Streifen darf
 * absichtlich scrollen.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { attachTo, bereiteInstanzVor, schliesseEinstellungen, type Cdp } from "../../tools/obsidian-cdp/cdp.js";
import { parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { boxOf, capture, setWindowSize } from "../../tools/obsidian-cdp/shot.js";

const PLUGIN_ID = "vault-retrieval";
const STAGING_VAULT = "vault-rag";
const TABS = ["related", "search", "chat", "smart-apply", "reformat"] as const;

interface UeberlaufTreffer { sel: string; text: string; scrollW: number; clientW: number; gekuerzt: boolean }

/** Misst im Teilbaum `wurzel` die Elemente mit verstecktem oder sichtbarem Überlauf; läuft im Fenster von `cdp`. */
async function ueberlauf(cdp: Cdp, wurzel: string): Promise<UeberlaufTreffer[]> {
  return cdp.evaluate<UeberlaufTreffer[]>(`
    const root = document.querySelector(${JSON.stringify(wurzel)});
    if (!root) return [];
    const out = [];
    for (const el of root.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || el.clientWidth === 0) continue;
      const ueber = el.scrollWidth > el.clientWidth + 1;
      const gekuerzt = cs.textOverflow === "ellipsis" && ueber;
      if (!ueber) continue;
      // Ein Scroll-Streifen (overflow-x: auto/scroll) ist gewollt; gemeldet wird nur, was abgeschnitten oder herausragend ist.
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
      out.push({ sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".") : ""), text: (el.textContent || "").trim().slice(0, 60), scrollW: el.scrollWidth, clientW: el.clientWidth, gekuerzt });
    }
    return out.slice(0, 40);
  `);
}

/** Schließt alle Hinweise (Notices), damit keiner die Tab-Leiste oder eine Zeile im Bild verdeckt; wartet danach kurz auf den nächsten Frame. */
async function schliesseHinweise(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`document.querySelectorAll(".notice").forEach((n) => n.remove()); await new Promise((r) => setTimeout(r, 300)); return true;`);
}

async function speichere(ordner: string, name: string, png: Buffer): Promise<void> {
  writeFileSync(join(ordner, name), png);
  console.log(`  Bild ${name} (${png.length} Bytes)`);
}

async function haupt(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.value("port"));
  const bilder = args.value("bilder");
  if (!Number.isInteger(port) || port < 1024) throw new Error("--port <Zahl> fehlt (Port der eigenen Zweitinstanz).");
  if (!bilder) throw new Error("--bilder <ordner> fehlt.");
  mkdirSync(bilder, { recursive: true });

  const main = await attachTo("workspace", port, STAGING_VAULT);
  if (!main) throw new Error(`Kein Obsidian-Hauptfenster auf Port ${port} für Vault „${STAGING_VAULT}“.`);
  await main.send("Page.bringToFront");
  if (!(await main.evaluate<boolean>(`return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`))) {
    const r = await bereiteInstanzVor(main, { pluginIds: [PLUGIN_ID], nurVault: STAGING_VAULT, sprache: "en" });
    console.log(`Instanz vorbereitet: ${r.hinweis}`);
  }
  // Gültigkeit der Messung: ohne englische Oberfläche wäre jedes Bild ein deutsches (CORE-TEST-22).
  const lang = await main.evaluate<string>(`return document.documentElement.lang;`);
  if (!/^en/i.test(lang)) throw new Error(`Oberfläche steht auf „${lang}“, nicht auf Englisch: nichts gemessen (Start ohne --lang=en-US?).`);
  console.log(`Oberfläche: ${lang}`);
  await setWindowSize(main, 1440, 900);
  await new Promise((r) => setTimeout(r, 500));

  // ── Hub: fünf Tabs ────────────────────────────────────────────────────────────
  console.log("\n── Hub, fünf Tabs");
  await main.evaluate(`app.workspace.getLeavesOfType("vault-retrieval-hub").forEach(l => l.detach()); return true;`);
  for (const tab of TABS) {
    await main.evaluate(`await app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].openHub(${JSON.stringify(tab)}); await new Promise(r => setTimeout(r, 900)); return true;`);
    const leaf = `.workspace-leaf-content[data-type='vault-retrieval-hub']`;
    const tabs = await main.evaluate<{ breite: number; gesamt: number; beschriftungen: string[] }>(`
      const root = document.querySelector(${JSON.stringify(leaf)});
      const bar = root?.querySelector(".vault-rag-tabs, .okit-hub-tabs, [role='tablist']");
      return { breite: bar ? bar.clientWidth : 0, gesamt: bar ? bar.scrollWidth : 0, beschriftungen: bar ? [...bar.querySelectorAll("button, [role='tab']")].map(b => (b.getAttribute("aria-label") || b.textContent || "").trim()) : [] };
    `);
    const o = await ueberlauf(main, leaf);
    console.log(`  ${tab}: Tab-Leiste ${tabs.breite}px (Inhalt ${tabs.gesamt}px) · Beschriftungen ${JSON.stringify(tabs.beschriftungen)} · Überlauf ${o.length}`);
    for (const t of o) console.log(`     - ${t.sel} „${t.text}“ ${t.scrollW}>${t.clientW}${t.gekuerzt ? " gekürzt" : ""}`);
    await schliesseHinweise(main);
    const box = await boxOf(main, leaf);
    await speichere(bilder, `hub-${tab}.png`, await capture(main, box ?? undefined, 2));
  }

  // ── Diagnose bei falschem Endpunkt ────────────────────────────────────────────
  await main.evaluate(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    p.settings.embeddingEndpoints = [{ url: "http://127.0.0.1:9", model: "kein-modell" }, ...p.settings.embeddingEndpoints.slice(1)];
    await p.saveSettings();
    return true;
  `);

  // ── Einstellungen ────────────────────────────────────────────────────────────
  console.log("\n── Einstellungen");
  await main.evaluate(`app.setting.open(); app.setting.openTabById(${JSON.stringify(PLUGIN_ID)}); await new Promise(r => setTimeout(r, 4000)); return true;`);
  const sett = await attachTo("settings", port, STAGING_VAULT);
  if (!sett) throw new Error("Einstellungen-Fenster nicht erreichbar.");
  const spalte = `.vertical-tab-content`;
  const mass = await sett.evaluate<{ hoehe: number; scrollH: number }>(`const c = document.querySelector(${JSON.stringify(spalte)}); return { hoehe: c ? c.clientHeight : 0, scrollH: c ? c.scrollHeight : 0 };`);
  const seiten = Math.max(1, Math.ceil(mass.scrollH / Math.max(1, mass.hoehe)));
  console.log(`  Spalte ${mass.hoehe}px hoch, Inhalt ${mass.scrollH}px → ${seiten} Bild(er)`);
  const o = await ueberlauf(sett, spalte);
  console.log(`  Überlauf in den Einstellungen: ${o.length}`);
  for (const t of o) console.log(`     - ${t.sel} „${t.text}“ ${t.scrollW}>${t.clientW}${t.gekuerzt ? " gekürzt" : ""}`);
  for (let i = 0; i < seiten; i++) {
    await sett.evaluate(`const c = document.querySelector(${JSON.stringify(spalte)}); c.scrollTop = ${i} * c.clientHeight; await new Promise(r => setTimeout(r, 300)); return true;`);
    await schliesseHinweise(sett);
    await speichere(bilder, `einstellungen-${i + 1}.png`, await capture(sett));
  }
  // Endpunkt-Zeilen: Texte der Statusanzeige (der Tooltip ist ein `title`, er lässt sich nicht fotografieren, aber lesen).
  const diag = await sett.evaluate<{ status: string[]; warn: string[]; zeilen: number }>(`
    const c = document.querySelector(${JSON.stringify(spalte)});
    const attr = (el) => [el.getAttribute("title"), el.getAttribute("aria-label"), (el.textContent || "").trim()].filter(Boolean).join(" | ");
    return { status: [...c.querySelectorAll(".okit-ep-status, .okit-ep-state")].map(attr), warn: [...c.querySelectorAll(".okit-ep-warn")].map(attr), zeilen: c.querySelectorAll(".okit-ep-status").length };
  `);
  console.log(`\n── Endpunkt-Zeilen: ${diag.zeilen} Statusanzeige(n)`);
  for (const s of diag.status) console.log(`   Status: ${s}`);
  for (const s of diag.warn) console.log(`   Warnung: ${s}`);
  await schliesseEinstellungen(main);
  // Offene Sockets halten den Node-Prozess am Leben (gemessen Welle 34: `messlauf.sh` hing nach „fertig“ bis zur TTL des Locks).
  sett.close();
  main.close();
  console.log(`\nfertig: ${bilder}`);
}

runDriver(haupt);
