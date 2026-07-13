# NEO — Design Specification

**Date:** 2026-07-13
**Status:** Approved (user: "implement")
**Target:** Claude Code plugin (v1). Harness-neutral authoring for future OpenCode/Codex adapters.

---

## 1. Identity

NEO is a Claude Code plugin that turns a session into an orchestrated team:

1. **An orchestrator that runs the show.** NEO takes over the main thread. It classifies intent, delegates to specialists, verifies evidence, and never does specialist work itself.
2. **A memory keeper that never forgets.** Neo-Shadow — a hook-driven second agent — maintains a "second brain" of markdown files (`.neo/brain/`) so context survives across sessions, compactions, and machines.
3. **A themed specialist roster.** Nine leaf agents (keymaker, tank, architect, trinity, mouse, smith, switch, oracle, morpheus) each do one job in a fresh, isolated context.

**Zero runtime dependencies.** Markdown + shell + JSON only. No servers, no databases, no npm/pip installs.

### Design principles (from research)

| Principle | Source |
|---|---|
| Context isolation is the superpower — subagents inherit zero history; the orchestrator constructs exactly the context each needs | superpowers, omo |
| Leaf workers never get the spawn tool | claude-flow, omo |
| Hooks are deterministic; prompts are advisory. Enforce with hooks, guide with prompts | Boris Cherny, official docs |
| Give the agent a way to verify its work → 2–3× quality. Evidence, not assertions | Boris Cherny |
| Plan-first: pour energy into the plan so implementation is a 1-shot | Boris Cherny |
| Persist learnings before ending sessions (second brain) | John Kim |
| Memory writes are the highest-leverage tokens — never run them on a cheap model | user decision |
| Bootstrap or die: without session-start activation, architecture is dead weight | superpowers |
| Model tiering = cost control (cheap search, mid implementation, top planning/review) | all frameworks |
| Detect, don't depend (graphify and other enhancers are optional) | user decision |

---

## 2. Agent Roster

All agents live in `agents/*.md`. Matrix-themed names; auto-delegation works off `description` fields, so the theme costs nothing functionally.

| Agent | Matrix role | Job | Model | Tools | Spawns? |
|---|---|---|---|---|---|
| **neo** | The One | Orchestrator; main session agent | session model | all + `Agent` | **ONLY spawner** |
| **neo-shadow** | — | Memory keeper; maintains `.neo/brain/` | `inherit` (main model — user rule) | Read, Grep, Glob, Write, Edit — **no Bash** | ✗ |
| **keymaker** | knows every door | Codebase search; fired 2–5 in parallel | haiku | Read, Grep, Glob | ✗ |
| **tank** | operator, loads programs | External docs / OSS examples / web | haiku | Read, Grep, Glob, WebFetch, WebSearch | ✗ |
| **architect** | designed the Matrix | Plan synthesis → `.neo/plans/*.md` | opus | Read, Grep, Glob, Write (jailed to `.neo/plans/`) | ✗ |
| **trinity** | elite executor | Implements ONE plan task per fresh context | sonnet | Read, Grep, Glob, Write, Edit, Bash | ✗ |
| **mouse** | built the training simulations | Test engineer; one target per invocation; writes + runs tests matching project conventions; reports failures as bugs — added 2026-07-13 | sonnet | Read, Grep, Glob, Write, Edit, Bash | ✗ |
| **smith** | hunts flaws, replicates | Adversarial review in fresh context | opus | Read, Grep, Glob, Bash (run tests) — **no Write/Edit** | ✗ |
| **switch** | not like this | Code simplifier; behavior-preserving slop removal after smith approves — added 2026-07-13 | sonnet | Read, Grep, Glob, Write, Edit, Bash | ✗ |
| **oracle** | sees outcomes | Debugging + architecture consultant | opus | Read, Grep, Glob, Bash — **no Write/Edit** | ✗ |
| **morpheus** | captains the ship | Git/GitHub operator (commits, sync, batched pushes, release docs) — added 2026-07-13 | sonnet | Read, Grep, Glob, Write, Edit, Bash | ✗ |

- **Spawn depth ≤ 2** (main → leaf). API caps at 5; we stay far below.
- **Model aliases** (`haiku`/`sonnet`/`opus`/`inherit`) so the plugin never rots on model IDs. Per-agent override = one frontmatter line (see `docs/customization.md`).
- Leaf agents structurally cannot spawn (no `Agent` in `tools`), plus a defense-in-depth spawn-guard hook.

### Platform constraint (caught in design)

Subagents **cannot** use `AskUserQuestion`. Therefore the grill-me interview cannot live inside the architect agent. Resolution: `/neo:plan` runs the interview **on the main thread** (NEO asks one question at a time, recommended answer first), then hands the transcript to architect (fresh context) for plan synthesis.

---

## 3. NEO System Prompt Structure

`agents/neo.md` body = the session system prompt (via full takeover). Harness-neutral prose; Claude Code tool names confined to one swappable section.

1. **Identity** — "You are NEO. You orchestrate; specialists work. Never do specialist work when a specialist exists."
2. **Intent Gate** — classify EVERY message: research / implement / investigate / evaluate / fix / open-ended → routing table. Turn-local reset (never carry implementation mode across turns). Context-completion gate (never implement while a consulted specialist's answer is pending).
3. **Tiered pipeline** — see §5.
4. **Delegation contract** — every spawn uses the 6-section prompt: TASK / EXPECTED OUTCOME / TOOLS / MUST DO / MUST NOT DO / CONTEXT. Subagents inherit zero history; NEO constructs the exact context.
5. **Evidence rules** — "It typechecks" ≠ verified. File edits need diagnostics/tests; claims need command output. Show evidence, not assertions.
6. **Memory duties** — brain arrives via SessionStart hook; delegate brain writes to neo-shadow at task boundaries; NEO never housekeeps memory itself.

---

## 4. The Second Brain (`.neo/`)

### Files (`.neo/brain/`)

| File | Content | Update cadence |
|---|---|---|
| `INDEX.md` | Map of content, `[[wiki-links]]` (graph-export escape hatch) | when structure changes |
| `BRIEF.md` | Scope, goals, constraints | pivots only |
| `ARCHITECTURE.md` | System patterns, key decisions' shape, gotchas | when patterns change; audit at 500 lines |
| `ACTIVE.md` | Current focus, next steps, open questions | **every session**; 150-line cap |
| `PROGRESS.md` | Append-only ledger of what shipped | as completed; never edit old entries |
| `DECISIONS.md` | Decision + rationale + alternatives considered | when made |
| `LESSONS.md` | Anti-patterns, "never again" rules | when noticed; capped, always loaded |
| `WORKFLOWS.md` | Recurring multi-step workflow ledger; entries: `candidate` → `proposed` → `skilled` | when a sequence recurs; neo-shadow writes, `/neo:train` promotes |

Plus `.neo/plans/` — architect artifacts, `YYYY-MM-DD-<slug>.md`.

### Load path (zero LLM cost)

SessionStart hook `cat`s BRIEF + ACTIVE + LESSONS + PROGRESS (tail-20) + INDEX into context. ARCHITECTURE/DECISIONS load on demand via INDEX pointers. Deterministic, free, instant.

### Write path (main model — highest-leverage tokens)

NEO hands neo-shadow a session delta (what happened + git diff summary). Shadow: rewrites ACTIVE, appends PROGRESS, extracts DECISIONS/LESSONS itself (judgment work — why it runs on the main model), touches ARCHITECTURE only on pattern changes, BRIEF only on pivots. One source of truth: pointers, never copies.

### Sync

SessionEnd hook auto-commits `.neo/brain/` if in a git repo. Documented opt-out.

---

## 5. Tiered Pipeline

| Tier | Trigger | Flow |
|---|---|---|
| **TRIVIAL** | 1 file, known change | NEO edits directly + runs diagnostics |
| **STANDARD** | 2+ files or steps | keymaker/tank parallel recon → NEO todo-plans → trinity implements → mouse tests (when behavior changed and test suite exists) → smith reviews |
| **DEEP** | new feature / ambiguous / architectural | `/neo:plan`: grill-me interview → architect artifact → user approval → trinity per-task fresh contexts → mouse tests → smith adversarial pass → switch strips slop → neo-shadow brain save |

Oracle is auto-consulted after 2 failed fix attempts at any tier.

---

## 6. Hooks (`hooks/hooks.json` + `hooks/scripts/*.sh`)

| Event | Script | Behavior |
|---|---|---|
| SessionStart | `brain-load.sh` | cat brain files; if no `.neo/`, hint `/neo:init`; detect graphify → advertise to agents |
| PreToolUse (Edit\|Write) | `jail.sh` | **HARD block (exit 2)**: neo-shadow outside `.neo/`, architect outside `.neo/plans/` |
| PreToolUse (Agent) | `spawn-guard.sh` | roster whitelist; defense-in-depth |
| PostToolUse (Edit\|Write) | `format.sh` | project-local formatters only; skips `.neo/`; fail-open exit 0 on every path |
| PreCompact | `save-brain.sh` | inject "save brain NOW via neo-shadow" |
| Stop | `stop-gate.sh` | **ONE-SHOT block**: open todos, unverified changes, or stale brain (code changed but ACTIVE.md untouched) → block with specifics; `stop_hook_active` ⇒ allow (no infinite loops) |
| SessionEnd | `brain-sync.sh` | git commit `.neo/brain/` |

**Pre-declared risk — RESOLVED (2026-07-13):** Verified against official hooks reference + Python SDK types: `agent_type` (and `agent_id`) ARE present in PreToolUse stdin when the hook fires inside a subagent, absent on the main thread; value may arrive plugin-namespaced (`neo:neo-shadow`) or bare, so `jail.sh` strips any namespace prefix. Primary mechanism = plugin `hooks/hooks.json` global jail keyed on `agent_type` (frontmatter-scoped agent hooks would be cleaner but plugin-shipped agents cannot carry `hooks:` frontmatter). Fallback A is DEAD: `Write(.neo/**)` in `tools:` frontmatter parses but is silently unenforced (anthropics/claude-code#61651). Caveat: `agent_type` has no formal stability contract yet (anthropics/claude-code#56168) — jail.sh is fail-open by design and behavior-tested (11 cases: block outside-jail writes, allow in-jail, ignore main thread + unjailed agents, reject `..` traversal).

---

## 7. Commands (`skills/`, namespaced `/neo:*`)

| Command | Does |
|---|---|
| `/neo:init` | Scaffold `.neo/` from templates + brief interview → BRIEF.md + starter CLAUDE.md |
| `/neo:save` | Manual brain save via neo-shadow (John Kim's "save this to my local claude.md" formalized) |
| `/neo:status` | Brain freshness, active focus, open todos, roster health, graphify detection |
| `/neo:plan` | Force DEEP tier: grill-me interview → architect artifact → approval |
| `/neo:review` | Force smith adversarial pass on current diff |
| `/neo:map` | Fan out parallel keymakers across the codebase; neo-shadow synthesizes findings into `ARCHITECTURE.md` |
| `/neo:train` | Review `WORKFLOWS.md` candidates, draft a `SKILL.md` for the chosen workflow, write to project's `.claude/skills/<name>/` on user approval. Human-gated; user request overrides 3-sighting threshold. |

Rejected: `/neo:decide`, `/neo:lesson` (extraction IS Shadow's job during saves), `/neo:grill` (folded into `/neo:plan`).

---

## 8. Repo Layout

```
neo/
├── .claude-plugin/
│   ├── plugin.json          # name "neo" → /neo:* namespace
│   └── marketplace.json     # self-serve marketplace
├── agents/                  # 11 agent definitions
├── skills/                  # 7 commands (init, save, status, plan, review, map, train)
├── hooks/
│   ├── hooks.json
│   └── scripts/             # 6 shell scripts
├── templates/
│   ├── brain/               # 8 brain file templates
│   ├── CLAUDE.md            # starter project memory
│   └── plan.md              # architect artifact template
├── settings.json            # {"agent": "neo"} — full takeover
├── README.md
└── docs/                    # architecture, brain-spec, hooks-reference,
                             # customization, portability, specs/
```

**Install:** `/plugin marketplace add <you>/neogents` → `/plugin install neo@neogents`. Dev: `claude --plugin-dir .`

**Naming (decided 2026-07-13, post-audit):** repo + marketplace = `neogents` (user coinage; verified fully clean on GitHub/npm/PyPI — availability audit rejected neogentic/neogent (live companies), agentrix (saturated), the-construct (squatted), matrixos (124★ collision), matrix-superpowers (brand-rides obra/superpowers)). Plugin manifest stays `neo` → commands stay `/neo:*`, install string reads `neo@neogents`. Agent NEO unchanged.

**Control model:** full takeover via `settings.json {"agent": "neo"}` (same mechanism oh-my-openagent uses for Sisyphus). Main thread retains plan mode + AskUserQuestion. Opt-out: disable plugin or override `agent` in user settings.

---

## 9. Non-Goals (v1)

- No MCP servers
- No vector DB / Graphiti (Phase 2 option preserved via `[[wiki-links]]` + INDEX.md)
- Graphify: detect-don't-depend only — advertised when present, never required
- No experimental agent-type hooks (documented as v2 Shadow upgrade path)
- No multi-harness adapters (`docs/portability.md` documents the path)
- No team mode

---

## 10. Decision Log

| # | Decision | Choice |
|---|---|---|
| 1 | Roster | Standard 8 |
| 2 | Naming | Full Matrix theme |
| 3 | Control model | Full takeover (`settings.json` agent) |
| 4 | Enforcement | Hard jails + one-shot Stop verification gate |
| 5 | Shadow triggers | NEO-mediated, stable primitives only |
| 6 | Pipeline | Tiered (TRIVIAL / STANDARD / DEEP) |
| 7 | Commands | Core 5 |
| 8 | Repo | Flat plugin repo + self-serve marketplace |
| 9 | Shadow model | `inherit` — main model only (user: "context managing is the highest priority work") |
| 10 | Platform first | Claude Code; harness-neutral authoring for later adapters |
| 11 | Morpheus added (2026-07-13) | Git/GitHub operator leaf agent. Spawned only on explicit shipping intent, preserving the "never commit unless asked" rule. Simple imperative messages; secret scan pre-stage; >100 MB file prevention → LFS; `pull --rebase` then push, hard stop on conflicts; commit-range batched pushes near GitHub's 2 GB pack limit; release-adjacent docs only. Roster 8 → 9. |
| 12 | Mouse added (2026-07-13) | Test engineer leaf agent. Gap: nobody owned writing tests; "it typechecks" is not QA. Mouse receives one target per invocation, enumerates scenarios before writing, runs the suite, and reports failures as bugs. Never modifies production code. Roster 9 → 10. |
| 13 | Switch added (2026-07-13) | Code simplifier leaf agent. Boris Cherny ships a code-simplifier agent; AI slop removal before shipping is a first-class step. Switch operates on the diff scope only, verifies after every removal, and reverts any simplification that breaks tests. Roster 10 → 11. |
| 14 | PostToolUse formatter hook (2026-07-13) | Deterministic formatting via project-local tools only (node_modules/.bin/prettier, ruff/black, gofmt, rustfmt). Each formatter is command -v guarded. Skips .neo/ (brain layout is content). Fail-open exit 0 on every path. Never installs anything. |
| 15 | /neo:map as a skill, not an agent (2026-07-13) | Mapping is a workflow: keymaker fan-out + shadow synthesis. A standing mapper agent would be idle between map runs and would duplicate keymaker's read-only toolset. A skill invokes the existing roster correctly and keeps the agent count lean. |
| 16 | Ponytail: distill + recommend, don't vendor (2026-07-13) | DietrichGebert/ponytail (MIT) enforces write-time YAGNI via a 7-rung decision ladder — zero overlap with NEO's domain. Vendoring its skills would rot against upstream and add a Node.js hook dependency (NEO is pure bash/markdown). Instead: trinity embeds a distilled, credited version of the ladder; smith gains an over-engineering hunt criterion; switch gains a reimplementation hunt; README recommends installing ponytail alongside (its SubagentStart hook injects the full ruleset into every NEO-spawned agent). |
| 17 | Workflow harvesting (2026-07-14) | Shadow detects recurring multi-step workflows into a `WORKFLOWS.md` ledger (3-sighting threshold); `/neo:train` promotes candidates to project skills, human-gated. Rationale: Boris Cherny's "if you do something more than once a day, turn it into a skill or command" made systematic — detection is free at save time (shadow already reads every session delta); creation is gated because skills change behavior; jail untouched (NEO main thread writes the skill file, same as `/neo:init` writing BRIEF.md). |
