# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Workflow harvesting: `WORKFLOWS.md` brain ledger (8th brain file) where neo-shadow records recurring multi-step sequences at save time, incrementing seen counts and setting `status: proposed` at 3 sightings.
- `/neo:train` command (7th command): reviews `WORKFLOWS.md` candidates, drafts a `SKILL.md` for the chosen workflow, shows the user the draft, and writes it to the project's `.claude/skills/<name>/` on approval. Human-gated; NEO never creates the skill without a yes. A user request overrides the 3-sighting threshold.
- `brain-load.sh` now lists `WORKFLOWS.md` in its on-demand pointer and surfaces a one-line hint at session start when proposed entries exist.

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
