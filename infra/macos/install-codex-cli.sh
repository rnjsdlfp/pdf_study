#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
RUNTIME_HOME="${CODEX_READER_HOME:-$HOME/Library/Application Support/CodexReader}"
DEFAULT_CODEX_HOME="$HOME/.codex"
CODEX_AUTH_HOME="${CODEX_HOME:-$DEFAULT_CODEX_HOME}"
if [ ! -f "$CODEX_AUTH_HOME/auth.json" ] && [ -f "$DEFAULT_CODEX_HOME/auth.json" ]; then
  CODEX_AUTH_HOME="$DEFAULT_CODEX_HOME"
fi
LOG_DIR="$RUNTIME_HOME/logs"
LOG_FILE="$LOG_DIR/codex-cli-install.log"
NPM_PREFIX="${CODEX_READER_NPM_PREFIX:-$HOME/.npm-global}"
NPM_CACHE_DIR="$RUNTIME_HOME/npm-cache"
MAC_RUNNER_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$NPM_PREFIX/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.codex/bin:$HOME/.bun/bin:$HOME/.cargo/bin"
export PATH="$MAC_RUNNER_PATH:${PATH:-}"
export npm_config_cache="$NPM_CACHE_DIR"
export NPM_CONFIG_CACHE="$NPM_CACHE_DIR"
export npm_config_update_notifier=false
export NPM_CONFIG_UPDATE_NOTIFIER=false
export CODEX_HOME="$CODEX_AUTH_HOME"

CODEX_CLI_HELPER="$ROOT_DIR/infra/macos/codex-cli.sh"
if [ -r "$CODEX_CLI_HELPER" ]; then
  # shellcheck source=/dev/null
  . "$CODEX_CLI_HELPER"
fi

print_line() {
  printf '%s\n' "$*"
}

log_line() {
  local line
  line="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
  print_line "$line"
  printf '%s\n' "$line" >> "$LOG_FILE"
}

pause_before_exit() {
  if [ -t 0 ]; then
    print_line ""
    print_line "Press Enter to close this window."
    read -r _ || true
  fi
}

mkdir -p "$LOG_DIR" "$NPM_CACHE_DIR" "$NPM_PREFIX/bin"
touch "$LOG_FILE"

print_line "Codex CLI setup"
print_line "Repository: $ROOT_DIR"
print_line "Install prefix: $NPM_PREFIX"
print_line "Log: $LOG_FILE"
print_line ""

CODEX_COMMAND=""
if command -v codex_reader_resolve_codex >/dev/null 2>&1; then
  CODEX_COMMAND="$(codex_reader_resolve_codex || true)"
fi

if [ -n "$CODEX_COMMAND" ]; then
  log_line "Codex CLI already found: $CODEX_COMMAND"
else
  if ! command -v npm >/dev/null 2>&1; then
    log_line "npm was not found. Install Node.js, then run this setup again."
    print_line ""
    print_line "Official alternatives:"
    print_line "  curl -fsSL https://chatgpt.com/codex/install.sh | sh"
    print_line "  brew install --cask codex"
    pause_before_exit
    exit 1
  fi

  log_line "Installing @openai/codex with npm into $NPM_PREFIX"
  npm install -g @openai/codex --prefix "$NPM_PREFIX" --no-audit --no-fund >> "$LOG_FILE" 2>&1
  CODEX_COMMAND="$(codex_reader_resolve_codex || true)"
fi

if [ -z "$CODEX_COMMAND" ]; then
  log_line "Codex CLI installation finished, but no working codex binary was found."
  print_line ""
  print_line "Try one of the official install commands manually:"
  print_line "  curl -fsSL https://chatgpt.com/codex/install.sh | sh"
  print_line "  npm install -g @openai/codex"
  print_line "  brew install --cask codex"
  pause_before_exit
  exit 1
fi

VERSION="$("$CODEX_COMMAND" --version 2>&1 || true)"
log_line "Codex CLI ready: $CODEX_COMMAND"
log_line "Version: $VERSION"
log_line "Codex auth home: $CODEX_HOME"

print_line ""
print_line "Codex CLI is ready:"
print_line "  $CODEX_COMMAND"
print_line "Codex auth home:"
print_line "  $CODEX_HOME"
print_line ""

if [ -t 0 ]; then
  print_line "If this Mac has not signed in to Codex yet, start login now."
  printf 'Run "codex login" now? [Y/n] '
  read -r ANSWER || ANSWER=""
  case "$ANSWER" in
    n|N|no|NO)
      print_line "Skipped login. You can run later:"
      print_line "  \"$CODEX_COMMAND\" login"
      ;;
    *)
      "$CODEX_COMMAND" login
      ;;
  esac
else
  print_line "If needed, sign in later with:"
  print_line "  \"$CODEX_COMMAND\" login"
fi

print_line ""
print_line "After login, restart:"
print_line "  ./★CodexReader\\ Tunnel.command"
pause_before_exit
