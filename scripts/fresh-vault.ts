/**
 * Staging-Vault frisch aus dem Fixture bauen — OHNE den Index zu verlieren (Task „GUI-Smoke baut den Staging-Vault nie aus
 * dem Fixture“, Welle 22). `buildVault` löscht alles außer `.obsidian/`, also auch `_vaultrag/index.bin`, und ein neuer Index
 * braucht das echte Embedding-Modell (in der Strom-Lage verboten). Darum liegt ein Index-SCHNAPPSCHUSS neben den
 * Staging-Vaults, und dieser Aufruf setzt ihn nach dem Aufbau wieder ein.
 *
 *   npm run build && npm run fresh-vault -- --port 9420        # Vault aus dem Fixture, Schnappschuss-Index zurück
 *   npm run fresh-vault -- --snapshot                          # Schnappschuss aus dem AKTUELLEN Vault ziehen
 *   npm run fresh-vault -- --status                            # Schnappschuss und Fixture vergleichen, nichts ändern
 *
 * ## Wo, und wann erneuert
 *
 * - **Ort:** `$STAGING_VAULTS_DIR/_snapshots/vault-rag/` (`index.bin` + `meta.json`), also außerhalb des Repos, bei den Vaults,
 *   die ebenfalls Wegwerfware sind. Nicht getrackt, nicht gesichert; verloren heißt: einmal mit echtem Modell neu bauen.
 * - **Gültig,** solange der Fingerprint des Fixtures (`docs/images/fixture/notes`: Pfade + Inhalt) und das Embedding-Modell im
 *   Schnappschuss mit dem Fixture übereinstimmen. Ändert sich eine Fixture-Notiz, ist er ungültig: der Aufbau meldet das und baut
 *   den Vault OHNE Index (dann sind die Index-Punkte „nichts gemessen“, nie falsch grün).
 * - **Erneuert** wird er von Hand, nach einem guten Lauf mit dem echten Embedding-Modell (`npm run shots -- --prepare`, dann
 *   `--snapshot`) — in der Modell-Runde, nie im Stub-Lauf. `--snapshot` prüft vorher: Container lesbar (CRC), jeder Pfad im
 *   Index ist eine Fixture-Notiz, Modell = das der Fixture-Einstellungen.
 *
 * ## Warum nicht in der laufenden Instanz
 *
 * Die Zweitinstanz hält den Vault offen und `buildVault` schriebe unter ihr weg. Der Aufruf bricht ab, wenn auf `--port` noch
 * etwas lauscht: erst die Instanz beenden, dann bauen, dann starten (Reihenfolge Profil → Vault → Start, docs/SMOKE.md).
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { argv, cwd, exit } from "node:process";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";
import { decodeContainer } from "../src/vendor/kit/index-container.js";

const REPO_NAME = "vault-rag";
const PLUGIN_ID = "vault-retrieval";

function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function dateien(dir: string, basis = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...dateien(p, basis)); else out.push(relative(basis, p));
  }
  return out;
}

/** Fingerprint der Fixture-Notizen: Pfade UND Inhalt (eine umgeschriebene Notiz macht den Index-Vektor falsch, ohne den Pfad zu ändern). */
function fixtureFingerprint(notesDir: string): string {
  const h = createHash("sha256");
  for (const rel of dateien(notesDir)) { h.update(rel); h.update("\0"); h.update(readFileSync(join(notesDir, rel))); h.update("\0"); }
  return h.digest("hex");
}

interface SnapshotMeta { fixture: string; embeddingModel: string; notes: number; createdAt: string }

function ordner(): { vaultDir: string; snapDir: string; notesDir: string; fixtureDir: string; repoRoot: string } {
  const repoRoot = cwd();
  const vaultDir = stagingVaultDir(REPO_NAME);
  const base = process.env.STAGING_VAULTS_DIR as string;
  const fixtureDir = join(repoRoot, "docs/images/fixture");
  return { repoRoot, vaultDir, snapDir: join(base, "_snapshots", REPO_NAME), notesDir: join(fixtureDir, "notes"), fixtureDir };
}

function fixtureModell(fixtureDir: string): string {
  const s = JSON.parse(readFileSync(join(fixtureDir, "plugin/settings.json"), "utf8")) as { embeddingEndpoints?: { model?: string }[] };
  return s.embeddingEndpoints?.[0]?.model ?? "";
}

function laeuscht(port: number): boolean {
  try { execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: "pipe" }); return true; } catch { return false; }
}

/** Ist ein vorhandener Schnappschuss für das heutige Fixture gültig? Gibt den Grund zurück, wenn nicht. */
function pruefeSchnappschuss(snapDir: string, notesDir: string, fixtureDir: string): { ok: true; meta: SnapshotMeta } | { ok: false; grund: string } {
  const bin = join(snapDir, "index.bin"); const metaDatei = join(snapDir, "meta.json");
  if (!existsSync(bin) || !existsSync(metaDatei)) return { ok: false, grund: "kein Schnappschuss vorhanden" };
  const meta = JSON.parse(readFileSync(metaDatei, "utf8")) as SnapshotMeta;
  if (meta.fixture !== fixtureFingerprint(notesDir)) return { ok: false, grund: "das Fixture hat sich seit dem Schnappschuss geändert" };
  const soll = fixtureModell(fixtureDir);
  if (soll !== "" && meta.embeddingModel !== soll) return { ok: false, grund: `Modell im Schnappschuss „${meta.embeddingModel}“, das Fixture verlangt „${soll}“` };
  return { ok: true, meta };
}

function main(): void {
  const { repoRoot, vaultDir, snapDir, notesDir, fixtureDir } = ordner();

  if (argv.includes("--status")) {
    const r = pruefeSchnappschuss(snapDir, notesDir, fixtureDir);
    console.log(r.ok ? `Schnappschuss gültig: ${r.meta.notes} Notizen, Modell ${r.meta.embeddingModel}, gezogen ${r.meta.createdAt}` : `Schnappschuss ungültig: ${r.grund}`);
    exit(r.ok ? 0 : 1);
  }

  if (argv.includes("--snapshot")) {
    const bin = join(vaultDir, "_vaultrag", "index.bin");
    if (!existsSync(bin)) { console.error(`Kein Index im Vault (${bin}) — erst mit dem echten Modell bauen (npm run shots -- --prepare).`); exit(2); }
    const buf = readFileSync(bin);
    const c = (() => { try { return decodeContainer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer); } catch (e) { console.error(`Container nicht lesbar (CRC?): ${String(e)}`); exit(2); } })();
    const notizen = new Set(dateien(notesDir).filter((p) => p.endsWith(".md")));
    const fremd = c.paths.filter((p) => !notizen.has(p));
    if (fremd.length > 0) { console.error(`Der Index kennt Pfade, die keine Fixture-Notiz sind (${fremd.slice(0, 3).join(", ")}…) — aus einem verschmutzten Vault wird kein Schnappschuss gezogen.`); exit(2); }
    const soll = fixtureModell(fixtureDir);
    const modell = String(c.manifest.embedding_model ?? "");
    if (soll !== "" && modell !== soll) { console.error(`Modell im Index „${modell}“, das Fixture verlangt „${soll}“.`); exit(2); }
    mkdirSync(snapDir, { recursive: true });
    copyFileSync(bin, join(snapDir, "index.bin"));
    const meta: SnapshotMeta = { fixture: fixtureFingerprint(notesDir), embeddingModel: modell, notes: c.paths.length, createdAt: new Date().toISOString() };
    writeFileSync(join(snapDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
    console.log(`Schnappschuss gezogen: ${c.paths.length} Notizen, Modell ${modell} → ${snapDir}`);
    return;
  }

  const portRoh = arg("port");
  const port = Number(portRoh);
  if (portRoh === undefined || !Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error("--port <Zahl> fehlt: der Port der Zweitinstanz, auf der der Vault offen war (der Aufbau läuft nur, wenn dort nichts mehr lauscht).");
    exit(2);
  }
  if (laeuscht(port)) { console.error(`Auf Port ${port} lauscht noch eine Instanz. Erst beenden — sie hält den Vault offen und der Aufbau schriebe unter ihr weg.`); exit(2); }

  for (const zeile of buildVault({ repoRoot, vaultDir, fixtureDir, pluginId: PLUGIN_ID })) console.log(`   ${zeile}`);
  // Wie `shots --setup`: Plugin-Einstellungen aus dem Fixture NACH buildVault (das data.json bewusst entfernt).
  const pluginOrdner = join(vaultDir, ".obsidian", "plugins", PLUGIN_ID);
  mkdirSync(pluginOrdner, { recursive: true });
  copyFileSync(join(fixtureDir, "plugin/settings.json"), join(pluginOrdner, "data.json"));
  console.log("   Plugin-Einstellungen aus docs/images/fixture/plugin/settings.json (je zwei Endpunkt-Zeilen)");

  const snap = pruefeSchnappschuss(snapDir, notesDir, fixtureDir);
  if (snap.ok) {
    mkdirSync(join(vaultDir, "_vaultrag"), { recursive: true });
    cpSync(join(snapDir, "index.bin"), join(vaultDir, "_vaultrag", "index.bin"));
    console.log(`   Index aus dem Schnappschuss (${snap.meta.notes} Notizen, Modell ${snap.meta.embeddingModel}, gezogen ${snap.meta.createdAt})`);
  } else {
    console.log(`   KEIN Index: ${snap.grund}. Die Index-Punkte des Smokes sind dann „nichts gemessen“; erneuern: npm run shots -- --prepare (echtes Modell), danach npm run fresh-vault -- --snapshot.`);
  }
  console.log(`\nVault steht: ${vaultDir}\nJetzt die Zweitinstanz mit eigenem Profil starten (docs/SMOKE.md) und den Smoke fahren.`);
}

main();
