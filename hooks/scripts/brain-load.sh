#!/usr/bin/env bash
# SessionStart: load the second brain into context. Zero LLM — pure cat.
# stdout from a SessionStart hook is injected into the session context.
set -uo pipefail

# Hook processes run in Claude's current directory, which follows `cd` mid-session,
# so anchor to the repo root first (CLAUDE_PROJECT_DIR is the launch dir, not the root).
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -n "$ROOT" ] && { cd "$ROOT" || exit 0; }

BRAIN=".neo/brain"

if [ ! -d "$BRAIN" ]; then
  # One-line hint only; stay quiet for projects that haven't opted in.
  echo "[neo] No second brain in this project. Run /neo:init to create one."
  exit 0
fi

echo "=== NEO SECOND BRAIN (auto-loaded from $BRAIN — do not re-read these files) ==="

for f in BRIEF.md ACTIVE.md LESSONS.md INDEX.md; do
  if [ -s "$BRAIN/$f" ]; then
    echo ""
    echo "--- $f ---"
    cat "$BRAIN/$f"
  fi
done

if [ -s "$BRAIN/PROGRESS.md" ]; then
  echo ""
  echo "--- PROGRESS.md (latest 20 lines) ---"
  tail -n 20 "$BRAIN/PROGRESS.md"
fi

# Machine snapshot from checkpoint.sh — inject only while fresh (<1h old).
if [ -s ".neo/CHECKPOINT.md" ] && [ -n "$(find .neo/CHECKPOINT.md -mmin -60 2>/dev/null)" ]; then
  echo ""
  echo "--- CHECKPOINT.md (deterministic snapshot from last session) ---"
  cat ".neo/CHECKPOINT.md"
fi

echo ""
echo "--- On demand (read only when needed) ---"
echo "ARCHITECTURE.md, DECISIONS.md, and WORKFLOWS.md live in $BRAIN/ — consult INDEX above for what they hold."

# Surface workflows ready to become skills (status set by neo-shadow at 3+ sightings).
if [ -s "$BRAIN/WORKFLOWS.md" ] && grep -q '^- status: proposed' "$BRAIN/WORKFLOWS.md" 2>/dev/null; then
  echo ""
  echo "[neo] WORKFLOWS.md has proposed entries — recurring workflows ready for /neo:train."
fi

# Detect-don't-depend: advertise optional tooling if present.
if command -v graphify >/dev/null 2>&1 && [ -f "graph.json" ]; then
  echo ""
  echo "[neo] graphify detected with graph.json — prefer 'graphify query/path/explain' over broad grep for cross-file questions."
fi

echo "=== END SECOND BRAIN ==="
exit 0
