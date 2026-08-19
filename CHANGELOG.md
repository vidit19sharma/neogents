# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Cut the roster from 11 agents to 4: neo, neo-shadow, trinity, smith. Codebase recon now uses Claude Code's built-in exploration subagents (keymaker, tank removed); NEO writes plan artifacts itself (architect removed); trinity writes and runs tests for what she changes (mouse folded in); NEO strips slop after review approval (switch removed); the failure protocol replaces the debugging consultant (oracle removed); shipping rules live in neo's own prompt (morpheus removed).
- Replaced the advisory PreCompact save reminder (`save-brain.sh`) with `checkpoint.sh`: a deterministic snapshot of branch, git status, diff stat, and the last assistant message written to `.neo/CHECKPOINT.md` on PreCompact and throttled Stop. `brain-load.sh` injects the checkpoint at session start when it's less than an hour old.
- Removed `spawn-guard.sh` and its PreToolUse matcher; the structural guarantee (leaf agents have no `Agent` tool, enforced by CI) is the control.
- Python formatters in `format.sh` now require project opt-in config (`ruff.toml`/`.ruff.toml`/`[tool.ruff]`; `[tool.black]`).
- Rewrote docs (architecture, hooks reference, workflow, customization, portability) for the lean roster.

### Added

- Workflow harvesting: `WORKFLOWS.md` brain ledger (8th brain file) where neo-shadow records recurring multi-step sequences at save time, incrementing seen counts and setting `status: proposed` at 3 sightings.
- `/neo:train` command (7th command): reviews `WORKFLOWS.md` candidates, drafts a `SKILL.md` for the chosen workflow, shows the user the draft, and writes it to the project's `.claude/skills/<name>/` on approval. Human-gated; NEO never creates the skill without a yes. A user request overrides the 3-sighting threshold.
- `brain-load.sh` now lists `WORKFLOWS.md` in its on-demand pointer and surfaces a one-line hint at session start when proposed entries exist.
- Memory validity: `LESSONS.md` entries now carry a `[YYYY-MM-DD]` datestamp (learned / last confirmed) and an optional trailing `(path)` evidence anchor; format documented in the template and brain spec.
- Supersession on write: neo-shadow replaces an existing lesson on the same subject or anchor instead of appending a near-duplicate, so contradictory lessons can't coexist.
- `brain-gc.sh` helper script: deterministic, zero-LLM staleness scan of `LESSONS.md` — flags `DEAD-ANCHOR` (cited path gone), `AGED` (datestamp older than 90 days; `NEO_GC_MAX_AGE_DAYS` to tune), and `UNDATED` (legacy) entries. Read-only, fail-open.
- `/neo:gc` command (8th command): runs the scan, then spawns neo-shadow to review only the flagged entries against the current codebase — KEEP (refresh date), REWRITE (details drifted), or ARCHIVE to `.neo/brain/archive/LESSONS.md` with a dated reason. Nothing is ever deleted outright.
- `/neo:status` now surfaces a one-line lesson-health summary (`brain-gc.sh --summary`) and offers `/neo:gc` when rot is detected.
- Run ledger: every subagent spawn is auto-logged by `run-ledger.sh` (PostToolUse on Agent/Task) to `.neo/runs/YYYY-MM-DD.md` — agent, task, verdict, first line; responses over 1500 chars get their own report file with a pointer.
- `FRICTION.md` brain file (9th): append-only evidence ledger of user corrections, smith BLOCKs, failed-fix escalations, and reverts after approval, with stable `[F-NNN]` IDs anchored to the NEO component they implicate.
- `/neo:recall` command (9th): greps `.neo/brain`, `.neo/plans`, and `.neo/runs` for a term and answers from `file:line` pointers before re-exploring the codebase.

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
