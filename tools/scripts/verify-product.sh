#!/usr/bin/env bash
set -euo pipefail

MODE=commit
case "${1:-}" in
  --start)
    MODE=start
    ;;
  --strict)
    MODE=strict
    ;;
  --commit|'')
    MODE=commit
    ;;
  *)
    echo "Usage: verify-product.sh [--commit|--start|--strict]" >&2
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PRODUCT_ROOT="$REPO_ROOT/product"
REMOTE_REF_ROOT="refs/drydock-product-verify/$$"

cleanup_remote_refs() {
  while IFS= read -r ref; do
    [[ -n "$ref" ]] && git -C "$PRODUCT_ROOT" update-ref -d "$ref"
  done < <(git -C "$PRODUCT_ROOT" for-each-ref --format='%(refname)' "$REMOTE_REF_ROOT")
}
trap cleanup_remote_refs EXIT

warn_or_fail() {
  local message="$1"
  if [[ "$MODE" == start ]]; then
    echo "WARNING: $message" >&2
  else
    echo "ERROR: $message" >&2
    return 1
  fi
}

STATUS="$(git -C "$REPO_ROOT" submodule status -- product 2>/dev/null || true)"
MARKER="${STATUS:0:1}"

if [[ -z "$STATUS" || "$MARKER" == "-" ]]; then
  warn_or_fail "Product submodule is uninitialized."
  [[ "$MODE" == start ]] && exit 0 || exit 1
fi

if [[ "$MARKER" == "+" || "$MARKER" == "U" ]]; then
  warn_or_fail "Product checkout does not match the Drydock gitlink."
fi

DIRTY="$(git -C "$PRODUCT_ROOT" status --porcelain --untracked-files=normal)"
if [[ -n "$DIRTY" ]]; then
  if [[ "$MODE" == commit && "${DRYDOCK_ALLOW_DIRTY_PRODUCT:-0}" == 1 ]]; then
    echo "WARNING: allowing dirty product checkout via DRYDOCK_ALLOW_DIRTY_PRODUCT=1." >&2
  elif [[ "$MODE" == start ]]; then
    echo "WARNING: Product checkout has local changes." >&2
  else
    echo "ERROR: Product checkout has local changes." >&2
    exit 1
  fi
fi

if [[ "$MODE" == start ]]; then
  exit 0
fi

PIN="$(git -C "$REPO_ROOT" ls-files --stage -- product | awk '$1 == "160000" { print $2; exit }')"
if [[ -z "$PIN" ]]; then
  echo "ERROR: no staged product gitlink found." >&2
  exit 1
fi

if ! git -C "$PRODUCT_ROOT" remote get-url origin >/dev/null 2>&1; then
  echo "ERROR: Product submodule has no origin remote." >&2
  exit 1
fi

git -C "$PRODUCT_ROOT" fetch --quiet --prune --no-tags origin \
  "+refs/heads/*:$REMOTE_REF_ROOT/heads/*" \
  "+refs/tags/*:$REMOTE_REF_ROOT/tags/*"

if ! git -C "$PRODUCT_ROOT" cat-file -e "$PIN^{commit}" 2>/dev/null; then
  echo "ERROR: product gitlink $PIN is unavailable after fetching origin." >&2
  exit 1
fi

if [[ -z "$(git -C "$PRODUCT_ROOT" for-each-ref --format='%(refname)' --contains="$PIN" "$REMOTE_REF_ROOT")" ]]; then
  echo "ERROR: product gitlink $PIN is not reachable from the product origin." >&2
  exit 1
fi

if [[ "$MODE" == strict && "$MARKER" != " " ]]; then
  echo "ERROR: strict validation requires the exact initialized product gitlink checkout." >&2
  exit 1
fi

echo "Product submodule is valid ($PIN)."
