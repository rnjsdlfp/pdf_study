#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PORT="${CODEX_READER_PORT:-3001}"
HOST="${CODEX_READER_HOST:-127.0.0.1}"
LOCAL_URL="http://${HOST}:${PORT}"
PAGES_URL="${CODEX_READER_PAGES_URL:-https://pdf-study.pages.dev}"
TUNNEL_ID="${CODEX_READER_TUNNEL_ID:-7b63dd79-b0f5-410c-a5f1-16f3b86e7ca2}"
TUNNEL_URL="${CODEX_READER_TUNNEL_URL:-https://reader-api.futurecontext.net}"
RUNTIME_HOME="${CODEX_READER_HOME:-$HOME/Library/Application Support/CodexReader}"
LOG_DIR="$RUNTIME_HOME/logs"
RUN_DIR="$RUNTIME_HOME/run"
RUNNER_LOG="$LOG_DIR/launcher.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
STATUS_FILE="$RUN_DIR/tunnel-status.json"

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
  cat > "$STATUS_FILE" <<EOF
{"ok":${ok},"url":"${TUNNEL_URL}","pid":${pid},"updated_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
EOF
}

open_pages() {
  local encoded
  encoded="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$TUNNEL_URL")"
  if command -v open >/dev/null 2>&1; then
    open "${PAGES_URL}/?apiBase=${encoded}" >/dev/null 2>&1 || true
  fi
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

mkdir -p "$LOG_DIR" "$RUN_DIR"

export CODEX_READER_HOME="$RUNTIME_HOME"
export CODEX_READER_HOST="$HOST"
export CODEX_READER_PORT="$PORT"
export CODEX_READER_CODEX_MODE="${CODEX_READER_CODEX_MODE:-auto}"

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

if curl -fsS "$TUNNEL_URL/health" >/dev/null 2>&1; then
  write_status true 1
  open_pages
  notify "Codex Reader Tunnel" "Tunnel is already online at $TUNNEL_URL"
  exit 0
fi

{
  printf '\n[%s] Starting Cloudflare Tunnel %s -> %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$TUNNEL_ID" "$LOCAL_URL"
  printf '[%s] Public API URL: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$TUNNEL_URL"
} >> "$TUNNEL_LOG"

if [ -n "${CODEX_READER_TUNNEL_TOKEN:-}" ]; then
  nohup npx --yes wrangler@latest tunnel run --token "$CODEX_READER_TUNNEL_TOKEN" --log-level info >> "$TUNNEL_LOG" 2>&1 &
else
  nohup npx --yes wrangler@latest tunnel run "$TUNNEL_ID" --log-level info >> "$TUNNEL_LOG" 2>&1 &
fi

TUNNEL_PID=$!
write_status false "$TUNNEL_PID"

for _ in $(seq 1 45); do
  if ! kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
    write_status false 0
    show_message "Codex Reader Tunnel" "The Tunnel process stopped. Check $TUNNEL_LOG. If this is the first run on this Mac, run: npx wrangler login"
    exit 1
  fi

  if curl -fsS "$TUNNEL_URL/health" >/dev/null 2>&1; then
    write_status true "$TUNNEL_PID"
    open_pages
    notify "Codex Reader Tunnel" "Tunnel is online at $TUNNEL_URL"
    exit 0
  fi
  sleep 2
done

write_status false "$TUNNEL_PID"
show_message "Codex Reader Tunnel" "The Tunnel started but $TUNNEL_URL is not reachable yet. Check DNS and $TUNNEL_LOG."
exit 1
