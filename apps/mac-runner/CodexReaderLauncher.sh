#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PORT="${CODEX_READER_PORT:-3001}"
HOST="${CODEX_READER_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}"
RUNTIME_HOME="${CODEX_READER_HOME:-$HOME/Library/Application Support/CodexReader}"
CODEX_AUTH_HOME="${CODEX_HOME:-$HOME/.codex}"
LOG_DIR="$RUNTIME_HOME/logs"
LAUNCH_LOG="$LOG_DIR/launcher.log"
MAC_RUNNER_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.codex/bin:$HOME/.bun/bin:$HOME/.cargo/bin"
export PATH="$MAC_RUNNER_PATH:${PATH:-}"
export CODEX_HOME="$CODEX_AUTH_HOME"
CODEX_CLI_HELPER="$ROOT_DIR/infra/macos/codex-cli.sh"
if [ -r "$CODEX_CLI_HELPER" ]; then
  # shellcheck source=/dev/null
  . "$CODEX_CLI_HELPER"
fi

show_message() {
  local title="$1"
  local message="$2"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"$message\" with title \"$title\" buttons {\"OK\"} default button \"OK\"" >/dev/null 2>&1 || true
  else
    printf '%s: %s\n' "$title" "$message"
  fi
}

notify() {
  local title="$1"
  local message="$2"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$message\" with title \"$title\"" >/dev/null 2>&1 || true
  fi
}

if [ ! -d "$ROOT_DIR/apps/mac-runner" ]; then
  show_message "Codex Reader" "Could not find the Codex Reader source folder. Keep this launcher inside the repository folder."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  show_message "Codex Reader" "Node.js was not found. Install Node.js 22 or newer, then run this launcher again."
  exit 1
fi

mkdir -p "$LOG_DIR"

export CODEX_READER_HOME="$RUNTIME_HOME"
export CODEX_READER_HOST="$HOST"
export CODEX_READER_PORT="$PORT"
export CODEX_READER_CODEX_MODE="${CODEX_READER_CODEX_MODE:-auto}"
if [ -z "${CODEX_READER_CODEX_COMMAND:-}" ] && command -v codex_reader_resolve_codex >/dev/null 2>&1; then
  CODEX_READER_CODEX_COMMAND="$(codex_reader_resolve_codex || true)"
  if [ -n "$CODEX_READER_CODEX_COMMAND" ]; then
    export CODEX_READER_CODEX_COMMAND
  fi
elif [ -z "${CODEX_READER_CODEX_COMMAND:-}" ] && command -v codex >/dev/null 2>&1; then
  export CODEX_READER_CODEX_COMMAND="$(command -v codex)"
fi

PYTHON_DEPS_SCRIPT="$ROOT_DIR/infra/macos/ensure-python-pdf-deps.sh"
if [ -x "$PYTHON_DEPS_SCRIPT" ]; then
  if "$PYTHON_DEPS_SCRIPT" "$ROOT_DIR" "$RUNTIME_HOME" >> "$LAUNCH_LOG" 2>&1; then
    export CODEX_READER_PYTHON="$RUNTIME_HOME/python/bin/python"
  else
    printf '[%s] PyMuPDF4LLM setup failed; legacy PDF extractor will be used.\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$LAUNCH_LOG"
  fi
fi

cd "$ROOT_DIR"

{
  printf '\n[%s] Launch requested from %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$ROOT_DIR"
  printf '[%s] Runtime home: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RUNTIME_HOME"
  printf '[%s] Codex auth home: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$CODEX_HOME"
  if [ -f "$CODEX_HOME/auth.json" ]; then
    printf '[%s] Codex auth file: found\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  else
    printf '[%s] Codex auth file: missing\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  fi
  printf '[%s] PATH: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$PATH"
  printf '[%s] Codex command: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${CODEX_READER_CODEX_COMMAND:-not found in launcher PATH}"
} >> "$LAUNCH_LOG"

nohup node "$ROOT_DIR/apps/mac-runner/CodexReaderRunner.js" >> "$LAUNCH_LOG" 2>&1 &
RUNNER_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS "$URL/health" >/dev/null 2>&1; then
    if command -v open >/dev/null 2>&1; then
      open "$URL" >/dev/null 2>&1 || true
    fi
    notify "Codex Reader" "Server is running on $URL"
    exit 0
  fi

  if ! kill -0 "$RUNNER_PID" >/dev/null 2>&1; then
    # A second launch exits quickly when an existing runner is already alive.
    sleep 1
  else
    sleep 1
  fi
done

show_message "Codex Reader" "The server did not become ready. Check $LAUNCH_LOG for details."
exit 1
