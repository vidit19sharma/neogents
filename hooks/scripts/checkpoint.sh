#!/usr/bin/env bash
# Stop + PreCompact: deterministic session checkpoint. Zero LLM — pure git.
# Snapshots volatile session state to .neo/CHECKPOINT.md so compaction or a
# crash never loses where work stood. brain-load.sh injects it next session
# while fresh. Throttled on Stop (fires every reply); always on PreCompact.
# Never blocks: exit 0 on every path.
set -uo pipefail

[ -d ".neo" ] || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null || true)"

EVENT=""
LAST_MSG=""
if command -v jq >/dev/null 2>&1; then
  EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)"
  LAST_MSG="$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null || true)"
fi

OUT=".neo/CHECKPOINT.md"

# Throttle Stop-triggered writes; a PreCompact snapshot must never be skipped.
if [ "$EVENT" != "PreCompact" ] && [ -f "$OUT" ] && [ -n "$(find "$OUT" -mmin -10 2>/dev/null)" ]; then
  exit 0
fi

{
  echo "# Checkpoint (machine-written — newest wins, safe to delete)"
  echo ""
  echo "- when: $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "- event: ${EVENT:-Stop}"
  echo "- branch: $(git branch --show-current 2>/dev/null || echo '?')"
  echo "- head: $(git log -1 --oneline 2>/dev/null || echo 'no commits')"
  echo ""
  echo "## Uncommitted files"
  echo ""
  echo '```'
  git status --short 2>/dev/null | head -n 100 || true
  echo '```'
  echo ""
  echo "## Diff stat (vs HEAD)"
  echo ""
  echo '```'
  git diff HEAD --stat 2>/dev/null | tail -n 40 || true
  echo '```'
  if [ -n "$LAST_MSG" ]; then
    echo ""
    echo "## Last assistant message"
    echo ""
    printf '%s' "$LAST_MSG" | head -c 4000
    echo ""
  fi
} > "${OUT}.tmp.$$" 2>/dev/null && mv -f "${OUT}.tmp.$$" "$OUT" 2>/dev/null || rm -f "${OUT}.tmp.$$" 2>/dev/null

exit 0
