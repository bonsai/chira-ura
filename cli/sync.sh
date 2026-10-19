#!/usr/bin/env bash
# crx/ → Chrome の unpacked 読込先へ反映（repo: dev/ crx/ cli/）
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/crx"
# 読込先: CHIRA_LOAD_DIR > ~/.crx > Windows 側 ~/.crx（WSL など）
if [ -n "${CHIRA_LOAD_DIR:-}" ]; then
  DST="$CHIRA_LOAD_DIR"
elif [ -d "$HOME/.crx/chira-ura-crx" ]; then
  DST="$HOME/.crx/chira-ura-crx"
else
  DST="$(ls -d /mnt/[a-z]/Users/*/.crx/chira-ura-crx 2>/dev/null | head -1)"
fi
[ -n "${DST:-}" ] || { echo "読込先が見つからない。CHIRA_LOAD_DIR で指定する" >&2; exit 1; }

[ -d "$DST" ] || { echo "読込先が無い: $DST（CHIRA_LOAD_DIR で指定）" >&2; exit 1; }

rsync -a --delete --exclude '.git' "$SRC"/ "$DST"/
echo "synced: $SRC -> $DST"
echo "chrome://extensions で「再読み込み」"
