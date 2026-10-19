#!/usr/bin/env bash
# chira コマンドを PATH に置く（skill から CLI を呼べるようにする）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${CHIRA_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN"
chmod +x "$HERE/cli.js"
ln -sf "$HERE/cli.js" "$BIN/chira"
echo "installed: $BIN/chira -> $HERE/cli.js"
"$BIN/chira" path
