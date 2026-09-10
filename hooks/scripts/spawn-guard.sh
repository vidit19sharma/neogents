#!/usr/bin/env bash
# PreToolUse (matcher: Agent): keep spawns inside the NEO roster.
# Defense-in-depth — the structural guarantee is that leaf agents have no Agent
# tool at all; this guard just stops roster drift from the main thread.
# Fail-open by design: if the payload shape is unrecognized, allow (the jail
# and structural limits are the hard guarantees, not this).
set -uo pipefail

# Plugin hooks are session-global: without this, the whitelist would also block
# Claude Code's built-in subagents and every other plugin's agents, in every repo.
[ -d ".neo/brain" ] || exit 0

command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null || true)"
[ -n "$INPUT" ] || exit 0

# Claude Code has used both field names across versions.
AGENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.subagent_type // .tool_input.agent_type // empty' 2>/dev/null || true)"
[ -n "$AGENT" ] || exit 0

case "$AGENT" in
  neo-shadow|keymaker|tank|architect|trinity|mouse|smith|switch|oracle|morpheus)
    exit 0
    ;;
  *)
    echo "[neo spawn-guard] '$AGENT' is not in the NEO roster. Spawnable: neo-shadow, keymaker, tank, architect, trinity, mouse, smith, switch, oracle, morpheus." >&2
    exit 2
    ;;
esac
