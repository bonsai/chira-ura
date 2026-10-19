#!/usr/bin/env bash
# crx/ → Chrome の unpacked 読込先へ反映（repo: dev/ crx/ cli/）
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/crx"
DST="${CHIRA_LOAD_DIR:-$HOME/.crx/chira-ura-crx}"

[ -d "$DST" ] || { echo "読込先が無い: $DST（CHIRA_LOAD_DIR で指定）" >&2; exit 1; }

rsync -a --delete --exclude '.git' "$SRC"/ "$DST"/
echo "synced: $SRC -> $DST"
echo "chrome://extensions で「再読み込み」"
