#!/usr/bin/env bash
# SessionEnd: commit brain changes so memory survives and travels with the repo.
# Opt out: create .neo/no-auto-commit
# This script must NEVER fail the session end — exit 0 on every path.
set -uo pipefail

# Hook processes run in Claude's current directory, which follows `cd` mid-session,
# so anchor to the repo root first (CLAUDE_PROJECT_DIR is the launch dir, not the root).
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -n "$ROOT" ] && { cd "$ROOT" || exit 0; }

[ -d ".neo/brain" ] || exit 0
[ -f ".neo/no-auto-commit" ] && exit 0

# Must be inside a git work tree.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Detached HEAD (bisect, tag checkout, etc.) has no branch to land the commit
# on reachably — the next checkout would wipe it. Only commit on a real branch.
git symbolic-ref -q HEAD >/dev/null || exit 0

GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)" || exit 0
# Never touch the index mid rebase/merge/cherry-pick/revert/bisect.
for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
  [ -e "$GIT_DIR/$state" ] && exit 0
done

# Anything to commit under .neo/brain (tracked changes or untracked files)?
if git status --porcelain -- .neo/brain 2>/dev/null | grep -q .; then
  # What the user had staged before we touched the index, so a failed commit
  # restores their staging instead of discarding it.
  STAGED_BEFORE="$(git diff --cached --name-only -- .neo/brain 2>/dev/null)"
  git add -- .neo/brain >/dev/null 2>&1 || exit 0
  # --no-verify is deliberate: hooks (including secret scanners and any hook
  # that can fail) must not break session end. The brain is markdown the user
  # can inspect and amend.
  if ! git commit --no-verify --quiet -m "neo: brain sync $(date +%Y-%m-%d)" -- .neo/brain >/dev/null 2>&1; then
    git reset -q -- .neo/brain >/dev/null 2>&1
    if [ -n "$STAGED_BEFORE" ]; then
      printf '%s\n' "$STAGED_BEFORE" | tr '\n' '\0' | xargs -0 git add -- >/dev/null 2>&1
    fi
  fi
fi

exit 0
