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

# With .neo/ gitignored (a supported setup) git reports nothing for brain paths,
# so there is no honest way to tell a saved brain from an unsaved one. Stand down.
git check-ignore -q .neo 2>/dev/null && exit 0

# Everything below compares against the session start marker written by
# brain-load.sh. Git state alone cannot answer "did THIS session save?":
# repo dirt predates the session, and brain-sync.sh commits the brain at every
# SessionEnd, so "the brain is in HEAD" is permanently true from session 2 on
# and silently retires the gate forever.
MARKER=".neo/.session"
[ -f "$MARKER" ] || exit 0

code_touched_this_session() {
  git status --porcelain -z -- ':(exclude).neo' 2>/dev/null |
    while IFS= read -r -d '' entry; do
      f="${entry:3}"
      [ -e "$f" ] || continue
      # An untracked DIRECTORY is reported as one entry, so -prune hid every file
      # inside it: work added to a directory that predates the session looked like
      # no work at all. `./` keeps a name like "-x.py" from being read as an option.
      if [ -n "$(find ./"$f" -newer "$MARKER" 2>/dev/null | head -n 1)" ]; then
        echo 1
        return 0
      fi
    done
}

brain_touched_this_session() {
  find .neo/brain -type f -newer "$MARKER" 2>/dev/null | head -n 1
}

if [ -n "$(code_touched_this_session)" ] && [ -z "$(brain_touched_this_session)" ]; then
  cat >&2 <<'EOF'
[neo stop-gate] Code changed during this session but the second brain was not updated.
Before finishing: spawn neo-shadow with the session delta (what happened, what changed, decisions, lessons, next steps) or run /neo:save.
If there is genuinely nothing worth saving, finish again and this gate will let you through.
EOF
  exit 2
fi

exit 0
