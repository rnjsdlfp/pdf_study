#!/usr/bin/env bash

codex_reader_resolve_codex() {
  local explicit="${CODEX_READER_CODEX_COMMAND:-}"
  local candidate

  if [ -n "$explicit" ]; then
    if codex_reader_command_ok "$explicit"; then
      printf '%s\n' "$explicit"
      return 0
    fi
    if candidate="$(command -v "$explicit" 2>/dev/null)" && codex_reader_command_ok "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  if candidate="$(command -v codex 2>/dev/null)" && codex_reader_command_ok "$candidate"; then
    printf '%s\n' "$candidate"
    return 0
  fi

  for candidate in \
    "$HOME/.npm-global/bin/codex" \
    "$HOME/.local/bin/codex" \
    "$HOME/.codex/bin/codex" \
    "$HOME/.bun/bin/codex" \
    "$HOME/.cargo/bin/codex" \
    "/opt/homebrew/bin/codex" \
    "/usr/local/bin/codex" \
    "/Applications/Codex.app/Contents/Resources/codex" \
    "$HOME/Applications/Codex.app/Contents/Resources/codex"; do
    if codex_reader_command_ok "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  for shell in /bin/zsh /bin/bash; do
    if [ -x "$shell" ]; then
      candidate="$("$shell" -lc 'command -v codex' 2>/dev/null | tail -n 1 || true)"
      if [ -n "$candidate" ] && codex_reader_command_ok "$candidate"; then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
  done

  return 1
}

codex_reader_command_ok() {
  local command_path="$1"
  [ -n "$command_path" ] || return 1
  "$command_path" --version >/dev/null 2>&1
}
