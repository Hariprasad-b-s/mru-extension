#!/usr/bin/env bash
# Builds dist/mru-tab-switcher-<version>.zip for upload to the Chrome Web Store.
# Usage: ./scripts/package.sh
set -euo pipefail

cd "$(dirname "$0")/.."

version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' manifest.json)
if [ -z "$version" ]; then
  echo "Couldn't read the version from manifest.json" >&2
  exit 1
fi

out="dist/mru-tab-switcher-$version.zip"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

# Only what the extension needs at runtime. The "key" field only pins the ID
# of unpacked development copies; the Web Store assigns the published ID.
grep -v '^  "key": ' manifest.json > "$staging/manifest.json"
cp background.js "$staging/"
mkdir "$staging/icons"
cp icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png "$staging/icons/"

mkdir -p dist
rm -f "$out"
(cd "$staging" && zip -qrX - .) > "$out"

echo "Built $out"
unzip -l "$out"
