#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${FIRESTACK_REGISTRY_PORT:-4873}"
CONTAINER="${FIRESTACK_REGISTRY_CONTAINER:-firestack-verdaccio}"
VOLUME_NAME="${FIRESTACK_REGISTRY_VOLUME:-firestack-verdaccio-storage}"
CONFIG_FILE="$ROOT_DIR/verdaccio/config.yaml"

if ! command -v docker >/dev/null 2>&1; then
  echo "[firestack] docker not found in PATH" >&2
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[firestack] registry already running at http://127.0.0.1:$PORT"
  exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  docker rm "$CONTAINER" >/dev/null
fi

docker run -d \
  --name "$CONTAINER" \
  -p "$PORT:4873" \
  -v "$VOLUME_NAME:/verdaccio/storage" \
  -v "$CONFIG_FILE:/verdaccio/conf/config.yaml:ro" \
  verdaccio/verdaccio:5 >/dev/null

echo "[firestack] registry started at http://127.0.0.1:$PORT"
echo "[firestack] storage volume: $VOLUME_NAME"
