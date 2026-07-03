#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
RUNTIME_HOME="${2:-${CODEX_READER_HOME:-$HOME/Library/Application Support/CodexReader}}"
VENV_DIR="$RUNTIME_HOME/python"
PIP_CACHE_DIR="$RUNTIME_HOME/pip-cache"
REQUIREMENTS_FILE="$ROOT_DIR/requirements-pdf.txt"

find_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi
  if command -v python >/dev/null 2>&1; then
    command -v python
    return
  fi
  return 1
}

if [ ! -f "$REQUIREMENTS_FILE" ]; then
  echo "Python PDF requirements file not found: $REQUIREMENTS_FILE"
  exit 1
fi

PYTHON_BIN="$(find_python)" || {
  echo "Python 3 was not found. PyMuPDF4LLM extraction will be skipped."
  exit 1
}

mkdir -p "$RUNTIME_HOME" "$PIP_CACHE_DIR"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

if "$VENV_DIR/bin/python" -c "import pymupdf4llm" >/dev/null 2>&1; then
  echo "PyMuPDF4LLM is already installed in $VENV_DIR"
  exit 0
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip --cache-dir "$PIP_CACHE_DIR"
"$VENV_DIR/bin/python" -m pip install --cache-dir "$PIP_CACHE_DIR" -r "$REQUIREMENTS_FILE"
"$VENV_DIR/bin/python" -c "import pymupdf4llm; print('PyMuPDF4LLM ready')"
