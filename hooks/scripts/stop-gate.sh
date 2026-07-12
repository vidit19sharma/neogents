#!/usr/bin/env bash
# Stop: one-shot verification gate.
# Blocks completion ONCE (exit 2 + reason on stderr) when code changed but the
# brain was not saved. On the retry, stop_hook_active is true and we allow —
# never an infinite loop, never a hard wall.
set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"

# One-shot: if we already blocked once this stop cycle, allow.
if command -v jq >/dev/null 2>&1; then
  ACTIVE="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
else
  case "$INPUT" in *'"stop_hook_active":true'*) ACTIVE=true ;; *) ACTIVE=false ;; esac
fi
[ "$ACTIVE" = "true" ] && exit 0

# No brain, no gate.
[ -d ".neo/brain" ] || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Dirty code (outside .neo/) with an untouched brain = stale memory.
CODE_DIRTY="$(git status --porcelain 2>/dev/null | grep -v ' \.neo/' | grep -v '^.. \.neo/' | grep -c . || true)"
BRAIN_DIRTY="$(git status --porcelain -- .neo/brain 2>/dev/null | grep -c . || true)"

if [ "${CODE_DIRTY:-0}" -gt 0 ] && [ "${BRAIN_DIRTY:-0}" -eq 0 ]; then
  cat >&2 <<'EOF'
[neo stop-gate] Code changed this session but the second brain was not updated.
Before finishing: spawn neo-shadow with the session delta (what happened, what changed, decisions, lessons, next steps) or run /neo:save.
If there is genuinely nothing worth saving, finish again and this gate will let you through.
EOF
  exit 2
fi

exit 0
