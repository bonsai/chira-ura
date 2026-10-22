#!/usr/bin/env bash
# crx/ → Chrome の unpacked 読込先へ反映（repo: dev/ crx/ cli/）
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/crx"
# 読込先: CHIRA_LOAD_DIR > repo 内 dist/chira-ura-crx
if [ -n "${CHIRA_LOAD_DIR:-}" ]; then
  DST="$CHIRA_LOAD_DIR"
elif [ -d "$(cd "$(dirname "$0")/../.." && pwd)/dist/chira-ura-crx" ]; then
  DST="$(cd "$(dirname "$0")/../.." && pwd)/dist/chira-ura-crx"
fi
[ -n "${DST:-}" ] || { echo "読込先が見つからない。CHIRA_LOAD_DIR で指定する" >&2; exit 1; }

[ -d "$DST" ] || { echo "読込先が無い: $DST（CHIRA_LOAD_DIR で指定）" >&2; exit 1; }

# 読込先の DB と canonical は消さない（--delete の対象から外す）
rsync -a --delete --exclude '.git' --exclude 'ura.db' --exclude 'canonical' "$SRC"/ "$DST"/
echo "synced: $SRC -> $DST"
echo "chrome://extensions で「再読み込み」"
