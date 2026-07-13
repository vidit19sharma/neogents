---
name: train
description: Promote recurring workflows from the second brain into project skills. Reviews .neo/brain/WORKFLOWS.md candidates, drafts a SKILL.md for the chosen workflow, and writes it to the project's .claude/skills/ after user approval. Use when neo-shadow flags a repeated workflow or the user says "make this a skill" or "train that workflow".
---

# /neo:train — turn repeated workflows into skills

Candidates: !`grep -c '^## candidate:' .neo/brain/WORKFLOWS.md 2>/dev/null || echo "0 (no WORKFLOWS.md — run /neo:init or wait for neo-shadow to record some)"` · Existing project skills: !`ls .claude/skills 2>/dev/null || echo "none"`

## Steps

1. **Guard**: if `.neo/brain/WORKFLOWS.md` is missing or has no entries, stop — nothing to train on yet. Tell the user neo-shadow records candidates automatically at save time.

2. **Review the ledger**: read `.neo/brain/WORKFLOWS.md`. List entries to the user, `proposed` first (3+ sightings), then `candidate`. Skip `skilled` — already promoted. If the user named a workflow, go straight to it; a user request overrides the 3-sighting threshold.

3. **Draft the skill** for the chosen workflow:
   - Directory name = the candidate's kebab-name (that becomes the command name).
   - Frontmatter: `name` matching the directory, `description` built from the entry's `trigger` line — concrete enough that auto-invocation fires on the right requests.
   - Body: the steps from the ledger, generalized (strip session-specific paths/values into placeholders), each step with its verify command where one exists.
   - Keep it under a screen. A skill that needs scrolling needs splitting.

4. **Approval gate**: show the user the full draft and the target path `.claude/skills/<name>/SKILL.md` (the **project's** skills directory — never the plugin's). Do not write without a yes.

5. **Write + record**: on approval, write the file yourself (you, NEO, on the main thread — this is outside the shadow's jail, like `/neo:init` writing BRIEF.md). Then spawn neo-shadow with a one-line delta: mark the entry `status: skilled` in `WORKFLOWS.md` and add a pointer to the new skill path.

6. **Report**: "Trained: /<name> — invoke it directly or let auto-delegation pick it up. Restart or /reload-plugins not needed for project skills."
