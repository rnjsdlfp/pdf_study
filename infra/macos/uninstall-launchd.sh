#!/usr/bin/env bash
set -euo pipefail

PLIST_DST="$HOME/Library/LaunchAgents/com.codexreader.runner.plist"

launchctl unload "$PLIST_DST" >/dev/null 2>&1 || true
rm -f "$PLIST_DST"

echo "Uninstalled com.codexreader.runner"
