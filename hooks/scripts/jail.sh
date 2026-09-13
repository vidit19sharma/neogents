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
# A trailing slash would survive the prefix strip below and leave REL absolute,
# blocking every legitimate write.
CWD="${CWD%/}"

# Normalize to a path relative to the session cwd.
REL="$FILE"
if [ -n "$CWD" ]; then
  case "$FILE" in
    "$CWD"/*) REL="${FILE#"$CWD"/}" ;;
  esac
fi

block() {
  echo "[neo jail] $AGENT may only write under $1 (attempted: $FILE). Write your output there, or report back instead of writing elsewhere." >&2
  exit 2
}

# Reject traversal tricks like .neo/../src/x before the prefix check.
case "/$REL/" in
  */../*) block "its jail (no '..' path segments)" ;;
esac

case "$AGENT" in
  neo-shadow)
    case "$REL" in
      .neo/brain/*) ;;
      *) block ".neo/brain/" ;;
    esac
    ;;
esac

# The string prefix check above can be defeated by a pre-existing symlink
# inside .neo/brain/ that points outside it. Defense-in-depth: refuse to
# write through a symlink, and compare parent directories physically.
[ -L "$FILE" ] && block ".neo/brain/ (refusing to write through a symlink)"

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

# Fail-closed: resolution here is fully script-controlled, so an unresolvable
# path is a reason to block, not to wave through.
if [ -n "$CWD" ]; then
  PHYS_DIR=$(phys_path "$(dirname "$FILE")") || block ".neo/brain/ (path does not resolve)"
  PHYS_JAIL=$(phys_path "$CWD/.neo/brain") || block ".neo/brain/ (jail does not resolve)"
  case "${PHYS_DIR}/" in
    "${PHYS_JAIL}/"*) ;;
    *) block ".neo/brain/ (path resolves outside the jail)" ;;
  esac
fi

exit 0
