#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST_SRC="$APP_ROOT/infra/macos/com.codexreader.runner.plist.template"
PLIST_DST="$HOME/Library/LaunchAgents/com.codexreader.runner.plist"
NODE_PATH="$(command -v node)"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Application Support/CodexReader/logs"

sed \
  -e "s#__APP_ROOT__#$APP_ROOT#g" \
  -e "s#__HOME__#$HOME#g" \
  -e "s#/usr/local/bin/node#$NODE_PATH#g" \
  "$PLIST_SRC" > "$PLIST_DST"

launchctl unload "$PLIST_DST" >/dev/null 2>&1 || true
launchctl load "$PLIST_DST"
launchctl start com.codexreader.runner

echo "Installed com.codexreader.runner"
