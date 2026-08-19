---
name: status
description: Show NEO second brain status — brain freshness, current focus, file sizes, and available tooling. Use when the user asks "where were we", "what's the status", or wants to check brain health.
---

# /neo:status — brain health check

- Brain files: !`wc -l .neo/brain/*.md 2>/dev/null || echo "no brain — run /neo:init"`
- Last save: !`git log -1 --format="%ar — %s" -- .neo/brain 2>/dev/null || echo "no brain commits yet"`
- Code since last save: !`git diff --stat $(git log -1 --format=%H -- .neo/brain 2>/dev/null) HEAD 2>/dev/null | tail -1 || echo "n/a"`
- Graphify: !`command -v graphify >/dev/null 2>&1 && echo "available" || echo "not installed"`
- Lesson health: !`bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/brain-gc.sh" --summary 2>/dev/null || echo "n/a"`

## Report (concise, from the data above + brain contents)

1. **Focus** — read `.neo/brain/ACTIVE.md`: current focus, next steps, open questions.
2. **Freshness** — compare last brain save vs code changes since. If code moved but the brain didn't: flag it, offer `/neo:save`.
3. **Size discipline** — flag ACTIVE.md over 150 lines or ARCHITECTURE.md over 500 (time for shadow to migrate/extract).
4. **Lesson rot** — if the lesson-health line shows dead anchors, aged, or undated entries: flag it, offer `/neo:gc`.
5. **Tooling** — one line: graphify available or not.

No essays. A tight status block the user can scan in ten seconds.
