---
name: init
description: Initialize the NEO second brain in this project. Scaffolds .neo/brain/ from templates, runs a short interview to fill BRIEF.md, and writes starter AGENTS.md and CLAUDE.md files if absent. Use when a project has no .neo/ directory yet.
---

# /neo:init — bootstrap the second brain

Current state: !`ls -d .neo 2>/dev/null || echo "no .neo directory"` · AGENTS.md: !`ls AGENTS.md 2>/dev/null || echo "absent"` · CLAUDE.md: !`ls CLAUDE.md 2>/dev/null || echo "absent"`

## Steps

1. **Guard**: if `.neo/brain/` already exists, say so and stop — never overwrite a living brain. Suggest `/neo:status` instead.

2. **Scaffold**:
   ```bash
   mkdir -p .neo/brain .neo/plans
   cp "${CLAUDE_PLUGIN_ROOT}/templates/brain/"*.md .neo/brain/
   ```

3. **Ignore the session marker** — `.neo/.session` is volatile session state the stop-gate compares mtimes against, and a plain `git add -A` would commit it:
   ```bash
   printf '.session\n' > .neo/.gitignore
   ```

4. **Interview** — ask ONE question at a time, offer your best-guess answer first (infer from the codebase before asking; if the repo answers a question, don't ask it):
   - What is this project? (one paragraph)
   - Who/what is it for, and why does it exist?
   - Scope of the current version? Explicit non-goals?
   - Hard constraints? (platform, language, performance, compliance)
   - Build / test / lint commands? (read package.json, Makefile, etc. first — confirm, don't ask blind)

5. **Write**:
   - Fill `.neo/brain/BRIEF.md` from the interview (replace all placeholder comments).
   - If the codebase is non-empty, do a quick exploration pass to fill `.neo/brain/ARCHITECTURE.md` stack + layout sections. Leave patterns/gotchas to accumulate naturally.
   - **Instruction files** — use this matrix:
     - Neither exists: copy `${CLAUDE_PLUGIN_ROOT}/templates/AGENTS.md`, fill the command placeholders, and copy `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md` as-is (it imports AGENTS.md).
     - Both exist: leave both alone.
     - Only `AGENTS.md` exists: copy `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md` as-is.
     - Only `CLAUDE.md` exists: do not write `AGENTS.md`. Propose: "Move CLAUDE.md's content into AGENTS.md and replace CLAUDE.md with the template (`@AGENTS.md` + Compact Instructions) so both harnesses read the same rules."
       Do this only on an explicit yes, on the main thread (like BRIEF.md, outside neo-shadow's jail). On no, leave both untouched and say: "OpenCode will read CLAUDE.md as a fallback only until an AGENTS.md appears."

6. **Report**: list created files, then: "Brain initialized. It loads automatically next session; save anytime with /neo:save."
