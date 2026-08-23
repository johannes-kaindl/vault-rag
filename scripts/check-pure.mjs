// uebernommen aus vault-crews/scripts/check-pure.mjs, 2026-08-23
// (dort seinerseits aus obsidian-paperize/scripts/check-pure.mjs, 2026-08-14)
//
// Haelt die Obsidian-Grenze, die AGENTS.md beschreibt: `obsidian` wird nur an der KANTE
// importiert, alles andere bleibt in Node/vitest testbar (PROF-OBS-03/04).
//
// Abweichung von der uebernommenen Fassung — ALLOWLIST statt Denylist: die Vorlage listet
// pure Wurzeln auf (`src/core`, `src/vendor`). vault-rag hat kein `src/core`; die Grenze
// verlaeuft hier nicht am Verzeichnis, sondern an einer kurzen, in AGENTS.md benannten Liste
// von Kanten-Dateien. Als Denylist muesste jedes neue pure Modul nachgetragen werden und
// waere bis dahin ungeprueft — genau der Fehler, den ein Gate verhindern soll. Umgekehrt
// ist die Kantenliste kurz und aendert sich selten, und ein neues obsidian-Import an
// unerwarteter Stelle faellt sofort auf.
//
// Bewusst ein Script statt eines grep-Einzeilers: der Einzeiler in den Vorgaenger-Repos
// erfasste nur einfache Anfuehrungszeichen und war blind fuer genau den Fremdcode, den er
// pruefen soll — das Kit schreibt doppelte (gemessen 2026-08-05 im drift-audit).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Die Kante. Jeder Eintrag ist eine bewusste Entscheidung, keine gewachsene Ausnahme —
// die Begruendung je Datei steht in AGENTS.md § Architecture principles.
const EDGE = new Set([
  "src/main.ts",                      // Plugin-Entry: Lifecycle, Events, Commands
  "src/settings.ts",                  // SettingTab
  "src/hub_view.ts",                  // der eine ItemView
  "src/http.ts",                      // kapselt requestUrl als einzigen Netz-Helfer
  "src/note_picker.ts",               // duenne Modal-/Picker-Wrapper, bewusst ungetestet
  "src/template_picker.ts",
  "src/reformat_picker.ts",
  "src/reformat_preview_modal.ts",
  "src/reformat_panel.ts",
  "src/chat_view.ts",                 // nur setIcon
  "src/smart_apply_view.ts",          // setIcon + Notice (Fehler-Feedback)
  "src/mcp/http_server.ts",           // Platform-Gate (desktop-only)
]);
// Die bewusst obsidian-gekoppelte Vendor-Schicht. Die Grenze verlaeuft bei "pure", nicht bei
// "vendored": ein neues gekoppeltes Kit-Modul gehoert in diesen Ordner, nicht in eine
// weitere Ausnahme hier.
const EXCLUDED_DIRS = ["src/vendor/kit-obsidian"];
const FORBIDDEN = /(?:from|import)\s*\(?\s*["']obsidian(\/[^"']*)?["']/;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (EXCLUDED_DIRS.includes(full)) return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk("src").filter((f) => f.endsWith(".ts"));
if (files.length === 0) {
  console.error("check:pure FEHLER: keine .ts-Datei unter src/ gefunden — laeuft das Gate im richtigen Verzeichnis?");
  process.exit(1);
}

// Ein Kanten-Eintrag, der ins Leere zeigt, ist ein stiller Deckel: er erlaubt eine Datei,
// die es nicht mehr gibt, und verdeckt beim Umbenennen, dass die Kante gewandert ist.
const stale = [...EDGE].filter((f) => !existsSync(f));
if (stale.length > 0) {
  console.error("check:pure FEHLER: EDGE nennt Dateien, die es nicht gibt:");
  for (const f of stale) console.error(`  ${f}`);
  process.exit(1);
}

const offenders = files.filter((f) => !EDGE.has(f)).filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")));

if (offenders.length > 0) {
  console.error("check:pure FEHLER: obsidian-Import ausserhalb der Kante:");
  for (const f of offenders) console.error(`  ${f}`);
  console.error("\nEntweder die Abhaengigkeit aufloesen (Wert durchreichen statt obsidian importieren),");
  console.error("oder die Datei bewusst zur Kante erklaeren: EDGE in scripts/check-pure.mjs + AGENTS.md.");
  process.exit(1);
}

console.log(`check:pure OK — ${files.length - EDGE.size} Module frei von obsidian-Importen, ${EDGE.size} an der Kante`);
