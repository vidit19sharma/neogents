#!/usr/bin/env bash
# Stop: one-shot verification gate.
# Blocks completion ONCE (exit 2 + reason on stderr) when code changed but the
# brain was not saved. On the retry, stop_hook_active is true and we allow —
# never an infinite loop, never a hard wall.
set -uo pipefail

# Hook processes run in Claude's current directory, which follows `cd` mid-session,
# so anchor to the repo root first (CLAUDE_PROJECT_DIR is the launch dir, not the root).
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -n "$ROOT" ] && { cd "$ROOT" || exit 0; }

INPUT="$(cat 2>/dev/null || true)"

# One-shot: if we already blocked once this stop cycle, allow.
if command -v jq >/dev/null 2>&1; then
  ACTIVE="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
else
  # Payloads arrive pretty-printed, so a fixed-spacing glob never matches.
  if printf '%s' "$INPUT" | grep -qE '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    ACTIVE=true
  else
    ACTIVE=false
  fi
fi
[ "$ACTIVE" = "true" ] && exit 0

# No brain, no gate.
[ -d ".neo/brain" ] || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Dirty code (outside .neo/) with an untouched brain = stale memory.
CODE_DIRTY="$(git status --porcelain -- ':(exclude).neo' 2>/dev/null | grep -c . || true)"
BRAIN_DIRTY="$(git status --porcelain -- .neo/brain 2>/dev/null | grep -c . || true)"

# A brain that was saved AND committed leaves nothing dirty, so dirtiness alone
# punishes the sessions that did the right thing: a brain landed in the last
# commit counts as saved.
BRAIN_COMMITTED=0
git log -1 --name-only --pretty=format: 2>/dev/null | grep -q '^\.neo/brain/' && BRAIN_COMMITTED=1

if [ "${CODE_DIRTY:-0}" -gt 0 ] && [ "${BRAIN_DIRTY:-0}" -eq 0 ] && [ "$BRAIN_COMMITTED" -eq 0 ]; then
  cat >&2 <<'EOF'
[neo stop-gate] The repo has uncommitted code changes (this session or earlier) but the second brain was not updated.
Before finishing: spawn neo-shadow with the session delta (what happened, what changed, decisions, lessons, next steps) or run /neo:save.
If there is genuinely nothing worth saving, finish again and this gate will let you through.
EOF
  exit 2
fi

exit 0
