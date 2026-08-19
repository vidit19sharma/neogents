#!/usr/bin/env bash
# NEO plugin — PreToolUse hook (matcher: Edit|Write|NotebookEdit).
# Path jail for write-restricted agents:
#   neo-shadow  -> may write only under .neo/
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
      .neo/*) ;;
      *) block ".neo/" ;;
    esac
    ;;
esac

# The string prefix check above can be defeated by a pre-existing symlink
# inside .neo/ that points outside it. Defense-in-depth: refuse to write
# through a symlink, and when the paths exist, compare parent directories
# physically (pwd -P). Fail-open when they don't resolve, e.g. new dirs.
[ -L "$FILE" ] && block ".neo/ (refusing to write through a symlink)"

if [ -n "$CWD" ]; then
  PHYS_DIR=$(cd "$(dirname "$FILE")" 2>/dev/null && pwd -P) || PHYS_DIR=""
  PHYS_JAIL=$(cd "$CWD/.neo" 2>/dev/null && pwd -P) || PHYS_JAIL=""
  if [ -n "$PHYS_DIR" ] && [ -n "$PHYS_JAIL" ]; then
    case "${PHYS_DIR}/" in
      "${PHYS_JAIL}/"*) ;;
      *) block ".neo/ (path resolves outside the jail)" ;;
    esac
  fi
fi

exit 0
