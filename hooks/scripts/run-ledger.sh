#!/usr/bin/env bash
# PostToolUse (Agent|Task): append every subagent spawn to the run ledger.
# Zero LLM — the system writes the ledger, never the model. Subagent output
# that only lives in chat dies at compaction; here it survives as files the
# orchestrator can grep (/neo:recall) and recover from after interruption.
# Never blocks: exit 0 on every path.
set -uo pipefail

[ -d ".neo" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null || true)"
[ -n "$INPUT" ] || exit 0

AGENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.subagent_type // "unknown"' 2>/dev/null || echo "unknown")"
DESC="$(printf '%s' "$INPUT" | jq -r '.tool_input.description // ""' 2>/dev/null | head -c 120)"

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

VERDICT="$(printf '%s' "$RESPONSE" | grep -m1 -E '^VERDICT' || true)"
SUMMARY="$(printf '%s' "$RESPONSE" | grep -m1 '[^[:space:]]' | head -c 200 || true)"

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
