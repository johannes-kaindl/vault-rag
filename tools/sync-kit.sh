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

# VORPRUEFUNG, bevor irgendetwas geschrieben wird.
#
# Ein Abbruch mitten im Lauf ist zu spaet: Am 2026-08-30 gemessen — mit KIT_REF=0.28.0 wurde
# `callout.ts` bereits ueberschrieben, bevor `clipboard.ts` fehlschlug. Der Vendor-Stand war
# danach halb 0.27.0, halb 0.28.0, und `set -e` hatte "korrekt" abgebrochen. Ein Schutz, der nur
# die Datei rettet, an der er ausloest, laesst alle vorherigen kaputt.
# Deshalb: erst pruefen, ob JEDE Quelle in der Ref existiert, dann schreiben.
pruefe_quellen() {
  local fehlend=""
  for pfad in "$@"; do
    git -C "$KIT" cat-file -e "$KIT_REF:$pfad" 2>/dev/null || fehlend="$fehlend $pfad"
  done
  if [ -n "$fehlend" ]; then
    echo "FEHLER: in obsidian-kit@$KIT_REF fehlen:$fehlend" >&2
    echo "        Nichts geschrieben. Seit 0.28.0 sind pure/-Module nach code-kit gezogen —" >&2
    echo "        die Ref zu heben verlangt eine Entscheidung ueber die QUELLE, nicht nur ueber die Version." >&2
    exit 1
  fi
}

# vendor <zielpfad> <kit-relativer-quellpfad>
#
# Schreibt ERST nach .tmp und verschiebt NUR bei Erfolg. Grund: die naheliegende Form
# `{ printf header; git show ...; } > ziel` legt die Zieldatei an, BEVOR `git show` laeuft —
# fehlt die Quelle in der Ref, bleibt eine Datei zurueck, die nur aus dem Herkunftsstempel
# besteht (hier 43 Bytes) und wie ein gueltiges Vendoring aussieht. `set -e` bricht zwar ab,
# aber der Stummel liegt dann schon da. Genau dieser Fall ist als CORE-META-22 promotet
# (Beleg: finance-ledger, 2026-08-27) — und er ist real: seit Kit 0.28.0 sind 23 `pure/`-Module
# nach `code-kit` gezogen, darunter die hier vendorierten `error_body` und `clipboard`. Ein Lauf
# mit KIT_REF=0.28.0 traefe also genau darauf.
# Reproduziert am 2026-08-30, nachdem `3d-codeblocks` denselben Defekt im eigenen Skript fand.
vendor() {
  local tmp="$1.tmp"
  { printf '%s\n' "// vendored from obsidian-kit@$VER, $2 — do not hand-edit; re-vendor via tools/sync-kit.sh"
    git -C "$KIT" show "$KIT_REF:$2"; } > "$tmp" || {
      rm -f "$tmp"
      echo "FEHLER: $2 fehlt in obsidian-kit@$KIT_REF — nichts geschrieben." >&2
      exit 1
    }
  mv "$tmp" "$1"
}

PURE="callout clipboard endpoint endpoint_diagnostics error_body frontmatter i18n reasoning settings sse timeout"
OBS="clipboard collapsible confirm folder-suggest hub settings_walker"

# Alle Quellen auf einmal pruefen — vor dem ersten Schreibvorgang.
QUELLEN=""
for f in $PURE; do QUELLEN="$QUELLEN src/pure/$f.ts"; done
QUELLEN="$QUELLEN src/pure/think-splitter.ts"
for f in $OBS; do QUELLEN="$QUELLEN src/obsidian/$f.ts"; done
pruefe_quellen $QUELLEN

for f in $PURE; do
  vendor "src/vendor/kit/$f.ts" "src/pure/$f.ts"
done
# Ausnahme: dieses Repo nennt pure/think-splitter.ts lokal think.ts (Konsumenten importieren "./vendor/kit/think").
vendor "src/vendor/kit/think.ts" "src/pure/think-splitter.ts"

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
