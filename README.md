# Neogents

[![CI](https://github.com/vidit19sharma/neogents/actions/workflows/ci.yml/badge.svg)](https://github.com/vidit19sharma/neogents/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](https://code.claude.com/docs)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

An orchestrator that runs the show and a second brain that never forgets.

NEO is a Claude Code plugin that turns your session into a coordinated team. It takes over the main thread, classifies every request, delegates to a lean specialist roster, and keeps a persistent memory of your project in plain markdown files that survive context loss, compaction, and machine switches.

Zero runtime dependencies. Markdown + shell + JSON only.

---

## Install

**From the marketplace:**
```
/plugin marketplace add vidit19sharma/neogents
/plugin install neo@neogents
```

**Dev mode (from this repo):**
```
claude --plugin-dir .
```

`settings.json` contains `{"agent": "neo"}`, which hands the main thread to NEO on every session start. To opt out, disable the plugin or override `agent` in your user settings.

---

## First run

```
/neo:init
```

Scaffolds `.neo/brain/` from templates, runs a short interview to fill `BRIEF.md`, and writes a starter `CLAUDE.md` if none exists. The brain loads automatically on every subsequent session start via the `SessionStart` hook.

---

## Agent Roster

| Agent | Matrix role | Job | Model | Spawns? |
|---|---|---|---|---|
| **neo** | The One | Orchestrator. Classifies intent, delegates, verifies evidence. Main session agent. | session model | only spawner |
| **neo-shadow** | Shadow | Memory keeper. Maintains `.neo/brain/`. Runs on the main model. | inherit | no |
| **trinity** | elite executor | Implements ONE plan task per fresh context — tests included. | sonnet | no |
| **smith** | hunts flaws | Adversarial review. Read-only + test execution. | opus | no |

Codebase recon uses Claude Code's built-in exploration subagents (fired 2-5 in parallel); external research uses NEO's own WebFetch/WebSearch. Planning, debugging escalation, and git shipping are rules inside neo — not separate agents.

Spawn depth is capped at 2 (main thread -> specialist). Leaf agents have no `Agent` tool and cannot spawn.

---

## Commands

| Command | What it does |
|---|---|
| `/neo:init` | Scaffold `.neo/` from templates + brief interview |
| `/neo:save` | Manual brain save via neo-shadow |
| `/neo:status` | Brain freshness, current focus, file sizes, tooling check |
| `/neo:plan` | Force DEEP tier: interview + plan artifact + approval gate |
| `/neo:review` | Force adversarial review via smith on current diff |
| `/neo:map` | Fan out parallel exploration subagents across the codebase, then have neo-shadow rewrite `ARCHITECTURE.md` |
| `/neo:train` | Promote a recurring workflow from `WORKFLOWS.md` into a project skill (human-gated) |
| `/neo:gc` | Garbage-collect stale lessons: deterministic scan, then neo-shadow keeps / rewrites / archives flagged entries |
| `/neo:recall` | Grep project memory (`.neo/brain`, `.neo/plans`, `.neo/runs`) for past decisions and work — file:line pointers, no re-exploration |

---

## Tiered Pipeline

NEO classifies every request into one of three tiers before acting.

```
TRIVIAL  ─── 1 file, known change
             NEO edits directly + runs diagnostics

STANDARD ─── 2+ files or steps, clear scope
             built-in exploration recon (parallel)
               └─> NEO todo-plan
                     └─> trinity implements + tests
                           └─> smith reviews

DEEP     ─── new feature / ambiguous / architectural
             /neo:plan forces this tier
             interview (main thread, one question at a time)
               └─> NEO writes plan artifact (.neo/plans/)
                     └─> user approval
                           └─> trinity per task (fresh contexts, parallel waves, tests included)
                                 └─> smith adversarial pass
                                       └─> neo-shadow saves brain
```

After 2 failed fix attempts NEO stops, re-reads the files from scratch, and re-derives the fix; after 3 it reverts and asks.

---

## Second Brain

The brain lives in `.neo/brain/` inside your project. It loads at session start via hook (zero LLM cost) and is written by neo-shadow at task boundaries.

| File | Content | Cadence |
|---|---|---|
| `BRIEF.md` | Scope, goals, constraints | Pivots only |
| `ACTIVE.md` | Current focus, next steps, open questions | Every save (150-line cap) |
| `PROGRESS.md` | Append-only ledger of what shipped | As completed |
| `DECISIONS.md` | Decision + rationale + alternatives | When made |
| `LESSONS.md` | Anti-patterns, "never again" rules | When noticed |
| `ARCHITECTURE.md` | System patterns, key decisions, gotchas | When patterns change |
| `INDEX.md` | Map of content with `[[wiki-links]]` | When structure changes |
| `WORKFLOWS.md` | Recurring multi-step workflows; written by neo-shadow at save time, promoted to project skills via `/neo:train` | When a sequence recurs (3-sighting threshold) |
| `FRICTION.md` | Append-only ledger of user corrections, smith BLOCKs, and escalations — evidence for improving NEO itself | When friction occurs |

Plans live in `.neo/plans/YYYY-MM-DD-<slug>.md`. Every subagent spawn is auto-logged to `.neo/runs/` by a hook (verdict + summary, full report when long). A deterministic checkpoint (`.neo/CHECKPOINT.md` — branch, uncommitted files, diff stat, last assistant message) is written on every stop and before compaction, and reloads automatically while fresh.

**Load path:** `SessionStart` hook cats `BRIEF + ACTIVE + LESSONS + INDEX` into context, plus the last 20 lines of `PROGRESS`. `ARCHITECTURE` and `DECISIONS` load on demand via INDEX pointers.

**Write path:** NEO hands neo-shadow a session delta (what happened, git diff summary, decisions, lessons, where work stopped). Shadow rewrites `ACTIVE`, appends `PROGRESS`, extracts `DECISIONS`/`LESSONS` with judgment, touches `ARCHITECTURE` only on pattern changes.

---

## Pairs Well With

- **[ponytail](https://github.com/DietrichGebert/ponytail)** — enforces a "lazy senior dev" YAGNI ruleset on all code generation. Zero overlap with NEO (NEO does orchestration + memory; ponytail constrains *what code gets written*), and its `SubagentStart` hook injects the ruleset into every agent NEO spawns — trinity gets the full discipline for free. Trinity ships with a distilled version of ponytail's decision ladder built in; installing ponytail alongside adds its modes, audits, and debt ledger.

  ```
  /plugin marketplace add DietrichGebert/ponytail
  /plugin install ponytail@ponytail
  ```

---

## Uninstall / Opt-out

- **Disable the plugin** to stop NEO from taking over the main thread.
- **Remove `.neo/`** from your project to delete the brain entirely.
- **Create `.neo/no-auto-commit`** to stop the `SessionEnd` hook from auto-committing brain changes.
- The brain files are plain markdown. They're yours; nothing is locked in.

---

## Repo Layout

```
neo/
├── .claude-plugin/
│   ├── plugin.json          # name "neo" -> /neo:* namespace
│   └── marketplace.json
├── agents/                  # 4 agent definitions
│   ├── neo.md
│   ├── neo-shadow.md
│   ├── trinity.md
│   └── smith.md
├── skills/                  # 9 commands (init, save, status, plan, review, map, train, gc, recall)
│   └── map/
├── hooks/
│   ├── hooks.json
│   └── scripts/             # 8 shell scripts
│       └── format.sh
├── templates/
│   ├── brain/               # 8 brain file templates
│   ├── CLAUDE.md
│   └── plan.md
├── settings.json            # {"agent": "neo"}
└── docs/
    ├── architecture.md
    ├── brain-spec.md
    ├── customization.md
    ├── hooks-reference.md
    ├── workflow.md          # end-to-end walkthrough: install -> daily loop -> shipping
    ├── portability.md
    └── specs/
```

---

## Contributing

Bug reports, feature requests, and agent proposals are welcome — issue templates guide each one.
Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR (it includes the full checklist for
adding an agent), and [SECURITY.md](SECURITY.md) for how to report vulnerabilities privately.
Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

---

## License

[MIT](LICENSE)
