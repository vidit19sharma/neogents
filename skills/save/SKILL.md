---
name: save
description: Save session context to the NEO second brain. Spawns neo-shadow to update .neo/brain/ files (ACTIVE, PROGRESS, DECISIONS, LESSONS) from the session delta. Use at task boundaries, before ending a session, before compaction, or whenever the user says "save context" or "update the brain".
---

# /neo:save — persist session memory

Brain: !`ls .neo/brain 2>/dev/null || echo "MISSING — run /neo:init first"` · Uncommitted: !`git diff --stat HEAD 2>/dev/null | tail -1 || echo "not a git repo"`

## Steps

1. **Guard**: if `.neo/brain/` is missing, stop and point to `/neo:init`.

2. **Assemble the session delta** (you, NEO, know the session — the shadow doesn't):
   - What was worked on and what state it reached (done / in-flight / blocked)
   - What changed on disk (summarize from the git stat above; include key file paths)
   - Decisions made this session, with the why and the rejected alternatives
   - Anything that bit us — mistakes, surprises, gotchas worth a lesson
   - What comes next + open questions
   - Base this on the session's raw record — the git diff and actual events — and on `PROGRESS.md`'s raw entries, never on `ACTIVE.md`'s last rewrite; re-summarizing a summary compounds loss.

3. **Spawn neo-shadow** (Agent tool) with the 6-section contract. TASK: update the brain from this delta. EXPECTED OUTCOME: ACTIVE rewritten (cap 150 lines), PROGRESS appended at the bottom under today's date, DECISIONS/LESSONS updated only if the delta earns it (new lessons datestamped `[YYYY-MM-DD]` and anchored to a file path where applicable; a lesson on the same subject as an existing one supersedes it in place), ARCHITECTURE only if patterns changed, WORKFLOWS updated if the session repeated a known multi-step sequence. MUST NOT: touch anything outside `.neo/brain/`. CONTEXT: the full delta from step 2.

4. **Verify**: confirm from the shadow's report which files changed. Relay one line to the user: "Brain saved — ACTIVE rewritten, PROGRESS +1 entry" (adjust to reality). If the report flags a workflow at 3+ sightings, offer `/neo:train`.
