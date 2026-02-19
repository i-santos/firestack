#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${FIRESTACK_REGISTRY_CONTAINER:-firestack-verdaccio}"
VOLUME_NAME="${FIRESTACK_REGISTRY_VOLUME:-firestack-verdaccio-storage}"
PURGE_STORAGE="${FIRESTACK_REGISTRY_PURGE_STORAGE:-false}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[firestack] docker not found in PATH" >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  docker rm -f "$CONTAINER" >/dev/null
  echo "[firestack] registry container removed: $CONTAINER"
else
  echo "[firestack] registry container not found: $CONTAINER"
fi

if [[ "$PURGE_STORAGE" == "true" ]]; then
  if docker volume ls --format '{{.Name}}' | grep -qx "$VOLUME_NAME"; then
    docker volume rm "$VOLUME_NAME" >/dev/null
    echo "[firestack] registry volume removed: $VOLUME_NAME"
  else
    echo "[firestack] registry volume not found: $VOLUME_NAME"
  fi
fi
