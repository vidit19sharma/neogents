# NEO Architecture

Design principles, the agent roster, the tiered pipeline, delegation mechanics, and the enforcement model.

---

## Design Principles

| Principle | Rationale |
|---|---|
| Context isolation is the superpower | Subagents inherit zero history. The orchestrator constructs exactly the context each specialist needs, no more. This is what makes parallel recon safe and cheap. |
| Leaf workers never get the spawn tool | Structural guarantee: a leaf cannot spawn even if its prompt told it to. Depth stays at 2. |
| Hooks are deterministic; prompts are advisory | Enforce with hooks, guide with prompts. A jail in a system prompt is a suggestion. A jail in a `PreToolUse` hook with `exit 2` is a hard block. |
| Deterministic work never goes to an LLM | Checkpoints, run logging, staleness scans, and formatting are shell scripts. An LLM asked to do a script's job will eventually skip it. |
| Give the agent a way to verify its work | Evidence, not assertions. "It typechecks" is not verified. Every task has a `verify:` step; every report has command output. |
| Plan-first | Energy poured into the plan is what lets implementation be one-shot. The plan artifact exists so trinity never has to guess. |
| Persist learnings before ending sessions | The second brain is why this project survives context loss. neo-shadow runs on the main model because memory writes are the highest-leverage tokens in the system. |
| Bootstrap or die | Without session-start activation, architecture is dead weight. The `SessionStart` hook is the entry point; everything else depends on it. |
| Don't wrap what the platform provides | Codebase recon uses Claude Code's built-in exploration subagents. External research uses WebFetch/WebSearch. NEO only defines agents for jobs the platform doesn't ship: memory, disciplined implementation, adversarial review. |
| Detect, don't depend | Optional tooling (graphify) is advertised when present, never required. The plugin works with zero external dependencies. |

---

## Agent Roster

All agents live in `agents/*.md`. Four agents; everything else is either a platform built-in or a rule inside neo's prompt.

### neo (`agents/neo.md`)

The main session agent. Activated via `settings.json` `{"agent": "neo"}`.

**Model:** session model · **Tools:** all, including `Agent` · **Spawns:** yes, the ONLY spawner

- Classifies every incoming message (intent gate, turn-local, never carried across turns)
- Routes to the correct tier (TRIVIAL / STANDARD / DEEP)
- Runs recon itself: built-in exploration subagents (2-5 in parallel) for the codebase, WebFetch/WebSearch for external knowledge
- Writes plan artifacts to `.neo/plans/` on DEEP work
- Constructs delegation prompts with the 6-section contract and verifies output against MUST DO / MUST NOT DO
- Owns git shipping rules (explicit intent only, match repo style, pull-before-push, never force-push shared history)
- Delegates brain saves to neo-shadow; never writes brain files itself

### neo-shadow (`agents/neo-shadow.md`)

**Model:** `inherit` · **Tools:** Read, Grep, Glob, Write, Edit (no Bash) · **Spawns:** no

The memory keeper. Runs on the main model because a wrong lesson or a vague `ACTIVE.md` poisons every future session that loads it.

Shadow receives a session delta from NEO and:
- Rewrites `ACTIVE.md` in full (150-line cap)
- Appends to `PROGRESS.md` (append-only)
- Appends to `DECISIONS.md` and `LESSONS.md` only when the delta earns it. Lessons are datestamped `[YYYY-MM-DD]` and anchored to a file path; a lesson on the same subject as an existing one **supersedes it in place**
- Appends to `FRICTION.md` when the delta contains a user correction, a smith BLOCK, a failed-fix escalation, or a revert after approval (stable `[F-NNN]` IDs)
- Touches `ARCHITECTURE.md` only on pattern changes, `BRIEF.md` only on scope pivots
- Updates `WORKFLOWS.md` when the session repeated a known multi-step sequence (**Pattern Watch**: `candidate` → `proposed` at 3 sightings → `skilled` only via `/neo:train`)

**Garbage collection:** `/neo:gc` runs `brain-gc.sh` — a deterministic staleness scan of `LESSONS.md` — then spawns shadow to KEEP / REWRITE / ARCHIVE flagged entries. See [brain-spec.md](brain-spec.md).

Shadow is jailed to `.neo/brain/` by the `jail.sh` hook. It cannot touch source code, and it cannot touch machine- or user-owned state elsewhere under `.neo/` (`.neo/CHECKPOINT.md`, `.neo/plans/`, `.neo/runs/`, `.neo/no-auto-commit`) even if instructed to.

### trinity (`agents/trinity.md`)

**Model:** sonnet · **Tools:** Read, Grep, Glob, Write, Edit, Bash · **Spawns:** no

Implementation. Executes ONE well-defined task per invocation — tests included. Reads every file the task names before writing. Matches existing conventions exactly. Writes and runs tests for the behavior she changes in the same task. Runs the task's `verify:` step and includes command output in her report. Stops and reports conflicts rather than improvising. Ships with a distilled YAGNI decision ladder.

### smith (`agents/smith.md`)

**Model:** opus · **Tools:** Read, Grep, Glob, Bash · **Spawns:** no

Adversarial review. Read-only with test execution. Hunts correctness errors, spec deviations, security issues, and replication of found patterns across the codebase. Delivers a `VERDICT: APPROVE | BLOCK` with `file:line` evidence for every blocking item.

### Folded into neo (former agents)

| Former agent | Now |
|---|---|
| keymaker (codebase search) | Claude Code's built-in exploration subagents, fired 2-5 in parallel |
| tank (external research) | NEO's own WebFetch/WebSearch |
| architect (plan synthesis) | NEO writes the plan artifact itself, following `templates/plan.md` |
| mouse (tests) | trinity tests what she changes, same task |
| switch (simplifier) | NEO strips slop from the diff scope after smith approves, then re-runs tests |
| oracle (debug consultant) | Failure protocol rule: after 2 failed fixes, stop and re-derive from scratch |
| morpheus (git operator) | Shipping rules in neo's prompt |

---

## Tiered Pipeline

NEO classifies every request before acting. The classification is turn-local.

**TRIVIAL** — one file, known location, obvious change. NEO edits directly and runs diagnostics.

**STANDARD** — 2+ files or steps, clear scope.
1. Recon: built-in exploration subagents in parallel; WebFetch/WebSearch for external libraries.
2. Plan: NEO writes a todo list with atomic items, each with a verify step.
3. Execute: trinity per task (tests included), or NEO directly when coordination overhead exceeds the task.
4. Review: smith on the diff.

**DEEP** — new feature, ambiguous scope, architectural impact. Forced by `/neo:plan`.
1. Interview: NEO asks one question at a time on the main thread, leading with a recommended answer.
2. Recon runs in parallel with the interview.
3. NEO writes the plan artifact to `.neo/plans/YYYY-MM-DD-<slug>.md` following `templates/plan.md`.
4. Approval gate: execution does not start before the user approves the plan.
5. Sprint contract: per task, NEO gives trinity and smith the done-criteria and verify plan; smith objects once with concrete gaps; both agree before execution; the agreed contract is written into the plan artifact.
6. Execute: trinity per task, fresh contexts, parallel waves where the dependency graph allows, tests included.
7. Review: smith adversarial pass on the full diff, against the recorded contracts.
8. NEO strips slop from the diff scope and re-runs tests.
9. Brain save: neo-shadow updates the second brain.

**Failure protocol:** after 2 failed fix attempts on the same problem, NEO stops all edits, re-reads the files from scratch, writes down what each attempt assumed vs what was disproved, and re-derives the fix. After 3, NEO reverts to the last working state and asks the user. Shotgun debugging is forbidden.

---

## Delegation Contract

Every spawn prompt has six sections. No exceptions.

```
TASK:             one atomic goal
EXPECTED OUTCOME: concrete deliverable + success criteria
TOOLS:            which of their tools they should actually use
MUST DO:          every requirement, nothing implicit
MUST NOT DO:      forbidden actions — anticipate rogue behavior
CONTEXT:          file paths, patterns to follow, constraints, prior findings
```

Specialists inherit zero history. NEO pastes what matters. File paths beat descriptions. When a specialist returns work, NEO verifies it against MUST DO / MUST NOT DO before accepting. Independent recon always runs simultaneously.

Every spawn is auto-logged to `.neo/runs/` by the `run-ledger.sh` hook (agent, task, verdict, summary — full report to a file when long). `/neo:recall` greps this ledger alongside the brain, so past subagent work is recoverable instead of re-done.

---

## Enforcement Model

Constraints are enforced structurally, not just through prompts.

**Structural tool allowlists.** Each agent's frontmatter lists exactly the tools it may use. Leaf agents have no `Agent` tool, so they structurally cannot spawn.

Hook processes inherit Claude's current working directory, which follows a mid-session `cd`. Every script except `jail.sh` (which takes its root from the payload's `cwd`) anchors to the git work tree root (`git rev-parse --show-toplevel`, falling back to `CLAUDE_PROJECT_DIR`) before touching `.neo/`, so a stray `cd` can't silently disable the brain.

**Hooks** (see [hooks-reference.md](hooks-reference.md)):
- `jail.sh` (PreToolUse) — neo-shadow may only write under `.neo/brain/`; fails closed on unresolvable paths; exit 2 blocks and feeds corrective stderr back to the agent
- `checkpoint.sh` (Stop + PreCompact) — deterministic snapshot of branch, uncommitted files, diff stat, and the last assistant message to `.neo/CHECKPOINT.md`; reloaded at session start while fresh
- `run-ledger.sh` (PostToolUse on Agent|Task) — appends every spawn to `.neo/runs/`
- `stop-gate.sh` (Stop) — one-shot block when code changed but the brain was not updated
- `brain-sync.sh` (SessionEnd) — auto-commits `.neo/brain/`

**Fail-open rationale.** `agent_type` in hook payloads has no formal stability contract in Claude Code (anthropics/claude-code#56168). Every hook exits 0 when it cannot determine what it needs (missing `jq`, unrecognized payload). A hook that breaks every write in a session is worse than one that occasionally misses a violation. Tool allowlists and the stop-gate audit provide defense-in-depth.

**Maintenance skills are not forked.** Claude Code skills support `context: fork`, which runs the skill body as the prompt of a fresh subagent, in the background by default (`background: false` waits instead). `/neo:gc`, `/neo:train`, and `/neo:evolve` are long-running and look like candidates, but each breaks under a fork:

- All three delegate to neo-shadow via the `Agent` tool. A backgrounded fork runs with the narrower background-subagent tool set, which has no `Agent` tool — and NEO caps spawn depth at 2 regardless.
- `/neo:train` (step 4) and `/neo:evolve` (step 5) are human-gated: nothing is written without an explicit yes. `AskUserQuestion` is stripped from every subagent, and a forked skill does not see the conversation, so the gate would have nothing to gate on.
- Restructuring `/neo:gc` as `context: fork` with `agent: neo-shadow` would sidestep the `Agent` tool, but the `agent` field is documented only for built-in types and subagents in `.claude/agents/` — not for plugin-namespaced ones. An unresolved `agent` falls back to `general-purpose`, which `jail.sh` does not jail. That trades a bounded, jailed writer for an unjailed one on an undocumented behavior.

The skills stay inline. Revisit if the `agent` field's handling of plugin subagents is documented.

---

## Second Brain

**Load path (zero LLM cost).** `brain-load.sh` runs at `SessionStart` and cats: `BRIEF.md`, `ACTIVE.md`, `LESSONS.md`, `INDEX.md` (full), `PROGRESS.md` (last 20 lines), and `.neo/CHECKPOINT.md` when written within the last hour. `ARCHITECTURE.md`, `DECISIONS.md`, and `WORKFLOWS.md` load on demand via INDEX pointers.

**Write path.** NEO assembles a session delta and spawns neo-shadow. One source of truth: pointers, never copies between files.

**Recall.** `/neo:recall` greps `.neo/brain`, `.neo/plans`, and `.neo/runs` for past decisions and work, returning `file:line` pointers.

**Sync.** `brain-sync.sh` commits `.neo/brain/` at `SessionEnd` with the message `neo: brain sync YYYY-MM-DD`. Opt out by creating `.neo/no-auto-commit`.
