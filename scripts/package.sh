#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT HUP INT TERM
cp -R src/. "$staging/"
cp LICENSE "$staging/"
archive="$(pwd)/dist/makerworld-photo-audit-1.0.0.zip"
(
  cd "$staging"
  zip -q -X -r extension.zip . -x '.*' '*/.*'
)
mv "$staging/extension.zip" "$archive"
unzip -tq "$archive"
