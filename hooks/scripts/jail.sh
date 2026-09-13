#!/usr/bin/env bash
# NEO plugin — PreToolUse hook (matcher: Edit|Write|NotebookEdit).
# Path jail for write-restricted agents:
#   neo-shadow  -> may write only under .neo/brain/ (not .neo/CHECKPOINT.md,
#                  .neo/plans/, .neo/runs/ or .neo/no-auto-commit — those are
#                  machine-written or user-owned)
# All other agents and the main thread pass through untouched.
#
# Protocol: exit 0 = allow; exit 2 + stderr = block (stderr is fed back
# to the agent as corrective feedback).
#
# Identity source: `agent_type` in the PreToolUse stdin payload. Present
# only inside subagents, absent on the main thread. May arrive
# plugin-namespaced ("neo:neo-shadow") or bare ("neo-shadow") depending
# on Claude Code version, so we strip any namespace prefix.
# NOTE: agent_type has no formal stability contract yet (anthropics/
# claude-code#56168). Fail-open by design: if the field or jq is
# missing, we allow rather than break every write in the session.
# Once we know it IS neo-shadow, everything after that is script-controlled
# and fails CLOSED — an unresolvable path blocks rather than passes.

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)

AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_type // empty' 2>/dev/null)
[ -z "$AGENT" ] && exit 0
AGENT="${AGENT##*:}"

case "$AGENT" in
  neo-shadow) ;;
  *) exit 0 ;;
esac

FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
[ -z "$FILE" ] && exit 0

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
# A trailing slash would survive the joins below and leave a doubled separator.
CWD="${CWD%/}"

block() {
  echo "[neo jail] $AGENT may only write under .neo/brain/ — $1 (attempted: $FILE). Write your output there, or report back instead of writing elsewhere." >&2
  exit 2
}

# The payload cwd follows the session's `cd`, so it is NOT the repo root: a
# session working in a subdirectory would build the jail at <subdir>/.neo/brain
# and block every legitimate brain write. Anchor to the work tree root instead.
ROOT="$(git -C "${CWD:-.}" rev-parse --show-toplevel 2>/dev/null)" || ROOT=""
[ -z "$ROOT" ] && ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -z "$ROOT" ] && ROOT="$CWD"
ROOT="${ROOT%/}"
[ -z "$ROOT" ] && block "the repo root could not be determined"

# A relative path is only meaningful against a cwd. Without one we cannot
# resolve it at all, and an unresolved path must never be waved through.
case "$FILE" in
  /*) ABS="$FILE" ;;
  *) [ -n "$CWD" ] || block "a relative path with no session cwd cannot be resolved"; ABS="$CWD/$FILE" ;;
esac

# Reject traversal tricks like .neo/../src/x before anything else.
case "/$ABS/" in
  */../*) block "no '..' path segments" ;;
esac

# A repo can ship .neo or .neo/brain as a git-tracked symlink. Both the target
# and the jail would then resolve through the same link and agree, relocating
# the entire jail (.neo/brain -> $HOME makes ~/.zshrc writable). Never follow one.
[ -L "$ROOT/.neo" ] && block "$ROOT/.neo is a symlink"
[ -L "$ROOT/.neo/brain" ] && block "$ROOT/.neo/brain is a symlink"

# Physical path of a target whose tail may not exist yet: resolve the nearest
# existing ancestor with pwd -P, then re-append the missing components. A
# missing intermediate directory must not skip the check — that would let a
# symlinked ancestor escape the jail unnoticed.
phys_path() {
  local p="$1" rest="" base
  while [ ! -d "$p" ]; do
    case "$p" in
      */?*) rest="${p##*/}${rest:+/$rest}"; p="${p%/*}"; [ -z "$p" ] && p="/" ;;
      *) return 1 ;;
    esac
  done
  base=$(cd "$p" 2>/dev/null && pwd -P) || return 1
  printf '%s' "${base%/}${rest:+/$rest}"
}

# The ALLOW decision is physical, not lexical. A string prefix match compares
# two spellings of a path, and on macOS the payload cwd may say /tmp while the
# resolved file says /private/tmp — identical directories, mismatched strings,
# every write locked out. Resolve both sides and compare those.
PHYS_DIR=$(phys_path "$(dirname "$ABS")") || block "the path does not resolve"
PHYS_JAIL=$(phys_path "$ROOT/.neo/brain") || block "the jail does not resolve"
case "${PHYS_DIR}/" in
  "${PHYS_JAIL}/"*) ;;
  *) block "it resolves outside the jail" ;;
esac

# Defense-in-depth on the leaf itself: a pre-existing symlink inside
# .neo/brain/ points outside it and writes straight through.
[ -L "$ABS" ] && block "refusing to write through a symlink"

# ...and so does a hardlink, which -L cannot see: the same inode is reachable
# from outside the jail, so writing "inside" edits the outside file.
link_count() {
  # GNU first (BSD stat rejects -c); BSD second; ls as the portable last resort.
  stat -c %h "$1" 2>/dev/null || stat -f %l "$1" 2>/dev/null ||
    ls -ldn "$1" 2>/dev/null | awk '{print $2}'
}
if [ -e "$ABS" ] && [ ! -d "$ABS" ]; then
  LINKS="$(link_count "$ABS" 2>/dev/null | head -n 1)"
  case "$LINKS" in
    ''|*[!0-9]*) ;;
    *) [ "$LINKS" -gt 1 ] && block "the target is a hardlink to a file outside the jail" ;;
  esac
fi

exit 0
