#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
exec node "$HARNESS_ROOT/tools/drydock.js" iterate web "$@"
