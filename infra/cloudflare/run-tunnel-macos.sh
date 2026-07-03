#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PORT="${CODEX_READER_PORT:-3001}"
HOST="${CODEX_READER_HOST:-127.0.0.1}"
LOCAL_URL="http://${HOST}:${PORT}"
PAGES_URL="${CODEX_READER_PAGES_URL:-https://pdf-study.pages.dev}"
TUNNEL_MODE="${CODEX_READER_TUNNEL_MODE:-quick}"
TUNNEL_ID="${CODEX_READER_TUNNEL_ID:-}"
TUNNEL_URL="${CODEX_READER_TUNNEL_URL:-}"
RUNTIME_HOME="${CODEX_READER_HOME:-$HOME/Library/Application Support/CodexReader}"
LOG_DIR="$RUNTIME_HOME/logs"
RUN_DIR="$RUNTIME_HOME/run"
RUNNER_LOG="$LOG_DIR/launcher.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
STATUS_FILE="$RUN_DIR/tunnel-status.json"
MAC_RUNNER_PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH="$MAC_RUNNER_PATH:${PATH:-}"
NPM_CACHE_DIR="$RUNTIME_HOME/npm-cache"
export npm_config_cache="$NPM_CACHE_DIR"
export NPM_CONFIG_CACHE="$NPM_CACHE_DIR"
export npm_config_update_notifier=false
export NPM_CONFIG_UPDATE_NOTIFIER=false

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

write_status() {
  local ok="$1"
  local pid="${2:-0}"
  local url="${3:-$TUNNEL_URL}"
  cat > "$STATUS_FILE" <<EOF
{"ok":${ok},"url":"${url}","pid":${pid},"updated_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
EOF
}

open_pages() {
  local url="${1:-$TUNNEL_URL}"
  if [ -z "$url" ]; then
    return
  fi
  local encoded
  encoded="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$url")"
  if command -v open >/dev/null 2>&1; then
    open "${PAGES_URL}/?apiBase=${encoded}" >/dev/null 2>&1 || true
  fi
}

detect_quick_tunnel_url() {
  grep -Eo 'https://[-a-zA-Z0-9.]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -n 1 || true
}

if [ ! -d "$ROOT_DIR/apps/mac-runner" ]; then
  show_message "Codex Reader Tunnel" "Could not find the Codex Reader source folder. Keep this launcher inside the repository folder."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  show_message "Codex Reader Tunnel" "Node.js was not found. Install Node.js 22 or newer, then run this launcher again."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  show_message "Codex Reader Tunnel" "npx was not found. Install Node.js 22 or newer, then run this launcher again."
  exit 1
fi

mkdir -p "$LOG_DIR" "$RUN_DIR" "$NPM_CACHE_DIR"

export CODEX_READER_HOME="$RUNTIME_HOME"
export CODEX_READER_HOST="$HOST"
export CODEX_READER_PORT="$PORT"
export CODEX_READER_CODEX_MODE="${CODEX_READER_CODEX_MODE:-auto}"
if [ -z "${CODEX_READER_CODEX_COMMAND:-}" ] && command -v codex >/dev/null 2>&1; then
  export CODEX_READER_CODEX_COMMAND="$(command -v codex)"
fi

PYTHON_DEPS_SCRIPT="$ROOT_DIR/infra/macos/ensure-python-pdf-deps.sh"
if [ -x "$PYTHON_DEPS_SCRIPT" ]; then
  if "$PYTHON_DEPS_SCRIPT" "$ROOT_DIR" "$RUNTIME_HOME" >> "$RUNNER_LOG" 2>&1; then
    export CODEX_READER_PYTHON="$RUNTIME_HOME/python/bin/python"
  else
    printf '[%s] PyMuPDF4LLM setup failed; legacy PDF extractor will be used.\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$RUNNER_LOG"
  fi
fi

cd "$ROOT_DIR"

if ! curl -fsS "$LOCAL_URL/health" >/dev/null 2>&1; then
  {
    printf '\n[%s] Starting Codex Reader server for Tunnel\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf '[%s] Runtime home: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RUNTIME_HOME"
  } >> "$RUNNER_LOG"

  nohup node "$ROOT_DIR/apps/mac-runner/CodexReaderRunner.js" >> "$RUNNER_LOG" 2>&1 &
fi

for _ in $(seq 1 30); do
  if curl -fsS "$LOCAL_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "$LOCAL_URL/health" >/dev/null 2>&1; then
  show_message "Codex Reader Tunnel" "The local server did not become ready. Check $RUNNER_LOG for details."
  exit 1
fi

if [ -n "$TUNNEL_URL" ] && curl -fsS "$TUNNEL_URL/health" >/dev/null 2>&1; then
  write_status true 1
  open_pages "$TUNNEL_URL"
  notify "Codex Reader Tunnel" "Tunnel is already online at $TUNNEL_URL"
  exit 0
fi

: > "$TUNNEL_LOG"
{
  printf '\n[%s] Starting Cloudflare Tunnel mode=%s -> %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$TUNNEL_MODE" "$LOCAL_URL"
  printf '[%s] PATH: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$PATH"
  printf '[%s] npm cache: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$NPM_CACHE_DIR"
  printf '[%s] Codex command: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${CODEX_READER_CODEX_COMMAND:-not found in launcher PATH}"
} >> "$TUNNEL_LOG"

if [ "$TUNNEL_MODE" = "named" ]; then
  if [ -z "$TUNNEL_URL" ]; then
    show_message "Codex Reader Tunnel" "Named Tunnel mode needs CODEX_READER_TUNNEL_URL."
    exit 1
  fi

  if [ -n "${CODEX_READER_TUNNEL_TOKEN:-}" ]; then
    nohup npx --yes wrangler@latest tunnel run --token "$CODEX_READER_TUNNEL_TOKEN" --log-level info >> "$TUNNEL_LOG" 2>&1 &
  elif [ -n "$TUNNEL_ID" ]; then
    nohup npx --yes wrangler@latest tunnel run "$TUNNEL_ID" --log-level info >> "$TUNNEL_LOG" 2>&1 &
  else
    show_message "Codex Reader Tunnel" "Named Tunnel mode needs CODEX_READER_TUNNEL_ID or CODEX_READER_TUNNEL_TOKEN."
    exit 1
  fi
else
  nohup npx --yes wrangler@latest tunnel quick-start "$LOCAL_URL" --log-level info >> "$TUNNEL_LOG" 2>&1 &
fi

TUNNEL_PID=$!
write_status false "$TUNNEL_PID" "$TUNNEL_URL"

for _ in $(seq 1 45); do
  if ! kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
    write_status false 0
    show_message "Codex Reader Tunnel" "The Tunnel process stopped. Check $TUNNEL_LOG."
    exit 1
  fi

  if [ -z "$TUNNEL_URL" ]; then
    TUNNEL_URL="$(detect_quick_tunnel_url)"
    if [ -n "$TUNNEL_URL" ]; then
      write_status false "$TUNNEL_PID" "$TUNNEL_URL"
    fi
  fi

  if [ -n "$TUNNEL_URL" ] && curl -fsS "$TUNNEL_URL/health" >/dev/null 2>&1; then
    write_status true "$TUNNEL_PID" "$TUNNEL_URL"
    open_pages "$TUNNEL_URL"
    notify "Codex Reader Tunnel" "Tunnel is online at $TUNNEL_URL"
    exit 0
  fi
  sleep 2
done

write_status false "$TUNNEL_PID" "$TUNNEL_URL"
show_message "Codex Reader Tunnel" "The Tunnel started but no reachable public URL was confirmed yet. Check $TUNNEL_LOG."
exit 1
