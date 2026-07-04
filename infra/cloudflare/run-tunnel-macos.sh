#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PORT="${CODEX_READER_PORT:-3001}"
HOST="${CODEX_READER_HOST:-127.0.0.1}"
LOCAL_URL="http://${HOST}:${PORT}"
PAGES_URL="${CODEX_READER_PAGES_URL:-https://pdf-study.pages.dev}"
DISCOVERY_URL="${CODEX_READER_DISCOVERY_URL:-https://pdf-study-discovery.jirehkwon.workers.dev}"
TUNNEL_MODE="${CODEX_READER_TUNNEL_MODE:-quick}"
TUNNEL_ID="${CODEX_READER_TUNNEL_ID:-}"
TUNNEL_URL="${CODEX_READER_TUNNEL_URL:-}"
RUNTIME_HOME="${CODEX_READER_HOME:-$HOME/Library/Application Support/CodexReader}"
DEFAULT_CODEX_HOME="$HOME/.codex"
CODEX_AUTH_HOME="${CODEX_HOME:-$DEFAULT_CODEX_HOME}"
if [ ! -f "$CODEX_AUTH_HOME/auth.json" ] && [ -f "$DEFAULT_CODEX_HOME/auth.json" ]; then
  CODEX_AUTH_HOME="$DEFAULT_CODEX_HOME"
fi
LOG_DIR="$RUNTIME_HOME/logs"
RUN_DIR="$RUNTIME_HOME/run"
RUNNER_LOG="$LOG_DIR/launcher.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
STATUS_FILE="$RUN_DIR/tunnel-status.json"
MAC_RUNNER_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.codex/bin:$HOME/.bun/bin:$HOME/.cargo/bin"
export PATH="$MAC_RUNNER_PATH:${PATH:-}"
NPM_CACHE_DIR="$RUNTIME_HOME/npm-cache"
LOCAL_CURL_MAX_TIME="${CODEX_READER_LOCAL_CURL_MAX_TIME:-3}"
PUBLIC_CURL_MAX_TIME="${CODEX_READER_PUBLIC_CURL_MAX_TIME:-8}"
REGISTER_CURL_MAX_TIME="${CODEX_READER_REGISTER_CURL_MAX_TIME:-20}"
OPEN_BROWSER="${CODEX_READER_OPEN_BROWSER:-true}"
CODEX_CLI_HELPER="$ROOT_DIR/infra/macos/codex-cli.sh"
TUNNEL_PID=""
export npm_config_cache="$NPM_CACHE_DIR"
export NPM_CONFIG_CACHE="$NPM_CACHE_DIR"
export npm_config_update_notifier=false
export NPM_CONFIG_UPDATE_NOTIFIER=false
export CODEX_HOME="$CODEX_AUTH_HOME"
if [ -r "$CODEX_CLI_HELPER" ]; then
  # shellcheck source=/dev/null
  . "$CODEX_CLI_HELPER"
fi

print_line() {
  printf '%s\n' "$*"
}

log_tunnel() {
  local message="$1"
  local line
  line="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $message"
  print_line "$line"
  printf '%s\n' "$line" >> "$TUNNEL_LOG"
}

log_runner() {
  local message="$1"
  local line
  line="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $message"
  print_line "$line"
  printf '%s\n' "$line" >> "$RUNNER_LOG"
}

http_ok() {
  local url="$1"
  local max_time="${2:-$PUBLIC_CURL_MAX_TIME}"
  curl -fsS --connect-timeout 3 --max-time "$max_time" "$url" >/dev/null 2>&1
}

show_message() {
  local title="$1"
  local message="$2"
  print_line ""
  print_line "$title: $message"
  print_line ""
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

restart_existing_runner() {
  local pid_file="$RUN_DIR/runner.pid"
  local pid=""

  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    case "$pid" in
      ''|*[!0-9]*)
        pid=""
        ;;
    esac
  fi

  if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
    log_runner "Stopping existing Codex Reader server pid=$pid for fresh launcher environment"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
  fi

  if http_ok "$LOCAL_URL/health" "$LOCAL_CURL_MAX_TIME"; then
    log_runner "Stopping existing Codex Reader server by process match for fresh launcher environment"
    pkill -f "$ROOT_DIR/apps/mac-runner/CodexReaderRunner.js" >/dev/null 2>&1 || true
    sleep 1
  fi

  rm -f "$RUN_DIR/runner.lock" "$RUN_DIR/runner.pid"
}

mark_tunnel_stopped() {
  write_status false 0 "$TUNNEL_URL"
}

stop_tunnel_and_exit() {
  mark_tunnel_stopped
  if [ -n "${TUNNEL_PID:-}" ] && kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
    kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  fi
  print_line ""
  print_line "Codex Reader Tunnel stopped."
  exit 0
}

write_status() {
  local ok="$1"
  local pid="${2:-0}"
  local url="${3:-$TUNNEL_URL}"
  cat > "$STATUS_FILE" <<EOF
{"ok":${ok},"url":"${url}","pid":${pid},"updated_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
EOF
}

show_recent_logs() {
  print_line ""
  print_line "Recent launcher log: $RUNNER_LOG"
  tail -n 40 "$RUNNER_LOG" 2>/dev/null || true
  print_line ""
  print_line "Recent tunnel log: $TUNNEL_LOG"
  tail -n 80 "$TUNNEL_LOG" 2>/dev/null || true
  print_line ""
}

fail_with_logs() {
  local message="$1"
  show_recent_logs
  show_message "Codex Reader Tunnel" "$message Logs are at $TUNNEL_LOG and $RUNNER_LOG."
  exit 1
}

open_pages() {
  local url="${1:-$TUNNEL_URL}"
  if [ -z "$url" ]; then
    return
  fi
  case "$OPEN_BROWSER" in
    false|False|FALSE|0|no|No|NO)
      log_tunnel "Browser auto-open disabled by CODEX_READER_OPEN_BROWSER=$OPEN_BROWSER"
      return
      ;;
  esac

  local timestamp
  local target
  timestamp="$(date +%s)"
  target="${PAGES_URL}/?refreshDiscovery=1&t=${timestamp}"
  log_tunnel "Opening browser: $target"
  if command -v open >/dev/null 2>&1; then
    if open "$target" >/dev/null 2>&1; then
      return
    fi
  fi
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "open location \"$target\"" >/dev/null 2>&1 || true
  fi
}

detect_quick_tunnel_url() {
  grep -Eo 'https://[-a-zA-Z0-9.]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -n 1 || true
}

register_tunnel_url() {
  local url="$1"
  if [ -z "$DISCOVERY_URL" ] || [ -z "$url" ]; then
    return 0
  fi

  local payload
  local response
  local exit_code
  payload="$(node -e 'console.log(JSON.stringify({ apiBase: process.argv[1] }))' "$url")"
  log_tunnel "Registering tunnel with discovery service: $url"
  if response="$(curl -fsS --connect-timeout 5 --max-time "$REGISTER_CURL_MAX_TIME" -X POST -H "Content-Type: application/json" --data "$payload" "$DISCOVERY_URL/register" 2>&1)"; then
    printf '%s\n' "$response" >> "$TUNNEL_LOG"
    if node -e 'const payload = JSON.parse(process.argv[1]); process.exit(payload && payload.ok === true ? 0 : 1);' "$response" >/dev/null 2>&1; then
      log_tunnel "Registered tunnel with discovery service: $DISCOVERY_URL"
      return 0
    fi
    log_tunnel "Discovery registration returned non-ok response: $response"
    return 1
  else
    exit_code=$?
    log_tunnel "Discovery registration failed: $DISCOVERY_URL (curl exit $exit_code) $response"
    return 1
  fi
}

keep_tunnel_running() {
  local url="$1"
  print_line ""
  print_line "Tunnel is online: $url"
  print_line "Keep this Terminal window open while using Codex Reader from other devices."
  print_line "If an old browser tab still says MacBook offline, refresh it or open ${PAGES_URL}/?refreshDiscovery=1."
  print_line "Press Control-C to stop the tunnel."
  print_line ""
  trap stop_tunnel_and_exit INT TERM
  wait "$TUNNEL_PID"
  local exit_code=$?
  mark_tunnel_stopped
  show_message "Codex Reader Tunnel" "The Tunnel process stopped. Other devices will show MacBook offline until you run ★CodexReader Tunnel.command again."
  exit "$exit_code"
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
touch "$RUNNER_LOG" "$TUNNEL_LOG"

print_line "Codex Reader Tunnel launcher"
print_line "Repository: $ROOT_DIR"
print_line "Local API: $LOCAL_URL"
print_line "Logs: $TUNNEL_LOG"
print_line ""

export CODEX_READER_HOME="$RUNTIME_HOME"
export CODEX_READER_HOST="$HOST"
export CODEX_READER_PORT="$PORT"
export CODEX_READER_CODEX_MODE="${CODEX_READER_CODEX_MODE:-auto}"
export CODEX_READER_MAX_CODEX_CONCURRENCY="${CODEX_READER_MAX_CODEX_CONCURRENCY:-4}"
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
  log_runner "Checking Python PDF extractor dependencies"
  if "$PYTHON_DEPS_SCRIPT" "$ROOT_DIR" "$RUNTIME_HOME" >> "$RUNNER_LOG" 2>&1; then
    export CODEX_READER_PYTHON="$RUNTIME_HOME/python/bin/python"
    log_runner "PyMuPDF4LLM extractor is ready"
  else
    log_runner "PyMuPDF4LLM setup failed; legacy PDF extractor will be used"
  fi
fi

cd "$ROOT_DIR"

write_status false 0 ""
restart_existing_runner

if ! http_ok "$LOCAL_URL/health" "$LOCAL_CURL_MAX_TIME"; then
  log_runner "Starting Codex Reader server for Tunnel"
  log_runner "Runtime home: $RUNTIME_HOME"

  nohup node "$ROOT_DIR/apps/mac-runner/CodexReaderRunner.js" >> "$RUNNER_LOG" 2>&1 &
fi

print_line "Waiting for local server..."
for _ in $(seq 1 30); do
  if http_ok "$LOCAL_URL/health" "$LOCAL_CURL_MAX_TIME"; then
    break
  fi
  sleep 1
done

if ! http_ok "$LOCAL_URL/health" "$LOCAL_CURL_MAX_TIME"; then
  fail_with_logs "The local server did not become ready."
fi
print_line "Local server is ready."

if [ -n "$TUNNEL_URL" ] && http_ok "$TUNNEL_URL/health" "$PUBLIC_CURL_MAX_TIME"; then
  write_status true 1
  register_tunnel_url "$TUNNEL_URL" || true
  open_pages "$TUNNEL_URL"
  notify "Codex Reader Tunnel" "Tunnel is already online at $TUNNEL_URL"
  exit 0
fi

: > "$TUNNEL_LOG"
log_tunnel "Starting Cloudflare Tunnel mode=$TUNNEL_MODE -> $LOCAL_URL"
log_tunnel "PATH: $PATH"
log_tunnel "npm cache: $NPM_CACHE_DIR"
log_tunnel "Discovery URL: $DISCOVERY_URL"
log_tunnel "Codex command: ${CODEX_READER_CODEX_COMMAND:-not found in launcher PATH}"
log_tunnel "Max Codex concurrency: $CODEX_READER_MAX_CODEX_CONCURRENCY"
log_tunnel "Codex auth home: $CODEX_HOME"
if [ -f "$CODEX_HOME/auth.json" ]; then
  log_tunnel "Codex auth file: found"
else
  log_tunnel "Codex auth file: missing"
fi

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
  print_line "Starting temporary Cloudflare Tunnel. First run can take a minute while Wrangler is downloaded."
  nohup npx --yes wrangler@latest tunnel quick-start "$LOCAL_URL" --log-level info >> "$TUNNEL_LOG" 2>&1 &
fi

TUNNEL_PID=$!
write_status false "$TUNNEL_PID" "$TUNNEL_URL"

for _ in $(seq 1 45); do
  if ! kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
    write_status false 0
    fail_with_logs "The Tunnel process stopped."
  fi

  if [ -z "$TUNNEL_URL" ]; then
    TUNNEL_URL="$(detect_quick_tunnel_url)"
    if [ -n "$TUNNEL_URL" ]; then
      log_tunnel "Detected public tunnel URL: $TUNNEL_URL"
      write_status false "$TUNNEL_PID" "$TUNNEL_URL"
    fi
  fi

  if [ -n "$TUNNEL_URL" ] && register_tunnel_url "$TUNNEL_URL"; then
    log_tunnel "Discovery service confirmed public tunnel health"
    write_status true "$TUNNEL_PID" "$TUNNEL_URL"
    open_pages "$TUNNEL_URL"
    notify "Codex Reader Tunnel" "Tunnel is online at $TUNNEL_URL"
    keep_tunnel_running "$TUNNEL_URL"
  fi

  if [ -n "$TUNNEL_URL" ] && http_ok "$TUNNEL_URL/health" "$PUBLIC_CURL_MAX_TIME"; then
    log_tunnel "Public tunnel health check passed"
    write_status true "$TUNNEL_PID" "$TUNNEL_URL"
    if register_tunnel_url "$TUNNEL_URL"; then
      open_pages "$TUNNEL_URL"
      notify "Codex Reader Tunnel" "Tunnel is online at $TUNNEL_URL"
      keep_tunnel_running "$TUNNEL_URL"
    fi
  fi
  sleep 2
done

write_status false "$TUNNEL_PID" "$TUNNEL_URL"
fail_with_logs "The Tunnel started but no reachable public URL was confirmed yet."
