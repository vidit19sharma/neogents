# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Workflow harvesting: `WORKFLOWS.md` brain ledger (8th brain file) where neo-shadow records recurring multi-step sequences at save time, incrementing seen counts and setting `status: proposed` at 3 sightings.
- `/neo:train` command (7th command): reviews `WORKFLOWS.md` candidates, drafts a `SKILL.md` for the chosen workflow, shows the user the draft, and writes it to the project's `.claude/skills/<name>/` on approval. Human-gated; NEO never creates the skill without a yes. A user request overrides the 3-sighting threshold.
- `brain-load.sh` now lists `WORKFLOWS.md` in its on-demand pointer and surfaces a one-line hint at session start when proposed entries exist.
- Dated, anchored lesson format: `LESSONS.md` entries are now `- [YYYY-MM-DD] Never X — because Y happened. (path/to/file)` — datestamp is when learned or last confirmed, anchor points at the file the lesson is about.
- Supersession on write: neo-shadow replaces an existing lesson on the same subject or anchor instead of appending a near-duplicate, so contradictory lessons can't coexist.
- `brain-gc.sh` helper script: deterministic, zero-LLM staleness scan of `LESSONS.md` — flags `DEAD-ANCHOR` (cited path gone), `AGED` (datestamp older than 90 days; `NEO_GC_MAX_AGE_DAYS` to tune), and `UNDATED` (legacy) entries. Read-only, fail-open.
- `/neo:gc` command (8th command): runs the scan, then spawns neo-shadow to review only the flagged entries against the current codebase — KEEP (refresh date), REWRITE (details drifted), or ARCHIVE to `.neo/brain/archive/LESSONS.md` with a dated reason. Nothing is ever deleted outright.
- `/neo:status` now surfaces a one-line lesson-health summary (`brain-gc.sh --summary`) and offers `/neo:gc` when rot is detected.
- `checkpoint.sh` hook (PreCompact + Stop): deterministic, zero-LLM snapshot of git state (branch, HEAD, `git status --short`, diff stat) and the last assistant message to `.neo/CHECKPOINT.md`. Always fires on PreCompact; throttled to one write per 10 minutes on Stop. `brain-load.sh` re-injects the checkpoint at session start when it is less than an hour old. Replaces the advisory `save-brain.sh`, which asked the model to save at PreCompact — too late to act on, and auto-compaction never gave it a turn.
- Run ledger: `run-ledger.sh` hook (PostToolUse on Agent/Task) appends every subagent spawn — agent, task, `VERDICT` line, first summary line — to `.neo/runs/YYYY-MM-DD.md`. Responses over 1500 characters get their own report file with a pointer from the ledger. Zero LLM tokens; subagent work survives compaction as files instead of dying in chat context.
- `FRICTION.md` brain file (9th): append-only evidence ledger with stable `[F-NNN]` IDs. neo-shadow appends when a session delta contains a user correction, a smith BLOCK, a 2-fail escalation, or a revert after approval — each entry anchored to the NEO component whose change would have prevented it.
- `/neo:recall` command (9th): greps `.neo/brain`, `.neo/plans`, and `.neo/runs` for past decisions and subagent work, answering with file:line pointers instead of re-exploring.
- `/neo:evolve` command (10th): clusters `FRICTION.md` evidence and proposes ONE bounded edit to an agent prompt, skill, or template — with an evidence manifest (entries cited, root cause, targeted fix, predicted impact including regression risk). Human-gated; may never touch `hooks/`, `.claude-plugin/`, or CI. Enforcement stays outside the loop it enforces.
- Jail symlink hardening: `jail.sh` now refuses writes through symlinks and verifies the physical parent path (`pwd -P`) resolves inside the jail, closing a symlink-escape gap. Fail-open when paths can't be resolved.
- Behavioral CI tests for `checkpoint.sh` (snapshot content, Stop throttle), `run-ledger.sh` (entry format, verdict surfacing, long-report split), and the jail symlink checks.

### Changed

- `save-brain.sh` (advisory PreCompact reminder) removed in favor of the deterministic `checkpoint.sh` above.

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
