# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Workflow harvesting: `WORKFLOWS.md` brain ledger (8th brain file) where neo-shadow records recurring multi-step sequences at save time, incrementing seen counts and setting `status: proposed` at 3 sightings.
- `/neo:train` command (7th command): reviews `WORKFLOWS.md` candidates, drafts a `SKILL.md` for the chosen workflow, shows the user the draft, and writes it to the project's `.claude/skills/<name>/` on approval. Human-gated; NEO never creates the skill without a yes. A user request overrides the 3-sighting threshold.
- `brain-load.sh` now lists `WORKFLOWS.md` in its on-demand pointer and surfaces a one-line hint at session start when proposed entries exist.

### Fixed

- `brain-sync.sh` no longer commits on a detached `HEAD`. The commit was unreachable from any branch, and the next `git checkout` deleted the newly-tracked brain files from the working tree — silently losing the session's memory to the reflog. Detached `HEAD` is ordinary (inspecting a tag or an old commit, `git bisect`), so the sync now skips and leaves the brain in the working tree for the next session on a branch.
- `brain-sync.sh` no longer commits during an in-progress `git revert` or `git bisect`. Committing cleared `REVERT_HEAD`, leaving the user's revert unresumable (`git revert --continue` failed with "no cherry-pick or revert in progress"). `REVERT_HEAD` and `BISECT_LOG` joined the existing rebase/merge/cherry-pick guards.
- `brain-sync.sh` now unstages the brain when its commit fails. `--no-verify` skips hooks but not GPG signing, so `commit.gpgsign = true` with an unusable key failed the commit while leaving brain files staged in the user's index — where the next unrelated `git commit` silently swept them in.
- `spawn-guard.sh` now only enforces the roster in projects that have a `.neo/brain/`. Plugin hooks are session-global, so the whitelist was blocking Claude Code's built-in subagents (`general-purpose`, `Explore`, `Plan`) and every other plugin's agents in every project on the machine — including projects that never ran `/neo:init`, and including sessions where the documented opt-out had already handed the main thread to another agent.

### Added

- CI behavioral coverage for `brain-sync.sh` (detached HEAD, revert, bisect, failed commit) and for `spawn-guard.sh`'s project scoping.

## [0.1.0] - 2026-07-13

### Added

- NEO orchestrator agent with main-thread takeover (`settings.json`), intent gate, and tiered pipeline (TRIVIAL / STANDARD / DEEP).
- 10 specialist agents: neo-shadow (memory keeper), keymaker (codebase search), tank (external docs), architect (planner), trinity (implementer), mouse (test engineer), smith (adversarial reviewer), switch (simplifier), oracle (consultant), morpheus (git/shipping).
- Second brain: 7 markdown files under `.neo/brain/` with tiered loading, size caps, and append-only progress ledger.
- 6 commands: `/neo:init`, `/neo:save`, `/neo:status`, `/neo:plan`, `/neo:review`, `/neo:map`.
- 7 lifecycle hooks: brain load (SessionStart), write jail (PreToolUse), spawn guard (PreToolUse), auto-format (PostToolUse), save reminder (PreCompact), stop gate (Stop), brain sync (SessionEnd). All fail-open.
- Templates for brain files, starter `CLAUDE.md` (with compaction instructions), and plan artifacts.
- Distilled ponytail YAGNI ladder into trinity; over-engineering criteria in smith and switch (credited, MIT).
- Documentation: architecture, brain spec, hooks reference, customization, portability, workflow, design spec.

[Unreleased]: https://github.com/vidit19sharma/neogents/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vidit19sharma/neogents/releases/tag/v0.1.0
