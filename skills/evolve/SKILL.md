---
name: evolve
description: Turn accumulated friction into one bounded, human-approved improvement to NEO itself. Reads FRICTION.md, clusters recurring patterns, proposes a single edit to an agent prompt, skill, or template — with evidence — and applies it only after explicit approval. Use when friction entries pile up or the user asks "why does NEO keep doing X".
---

# /neo:evolve — improve NEO from evidence

Friction ledger: !`grep -c '^- \[F-' .neo/brain/FRICTION.md 2>/dev/null || echo "0"` entries

NEO's components (agent prompts, skills, templates) are files. Friction entries are evidence of where those files fail. This command closes the loop — one bounded edit at a time, never on a hunch.

## Steps

1. **Guard**: no `.neo/brain/FRICTION.md` or fewer than 3 entries → say there isn't enough evidence to evolve yet and stop. Evolution on thin evidence is guessing.

2. **Cluster**: read `FRICTION.md` and group entries by the component they implicate. A pattern needs **2+ entries pointing at the same component** — single incidents don't justify edits.

3. **Propose ONE edit** — the most recurrent cluster only. Present an evidence manifest before touching anything:
   - **Evidence**: the `[F-NNN]` entries cited, verbatim.
   - **Root cause**: what in the component invites this failure — one paragraph.
   - **Targeted fix**: the exact edit (quote current text → proposed text). Smallest change that addresses the pattern. Prefer adding a narrow rule over rewriting sections.
   - **Predicted impact**: what should stop happening, and what's at risk of regressing.

4. **Editable surface** (hard boundary):
   - MAY edit: `agents/*.md`, `skills/*/SKILL.md`, `templates/**` — prompt-layer only.
   - MUST NEVER edit: `hooks/` (any script or hooks.json), `.claude-plugin/`, CI. Enforcement stays outside the loop it enforces.

5. **Human gate**: apply the edit only after an explicit yes. "Maybe" or silence means no. If rejected, note the rejection as a new FRICTION entry so the next run knows it was tried.

6. **After applying**: re-read the edited file to confirm the change is coherent in context, and check the edit didn't weaken an existing rule (zero-regression: an evolve edit may add or sharpen constraints, never quietly remove one). Ask shadow to record the change in DECISIONS.md, and mark the cited friction entries with `(addressed by <file>, YYYY-MM-DD)`.
