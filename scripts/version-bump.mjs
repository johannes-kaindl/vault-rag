// Synct die Version über package.json → manifest.json → versions.json (Obsidian-Release-Hygiene).
//   npm run version-bump 0.2.0
// Aktualisiert nur die Versions-Felder (package.json per gezieltem Replace → Formatierung bleibt erhalten;
// manifest.json/versions.json per JSON-Sync). versions.json bekommt {version: manifest.minAppVersion}.
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2] ?? process.env.npm_package_version;
if (!target || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(target)) {
  console.error("version-bump: gültige Ziel-Version (SemVer) erwartet — z.B. `npm run version-bump 0.2.0`.");
  process.exit(1);
}

// package.json: nur die Top-Level-version-Zeile ersetzen (Formatierung/Reihenfolge bleibt).
const pkgRaw = readFileSync("package.json", "utf8");
writeFileSync("package.json", pkgRaw.replace(/("version":\s*")[^"]+(")/, `$1${target}$2`));

// manifest.json: version setzen.
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = target;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// versions.json: Mapping version → minAppVersion ergänzen.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[target] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

// package-lock.json: die beiden Versions-Felder mitziehen (Top-Level + der ""-Eintrag unter
// `packages`). Ohne das lief die Lock-Version dem Release über mehrere Versionen hinterher —
// `npm ci` installierte dann ein Paket, dessen Version nicht zum Tag passt. Gezielter Replace
// statt JSON-Rewrite: die Datei ist groß und ihre Formatierung stammt von npm.
let lockRaw = readFileSync("package-lock.json", "utf8");
const before = lockRaw;
lockRaw = lockRaw.replace(/("version":\s*")[^"]+(")/, `$1${target}$2`);                 // Top-Level
lockRaw = lockRaw.replace(/("":\s*\{\s*"name":\s*"[^"]+",\s*"version":\s*")[^"]+(")/, `$1${target}$2`);
if (lockRaw === before) {
  console.warn("version-bump: package-lock.json unverändert — Struktur unerwartet, bitte prüfen.");
}
writeFileSync("package-lock.json", lockRaw);

console.log(`version-bump: ${target} (minAppVersion ${manifest.minAppVersion}) → package.json · manifest.json · versions.json · package-lock.json`);
