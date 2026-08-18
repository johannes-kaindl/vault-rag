import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "src");

/**
 * Wächter für die Fehlerklasse aus „i18n Teil 3": ein deutscher String, der als
 * RÜCKGABEWERT entsteht und erst später in einer Text-Senke landet.
 *
 * Der Sink-Wächter (`sink_guard.ts`) kann sie strukturell nicht sehen — zwischen Erzeugung
 * und Anzeige liegt ein Rückgabewert, an der Senke steht kein Literal mehr. Die naheliegende
 * Erweiterung wäre ein Sprach-Scan über Rückgabewerte; genau der ist in 0.22.0 durchgefallen
 * (ein eingefügtes `createEl({text:"Verbindung"})` blieb grün). Linguistisches Raten ist hier
 * die falsche Bauart.
 *
 * Stattdessen prüft dieser Wächter STRUKTURELL, dass die zwei Stellen zu bleiben, was sie
 * sind — die Kit-Diagnose kommt als Code herein und wird an genau einer Grenze zu Text.
 * Den Rest erledigt der Compiler: `EndpointStatusKind` wird erschöpfend geswitcht, und
 * `StartErrorReason` ist kein String, lässt sich also gar nicht erst anzeigen.
 */

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...tsFiles(p));
      continue;
    }
    if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Alle src-Dateien außer den vendorten Snapshots (die dürfen deutsche Prosa tragen —
 *  sie sind verbatim aus obsidian-kit und werden nie von Hand editiert). */
function repoOwnFiles(): { rel: string; text: string }[] {
  return tsFiles(SRC)
    .map((f) => ({ rel: f.slice(SRC.length + 1), text: readFileSync(f, "utf8") }))
    .filter((f) => !f.rel.startsWith("vendor/"));
}

/** Zeilen ohne reine Kommentarzeilen — ein `//`-Hinweis auf `klartext` ist Doku, kein Zugriff. */
function codeLines(text: string): { no: number; line: string }[] {
  return text.split("\n")
    .map((line, i) => ({ no: i + 1, line }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

describe("Diagnose-Codes: die Kit-Prosa bleibt draußen", () => {
  it("liest nirgends `.klartext` — der Code (`kind`) ist die einzige zulässige Quelle", () => {
    // `EndpointStatus` trägt beides: `kind` (sprachneutrale Union) und `klartext` (fest
    // deutsch). Bis 0.23.0 hing settings.ts am klartext — jeder Nutzer mit englischer
    // Oberfläche sah bei JEDEM nicht erreichbaren Endpunkt einen deutschen Tooltip.
    const hits = repoOwnFiles().flatMap((f) =>
      codeLines(f.text)
        .filter(({ line }) => /\.klartext\b/.test(line))
        .map(({ no }) => `${f.rel}:${no}`),
    );
    expect(hits).toEqual([]);
  });

  it("kapselt `validateEndpointInput` in endpoint_config.ts", () => {
    // Die erste Fassung dieser Regel prüfte nur, ob `endpointWarningText` in derselben
    // Datei VORKOMMT — und blieb in der Gegenprobe grün, während der Aufruf umgangen war
    // (der Import allein reichte). Solange ein Aufrufer das rohe `EndpointWarning` in der
    // Hand hält, kann er an der fest deutschen `message` vorbeigreifen, und ein Wächter
    // kann das nur raten. Deshalb liegt der Aufruf jetzt hinter `endpointInputWarnings`,
    // das fertige Strings liefert: es gibt nichts mehr zu greifen. Diese Regel hält die
    // Kapsel geschlossen — sie ist der Grund, warum die Textprüfung entfallen kann.
    const callers = repoOwnFiles()
      .filter((f) => /\bvalidateEndpointInput\s*\(/.test(f.text))
      .map((f) => f.rel);
    expect(callers).toEqual(["endpoint_config.ts"]);
  });
});
