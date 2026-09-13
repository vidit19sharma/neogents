#!/usr/bin/env bash
# SessionEnd: commit brain changes so memory survives and travels with the repo.
# Opt out: create .neo/no-auto-commit
# This script must NEVER fail the session end — exit 0 on every path.
set -uo pipefail

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
  git add -- .neo/brain >/dev/null 2>&1 || exit 0
  git commit --no-verify --quiet -m "neo: brain sync $(date +%Y-%m-%d)" -- .neo/brain >/dev/null 2>&1 || git reset -q -- .neo/brain
fi

exit 0
