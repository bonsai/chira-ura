#!/usr/bin/env bash
set -euo pipefail

# Build iOS client (Flutter)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$DIR/../mobile"

echo "Building iOS bundle from $MOBILE_DIR..."
cd "$MOBILE_DIR"
flutter build ios --no-codesign "$@"
