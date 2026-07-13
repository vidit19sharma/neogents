# Project conventions

<!-- Starter CLAUDE.md written by /neo:init. Keep under ~100 lines — bloat causes rule-skipping.
     Prune test: "would removing this line cause a mistake?" If no, remove it.
     Long-term project knowledge lives in .neo/brain/, not here. -->

## Memory

- Long-term project memory lives in `.neo/brain/` (loaded automatically at session start).
- After completing meaningful work, save context: run `/neo:save` or ask NEO to update the brain.
- When you correct a repeated mistake, add the rule here or ask neo-shadow to record it in `.neo/brain/LESSONS.md`.

## Commands

<!-- The commands that gate "done". Filled by /neo:init from your answers. -->

- Build: `<fill: build command>`
- Test: `<fill: test command>`
- Lint/typecheck: `<fill: check command>`

## Rules

<!-- Project-specific rules that must hold on every change. Examples below — replace with real ones. -->

- Match existing patterns before inventing new ones; check neighboring files first.
- Never commit unless explicitly asked.
- Run the test command before declaring any change complete.

## Compact Instructions

<!-- Injected into Claude Code's compaction prompt. Keeps compaction brain-aware. -->

- Always preserve: the current focus, open todos, and any unverified or uncommitted changes.
- The second brain in `.neo/brain/` is the source of truth for project memory — prefer pointing to it over restating its content.
- If work was done that the brain does not yet reflect, note explicitly that a `/neo:save` is pending.
