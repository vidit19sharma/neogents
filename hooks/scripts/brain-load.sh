#!/usr/bin/env bash
# SessionStart: load the second brain into context. Zero LLM — pure cat.
# stdout from a SessionStart hook is injected into the session context.
set -uo pipefail

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

echo ""
echo "--- On demand (read only when needed) ---"
echo "ARCHITECTURE.md and DECISIONS.md live in $BRAIN/ — consult INDEX above for what they hold."

# Detect-don't-depend: advertise optional tooling if present.
if command -v graphify >/dev/null 2>&1 && [ -f "graph.json" ]; then
  echo ""
  echo "[neo] graphify detected with graph.json — prefer 'graphify query/path/explain' over broad grep for cross-file questions."
fi

echo "=== END SECOND BRAIN ==="
exit 0
