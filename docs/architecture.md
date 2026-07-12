# NEO Architecture

Deep dive into design principles, the agent roster, the tiered pipeline, delegation mechanics, and the enforcement model.

---

## Design Principles

| Principle | Rationale |
|---|---|
| Context isolation is the superpower | Subagents inherit zero history. The orchestrator constructs exactly the context each specialist needs, no more. This is what makes parallel recon safe and cheap. |
| Leaf workers never get the spawn tool | Structural guarantee: a leaf cannot spawn even if its prompt told it to. Depth stays at 2. |
| Hooks are deterministic; prompts are advisory | Enforce with hooks, guide with prompts. A jail in a system prompt is a suggestion. A jail in a `PreToolUse` hook with `exit 2` is a hard block. |
| Give the agent a way to verify its work | Evidence, not assertions. "It typechecks" is not verified. Every task has a `verify:` step; every report has command output. |
| Plan-first | Energy poured into the plan is what lets implementation be one-shot. The architect artifact exists so trinity never has to guess. |
| Persist learnings before ending sessions | The second brain is why this project survives context loss. neo-shadow runs on the main model because memory writes are the highest-leverage tokens in the system. |
| Bootstrap or die | Without session-start activation, architecture is dead weight. The `SessionStart` hook is the entry point; everything else depends on it. |
| Model tiering = cost control | haiku for search, sonnet for implementation, opus for planning/review/debugging. Cheap models do cheap work; expensive models do judgment work. |
| Detect, don't depend | Optional tooling (graphify) is advertised when present, never required. The plugin works with zero external dependencies. |

---

## Agent Roster

All agents live in `agents/*.md`. The `description` field drives Claude Code's auto-delegation; the Matrix theme costs nothing functionally.

### neo (`agents/neo.md`)

The main session agent. Activated via `settings.json` `{"agent": "neo"}`, which hands the main thread to NEO on every session start.

**Model:** session model (whatever the user has configured)
**Tools:** all tools, including `Agent`
**Spawns:** yes, the ONLY agent that spawns

Responsibilities:
- Classify every incoming message (intent gate, turn-local, never carried across turns)
- Route to the correct tier (TRIVIAL / STANDARD / DEEP)
- Construct delegation prompts with the 6-section contract
- Verify specialist output against MUST DO / MUST NOT DO before accepting
- Maintain todo lists as the real-time progress display
- Delegate brain saves to neo-shadow; never write brain files itself

### neo-shadow (`agents/neo-shadow.md`)

**Model:** `inherit` (resolves to the main session model)
**Tools:** Read, Grep, Glob, Write, Edit (no Bash)
**Spawns:** no

The memory keeper. Runs on the main model because context management is the highest-priority work in the system. A wrong lesson or a vague `ACTIVE.md` poisons every future session that loads it.

Shadow receives a session delta from NEO (what happened, git diff summary, decisions, lessons, where work stopped) and:
- Rewrites `ACTIVE.md` in full (150-line cap)
- Appends to `PROGRESS.md` (append-only, never edits old entries)
- Appends to `DECISIONS.md` and `LESSONS.md` only when the delta earns it
- Touches `ARCHITECTURE.md` only when system patterns changed
- Touches `BRIEF.md` only on genuine scope pivots
- Updates `INDEX.md` when files or sections move

Shadow is jailed to `.neo/` by the `jail.sh` hook. It cannot touch source code even if instructed to.

### keymaker (`agents/keymaker.md`)

**Model:** haiku
**Tools:** Read, Grep, Glob
**Spawns:** no

Codebase search. Given a question about this repository, keymaker finds the exact files, lines, and patterns that answer it. NEO fires 2-5 in parallel for non-trivial recon. Output is structured `FOUND / CONVENTIONS OBSERVED / NOT FOUND` with `file:line` references.

### tank (`agents/tank.md`)

**Model:** haiku
**Tools:** Read, Grep, Glob, WebFetch, WebSearch
**Spawns:** no

External knowledge. Unfamiliar libraries, framework questions, API docs, OSS examples, best practices. Checks project manifests for dependency versions before answering version-sensitive questions. Output is structured `ANSWER / DETAILS / SOURCES / CAVEATS`.

### architect (`agents/architect.md`)

**Model:** opus
**Tools:** Read, Grep, Glob, Write
**Spawns:** no

Plan synthesis. Receives the interview transcript (from `/neo:plan`), recon findings, and constraints. Produces a plan artifact at `.neo/plans/YYYY-MM-DD-<slug>.md` containing: goal, non-goals, inherited decisions, task graph with dependency edges, parallel waves, and per-task `files / do / verify / agent` specs.

Jailed to `.neo/plans/` by the `jail.sh` hook. Cannot write code.

**Platform constraint:** subagents cannot use `AskUserQuestion`. The grill-me interview therefore runs on the main thread (NEO asks, one question at a time), and only the completed transcript is handed to architect in a fresh context for synthesis.

### trinity (`agents/trinity.md`)

**Model:** sonnet
**Tools:** Read, Grep, Glob, Write, Edit, Bash
**Spawns:** no

Implementation. Executes ONE well-defined task per invocation. Receives a fully-specified task from a plan artifact or NEO's delegation prompt. Reads every file the task names before writing. Matches existing conventions exactly. Runs the task's `verify:` step and includes command output in its report. Stops and reports conflicts rather than improvising.

### mouse (`agents/mouse.md`)

**Model:** sonnet
**Tools:** Read, Grep, Glob, Write, Edit, Bash
**Spawns:** no

Test engineer. Receives ONE test target per invocation: a module, a change set, or a described behavior. Reads the code under test and the existing test suite in full, then enumerates scenarios (happy path, edges, failure modes, regressions) before writing a single line. Tests must be indistinguishable from the ones already in the project. Runs the suite and captures actual command output. Failures are findings: mouse reports them precisely and never weakens an assertion or adds a skip. If the project has no test framework, mouse reports the options that fit the stack and stops. Never modifies production code.

### smith (`agents/smith.md`)

**Model:** opus
**Tools:** Read, Grep, Glob, Bash
**Spawns:** no

Adversarial review. Read-only with test execution. Hunts correctness errors, spec deviations, security issues, and replication of found patterns across the codebase. Delivers a `VERDICT: APPROVE | BLOCK` with `file:line` evidence for every blocking item. Cannot write or edit.

### switch (`agents/switch.md`)

**Model:** sonnet
**Tools:** Read, Grep, Glob, Write, Edit, Bash
**Spawns:** no

Code simplifier. Receives a scope (files or diff from the current effort) and works inside it only. Hunts dead code, needless abstraction, duplication, comment slop (restating the code, changelog narration, placeholder headers), defensive slop (null checks for conditions impossible by construction), and verbosity where the language idiom does it in fewer lines. Every removal is behavior-preserving: switch runs the project's tests or build after each change and reverts any simplification that causes a failure. When judgment is close, it leaves the code alone and reports instead. Never touches tests, never touches files outside the given scope.

### oracle (`agents/oracle.md`)

**Model:** opus
**Tools:** Read, Grep, Glob, Bash
**Spawns:** no

Consultant. Consulted automatically after 2 failed fix attempts on the same problem. Also used for architecture tradeoffs and security review. Diagnoses root causes, not symptoms. Prescribes the minimal change with `file:line` precision. Cannot write or edit.

### morpheus (`agents/morpheus.md`)

**Model:** sonnet
**Tools:** Read, Grep, Glob, Write, Edit, Bash
**Spawns:** no

Git/GitHub operator. Spawned ONLY on explicit shipping intent (commit, push, PR, release) — this preserves the "never commit unless asked" rule while keeping git mechanics off NEO's coordination budget. Simple imperative commit messages, secret scan before staging, large-file prevention (LFS recommendation at 100 MB — GitHub's hard limit), `git pull --rebase` before push with hard stop on conflicts, and batched commit-range pushes when a pack approaches GitHub's 2 GB limit. Owns release-adjacent docs only (CHANGELOG, release notes, PR descriptions). Never force-pushes, never rewrites pushed history, never touches `.neo/brain/` commits (the brain-sync hook owns those).

---

## Tiered Pipeline

NEO classifies every request before acting. The classification is turn-local and never carried across turns.

### TRIVIAL

**Trigger:** one file, known location, obvious change.

NEO edits directly and runs diagnostics. Spawning would cost more than doing.

### STANDARD

**Trigger:** 2+ files, or 2+ steps, with clear scope.

1. Recon: keymaker (and tank if external libraries are involved) in parallel.
2. Plan: NEO writes a todo list with atomic items, each with a verify step.
3. Execute: trinity per task, or NEO directly when coordination overhead exceeds the task.
4. Test: mouse writes and runs tests when behavior changed and a test suite exists.
5. Review: smith on the diff.

### DEEP

**Trigger:** new feature, ambiguous scope, architectural impact. Also forced by `/neo:plan`.

1. Interview: NEO asks one question at a time on the main thread, leading with a recommended answer. Continues until goal, scope, non-goals, constraints, and every design fork are resolved.
2. Recon: keymaker/tank run in parallel with the interview.
3. Architect: receives the full interview transcript + recon findings in a fresh context. Produces the plan artifact.
4. Approval gate: user reviews and approves the plan. Execution does not start before approval.
5. Execute: trinity per task, each in a fresh context. Waves run in parallel where the dependency graph allows.
6. Test: mouse writes and runs tests.
7. Review: smith adversarial pass on the full diff.
8. Simplify: switch strips dead code and slop from the diff scope.
9. Brain save: neo-shadow updates the second brain.

**Failure protocol:** after 2 failed fix attempts on the same problem, NEO stops and consults oracle with the full failure history. After 3, NEO reverts to the last working state, documents what was tried, and asks the user. Shotgun debugging is forbidden.

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

Specialists inherit zero history. They know nothing about the user's request, previous findings, or why. NEO pastes what matters. File paths beat descriptions. When a specialist returns work, NEO verifies it against MUST DO / MUST NOT DO before accepting.

Independent recon always runs simultaneously. Sequential spawning of independent work is waste.

---

## Enforcement Model

The plugin enforces constraints structurally, not just through prompts.

### Structural tool allowlists

Each agent's frontmatter lists exactly the tools it may use. Leaf agents have no `Agent` tool, so they structurally cannot spawn regardless of what their prompt says.

### Hooks

Hooks are the hard enforcement layer. See `docs/hooks-reference.md` for full details.

**Jail (`jail.sh`, PreToolUse on Edit|Write|NotebookEdit):**
- neo-shadow may only write under `.neo/`
- architect may only write under `.neo/plans/`
- All other agents and the main thread pass through
- Exit 2 blocks the write and feeds the error message back to the agent as corrective feedback
- Fail-open by design: if `agent_type` is absent from the payload or `jq` is missing, the hook allows rather than breaking every write in the session

**Spawn guard (`spawn-guard.sh`, PreToolUse on Agent|Task):**
- Blocks spawns of agents not in the NEO roster
- Defense-in-depth: the structural guarantee (no `Agent` tool on leaves) is the primary control; this guard catches roster drift from the main thread
- Fail-open: unrecognized payload shapes are allowed through

**Stop gate (`stop-gate.sh`, Stop):**
- One-shot: blocks completion once when code changed but the brain was not updated
- Checks `stop_hook_active` in the payload; if true, allows immediately (no infinite loops)
- Only fires when inside a git repo with a `.neo/brain/` directory

**Brain sync (`brain-sync.sh`, SessionEnd):**
- Auto-commits `.neo/brain/` at session end
- Skips if `.neo/no-auto-commit` exists
- Skips during rebase, merge, or cherry-pick
- Never fails the session end (exits 0 on every path)

### Fail-open rationale

`jail.sh` reads `agent_type` from the PreToolUse stdin payload. This field has no formal stability contract in Claude Code (tracked at anthropics/claude-code#56168). The hook is fail-open by design: if the field is absent or `jq` is unavailable, the hook exits 0 and allows the write. The structural tool allowlists and the stop-gate audit of `git status` provide defense-in-depth when the jail cannot identify the agent.

---

## Second Brain

### Load path (zero LLM cost)

`brain-load.sh` runs at `SessionStart` and cats the following into context:
- `BRIEF.md` (full)
- `ACTIVE.md` (full)
- `LESSONS.md` (full)
- `INDEX.md` (full)
- `PROGRESS.md` (last 20 lines)

`ARCHITECTURE.md` and `DECISIONS.md` are not loaded automatically. The INDEX points to them; NEO reads them on demand.

### Write path

NEO assembles a session delta and spawns neo-shadow. Shadow rewrites `ACTIVE.md`, appends to `PROGRESS.md`, and updates other files only when the delta warrants it. One source of truth: pointers, never copies between files.

### Sync

`brain-sync.sh` runs at `SessionEnd` and commits `.neo/brain/` with the message `neo: brain sync YYYY-MM-DD`. Opt out by creating `.neo/no-auto-commit`.
