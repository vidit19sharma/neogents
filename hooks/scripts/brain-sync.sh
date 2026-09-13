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
# (With .neo/ gitignored this is always empty and the sync no-ops silently —
# a deliberate, supported setup, not a failure.)
if git status --porcelain -- .neo/brain 2>/dev/null | grep -q .; then
  # The user's index entries — blob ids, not paths. Re-adding paths after a
  # failed commit would stage the WORKTREE content, silently replacing what
  # they had deliberately staged with a different version of the file.
  # -z keeps exotic filenames intact, and NUL-delimited data cannot survive a
  # command substitution, so it goes to a file.
  INDEX_BEFORE="$GIT_DIR/neo-index-before.$$"
  git ls-files -s -z -- .neo/brain > "$INDEX_BEFORE" 2>/dev/null || : > "$INDEX_BEFORE"
  git add -- .neo/brain >/dev/null 2>&1 || { rm -f "$INDEX_BEFORE"; exit 0; }
  # --no-verify is deliberate: hooks (including secret scanners and any hook
  # that can fail) must not break session end. The brain is markdown the user
  # can inspect and amend.
  if ! git commit --no-verify --quiet -m "neo: brain sync $(date +%Y-%m-%d)" -- .neo/brain >/dev/null 2>&1; then
    git reset -q -- .neo/brain >/dev/null 2>&1
    if [ -s "$INDEX_BEFORE" ]; then
      git update-index -z --index-info < "$INDEX_BEFORE" >/dev/null 2>&1
    fi
  fi
  rm -f "$INDEX_BEFORE"
fi

exit 0
