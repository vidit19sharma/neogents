---
name: plan
description: Run the DEEP planning flow — relentless requirements interview, then architect produces a reviewable plan artifact in .neo/plans/. Use for new features, ambiguous scope, architectural changes, or when the user says "plan this" or "let's think this through".
---

# /neo:plan — interview, then architect

## Phase 1 — Interview (main thread, you)

Interview the user relentlessly about this work until you reach shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one by one.

Rules:
- ONE question at a time. Never a questionnaire.
- For every question, lead with your recommended answer and why.
- If the codebase can answer it, explore (spawn keymaker) instead of asking.
- Consult `.neo/brain/DECISIONS.md` and `BRIEF.md` first — never re-ask what's already decided.
- Keep going until goal, scope, non-goals, constraints, and every fork in the road are resolved. "I don't know" from the user = you propose, they confirm.

## Phase 2 — Architect (fresh context)

Spawn **architect** with the 6-section contract. CONTEXT must carry: the full interview transcript (decisions + rationale), relevant brain excerpts, and file paths keymaker surfaced. EXPECTED OUTCOME: plan artifact at `.neo/plans/YYYY-MM-DD-<slug>.md` — goal, non-goals, inherited decisions, task graph, waves, per-task files/do/verify/agent, risks. MUST NOT: write anywhere else, relitigate interview decisions, leave open questions unstated.

## Phase 3 — Approval gate

Read the artifact. Present the plan summary: goal, wave schedule, task count, risks. If the architect left open questions, resolve them with the user and send the architect back (same context) before proceeding.

**Do not execute until the user approves the plan.** On approval, execute wave by wave: trinity per task (fresh context each), smith after the final wave, oracle on repeated failures.
