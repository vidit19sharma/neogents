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

2. **Scaffold.** Creates `.neo/brain/` and `.neo/plans/`, then copies the eight brain template files from `templates/brain/`.

3. **Interview.** NEO asks one question at a time, leading each with its best-guess answer inferred from the codebase. It reads `package.json`, `Makefile`, and similar files before asking about build commands. It confirms; it doesn't ask blind. The questions cover: what the project is, who it's for, the scope of the current version, explicit non-goals, hard constraints, and build/test/lint commands.

4. **Write.** Fills `.neo/brain/BRIEF.md` from your answers. If the codebase is non-empty, NEO does a quick pass (or spawns keymaker) to populate the stack and layout sections of `ARCHITECTURE.md`. If no `CLAUDE.md` exists, it copies `templates/CLAUDE.md` and fills the command placeholders. If one already exists, it leaves it alone.

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
     |  cats BRIEF + ACTIVE + LESSONS + INDEX + PROGRESS tail-20 into context
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
     |  blocks neo-shadow writes outside .neo/
     |  blocks architect writes outside .neo/plans/
     |  all other agents and main thread pass through
     |
[PreToolUse / Agent|Task] spawn-guard.sh fires before every spawn
     |  blocks any agent not in the NEO roster
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
     v
Context approaches compaction limit
     |
[PreCompact] checkpoint.sh fires
     |  deterministic snapshot: branch, HEAD, git status, diff stat,
     |  last assistant message -> .neo/CHECKPOINT.md (no LLM involved)
     |
     v
NEO finishes responding
     |
[Stop] checkpoint.sh fires (throttled: one write per 10 min)
     |
[Stop] stop-gate.sh fires
     |  checks: code dirty outside .neo/ AND brain clean inside .neo/brain/
     |  if both true: blocks once with instructions to save
     |  if stop_hook_active=true in payload: lets through (one-shot, no loops)
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
| "explain X", "how does Y work" | understanding | spawns keymaker/tank, synthesizes, answers. No edits. |
| "implement X", "add Y", "fix Z" | implementation | tiers the request (see below), executes |
| "look into X", "investigate" | investigation | recon only, reports findings. No edits. |
| "what do you think of X" | evaluation | assesses, proposes, waits for confirmation |
| "X is broken", error pasted | fix | diagnoses, applies minimal fix. Never refactors while fixing. |
| "improve", "refactor", "clean up" | open-ended | assesses codebase state first, proposes approach, confirms |
| "commit", "push", "PR", "release" | shipping | spawns morpheus with exact scope. Never runs git inline. |
| "write tests", "cover X with tests" | testing | spawns mouse with the code under test |

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
   keymaker (codebase questions) + tank (external library questions) — parallel
   
2. Plan
   NEO writes a todo list: atomic items, each with a verify step
   
3. Execute
   trinity per task (fresh context each)
   NEO handles tasks directly only when coordination overhead exceeds the task
   
4. Test
   mouse — when behavior changed and the project has a test suite
   
5. Review
   smith — adversarial pass on the diff
```

### DEEP

**Trigger:** new feature, ambiguous scope, architectural impact. Also forced by `/neo:plan`.

```
1. Interview
   NEO asks one question at a time on the main thread
   Leads each question with a recommended answer
   Continues until goal, scope, non-goals, constraints, and every design fork are resolved
   Recon (keymaker/tank) runs in parallel with the interview

2. Architect
   Receives: full interview transcript + recon findings (fresh context)
   Produces: .neo/plans/YYYY-MM-DD-<slug>.md
   Contents: goal, non-goals, inherited decisions, task graph with dependency edges,
             parallel waves, per-task files/do/verify/agent specs, risks
   Jailed to .neo/plans/ — cannot write code

3. Approval gate
   NEO presents the plan summary: goal, wave schedule, task count, risks
   Execution does not start before user approval

4. Execute
   trinity per task, each in a fresh context
   Waves run in parallel where the dependency graph allows

5. Test
   mouse writes and runs tests for the new behavior

6. Review
   smith adversarial pass on the full diff

7. Simplify
   switch strips dead code and slop from the diff scope
   Behavior-preserving only — runs tests after each removal, reverts on failure

8. Brain save
   NEO assembles session delta, spawns neo-shadow
```

**Failure protocol:** after 2 failed fix attempts on the same problem, NEO stops and consults oracle with the full failure history. After 3 failed attempts, NEO reverts to the last working state, documents what was tried, and asks the user. Shotgun debugging is forbidden.

---

## The Second Brain

The brain lives in `.neo/brain/` as eight plain markdown files. It's yours. Nothing is locked in, and it travels with the repo via git.

| File | What it holds | When it changes |
|---|---|---|
| `BRIEF.md` | Scope, goals, constraints, non-goals | Pivots only |
| `ACTIVE.md` | Current focus, next steps, open questions | Every save (full rewrite, 150-line cap) |
| `PROGRESS.md` | Append-only ledger of what shipped, dated | As work completes |
| `DECISIONS.md` | Significant choices with rationale and rejected alternatives | When a decision is made |
| `LESSONS.md` | Anti-patterns learned the hard way | When a mistake teaches something reusable |
| `ARCHITECTURE.md` | System patterns, module relationships, stack, gotchas | When patterns change |
| `INDEX.md` | Map of all brain content with `[[wiki-links]]` | When structure changes |
| `WORKFLOWS.md` | Recurring multi-step workflows; `candidate` → `proposed` → `skilled` | When a sequence recurs (3-sighting threshold); promoted via `/neo:train` |
| `FRICTION.md` | Append-only evidence ledger of corrections, review blocks, and escalations (`[F-NNN]` stable IDs) | When the delta contains a user correction, smith BLOCK, 2-fail escalation, or revert after approval |

Plans live separately in `.neo/plans/YYYY-MM-DD-<slug>.md`. Subagent spawns are auto-logged by a hook to `.neo/runs/YYYY-MM-DD.md` (agent, task, verdict, summary — long reports get their own file). `.neo/CHECKPOINT.md` is a machine-written snapshot of git state from the last Stop or compaction; newest wins, safe to delete.

### What loads at session start

`brain-load.sh` cats these files directly into context. No LLM call, no cost:

```
BRIEF.md        full
ACTIVE.md       full
LESSONS.md      full
INDEX.md        full
PROGRESS.md     last 20 lines only
```

`ARCHITECTURE.md`, `DECISIONS.md`, `WORKFLOWS.md`, and `FRICTION.md` are not loaded automatically. The INDEX points to them; NEO reads them on demand when they're relevant. If `WORKFLOWS.md` has any `status: proposed` entries, `brain-load.sh` surfaces a one-line hint at session start so NEO can offer `/neo:train`. If `.neo/CHECKPOINT.md` is fresh (under an hour old), `brain-load.sh` cats it too.

### When saves happen

| Trigger | Mechanism |
|---|---|
| Task boundary | NEO assembles delta, spawns neo-shadow |
| Before compaction | `checkpoint.sh` writes a deterministic snapshot to `.neo/CHECKPOINT.md` |
| Stop-gate fires | Gate names what to do; NEO spawns neo-shadow or user runs `/neo:save` |
| `/neo:save` command | NEO assembles delta, spawns neo-shadow |
| Session end | `brain-sync.sh` commits `.neo/brain/` to git automatically |

NEO never writes brain files itself. That judgment belongs to neo-shadow, running on the main model (`inherit`), with full attention. A wrong lesson poisons every future session that loads it.

### The write flow

1. NEO assembles a session delta: what happened, what changed (git diff summary), decisions made, mistakes hit, where work stopped, what comes next.
2. NEO spawns neo-shadow with the delta.
3. neo-shadow reads the current brain files before writing anything.
4. neo-shadow rewrites `ACTIVE.md` in full (150-line cap), appends to `PROGRESS.md`, updates `DECISIONS.md`/`LESSONS.md` only when the delta earns it, touches `ARCHITECTURE.md` only on pattern changes, `BRIEF.md` only on genuine scope pivots, and updates `WORKFLOWS.md` when the session repeated a known multi-step sequence (incrementing seen counts; setting `status: proposed` at 3 sightings and flagging it in the report).
5. neo-shadow reports which files changed and flags anything contradictory.

### Auto-commit opt-out

Create `.neo/no-auto-commit` in your project root. The file's presence is the signal; its contents don't matter. `brain-sync.sh` checks for it before doing anything.

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
| `/neo:train` | When neo-shadow flags a proposed workflow (or you want to turn any recurring sequence into a skill); shows a draft for approval before writing anything |
| `/neo:gc` | When `/neo:status` flags lesson rot — scans for dead anchors and aged entries, then neo-shadow keeps / rewrites / archives only the flagged ones |
| `/neo:recall` | "Did we already solve this?" / "When did we decide X?" — greps `.neo/brain`, `.neo/plans`, and `.neo/runs`, returns `file:line` pointers |
| `/neo:evolve` | When `FRICTION.md` has accumulated recurring patterns — proposes ONE bounded, human-approved edit to an agent prompt, skill, or template (never hooks or CI) |

### /neo:status in detail

Reads live data before reporting: brain file line counts, last brain commit timestamp, code changes since that commit, and whether graphify is installed. Flags `ACTIVE.md` over 150 lines or `ARCHITECTURE.md` over 500 (both signal that neo-shadow should migrate content). Output is a tight block you can scan in ten seconds.

### /neo:map in detail

Fans out 3-4 keymakers in parallel, each covering one angle: stack and entry points, layout and boundaries, patterns and conventions, gotchas and hotspots. Then spawns neo-shadow to synthesize all findings into `ARCHITECTURE.md`. Safe to re-run: shadow rewrites from current findings, and prior knowledge lives in git history.

---

## Shipping

Morpheus handles all git and GitHub operations. NEO spawns it only on explicit shipping intent: "commit", "push", "PR", "release", "changelog". This preserves the "never commit unless asked" rule while keeping git mechanics off NEO's coordination budget.

What morpheus does:

- **Secret scan** before staging. Blocks if secrets are found.
- **Large-file check.** Recommends LFS for files approaching 100 MB (GitHub's hard limit).
- **`git pull --rebase`** before every push. Hard stops on conflicts. Never pushes over them.
- **Batched pushes** when a commit range would produce a pack approaching GitHub's 2 GB limit.
- **Simple imperative commit messages.** No AI-generated essays.
- **PR creation** via `gh`. Writes the PR description from the plan artifact or session context.
- **Release docs** (CHANGELOG, release notes) when asked. Owns these files; never touches `.neo/brain/` commits (brain-sync owns those).

Morpheus never force-pushes and never rewrites pushed history.

---

## Enforcement — What Stops Rogue Behavior

NEO enforces constraints structurally, not just through prompts. There are three layers.

### Structural tool allowlists

Each agent's frontmatter lists exactly the tools it may use. Leaf agents (every specialist except neo) have no `Agent` tool in their frontmatter. They structurally cannot spawn regardless of what their prompt says. Spawn depth is capped at 2: neo to specialist. Specialists never spawn.

### Hooks (the hard layer)

| Hook | What it blocks | Exit on block |
|---|---|---|
| `jail.sh` (PreToolUse / Edit\|Write\|NotebookEdit) | neo-shadow writing outside `.neo/`; architect writing outside `.neo/plans/` | 2 (with corrective feedback to the agent) |
| `spawn-guard.sh` (PreToolUse / Agent\|Task) | Spawns of agents not in the NEO roster | 2 (with roster list) |
| `stop-gate.sh` (Stop) | Session completion when code changed but brain wasn't updated | 2 (one-shot; lets through on second attempt) |

`format.sh` (PostToolUse), `run-ledger.sh` (PostToolUse on Agent|Task), `checkpoint.sh` (PreCompact + Stop), and `brain-sync.sh` (SessionEnd) are not blocking hooks. They exit 0 on every path.

### Fail-open policy

Every hook in this plugin is fail-open. When a hook can't determine what it needs (missing `jq`, unrecognized payload shape, absent `agent_type` field), it exits 0 and allows the operation. The rationale: a hook that breaks every write in a session because of a Claude Code version change is worse than one that occasionally misses a jail violation. The structural tool allowlists and the stop-gate's post-hoc `git status` audit provide defense-in-depth for the cases where hooks can't act.

The `agent_type` field in PreToolUse payloads has no formal stability contract in Claude Code (tracked at anthropics/claude-code#56168). The jail strips namespace prefixes (`neo:neo-shadow` becomes `neo-shadow`) to handle both forms that have appeared across versions.

---

## A Worked Example

**Request:** "Add rate limiting to the API. We're getting hammered on /search."

Here's the full trace through DEEP tier.

**1. Intent classification**

NEO reads the message. "Intent: implementation, DEEP tier (new behavior, cross-cutting concern, unclear scope)."

**2. Interview (main thread)**

NEO asks one question at a time, leading each with a recommendation:

- "What rate limit? I'd suggest 60 req/min per IP for /search, stricter for unauthenticated callers. Does that match your expectation?"
- "Where should limits be enforced? Middleware layer or route handler? I'd go middleware so it applies consistently."
- "Redis for the counter store, or in-memory? In-memory is simpler but won't survive restarts or scale horizontally. Do you have Redis already?"
- "What response on limit hit? 429 with Retry-After, or silent drop? 429 is the standard."

Meanwhile, NEO fires keymaker in parallel (same message, separate spawn): "Find all route definitions, existing middleware registration order, and any existing rate-limit or throttle code in this repo."

**3. Architect**

Once the interview resolves all forks, NEO spawns architect in a fresh context with: the full interview transcript, keymaker's findings (middleware file paths, registration order, existing patterns), and relevant brain excerpts from `ARCHITECTURE.md`.

Architect produces `.neo/plans/2026-07-13-rate-limiting.md` containing:
- Goal and non-goals
- Inherited decisions (Redis already in stack, 429 response, middleware layer)
- Task graph: Task 1 (rate-limit middleware), Task 2 (wire into app), Task 3 (config), Task 4 (tests). Tasks 1 and 3 can run in parallel; Task 2 depends on both.
- Per-task specs: files to touch, what to do, verify command, which agent

`jail.sh` fires on architect's write to `.neo/plans/`. Path matches `.neo/plans/**`, exits 0, write proceeds.

**4. Approval gate**

NEO presents the plan summary. You approve.

**5. Execute (Wave 1 — parallel)**

NEO spawns trinity twice in the same message:
- Trinity instance A: implement the rate-limit middleware module
- Trinity instance B: write the config schema

`spawn-guard.sh` fires twice. Both `trinity` names are in the roster, exits 0 both times.

Each trinity instance receives the full 6-section delegation contract with exact file paths, the task's `do` and `verify` steps, and the relevant keymaker findings. They know nothing about each other or the broader request.

After each file write, `format.sh` fires and runs the project-local formatter on the changed file.

**6. Execute (Wave 2 — sequential)**

Trinity instance C wires the middleware into the app, depending on Wave 1 outputs. NEO verifies trinity's report against MUST DO / MUST NOT DO before accepting.

**7. Test**

NEO spawns mouse with the middleware module and the existing test suite. Mouse reads both in full, enumerates scenarios (happy path, limit hit, per-IP isolation, Redis failure fallback), writes tests indistinguishable from the existing ones, runs the suite, and reports actual command output. Failures are findings. Mouse never weakens an assertion.

**8. Review**

NEO spawns smith with the full diff. Smith reads every changed file, runs the test suite, checks whether the rate-limit pattern was replicated correctly across any similar routes, and delivers a verdict: `VERDICT: APPROVE` or `VERDICT: BLOCK` with `file:line` evidence for every blocking item.

**9. Simplify**

Smith approves. NEO spawns switch with the diff scope. Switch hunts dead code, needless abstraction, and comment slop introduced during implementation. Runs tests after each removal. Reverts anything that causes a failure.

**10. Brain save**

NEO assembles the session delta: what was built, which files changed, the Redis decision and why, the 429 response choice, where to pick up next (integration tests, load testing). Spawns neo-shadow.

neo-shadow reads the current brain files, then:
- Rewrites `ACTIVE.md`: focus = rate limiting shipped, next = load test under realistic traffic
- Appends to `PROGRESS.md`: "Added /search rate limiting (60 req/min/IP, Redis, 429+Retry-After); all rate-limit tests green."
- Appends to `DECISIONS.md`: Redis chosen over in-memory for horizontal scale
- Leaves `LESSONS.md` and `BRIEF.md` untouched (nothing new learned, no scope pivot)

`jail.sh` fires on every neo-shadow write. All paths are under `.neo/`, exits 0.

**11. Stop gate**

NEO finishes responding. `stop-gate.sh` fires. Code is dirty (new middleware files), brain is also dirty (neo-shadow just updated it). Gate condition: code dirty AND brain clean. Brain is not clean, so gate exits 0 and the session completes.

**12. Session end**

`brain-sync.sh` fires. Commits `.neo/brain/` with `neo: brain sync 2026-07-13`. Next session opens with the updated brain already in context.

---

## What NEO Doesn't Do

A few things worth stating explicitly, since they're easy to assume:

- **No auto-commit.** Morpheus only runs when you explicitly ask to commit, push, or create a PR.
- **No vector database.** The brain is plain markdown files. No embeddings, no external services.
- **No MCP servers.** Zero runtime dependencies beyond `jq` and project-local formatters.
- **No auto-triggered morpheus.** Shipping is always explicit.
- **No speculative file reads.** NEO spawns keymaker rather than guessing about code it hasn't read.
