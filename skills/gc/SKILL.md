---
name: gc
description: Garbage-collect the NEO second brain. Runs a deterministic staleness scan over .neo/brain/LESSONS.md (dead anchors, aged entries, missing datestamps), then spawns neo-shadow to review only the flagged entries against the current codebase — keep, rewrite, or archive. Use when /neo:status flags lesson rot, when LESSONS.md grows past ~30 entries, or when the user says "clean the brain", "prune lessons", or "gc".
---

# /neo:gc — collect stale memory

Scan: !`bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/brain-gc.sh" 2>/dev/null || echo "scan unavailable — read .neo/brain/LESSONS.md and review manually"`

## Steps

1. **Guard**: if `.neo/brain/` is missing, stop and point to `/neo:init`. If the scan above reports healthy (no dead anchors, no aged, no undated), report "Brain healthy — nothing to collect" and stop. Also check `DECISIONS.md`: for each entry, if its `Reverses when:` condition has come true, flag it as stale/superseded.

2. **Spawn neo-shadow** (Agent tool) with the 6-section contract. TASK: review ONLY the flagged entries from the scan against the current codebase, one verdict each:
   - **KEEP** — still true. For `UNDATED` entries, stamp today's date: `- [YYYY-MM-DD] <unchanged text>`. For `AGED` entries confirmed still true, refresh the datestamp (date = last confirmed).
   - **REWRITE** — the kernel is true but details drifted (file moved, command renamed). Update text, anchor, and datestamp. A `DEAD-ANCHOR` often means the file moved — grep for its new location before concluding it's gone.
   - **ARCHIVE** — no longer applies (dependency removed, pattern retired). Move the line to `.neo/brain/archive/LESSONS.md` under a `## YYYY-MM-DD` heading with a one-line reason. Create the archive file if absent.

   EXPECTED OUTCOME: every remaining LESSONS.md entry datestamped and true against the current codebase; archived entries preserved verbatim with reasons. MUST NOT: delete any entry outright (archive instead), touch entries the scan did not flag, touch anything outside `.neo/brain/`. CONTEXT: the full scan report above, plus the current date.

3. **Verify + report**: from the shadow's report, relay one line: "GC done — N kept, N rewritten, N archived." If the shadow was unsure about any entry, it keeps it marked `(unverified)` — surface those to the user for a human call.
