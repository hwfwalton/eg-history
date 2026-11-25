#!/bin/bash
# Screenshots the page with headless Chrome (macOS) and prints console messages, script errors and
# Content-Security-Policy refusals, so a change can be checked without opening a browser.
#
# Usage: scripts/screenshot.sh <url> <out.png> [width=1280] [height=900]
#   e.g. scripts/screenshot.sh "http://127.0.0.1:8480/?theme=dark#weeks" /tmp/weeks.png
# - ?theme=light or ?theme=dark forces the theme; ?range=2024 picks a range; #<section id> scrolls to a
#   section (ids: header, range, numbers, most-played, styles, cost, modes, overdue, play-history, years,
#   styles-by-year, weeks, milestones, sessions, games, notes).
# - The window is the viewport, not the whole page: shoot sections one at a time.
# - Headless Chrome won't go narrower than 500px: a smaller width is a 500px layout cropped on the right.
#   Check phone widths in a real browser instead.
set -u
URL="$1"; OUT="$2"; W="${3:-1280}"; H="${4:-900}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$(mktemp -d)"
"$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check --hide-scrollbars \
  --user-data-dir="$PROFILE" --window-size="$W,$H" --virtual-time-budget=6000 \
  --enable-logging=stderr --v=0 --screenshot="$OUT" "$URL" 2>&1 \
  | grep -E "CONSOLE|Uncaught|ERR_|Refused to" | sed -E 's/^\[[^]]*\] //' | head -40
rm -rf "$PROFILE"
[ -s "$OUT" ] && echo "saved $OUT (${W}x${H})" || { echo "NO SCREENSHOT WRITTEN"; exit 1; }
