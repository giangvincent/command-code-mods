#!/usr/bin/env bash
# Install / restore the sidebar-pins overlay in the Command Code desktop app.
#
#   ./patch-sidebar.sh            # apply (safe to re-run after every update)
#   ./patch-sidebar.sh --restore  # put the original bundle back
#   ./patch-sidebar.sh --check    # report state, change nothing
#
# Why a script: the app is a signed, minified Electron bundle and its source is
# closed. We do not touch that code. We add one same-origin script to
# out/renderer/index.html (allowed by the app's own CSP: script-src 'self') and
# drop cmd-sidebar-pins.js next to it. Updates replace the whole bundle, so run
# this again afterwards.
#
# Env: APP="/path/to/Command Code.app" to target another install.
set -euo pipefail

APP="${APP:-/Applications/Command Code.app}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/cmd-sidebar-pins.js"
RENDERER="$APP/Contents/Resources/app/out/renderer"
INDEX="$RENDERER/index.html"
DEST="$RENDERER/assets/cmd-sidebar-pins.js"
TAG='<script defer src="./assets/cmd-sidebar-pins.js"></script>'
MARK="<!-- cc-sidebar-pins -->"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

# macOS gates writes into another app's bundle behind App Management (TCC):
# an ungranted terminal gets EPERM even though the file is user-writable and
# unsullied by flags. Probe once, up front, so the failure names the cause.
probe_write() {
  { : >> "$INDEX"; } 2>/dev/null || die "cannot write inside the app bundle.
       macOS App Management is blocking this terminal.
       System Settings > Privacy & Security > App Management: enable the app you
       run this from (Terminal, iTerm, Ghostty, ...), then re-run.
       sudo does not bypass this."
}

[[ -d "$APP" ]] || die "app not found: $APP (set APP=... )"
[[ -f "$INDEX" ]] || die "renderer index not found: $INDEX"
[[ -f "$SRC" ]] || die "missing $SRC"

is_patched() { grep -qF "$MARK" "$INDEX"; }

app_version() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
    "$APP/Contents/Info.plist" 2>/dev/null || echo "unknown"
}

resign() {
  # Editing Resources invalidates the seal; ad-hoc signing keeps macOS quiet.
  # Fails with EPERM under the same App Management gate as probe_write, since
  # codesign has to write _CodeSignature inside the bundle.
  local err
  if err="$(codesign --force --sign - "$APP" 2>&1)"; then
    say "  re-signed (ad-hoc)"
  else
    say "  note: ad-hoc re-sign failed — seal does not match the files:"
    printf '%s\n' "$err" | sed 's/^/    /'
    say "    'Operation not permitted' here is the same App Management gate;"
    say "    grant this terminal in System Settings > Privacy & Security > App Management."
  fi
}

case "${1:-}" in
  --check)
    say "app:     $APP ($(app_version))"
    say "index:   $INDEX"
    say "patched: $(is_patched && echo yes || echo no)"
    [[ -f "$DEST" ]] && say "overlay: present" || say "overlay: absent"
    exit 0
    ;;

  --restore)
    wrote=0
    if [[ -f "$INDEX.ccsp-orig" ]]; then
      if cmp -s "$INDEX.ccsp-orig" "$INDEX"; then
        say "index.html already pristine"
      else
        probe_write
        cp -p "$INDEX.ccsp-orig" "$INDEX"
        say "index.html restored"
        wrote=1
      fi
    elif is_patched; then
      # No backup (fresh update shipped a clean file we then patched): strip ours.
      probe_write
      sed -i '' -e "/$MARK/d" -e '\|cmd-sidebar-pins.js|d' "$INDEX"
      say "index.html cleaned"
      wrote=1
    else
      say "nothing to restore"
    fi
    if [[ -f "$DEST" ]]; then
      rm -f "$DEST"
      wrote=1
    fi
    # Nothing touched, nothing to re-sign — and no pointless write into the bundle.
    if (( wrote )); then resign; fi
    say "done — restart Command Code"
    exit 0
    ;;

  "") ;;
  *) die "unknown option: $1 (use --check, --restore, or nothing)" ;;
esac

say "app: $APP ($(app_version))"
probe_write

if is_patched; then
  say "already patched — refreshing overlay only"
  install -m 644 "$SRC" "$DEST"
else
  # Keep one pristine copy of the shipping index.html for --restore. An update
  # replaces the bundle, so an unpatched index that differs from the backup is
  # the new shipping file and becomes the backup — the old one is stale.
  cmp -s "$INDEX.ccsp-orig" "$INDEX" 2>/dev/null || cp -p "$INDEX" "$INDEX.ccsp-orig"

  install -m 644 "$SRC" "$DEST"

  # Inject once, right before </body>.
  grep -qF "cmd-sidebar-pins.js" "$INDEX" && die "index mentions the overlay but not our marker — refusing to touch it"

  tmp="$(mktemp)"
  awk -v tag="$TAG" -v mark="$MARK" '
    /<\/body>/ && !done { print "\t" mark; print "\t" tag; done = 1 }
    { print }
    END { if (!done) { print "\t" mark; print "\t" tag } }
  ' "$INDEX" > "$tmp"
  cat "$tmp" > "$INDEX"
  rm -f "$tmp"
  say "index.html patched"
fi

is_patched || die "patch did not land — index.html unchanged"

# Verify the overlay file is valid JS before we bless the install.
node --check "$DEST" >/dev/null 2>&1 || die "overlay failed syntax check: $DEST"
say "overlay installed: $DEST"

resign
say ""
say "done — quit and reopen Command Code."
say "re-run this after every app update.  --restore undoes it."
