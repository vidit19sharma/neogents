---
name: review
description: Force an adversarial review — spawns smith in a fresh context to hunt flaws in the current changes. Use before merging, after finishing a feature, or when the user says "review this" or "check my work".
---

# /neo:review — summon smith

Changes in scope: !`git diff --stat HEAD 2>/dev/null | tail -5 || echo "not a git repo — review working tree by file list"`

## Steps

1. **Scope**: default = all uncommitted changes (`git diff HEAD` + untracked files). If the user named a branch, commit range, or files, use that instead. If the tree is clean and no scope was given, ask what to review.

2. **Spawn smith** (fresh context — no bias toward code written this session). The 6-section contract. CONTEXT: the diff scope (file list + how to view it: `git diff HEAD -- <paths>`), what the change was SUPPOSED to do (one paragraph — from the session, the plan artifact, or ask the user), and the project's test command from CLAUDE.md. EXPECTED OUTCOME: verdict block — APPROVE or BLOCK, blocking findings with file:line and evidence, replication check across the codebase, what was verified by execution, what was NOT examined.

3. **Relay honestly**: verdict verbatim. BLOCK findings → offer to fix (trinity for mechanical fixes, main thread for judgment calls). Never soften a BLOCK into "minor notes".

4. **Re-review after fixes**: send smith the same context plus what changed (continue the session if possible) — a fix pass without re-review is an unverified fix.
