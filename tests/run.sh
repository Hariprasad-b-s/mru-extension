#!/usr/bin/env bash
# Runs every test suite against a real Chromium, most of them with real key
# presses. Needs Node 18+, Playwright with its Chromium (npm i -D playwright &&
# npx playwright install chromium, or set PLAYWRIGHT=/path/to/playwright), and
# on Linux xvfb-run and xdotool. Usage: ./tests/run.sh
set -uo pipefail
cd "$(dirname "$0")/.."
export EXT_DIR="$PWD"
if [ -z "${PLAYWRIGHT:-}" ] && [ -d /opt/node-tools/node_modules/playwright ]; then
  export PLAYWRIGHT=/opt/node-tools/node_modules/playwright
fi

# The store package, unzipped, for the suites that also test it.
./scripts/package.sh >/dev/null
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' manifest.json)
export PKG_DIR
PKG_DIR=$(mktemp -d)
trap 'rm -rf "$PKG_DIR"' EXIT
unzip -q "dist/mru-tab-switcher-$version.zip" -d "$PKG_DIR"

failed=0
run() {
  local name=$1; shift
  local out
  out=$("$@" 2>&1)
  local passed failures
  passed=$(grep -cE '^ *PASS' <<<"$out")
  failures=$(grep -E '^ *FAIL|Error' <<<"$out")
  printf '%-15s %3d passed\n' "$name" "$passed"
  if [ -n "$failures" ] || [ "$passed" -eq 0 ]; then
    echo "$failures"
    failed=1
  fi
}
headed() { xvfb-run -a -s "-screen 0 1280x800x24" "$@"; }

run basics        node tests/basics.mjs
run ctrl-tab      headed node tests/ctrl-tab.mjs
run cycling       headed node tests/cycling.mjs
run windows       headed node tests/windows.mjs
run timing        headed node tests/timing.mjs
run brave-history headed node tests/brave-history.mjs
run settings      headed node tests/settings.mjs
run settings-zip  headed node tests/settings.mjs "$PKG_DIR"
run release       headed node tests/release.mjs
run release-zip   headed node tests/release.mjs "$PKG_DIR"
run update        headed node tests/update.mjs
run package       node tests/package.mjs

[ "$failed" -eq 0 ] && echo "All suites passed (v$version)." || echo "Some suites failed (v$version)."
exit "$failed"
