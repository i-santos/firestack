#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=""
if [[ "${1:-}" == "--env-file" ]]; then
  ENV_FILE="${2:-}"
  shift 2
fi

if [[ "${1:-}" != "--" ]]; then
  echo "Usage: docker-suite.sh [--env-file <path>] -- <command...>" >&2
  exit 1
fi
shift

if [[ $# -eq 0 ]]; then
  echo "Usage: docker-suite.sh [--env-file <path>] -- <command...>" >&2
  exit 1
fi

if [[ -n "$ENV_FILE" && ! -f "$ENV_FILE" ]]; then
  echo "[firestack] env file not found: $ENV_FILE" >&2
  exit 1
fi

IMAGE="${FIRESTACK_DOCKER_IMAGE:-node:22-bookworm}"
BOOTSTRAP="${FIRESTACK_DOCKER_BOOTSTRAP:-npm ci}"
WORKDIR="/work"
NPM_CACHE_VOLUME="${FIRESTACK_DOCKER_NPM_CACHE_VOLUME:-firestack-npm-cache}"

mapfile -t CMD_ARRAY < <(printf '%s\n' "$@")
CMD_STR=$(printf '%q ' "${CMD_ARRAY[@]}")

ENV_ARGS=()
if [[ -n "$ENV_FILE" ]]; then
  ENV_ARGS+=(--env-file "$PWD/$ENV_FILE")
fi

docker run --rm -t \
  --init \
  -v "$PWD:$WORKDIR" \
  -v "$NPM_CACHE_VOLUME:/root/.npm" \
  -w "$WORKDIR" \
  "${ENV_ARGS[@]}" \
  "$IMAGE" \
  bash -lc "$BOOTSTRAP && $CMD_STR"
