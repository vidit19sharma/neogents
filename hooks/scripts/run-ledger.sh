#!/usr/bin/env bash
# PostToolUse (Agent|Task): append every subagent spawn to the run ledger.
# Zero LLM — the system writes the ledger, never the model. Subagent output
# that only lives in chat dies at compaction; here it survives as files the
# orchestrator can grep (/neo:recall) and recover from after interruption.
# Never blocks: exit 0 on every path.
set -uo pipefail

# Hook processes run in Claude's current directory, which follows `cd` mid-session,
# so anchor to the repo root first (CLAUDE_PROJECT_DIR is the launch dir, not the root).
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -n "$ROOT" ] && { cd "$ROOT" || exit 0; }

# A clone can ship `.neo` as a symlink; the ledger and report files would then be
# written outside the repo, into whatever directory the link points at.
if [ -L ".neo" ] || [ -L ".neo/brain" ]; then exit 0; fi

[ -d ".neo" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null || true)"
[ -n "$INPUT" ] || exit 0

# Every field below is model-controlled. A newline in one of them would end the
# ledger line and let the model write ledger entries of its own choosing, so
# newlines are flattened before interpolation.
oneline() { printf '%s' "$1" | tr '\n\r' '  '; }

AGENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.subagent_type // "unknown"' 2>/dev/null || echo "unknown")"
DESC="$(printf '%s' "$INPUT" | jq -r '.tool_input.description // ""' 2>/dev/null | head -c 120)"
AGENT="$(oneline "$AGENT")"
DESC="$(oneline "$DESC")"

# Flatten the response to plain text whatever shape the harness returns.
RESPONSE="$(printf '%s' "$INPUT" | jq -r '
  .tool_response
  | if type == "string" then .
    elif type == "array" then map(.text? // empty) | join("\n")
    elif type == "object" then
      (.content // empty)
      | if type == "array" then map(.text? // empty) | join("\n")
        elif type == "string" then .
        else "" end
    else "" end
' 2>/dev/null || true)"

mkdir -p .neo/runs 2>/dev/null || exit 0
LEDGER=".neo/runs/$(date +%Y-%m-%d).md"
STAMP="$(date '+%H:%M:%S')"

VERDICT="$(oneline "$(printf '%s' "$RESPONSE" | grep -m1 -E '^VERDICT' || true)")"
SUMMARY="$(oneline "$(printf '%s' "$RESPONSE" | grep -m1 '[^[:space:]]' | head -c 200 || true)")"

{
  echo ""
  echo "## ${STAMP} ${AGENT}${DESC:+ — ${DESC}}"
  [ -n "$VERDICT" ] && echo "- ${VERDICT}"
  [ -n "$SUMMARY" ] && [ "$SUMMARY" != "$VERDICT" ] && echo "- ${SUMMARY}"
} >> "$LEDGER" 2>/dev/null || true

# Long reports get their own file so the full text survives compaction.
# $$ suffix keeps same-second parallel spawns from clobbering each other.
if [ "${#RESPONSE}" -gt 1500 ]; then
  REPORT=".neo/runs/$(date +%Y-%m-%d)-$(date +%H%M%S)-${AGENT}-$$.md"
  printf '%s\n' "$RESPONSE" > "$REPORT" 2>/dev/null &&
    echo "- full report: ${REPORT}" >> "$LEDGER" 2>/dev/null || true
fi

exit 0
