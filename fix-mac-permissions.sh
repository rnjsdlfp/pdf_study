#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

chmod +x "$ROOT_DIR/★CodexReader.command"
chmod +x "$ROOT_DIR/★CodexReader Tunnel.command"
chmod +x "$ROOT_DIR/★Install Codex CLI.command"
chmod +x "$ROOT_DIR/★ Codex Reader.app/Contents/MacOS/CodexReader"
chmod +x "$ROOT_DIR/apps/mac-runner/CodexReaderLauncher.sh"
chmod +x "$ROOT_DIR/infra/cloudflare/run-tunnel-macos.sh"
chmod +x "$ROOT_DIR/infra/macos/codex-cli.sh"
chmod +x "$ROOT_DIR/infra/macos/install-codex-cli.sh"
chmod +x "$ROOT_DIR/infra/macos/ensure-python-pdf-deps.sh"

if [ -f "$ROOT_DIR/infra/macos/install-launchd.sh" ]; then
  chmod +x "$ROOT_DIR/infra/macos/install-launchd.sh"
fi

if [ -f "$ROOT_DIR/infra/macos/uninstall-launchd.sh" ]; then
  chmod +x "$ROOT_DIR/infra/macos/uninstall-launchd.sh"
fi

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$ROOT_DIR/★CodexReader.command" "$ROOT_DIR/★CodexReader Tunnel.command" "$ROOT_DIR/★Install Codex CLI.command" "$ROOT_DIR/★ Codex Reader.app" "$ROOT_DIR/infra/macos/ensure-python-pdf-deps.sh" "$ROOT_DIR/infra/macos/install-codex-cli.sh" 2>/dev/null || true
fi

echo "Mac launch permissions fixed."
echo "Now double-click: ★CodexReader.command, ★CodexReader Tunnel.command, ★Install Codex CLI.command, or ★ Codex Reader.app"
