#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${FIRESTACK_REGISTRY_CONTAINER:-firestack-verdaccio}"

docker logs -f "$CONTAINER"
