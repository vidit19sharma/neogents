@AGENTS.md

<!-- Claude Code reads this file. The project's conventions live in AGENTS.md so every harness
     shares one copy; the line above imports it. Only Claude-specific sections belong below. -->

## Compact Instructions

<!-- Injected into Claude Code's compaction prompt. Keeps compaction brain-aware. -->

- Always preserve: the current focus, open todos, and any unverified or uncommitted changes.
- The second brain in `.neo/brain/` is the source of truth for project memory — prefer pointing to it over restating its content.
- If work was done that the brain does not yet reflect, note explicitly that a `/neo:save` is pending.
