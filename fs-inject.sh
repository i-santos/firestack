#!/usr/bin/env bash
set -euo pipefail

TARGET="$(pwd)"
FORCE="false"
DRY_RUN="false"

usage() {
  cat <<'USAGE'
Usage:
  bash firestack/fs-inject.sh [--target <dir>] [--force] [--dry-run]

Options:
  --target   Project directory to install FireStack kit into (default: current dir)
  --force    Overwrite existing FireStack templates and fs:* scripts
  --dry-run  Preview changes without writing files
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --force)
      FORCE="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Invalid argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/fs-install.mjs"

if [[ ! -f "$INSTALLER" ]]; then
  echo "[firestack] installer not found: $INSTALLER" >&2
  exit 1
fi

CMD=(node "$INSTALLER" --target "$TARGET")

if [[ "$FORCE" == "true" ]]; then
  CMD+=(--force)
fi

if [[ "$DRY_RUN" == "true" ]]; then
  CMD+=(--dry-run)
fi

"${CMD[@]}"

echo "[firestack] next steps:"
echo "1) copy .env.fs.<env>.example to .env.fs.<env> and set real values"
echo "2) run: npm run fs:env:check"
echo "3) run: npm run fs:test:ci:docker"
