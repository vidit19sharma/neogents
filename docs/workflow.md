# NEO Workflow Guide

End-to-end walkthrough of what actually happens when you work with NEO day to day. Covers install through shipping, with every agent spawn and hook firing named explicitly.

For the design rationale behind these choices, see [architecture.md](architecture.md). For the full hook contract, see [hooks-reference.md](hooks-reference.md). For brain file rules, see [brain-spec.md](brain-spec.md).

---

## Day 0 — Install

**From the marketplace:**

```
/plugin marketplace add vidit19sharma/neogents
/plugin install neo@neogents
```

**Dev mode (from a local clone of this repo):**

```
claude --plugin-dir .
```

Both paths register the plugin under the namespace `neo`, which is why all commands are `/neo:*`.

The plugin ships a `settings.json` containing `{"agent": "neo"}`. This single field hands the main thread to NEO on every session start. You don't invoke NEO manually; it is the session agent. To opt out, disable the plugin or override `agent` in your user settings.

Nothing else to configure. No API keys, no external services, no runtime dependencies beyond `jq` (used by the hooks) and whatever formatters your project already has.

---

## First Session — /neo:init

When you open a session in a project that has no `.neo/` directory, the `SessionStart` hook fires `brain-load.sh`. It finds no brain and prints one quiet hint:

```
[neo] No second brain in this project. Run /neo:init to create one.
```

Then it exits cleanly. NEO sees this hint in context and will suggest `/neo:init` once if you haven't already run it. It won't nag.

Run `/neo:init` to bootstrap the brain. Here's what happens:

1. **Guard check.** If `.neo/brain/` already exists, init stops and points you to `/neo:status` instead. It never overwrites a living brain.

2. **Scaffold.** Creates `.neo/brain/` and `.neo/plans/`, then copies the brain template files from `templates/brain/`.

3. **Interview.** NEO asks one question at a time, leading each with its best-guess answer inferred from the codebase. It reads `package.json`, `Makefile`, and similar files before asking about build commands. It confirms; it doesn't ask blind.

4. **Write.** Fills `.neo/brain/BRIEF.md` from your answers. If the codebase is non-empty, NEO does a quick exploration pass to populate the stack and layout sections of `ARCHITECTURE.md`. If no `CLAUDE.md` exists, it copies `templates/CLAUDE.md` and fills the command placeholders.

5. **Report.** Lists the created files and confirms: "Brain initialized. It loads automatically next session; save anytime with /neo:save."

From this point on, the brain loads at the start of every session with zero LLM cost.

---

## Anatomy of Every Session

Every session follows the same hook lifecycle, regardless of what you're working on.

```
Session opens
     |
     v
[SessionStart] brain-load.sh fires
     |  touches .neo/.session (session marker stop-gate.sh compares mtimes against)
     |  cats BRIEF + ACTIVE + LESSONS + INDEX + PROGRESS tail-20 into context
     |  cats CHECKPOINT.md too, if less than an hour old
     |  skips symlinked files; caps each at 16K, the whole dump at 64K
     |  (zero LLM cost — pure shell cat)
     |
     v
NEO reads the brain, picks up where ACTIVE.md left off
     |
     v
You send a message — NEO classifies intent, routes work
     |
     v
[PreToolUse / Edit|Write|NotebookEdit] jail.sh fires before every write
     |  blocks neo-shadow writes outside .neo/brain/
     |  all other agents and main thread pass through
     |
     v
File edited
     |
     v
[PostToolUse / Edit|Write|NotebookEdit] format.sh fires
     |  runs project-local formatter (prettier, ruff, gofmt, rustfmt)
     |  skips .neo/ files — brain layout is content, not code
     |  fail-open: never breaks an edit
     |
[PostToolUse / Agent|Task] run-ledger.sh fires after every spawn
     |  appends agent, task, verdict, and summary to .neo/runs/YYYY-MM-DD.md
     |  long reports get their own file with a pointer
     |
     v
Context approaches compaction limit
     |
[PreCompact] checkpoint.sh fires
     |  writes .neo/CHECKPOINT.md: branch, git status, diff stat, last message
     |  deterministic — no LLM involved, nothing to forget
     |
     v
NEO finishes responding
     |
[Stop] checkpoint.sh fires (throttled to once per 10 minutes), then stop-gate.sh
     |  stop-gate checks: a dirty file outside .neo/ newer than the .neo/.session marker,
     |  and no .neo/brain/ file newer than it
     |  if both true: blocks once with instructions to save
     |  if stop_hook_active=true in payload: lets through (one-shot, no loops)
     |  stands down entirely when .neo/ is gitignored (no honest signal either way)
     |
     v
Session ends
     |
[SessionEnd] brain-sync.sh fires
     |  commits .neo/brain/ with "neo: brain sync YYYY-MM-DD"
     |  skips if .neo/no-auto-commit exists
     |  skips during rebase/merge/cherry-pick
     |  exits 0 on every path — never fails the session end
```

The hooks are deterministic. They run regardless of what NEO's prompt says. A jail in a system prompt is a suggestion; a jail in a `PreToolUse` hook with `exit 2` is a hard block.

---

## How NEO Routes Your Request

Before acting on any message, NEO classifies intent. This classification is turn-local: it resets every message and is never carried forward.

| What you say | Intent | What NEO does |
|---|---|---|
| "explain X", "how does Y work" | understanding | explores (own tools or built-in exploration subagents), synthesizes, answers. No edits. |
| "implement X", "add Y", "fix Z" | implementation | tiers the request (see below), executes |
| "look into X", "investigate" | investigation | recon only, reports findings. No edits. |
| "what do you think of X" | evaluation | assesses, proposes, waits for confirmation |
| "X is broken", error pasted | fix | diagnoses, applies minimal fix. Never refactors while fixing. |
| "improve", "refactor", "clean up" | open-ended | assesses codebase state first, proposes approach, confirms |
| "commit", "push", "PR", "release" | shipping | follows the git rules in its own prompt. Never ships without being asked. |
| "did we already...", "when did we decide..." | recall | `/neo:recall` — greps the brain, plans, and run ledger before re-exploring |

NEO states its classification in one line before acting: "Intent: investigation, recon only, no edits." Three gates must pass before any implementation starts: the message contains an explicit implementation verb, the scope is concrete enough to execute without guessing, and no pending specialist result blocks the work. If any gate fails, NEO researches, clarifies, or waits. It doesn't touch files.

---

## The Three Tiers

After classifying intent as implementation, NEO picks a tier. Escalating is always safe; de-escalating is how codebases rot.

### TRIVIAL

**Trigger:** one file, known location, obvious change.

NEO edits directly and runs diagnostics. Spawning would cost more than doing. This is the only tier where NEO writes source code itself.

### STANDARD

**Trigger:** 2+ files, or 2+ steps, with clear scope.

```
1. Recon
   built-in exploration subagents (2–5, parallel) for codebase questions
   WebFetch/WebSearch for external library questions

2. Plan
   NEO writes a todo list: atomic items, each with a verify step

3. Execute
   trinity per task (fresh context each) — implementation and tests in the same task
   NEO handles tasks directly only when coordination overhead exceeds the task

4. Review
   smith — adversarial pass on the diff
```

### DEEP

**Trigger:** new feature, ambiguous scope, architectural impact. Also forced by `/neo:plan`.

```
1. Interview
   NEO asks one question at a time on the main thread
   Leads each question with a recommended answer
   Continues until goal, scope, non-goals, constraints, and every design fork are resolved
   Recon runs in parallel with the interview

2. Plan artifact
   NEO writes .neo/plans/YYYY-MM-DD-<slug>.md itself, following templates/plan.md
   Contents: goal, non-goals, inherited decisions, task graph with dependency edges,
             parallel waves, per-task files/do/verify specs, risks

3. Approval gate
   NEO presents the plan summary: goal, wave schedule, task count, risks
   Execution does not start before user approval

4. Contract negotiation
   Per task, NEO gives trinity and smith the done-criteria and verify plan
   Smith objects once with concrete gaps; revise until both agree
   Agreed contract is written into the plan artifact — smith reviews against exactly this later

5. Execute
   trinity per task, each in a fresh context, tests included
   Waves run in parallel where the dependency graph allows

6. Review
   smith adversarial pass on the full diff, against the recorded contracts

7. Simplify
   After approval, NEO strips dead code and slop from the diff scope itself,
   then re-runs the tests

8. Brain save
   NEO assembles session delta, spawns neo-shadow
```

**Failure protocol:** after 2 failed fix attempts on the same problem, NEO stops, re-reads the involved files from scratch, writes down what each attempt assumed and what disproved it, and re-derives the fix. After 3 failed attempts, NEO reverts to the last working state, documents what was tried, and asks the user. Shotgun debugging is forbidden.

---

## The Second Brain

The brain lives in `.neo/brain/` as plain markdown files. It's yours. Nothing is locked in, and it travels with the repo via git. The full contract is in [brain-spec.md](brain-spec.md); the short version:

| File | What it holds | When it changes |
|---|---|---|
| `BRIEF.md` | Scope, goals, constraints, non-goals | Pivots only |
| `ACTIVE.md` | Current focus, next steps, open questions, open commitments | Every save (full rewrite, 150-line cap) |
| `PROGRESS.md` | Append-only ledger of what shipped, dated | As work completes |
| `DECISIONS.md` | Significant choices with rationale and rejected alternatives | When a decision is made |
| `LESSONS.md` | Anti-patterns learned the hard way, dated and anchored | When a mistake teaches something reusable |
| `FRICTION.md` | Append-only ledger of corrections, review blocks, escalations | When the session hits friction; evidence for improving NEO itself |
| `ARCHITECTURE.md` | System patterns, module relationships, stack, gotchas | When patterns change |
| `INDEX.md` | Map of all brain content with `[[wiki-links]]` | When structure changes |
| `WORKFLOWS.md` | Recurring multi-step workflows; `candidate` → `proposed` → `skilled` | When a sequence recurs (3-sighting threshold); promoted via `/neo:train` |

Plans live separately in `.neo/plans/YYYY-MM-DD-<slug>.md`. Every subagent spawn is auto-logged to `.neo/runs/YYYY-MM-DD.md` by a hook — agent, task, verdict, summary. `.neo/CHECKPOINT.md` is a machine-written crash snapshot; it's disposable and never curated. `.neo/.session` is the session-start marker `stop-gate.sh` compares mtimes against — also disposable, never committed.

### When saves happen

| Trigger | Mechanism |
|---|---|
| Task boundary | NEO assembles delta, spawns neo-shadow |
| Before compaction | `checkpoint.sh` snapshots state deterministically; brain save still happens at task boundaries |
| Stop-gate fires | Gate names what to do; NEO spawns neo-shadow or user runs `/neo:save` |
| `/neo:save` command | NEO assembles delta, spawns neo-shadow |
| Session end | `brain-sync.sh` commits `.neo/brain/` to git automatically |

NEO never writes brain files itself. That judgment belongs to neo-shadow, running on the main model (`inherit`), with full attention. A wrong lesson poisons every future session that loads it.

### Auto-commit opt-out

Create `.neo/no-auto-commit` in your project root. The file's presence is the signal; its contents don't matter.

---

## Commands Reference in Workflow Context

| Command | When you'd reach for it |
|---|---|
| `/neo:init` | Day 0 in a new project, or when adopting NEO in an existing repo |
| `/neo:save` | Before ending a session manually, after a long work block, whenever you want a checkpoint |
| `/neo:status` | "Where were we?" — shows current focus, brain freshness, file sizes, tooling |
| `/neo:plan` | Forces DEEP tier for any request; use when scope is ambiguous or architectural |
| `/neo:review` | Before merging, after finishing a feature, or any time you want smith's adversarial pass |
| `/neo:map` | When adopting NEO in a mature codebase, or when `ARCHITECTURE.md` is empty or stale |
| `/neo:recall` | "Did we already solve this?" — greps `.neo/brain`, `.neo/plans`, `.neo/runs` and answers with `file:line` pointers |
| `/neo:evolve` | When `FRICTION.md` accumulates 3+ entries — proposes ONE bounded, evidence-backed edit to an agent prompt, skill, or template (human-gated; never hooks or CI) |
| `/neo:train` | When neo-shadow flags a proposed workflow; shows a draft for approval before writing anything |
| `/neo:gc` | When `/neo:status` flags lesson rot — scans for dead anchors and aged entries, then neo-shadow keeps / rewrites / archives only the flagged ones |

---

## Shipping

NEO handles git and GitHub operations itself, but only on explicit shipping intent: "commit", "push", "PR", "release". The rules live in NEO's own prompt:

- Match the repo's existing commit style (`git log -20` first).
- Atomic commits — one logical change each.
- Secret scan before staging. `git pull --rebase` before every push; hard stop on conflicts.
- Files at or past ~50 MB: recommend LFS or ask (GitHub hard-fails at 100 MB).
- Never force-push shared branches. Never commit without being asked.

---

## Enforcement — What Stops Rogue Behavior

NEO enforces constraints structurally, not just through prompts.

### Structural tool allowlists

Each agent's frontmatter lists exactly the tools it may use. Leaf agents (every specialist except neo) have no `Agent` tool in their frontmatter. They structurally cannot spawn regardless of what their prompt says. Spawn depth is capped at 2: neo to specialist. Specialists never spawn.

### Hooks (the hard layer)

| Hook | What it does | Exit on block |
|---|---|---|
| `jail.sh` (PreToolUse / Edit\|Write\|NotebookEdit) | Blocks neo-shadow writing outside `.neo/brain/` | 2 (with corrective feedback to the agent) |
| `stop-gate.sh` (Stop) | Blocks session completion when a dirty file is newer than the `.neo/.session` session marker and no brain file is; stands down when `.neo/` is gitignored | 2 (one-shot; lets through on second attempt) |
| `checkpoint.sh` (Stop, PreCompact) | Snapshots branch, git status, diff stat, last message to `.neo/CHECKPOINT.md` | never blocks |
| `run-ledger.sh` (PostToolUse / Agent\|Task) | Appends every spawn to `.neo/runs/` | never blocks |

`format.sh` (PostToolUse) and `brain-sync.sh` (SessionEnd) are not blocking hooks. They exit 0 on every path.

### Fail-open policy

Every hook in this plugin is fail-open. When a hook can't determine what it needs (missing `jq`, unrecognized payload shape, absent `agent_type` field), it exits 0 and allows the operation. The rationale: a hook that breaks every write in a session because of a Claude Code version change is worse than one that occasionally misses a jail violation. The structural tool allowlists and the stop-gate's post-hoc `git status` audit provide defense-in-depth for the cases where hooks can't act.

The `agent_type` field in PreToolUse payloads has no formal stability contract in Claude Code (tracked at anthropics/claude-code#56168). The jail strips namespace prefixes (`neo:neo-shadow` becomes `neo-shadow`) to handle both forms that have appeared across versions.

---

## A Worked Example

**Request:** "Add rate limiting to the API. We're getting hammered on /search."

Here's the full trace through DEEP tier.

**1. Intent classification.** NEO reads the message. "Intent: implementation, DEEP tier (new behavior, cross-cutting concern, unclear scope)."

**2. Interview (main thread).** NEO asks one question at a time, leading each with a recommendation: rate limit and window, enforcement layer, counter store (Redis vs in-memory), response on limit hit. Meanwhile it fires built-in exploration subagents in parallel: "Find all route definitions, existing middleware registration order, and any existing rate-limit or throttle code in this repo."

**3. Plan artifact.** Once the interview resolves all forks, NEO writes `.neo/plans/2026-07-13-rate-limiting.md` itself: goal and non-goals, inherited decisions (Redis already in stack, 429 response, middleware layer), task graph with dependency edges, per-task files/do/verify specs.

**4. Approval gate.** NEO presents the plan summary. You approve.

**5. Contract negotiation.** Before Wave 1 starts, NEO gives trinity and smith each task's done-criteria and verify plan — e.g. the middleware task: "returns 429 past the limit, verified by `npm test -- rate-limit`". Smith objects once on a concrete gap (the config-schema task's criteria miss a malformed Redis URL); NEO revises until both agree. The agreed contracts go into the plan artifact.

**6. Execute (Wave 1 — parallel).** NEO spawns trinity twice in the same message: instance A implements the rate-limit middleware plus its tests; instance B writes the config schema plus its tests. Each receives the full 6-section delegation contract with exact file paths and verify steps. They know nothing about each other or the broader request. `run-ledger.sh` logs both spawns to `.neo/runs/`. After each file write, `format.sh` runs the project formatter.

**7. Execute (Wave 2 — sequential).** Trinity instance C wires the middleware into the app, depending on Wave 1 outputs, and covers the wiring with a test. NEO verifies trinity's report against MUST DO / MUST NOT DO before accepting.

**8. Review.** NEO spawns smith with the full diff. Smith reads every changed file, runs the test suite against the recorded contracts, checks whether the rate-limit pattern was replicated correctly across similar routes, and delivers `VERDICT: APPROVE` or `VERDICT: BLOCK` with `file:line` evidence for every blocking item.

**9. Simplify.** Smith approves. NEO strips dead code, needless abstraction, and comment slop from the diff scope itself, then re-runs the tests.

**10. Brain save.** NEO assembles the session delta: what was built, which files changed, the Redis decision and why, where to pick up next. Spawns neo-shadow, which rewrites `ACTIVE.md`, appends to `PROGRESS.md`, and records the Redis decision in `DECISIONS.md`. `jail.sh` fires on every neo-shadow write; all paths are under `.neo/`, so it exits 0.

**11. Stop gate.** NEO finishes responding. New middleware files are newer than the session's `.neo/.session` marker, but so is the brain (neo-shadow just updated it). The gate's block condition — dirty file newer than the marker AND no brain file newer — doesn't hold, so the session completes.

**12. Session end.** `brain-sync.sh` commits `.neo/brain/` with `neo: brain sync 2026-07-13`. Next session opens with the updated brain already in context.

---

## What NEO Doesn't Do

A few things worth stating explicitly, since they're easy to assume:

- **No auto-commit of code.** Shipping only happens when you explicitly ask. (`brain-sync.sh` commits only `.neo/brain/`.)
- **No vector database.** The brain is plain markdown files. No embeddings, no external services.
- **No MCP servers.** Zero runtime dependencies beyond `jq` and project-local formatters.
- **No speculative file reads.** NEO explores rather than guessing about code it hasn't read — and greps `.neo/runs/` before re-doing recon it already paid for.
