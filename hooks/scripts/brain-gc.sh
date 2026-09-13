#!/usr/bin/env bash
# Brain GC scan: deterministic staleness signals for .neo/brain/LESSONS.md.
# NOT a lifecycle hook — invoked by the /neo:gc and /neo:status skills.
# Read-only, zero LLM cost. Flags entries; judgment about them stays with
# neo-shadow during /neo:gc. Always exits 0 (advisory, fail-open).
#
# Flags:
#   DEAD-ANCHOR  cited path no longer exists (file may have moved — verify before archiving)
#   AGED         datestamp older than NEO_GC_MAX_AGE_DAYS (default 90)
#   UNDATED      legacy entry without a [YYYY-MM-DD] datestamp
#
# Usage: brain-gc.sh [--summary]
#   (no args)  full report: one line per flagged entry, then a summary line
#   --summary  single summary line only (used by /neo:status)
set -uo pipefail

# Hook processes run in Claude's current directory, which follows `cd` mid-session,
# so anchor to the repo root first (CLAUDE_PROJECT_DIR is the launch dir, not the root).
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -n "$ROOT" ] && { cd "$ROOT" || exit 0; }

LESSONS=".neo/brain/LESSONS.md"
MAX_AGE_DAYS="${NEO_GC_MAX_AGE_DAYS:-90}"
MODE="${1:-full}"

if [ ! -f "$LESSONS" ]; then
  echo "no LESSONS.md"
  exit 0
fi

# Threshold date in ISO form — GNU date first, BSD fallback. ISO dates compare
# lexicographically, so no epoch math is needed. Empty threshold = skip age checks.
THRESHOLD="$(date -d "-${MAX_AGE_DAYS} days" +%F 2>/dev/null \
  || date -v "-${MAX_AGE_DAYS}d" +%F 2>/dev/null \
  || echo "")"

total=0; aged=0; dead=0; undated=0
report=""

while IFS= read -r line || [ -n "$line" ]; do
  # Only bullet entries are lessons; headers/comments/prose are skipped.
  case "$line" in
    "- "*) ;;
    *) continue ;;
  esac
  total=$((total + 1))
  flags=""

  # Datestamp: "- [YYYY-MM-DD] ..."
  d="$(printf '%s' "$line" | sed -n 's/^- \[\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)\].*/\1/p')"
  if [ -z "$d" ]; then
    undated=$((undated + 1))
    flags="UNDATED"
  elif [ -n "$THRESHOLD" ] && [ "$d" \< "$THRESHOLD" ]; then
    aged=$((aged + 1))
    flags="AGED"
  fi

  # Corroborated lessons carry a trailing "(seen: N, first YYYY-MM-DD)" suffix.
  # It is the LAST parenthetical and it contains spaces, so leaving it in place
  # makes the anchor match below reject the entry and skip the dead-anchor check
  # on exactly the lessons that have been confirmed most often.
  bare="$(printf '%s' "$line" | sed 's/[[:space:]]*([Ss]een:[^)]*)[[:space:]]*$//')"

  # Evidence anchor: trailing "(path)" — must look like a path (has / or .),
  # no spaces, so parentheticals like "(unverified)" are not treated as anchors.
  anchor="$(printf '%s' "$bare" | sed -n 's/.*(\([^()]*\))[[:space:]]*$/\1/p')"
  case "$anchor" in
    "" | *" "*) anchor="" ;;
    */* | *.*) ;;
    *) anchor="" ;;
  esac
  if [ -n "$anchor" ]; then
    target="${anchor%%:*}"   # allow (path:line) anchors
    if [ ! -e "$target" ]; then
      dead=$((dead + 1))
      flags="${flags:+$flags,}DEAD-ANCHOR"
    fi
  fi

  if [ -n "$flags" ] && [ "$MODE" != "--summary" ]; then
    report="${report}${flags} | ${line}"$'\n'
  fi
done < "$LESSONS"

flagged=$((aged + dead + undated))
summary="${total} lessons: ${dead} dead anchors, ${aged} aged (>${MAX_AGE_DAYS}d), ${undated} undated"
if [ "$flagged" -eq 0 ]; then
  summary="${total} lessons: healthy (no dead anchors, none older than ${MAX_AGE_DAYS}d, all datestamped)"
fi

if [ "$MODE" = "--summary" ]; then
  echo "$summary"
else
  [ -n "$report" ] && printf '%s' "$report"
  echo "$summary"
fi

exit 0
