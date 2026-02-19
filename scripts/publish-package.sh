#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="${FIRESTACK_REGISTRY:-http://127.0.0.1:4873}"
NPM_CACHE="${FIRESTACK_NPM_CACHE:-/tmp/npm-cache-firestack}"

cd "$ROOT_DIR"

if ! npm --cache "$NPM_CACHE" whoami --registry "$REGISTRY" >/dev/null 2>&1; then
  echo "[firestack] npm auth missing for $REGISTRY"
  echo "[firestack] run: npm adduser --registry $REGISTRY"
  exit 1
fi

npm --cache "$NPM_CACHE" publish --registry "$REGISTRY"
