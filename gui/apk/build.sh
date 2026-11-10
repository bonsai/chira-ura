#!/usr/bin/env bash
set -euo pipefail

# Build Android client APK (Flutter)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$DIR/../mobile"

echo "Building Android APK from $MOBILE_DIR..."
cd "$MOBILE_DIR"
flutter build apk "$@"
