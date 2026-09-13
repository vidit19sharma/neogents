---
name: plan
description: Run the DEEP planning flow — relentless requirements interview, then a reviewable plan artifact in .neo/plans/. Use for new features, ambiguous scope, architectural changes, or when the user says "plan this" or "let's think this through".
---

# /neo:plan — interview, then plan artifact

## Phase 1 — Interview (main thread, you)

Interview the user relentlessly about this work until you reach shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one by one.

Rules:
- ONE question at a time. Never a questionnaire.
- For every question, lead with your recommended answer and why.
- If the codebase can answer it, explore it yourself (or fan out built-in exploration subagents) instead of asking.
- Consult `.neo/brain/DECISIONS.md` and `BRIEF.md` first — never re-ask what's already decided.
- Keep going until goal, scope, non-goals, constraints, and every fork in the road are resolved. "I don't know" from the user = you propose, they confirm.

## Phase 2 — Plan artifact (you)

Write the plan artifact yourself to `.neo/plans/YYYY-MM-DD-<slug>.md`, following `templates/plan.md`: goal, non-goals, inherited decisions, task graph, waves, per-task files/do/verify/agent, risks. Carry the interview decisions and rationale into it — do not relitigate them, and do not leave open questions unstated.

## Phase 3 — Approval gate

Present the plan summary: goal, wave schedule, task count, risks. Resolve any remaining open questions with the user and update the artifact before proceeding.

**Do not execute until the user approves the plan.** On approval, negotiate the contract per task with trinity and smith — done-criteria and verify plan, revised until both agree, written into the plan artifact — then execute wave by wave: trinity per task (fresh context each, tests included), smith after the final wave against the recorded contracts. After two failed fixes on the same problem, stop and re-derive from scratch per the failure protocol.
