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
- `SECURITY.md` now notes that `.neo/brain/` content is untrusted input: the nonce fence around the session-start dump limits impersonation, not trust — read a cloned repo's brain files the way you'd read its `CLAUDE.md`.
- Docs drift sweep: finished the `sprint contract` → `contract` rename across `architecture.md` and `workflow.md`, updated the jail's stale `.neo/` scope references to `.neo/brain/`, and synced the `ACTIVE.md` and load-path descriptions across `brain-spec.md` and `README.md`.
- Second docs drift sweep: fixed the "project-local formatters" overclaim (only prettier is `node_modules/.bin`-resolved; ruff/black/gofmt/rustfmt are `PATH`-resolved, all config-gated) across `SECURITY.md`, `CONTRIBUTING.md`, `docs/customization.md`, `docs/hooks-reference.md`, and `docs/workflow.md`; corrected `neo-shadow.md`'s own jail claim to `.neo/brain/`; synced `brain-spec.md`'s Git Sync section with `brain-sync.sh`'s detached-HEAD and revert/bisect guards; added `WORKFLOWS.md` to the on-demand file lists in `README.md` and `docs/hooks-reference.md`; separated `FRICTION.md` from the three auto-pointer files in `brain-spec.md`; fixed the run-ledger report filename's missing `-$$` suffix; and added a smith checklist line for verifying the diff against a plan's negotiated contract.

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
- `/neo:evolve` command (10th): clusters `FRICTION.md` evidence and proposes ONE bounded, human-approved edit to an agent prompt, skill, or template — with an evidence manifest (entries cited, root cause, targeted fix, predicted impact). May never touch `hooks/`, `.claude-plugin/`, or CI.
- Lessons carry a provenance tag — `[verified]` (corroborated across ~3 independent sessions or explicitly confirmed by the user), `[observed]` (seen once), `[assumed]` (inferred) — and an optional `(seen: N, first YYYY-MM-DD)` counter that tracks corroboration toward the `[verified]` bar.
- `DECISIONS.md` entries require a `Reverses when:` field naming the condition that would invalidate them, giving `/neo:gc` an objective staleness check instead of relying on age alone; the redundant `Revisit if:` field is retired.
- DEEP-tier execution now negotiates a contract per task before trinity starts: NEO gives trinity and smith the done-criteria and verify plan, smith objects once with concrete gaps until both agree, and the agreed contract is written into the plan artifact for smith's later review to check against.
- `ACTIVE.md` gains an Open commitments checklist for promises made to the user that aren't yet delivered — edited in place, unlike the append-only `PROGRESS.md`.
- Expanded CI: hook tests now run from a subdirectory and against pretty-printed payloads, matching how Claude Code actually invokes hooks.

### Fixed

- `brain-sync.sh` now guards detached HEAD and `REVERT_HEAD`/`BISECT_LOG` states (previously only rebase/merge/cherry-pick), and restores the user's own pre-existing staged files if the commit fails instead of leaving the index reset. Bugs originally diagnosed in PR #1 by Dakuaisu.
- Every hook script other than `jail.sh` now resolves the git work tree root via `git rev-parse --show-toplevel` (falling back to `CLAUDE_PROJECT_DIR`) before touching `.neo/`, so a mid-session `cd` can no longer silently disable the brain. (`jail.sh` itself gained repo-root anchoring later; see below.)
- `jail.sh` fails closed on unresolvable paths instead of skipping the check, is narrowed from `.neo/` to `.neo/brain/` so neo-shadow can no longer overwrite machine- or user-owned state (`.neo/CHECKPOINT.md`, `.neo/plans/`, `.neo/runs/`, `.neo/no-auto-commit`), and strips a trailing slash from the payload `cwd` that used to defeat the prefix check.
- `stop-gate.sh`'s jq-less loop guard now matches whitespace-tolerant `stop_hook_active` (Claude Code pretty-prints hook payloads), and no longer blocks a session that saved and committed the brain in the same turn.
- `brain-load.sh` fences the session-start brain dump with a per-run nonce so brain content can't forge the closing marker, caps each file at 16K, and labels the dump as untrusted project data.
- `run-ledger.sh` flattens newlines out of model-controlled fields (agent name, description, verdict, summary) before writing them, so a crafted field can no longer forge a fake ledger entry.
- `brain-gc.sh` now counts the final lesson in `LESSONS.md` even when the file has no trailing newline.
- `jail.sh` now anchors to the repo root via `git -C "$cwd" rev-parse --show-toplevel` (falling back to `CLAUDE_PROJECT_DIR`, then the raw payload `cwd`) instead of trusting the payload `cwd` directly, and the allow decision is now physical-path based (`pwd -P` on the nearest existing ancestor, compared to the resolved jail) rather than a string prefix — a payload `cwd` of `/tmp` resolving to `/private/tmp` no longer false-blocks. Also rejects a symlinked `.neo` or `.neo/brain`, `..` path segments, a hardlinked write target (link count > 1), and a relative path with no session `cwd`.
- `stop-gate.sh` is redesigned around a session marker: `brain-load.sh` now touches `.neo/.session` at `SessionStart`, and the gate blocks only when a dirty file outside `.neo/` is newer than that marker and no `.neo/brain/` file is newer — replacing the prior dirty-vs-clean heuristic and the "brain is in HEAD" rule, the latter of which retired the gate permanently once `brain-sync.sh` started committing the brain every session. Stands down when `.neo/` is gitignored, since git then reports nothing for brain paths.
- `brain-load.sh` skips symlinked brain files and a symlinked `CHECKPOINT.md` (never follows either into context), and now caps the whole dump at 64K total in addition to the existing 16K per-file cap.
- `brain-sync.sh`'s staged-file restore after a failed commit is now content-exact: it replays the user's pre-existing staged entries by blob id (`git update-index -z --index-info`) instead of re-adding by path, which would have staged whatever the worktree currently holds — a different version of the file.
- `checkpoint.sh` flattens newlines out of the model-controlled `last_assistant_message` field before writing it (like `run-ledger.sh`'s `oneline()`), and writes `?` for the branch on a detached HEAD instead of an empty value.

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
