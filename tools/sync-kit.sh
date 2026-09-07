#!/bin/sh
# Vendort Kit-Module byte-identisch aus zwei Quellen (Dach-AGENTS.md, Kit-first).
# Nie von Hand editieren — Skript neu laufen lassen.
#
# ZWEI QUELLEN seit dem code-kit-Split (obsidian-kit 0.28.0, `2ab1bb5`): die domaenenfreie
# pure-Schicht liegt in code-kit (`src/ts/{pure,web}/`), obsidian-kit vendort sie selbst nur
# noch zurueck. Von unseren 15 pure-Modulen gibt es ACHT in obsidian-kit 0.31.0 gar nicht mehr
# (clipboard, error_body, i18n, reasoning, settings, sse, timeout, think-splitter) — ein reiner
# Ref-Sprung liefe dort ins Leere. Nur `callout` und `frontmatter` sind in obsidian-kit geblieben.
# Form uebernommen aus kuro-gamification/tools/sync-kit.sh (2026-09-02).
#
# GELESEN WIRD AUS EINER FESTEN REF (`git show <ref>:<pfad>`), nicht aus dem Arbeitsstand des
# Nachbar-Repos — reproduzierbar, und es stoert keine parallele Session dort. `^{commit}` peelt
# annotierte Tags (code-kit taggt annotiert; ohne Peel stuende die SHA des Tag-OBJEKTS in
# VENDOR.json, die in `git log` der Quelle nie vorkommt).
#
# Zweiter Lauf darf keinen Diff erzeugen — deshalb steht in VENDOR.json KEIN Datum.
set -e
KIT="${KIT_DIR:-../obsidian-kit}"
KIT_REF="${KIT_REF:-0.31.0}"
CODEKIT="${CODEKIT_DIR:-../../code-kit}"
CODEKIT_REF="${CODEKIT_REF:-0.5.0}"

CK_PURE="endpoint endpoint_config endpoint_diagnostics error_body i18n model-choice model-list-cache reasoning settings sse timeout"
CK_WEB="clipboard"
KIT_PURE="callout frontmatter"
KIT_OBSIDIAN="clipboard collapsible confirm endpoint-list folder-suggest hub model-picker settings_walker"
# Ausnahme: pure/think-splitter.ts heisst hier think.ts (Konsumenten importieren "./vendor/kit/think").

# --- Vorbedingungen, ALLE vor dem ersten Schreibvorgang (ein Abbruch mitten im Lauf hinterliesse
#     eine halb aktualisierte Vendor-Schicht — so am 2026-08-30 mit KIT_REF=0.28.0 passiert).
for pair in "$KIT|$KIT_REF|KIT_DIR" "$CODEKIT|$CODEKIT_REF|CODEKIT_DIR"; do
  dir=$(printf '%s' "$pair" | cut -d'|' -f1)
  ref=$(printf '%s' "$pair" | cut -d'|' -f2)
  var=$(printf '%s' "$pair" | cut -d'|' -f3)
  test -d "$dir/.git" || { echo "sync-kit: kein git-Repo unter $dir — $var setzen. Nichts geschrieben." >&2; exit 1; }
  git -C "$dir" rev-parse --verify --quiet "$ref^{commit}" >/dev/null \
    || { echo "sync-kit: Ref '$ref' gibt es in $dir nicht. Nichts geschrieben." >&2; exit 1; }
done
fehlend=""
for m in $CK_PURE think-splitter; do git -C "$CODEKIT" cat-file -e "$CODEKIT_REF:src/ts/pure/$m.ts" 2>/dev/null || fehlend="$fehlend code-kit:src/ts/pure/$m.ts"; done
for m in $CK_WEB; do git -C "$CODEKIT" cat-file -e "$CODEKIT_REF:src/ts/web/$m.ts" 2>/dev/null || fehlend="$fehlend code-kit:src/ts/web/$m.ts"; done
for m in $KIT_PURE; do git -C "$KIT" cat-file -e "$KIT_REF:src/pure/$m.ts" 2>/dev/null || fehlend="$fehlend obsidian-kit:src/pure/$m.ts"; done
for m in $KIT_OBSIDIAN; do git -C "$KIT" cat-file -e "$KIT_REF:src/obsidian/$m.ts" 2>/dev/null || fehlend="$fehlend obsidian-kit:src/obsidian/$m.ts"; done
if [ -n "$fehlend" ]; then echo "sync-kit: fehlende Quellen —$fehlend. Nichts geschrieben." >&2; exit 1; fi

KIT_SHA=$(git -C "$KIT" rev-parse --short "$KIT_REF^{commit}")
CK_SHA=$(git -C "$CODEKIT" rev-parse --short "$CODEKIT_REF^{commit}")
mkdir -p src/vendor/kit src/vendor/kit-obsidian

# copy <repo-dir> <ref> <quell-label> <quellpfad> <zielpfad> — Header + Inhalt in einem Zug,
# in .tmp geschrieben und erst bei Erfolg per mv umgelegt (Torso-Schutz, CORE-META-22).
copy() {
  tmp="$5.tmp$$"
  { printf '%s\n' "// vendored from $3@$2, $4 — do not hand-edit; re-vendor via tools/sync-kit.sh"
    git -C "$1" show "$2:$4"; } > "$tmp" \
    || { rm -f "$tmp"; echo "sync-kit: $4 fehlt in $3@$2 — nichts geschrieben." >&2; exit 1; }
  mv "$tmp" "$5"
}

# Kit-interne Querimporte aufs Vendor-Layout umschreiben: im Kit liegt die pure-Schicht unter
# src/vendor/code-kit/{pure,web}/ (oder historisch src/pure/), hier flach unter src/vendor/kit/.
# EINZIGE zulaessige Abweichung von verbatim. Getrennte sed-Ausdruecke: BSD-sed kennt `\|` nicht
# und schreibt dann lautlos nichts um.
relayer() {
  f=$1
  sed -e 's|\(["'"'"']\)\.\./vendor/code-kit/pure/|\1../kit/|g' \
      -e 's|\(["'"'"']\)\.\./vendor/code-kit/web/|\1../kit/|g' \
      -e 's|\(["'"'"']\)\.\./pure/|\1../kit/|g' "$f" > "$f.tmp"
  if cmp -s "$f" "$f.tmp"; then rm -f "$f.tmp"; return 0; fi
  mv "$f.tmp" "$f"
  if grep -qE '\.\./(vendor/code-kit/(pure|web)|pure)/' "$f"; then
    echo "sync-kit: Kit-interner Importpfad in $f nicht umgeschrieben — Muster pruefen" >&2; exit 1
  fi
  for dep in $(sed -n 's|.*from ["'"'"']\.\./kit/\([A-Za-z0-9_/-]*\)["'"'"'].*|\1|p' "$f" | sort -u); do
    [ -f "src/vendor/kit/$dep.ts" ] || { echo "sync-kit: $f importiert ../kit/$dep, aber src/vendor/kit/$dep.ts fehlt — mitvendorieren" >&2; exit 1; }
  done
  printf '%s\n' "// ONE mechanical deviation from verbatim: kit-internal imports of the code-kit layer → ../kit/ (vendor layout); reproduce on every re-vendor, nothing else may differ." | cat - "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
}

for m in $CK_PURE; do copy "$CODEKIT" "$CODEKIT_REF" code-kit "src/ts/pure/$m.ts" "src/vendor/kit/$m.ts"; done
copy "$CODEKIT" "$CODEKIT_REF" code-kit "src/ts/pure/think-splitter.ts" "src/vendor/kit/think.ts"
for m in $CK_WEB; do copy "$CODEKIT" "$CODEKIT_REF" code-kit "src/ts/web/$m.ts" "src/vendor/kit/$m.ts"; done
for m in $KIT_PURE; do copy "$KIT" "$KIT_REF" obsidian-kit "src/pure/$m.ts" "src/vendor/kit/$m.ts"; done
for m in $KIT_OBSIDIAN; do
  copy "$KIT" "$KIT_REF" obsidian-kit "src/obsidian/$m.ts" "src/vendor/kit-obsidian/$m.ts"
  relayer "src/vendor/kit-obsidian/$m.ts"
done

liste() { l=""; for m in "$@"; do [ -z "$l" ] && l="$m.ts" || l="$l, $m.ts"; done; printf '%s' "$l"; }
cat > src/vendor/kit/VENDOR.json <<JSON
{
  "source": "code-kit + obsidian-kit",
  "code-kit": { "version": "$CODEKIT_REF", "sha": "$CK_SHA", "vendored": "pure: $(liste $CK_PURE), think.ts (aus pure/think-splitter.ts); web: $(liste $CK_WEB)" },
  "obsidian-kit": { "version": "$KIT_REF", "sha": "$KIT_SHA", "vendored": "pure: $(liste $KIT_PURE)" },
  "note": "Verbatim snapshots (plus Herkunfts-Header in Zeile 1). Der Ordner heisst historisch 'kit'; die pure-Schicht kommt seit dem code-kit-Split aus code-kit, nur callout/frontmatter noch aus obsidian-kit. Never hand-edit. Re-vendor via tools/sync-kit.sh."
}
JSON
cat > src/vendor/kit-obsidian/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$KIT_REF",
  "sha": "$KIT_SHA",
  "vendored": "$(liste $KIT_OBSIDIAN)",
  "note": "Verbatim snapshot von obsidian-kit/src/obsidian (plus Herkunfts-Header). Module mit Kit-internem Import der code-kit-Schicht tragen EINE mechanische Abweichung: der Import zeigt auf ../kit/ (Vendor-Layout). Never hand-edit. Re-vendor via tools/sync-kit.sh."
}
JSON
echo "vendored code-kit@$CODEKIT_REF ($CK_SHA) + obsidian-kit@$KIT_REF ($KIT_SHA)"
