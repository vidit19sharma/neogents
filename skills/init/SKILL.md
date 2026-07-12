---
name: init
description: Initialize the NEO second brain in this project. Scaffolds .neo/brain/ from templates, runs a short interview to fill BRIEF.md, and writes a starter CLAUDE.md if none exists. Use when a project has no .neo/ directory yet.
---

# /neo:init — bootstrap the second brain

Current state: !`ls -d .neo 2>/dev/null || echo "no .neo directory"` · CLAUDE.md: !`ls CLAUDE.md 2>/dev/null || echo "absent"`

## Steps

1. **Guard**: if `.neo/brain/` already exists, say so and stop — never overwrite a living brain. Suggest `/neo:status` instead.

2. **Scaffold**:
   ```bash
   mkdir -p .neo/brain .neo/plans
   cp "${CLAUDE_PLUGIN_ROOT}/templates/brain/"*.md .neo/brain/
   ```

3. **Interview** — ask ONE question at a time, offer your best-guess answer first (infer from the codebase before asking; if the repo answers a question, don't ask it):
   - What is this project? (one paragraph)
   - Who/what is it for, and why does it exist?
   - Scope of the current version? Explicit non-goals?
   - Hard constraints? (platform, language, performance, compliance)
   - Build / test / lint commands? (read package.json, Makefile, etc. first — confirm, don't ask blind)

4. **Write**:
   - Fill `.neo/brain/BRIEF.md` from the interview (replace all placeholder comments).
   - If the codebase is non-empty, do a quick pass (or spawn keymaker) to fill `.neo/brain/ARCHITECTURE.md` stack + layout sections. Leave patterns/gotchas to accumulate naturally.
   - If `CLAUDE.md` is absent, copy `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md` and fill the command placeholders. If present, leave it alone.

5. **Report**: list created files, then: "Brain initialized. It loads automatically next session; save anytime with /neo:save."
