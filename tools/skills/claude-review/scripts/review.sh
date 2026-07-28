#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: review.sh <artifact> [review-focus]" >&2
  exit 2
fi

ARTIFACT="$1"
FOCUS="${2:-Identify incorrect assumptions, missing constraints, migration hazards, and meaningful counterarguments.}"
CLAUDE_REVIEW_MODEL="${CLAUDE_REVIEW_MODEL:-opus}"
CLAUDE_REVIEW_EFFORT="${CLAUDE_REVIEW_EFFORT:-medium}"

if [[ ! -f "$ARTIFACT" ]]; then
  echo "ERROR: review artifact is not a readable file: $ARTIFACT" >&2
  exit 2
fi

PROMPT="Independently review $ARTIFACT in the current repository. Start with that artifact and consult only directly relevant repository files when needed. Do not edit files. $FOCUS Distinguish blocking design problems from optional improvements, and cite the relevant section or file for every finding."

printf '%s\n' "$PROMPT" | claude \
  --print \
  --no-session-persistence \
  --permission-mode plan \
  --tools "Read,Glob,Grep" \
  --model "$CLAUDE_REVIEW_MODEL" \
  --effort "$CLAUDE_REVIEW_EFFORT"
