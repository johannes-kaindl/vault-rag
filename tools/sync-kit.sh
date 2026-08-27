#!/bin/sh
# Vendort Kit-Module byte-identisch aus dem Schwester-Repo obsidian-kit (Dach-AGENTS.md, Kit-first).
# Nie von Hand editieren — Skript neu laufen lassen.
#
# Gelesen wird aus einer festen Ref (KIT_REF), nicht aus dem Arbeitsstand des Nachbar-Repos:
# obsidian-kit laeuft weiter (0.28.0 hat die pure-Teilmenge nach code-kit verschoben, dort gibt es
# `src/pure/error_body.ts` und `src/pure/clipboard.ts` nicht mehr), und ein `cat` aus dessen
# Arbeitsverzeichnis liefert je nach dessen HEAD etwas anderes oder gar nichts. `git show <ref>:<pfad>`
# ist reproduzierbar und stoert keine parallele Session im Nachbar-Repo.
#
# Zweiter Lauf darf keinen Diff erzeugen — das ist die Probe darauf, dass Header und VENDOR.json
# deterministisch sind (deshalb steht hier KEIN Datum: es wuerde jeden Lauf einen Diff erzeugen).
set -e
KIT=../obsidian-kit
KIT_REF=${KIT_REF:-0.27.0}
# Der Tag-Commit, nicht der Kit-HEAD: HEAD steht auf einem spaeteren Stand, und ein daraus
# gelesener SHA widerspraeche der vendorierten Version.
SHA=$(git -C "$KIT" rev-parse --short "$KIT_REF^{commit}")
VER=$(git -C "$KIT" describe --tags --abbrev=0 "$KIT_REF")

mkdir -p src/vendor/kit src/vendor/kit-obsidian

# vendor <zielpfad> <kit-relativer-quellpfad>
vendor() {
  { printf '%s\n' "// vendored from obsidian-kit@$VER, $2 — do not hand-edit; re-vendor via tools/sync-kit.sh"
    git -C "$KIT" show "$KIT_REF:$2"; } > "$1"
}

PURE="callout clipboard endpoint endpoint_diagnostics error_body frontmatter i18n reasoning settings sse timeout"
for f in $PURE; do
  vendor "src/vendor/kit/$f.ts" "src/pure/$f.ts"
done
# Ausnahme: dieses Repo nennt pure/think-splitter.ts lokal think.ts (Konsumenten importieren "./vendor/kit/think").
vendor "src/vendor/kit/think.ts" "src/pure/think-splitter.ts"

OBS="clipboard collapsible confirm folder-suggest hub settings_walker"
for f in $OBS; do
  vendor "src/vendor/kit-obsidian/$f.ts" "src/obsidian/$f.ts"
done
# Schichtwechsel: im Kit liegen pure/ und obsidian/ nebeneinander, hier heisst der pure-Zweig kit/.
# sed -i '' ist BSD/macOS; GNU-sed braeuchte -i''. Bewusst macOS-only wie der Rest der Maintainer-Tools.
sed -i '' 's|from "\.\./pure/clipboard"|from "../kit/clipboard"|' src/vendor/kit-obsidian/clipboard.ts

write_vendor_json() { # write_vendor_json <verzeichnis> <modul-liste>
  printf '{\n  "source": "obsidian-kit",\n  "version": "%s",\n  "sha": "%s",\n  "vendored": "%s",\n  "note": "Verbatim snapshot. Never hand-edit. Re-vendor via tools/sync-kit.sh."\n}\n' \
    "$VER" "$SHA" "$2" > "$1/VENDOR.json"
}
write_vendor_json src/vendor/kit "$(printf '%s.ts, ' $PURE)think.ts (aus pure/think-splitter.ts)"
write_vendor_json src/vendor/kit-obsidian "$(printf '%s.ts, ' $OBS | sed 's/, $//')"

echo "vendored obsidian-kit@$VER ($SHA): $PURE think | $OBS"
