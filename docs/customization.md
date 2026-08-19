# NEO Customization

NEO is designed to work out of the box and stay out of your way. Most projects need zero configuration. This document covers the knobs that exist when you do need them.

See also: [brain-spec.md](brain-spec.md) for brain file rules, [portability.md](portability.md) for the multi-harness roadmap.

---

## Agent Models

Every agent in `agents/*.md` has a `model:` frontmatter field. The default roster:

| Agent | Default model | Rationale |
|---|---|---|
| neo | (session model) | Orchestrator; uses whatever the user started the session with. |
| neo-shadow | `inherit` | Memory writes are the highest-leverage tokens. Always runs on the main model. |
| keymaker | `haiku` | Search work; cheap and fast. |
| tank | `haiku` | External docs lookup; cheap and fast. |
| architect | `opus` | Plan synthesis; needs the best reasoning available. |
| trinity | `sonnet` | Implementation; mid-tier balances quality and cost. |
| mouse | `sonnet` | Test engineering; mid-tier balances quality and cost. |
| smith | `opus` | Adversarial review; needs the best reasoning available. |
| switch | `sonnet` | Code simplification; procedural slop removal. |
| oracle | `opus` | Debugging consultant; needs the best reasoning available. |
| morpheus | `sonnet` | Git/GitHub operations; procedural work. |

**To override a single agent's model**, edit the `model:` line in its `agents/*.md` file:

```yaml
---
name: trinity
model: opus
---
```

That's the entire change. One line, one file.

**Aliases** (`haiku`, `sonnet`, `opus`, `inherit`) are resolved by Claude Code at spawn time. They never rot on specific model IDs. `inherit` means "use the same model as the spawning session" — neo-shadow uses this so it always runs on the main model regardless of what the user started with.

**To override for a specific project** without touching the plugin files, add a `model:` override in your project's Claude Code user settings for that agent. The plugin's frontmatter is the default; user settings win.

---

## Hook Scripts

Hooks live in `hooks/scripts/`. Each script has a single job and a documented exit-code contract.

### Exit-code protocol

| Exit code | Meaning |
|---|---|
| `0` | Allow / continue. |
| `2` | Block. stderr is fed back to the agent as corrective feedback. |

Any other exit code is treated as an error. Scripts that must never fail the session (like `brain-sync.sh`) catch all errors and exit 0.

### Editing a hook

Open the relevant script and change it. The scripts are plain bash with no build step. Changes take effect on the next session start (or next tool use, for PreToolUse hooks).

**What each script does:**

| Script | Hook event | What it does | Safe to edit? |
|---|---|---|---|
| `brain-load.sh` | SessionStart | Cats brain files into context. | Yes — add files, change order, adjust the graphify detection. |
| `jail.sh` | PreToolUse (Edit/Write) | Blocks neo-shadow and architect from writing outside their jails. | Carefully — weakening this removes a hard safety guarantee. |
| `spawn-guard.sh` | PreToolUse (Agent) | Blocks spawns of agents not in the NEO roster. | Yes, when adding roster agents (see below). |
| `format.sh` | PostToolUse (Edit/Write) | Formats the just-edited file with project-local formatters. Fail-open. | Yes — add formatters, adjust file extensions. |
| `checkpoint.sh` | PreCompact + Stop | Deterministic snapshot of git state and the last assistant message to `.neo/CHECKPOINT.md`. Throttled on Stop (10 min). | Yes — adjust throttle, sections, sizes. |
| `run-ledger.sh` | PostToolUse (Agent/Task) | Appends every subagent spawn (agent, task, verdict, summary) to `.neo/runs/YYYY-MM-DD.md`; long reports get their own file. | Yes — adjust thresholds, entry format. |
| `stop-gate.sh` | Stop | Blocks session end when code changed but brain wasn't saved. | Yes — adjust the staleness logic. |
| `brain-sync.sh` | SessionEnd | Commits `.neo/brain/` to git. | Yes — adjust commit message, add push, etc. |
| `brain-gc.sh` | (none — helper) | Deterministic staleness scan of `LESSONS.md`; invoked by `/neo:gc` and `/neo:status`, not by hooks.json. | Yes — adjust flag rules, age threshold. |

### Disabling a hook

Remove or comment out the relevant entry in `hooks/hooks.json`. The hook file stays on disk; it just won't run.

---

## Disabling Full Takeover

NEO takes over the main thread via `settings.json`:

```json
{ "agent": "neo" }
```

This is the same mechanism other Claude Code plugins use for orchestrator control. To disable it:

**Option A — disable the plugin entirely:**
```
/plugin disable neo
```

**Option B — override the agent in your user settings.** Claude Code user settings override plugin settings. Set `agent` to your preferred agent (or remove it) in your user settings file. The plugin stays installed; NEO just doesn't run as the session agent.

When NEO isn't the session agent, the brain files still exist and the hooks still run (brain loads at session start, brain syncs at session end). Only the orchestration layer is bypassed.

---

## Adding Roster Agents

The NEO roster is the set of agents NEO can spawn. Adding a new agent requires two steps:

**Step 1 — create the agent file** in `agents/<name>.md` with the standard frontmatter:

```yaml
---
name: <name>
description: <one line — this is what NEO reads to decide when to spawn>
model: <haiku|sonnet|opus|inherit>
tools: <comma-separated list — no Agent tool for leaf agents>
---
```

**Step 2 — add the name to `spawn-guard.sh`'s whitelist:**

```bash
case "$AGENT" in
  neo-shadow|keymaker|tank|architect|trinity|mouse|smith|switch|oracle|morpheus|<name>)
    exit 0
    ;;
```

Without step 2, `spawn-guard.sh` will block any attempt to spawn the new agent and log: `'<name>' is not in the NEO roster.`

**Leaf agents must not have the `Agent` tool.** The structural guarantee that leaf agents can't spawn is that they don't have `Agent` in their `tools` list. `spawn-guard.sh` is defense-in-depth, not the primary control.

---

## Tuning Brain Caps

The caps are documented in the brain files themselves and enforced by neo-shadow's judgment, not by code. To change them, update the relevant template and tell neo-shadow the new rule.

| Cap | Default | Where it's documented |
|---|---|---|
| `ACTIVE.md` line cap | 150 lines | `templates/brain/ACTIVE.md` header comment, `agents/neo-shadow.md` |
| `ARCHITECTURE.md` audit threshold | 500 lines | `templates/brain/ARCHITECTURE.md` header comment, `agents/neo-shadow.md` |
| `PROGRESS.md` tail at load | 20 lines | `hooks/scripts/brain-load.sh` (`tail -n 20`) |
| `LESSONS.md` GC age threshold | 90 days | `hooks/scripts/brain-gc.sh` (`NEO_GC_MAX_AGE_DAYS`) |

To change the `PROGRESS.md` tail, edit the `tail -n 20` line in `brain-load.sh`. To change how old a lesson must be before `/neo:gc` flags it for review, set the `NEO_GC_MAX_AGE_DAYS` environment variable (or edit the default in `brain-gc.sh`). The other caps are prose rules in the agent and template files — edit both to keep them consistent.

---

## Project-Level CLAUDE.md

`/neo:init` writes a starter `CLAUDE.md` at the project root if one doesn't exist. It's a short file (target: under 100 lines) with three sections:

- **Memory** — points to `.neo/brain/` and explains how to save.
- **Commands** — build, test, lint commands. Filled in during the init interview.
- **Rules** — project-specific rules that must hold on every change.

**CLAUDE.md vs the brain:** CLAUDE.md holds rules that must be active on every single tool call — the kind of thing where forgetting it once causes a mistake. Long-term project knowledge (architecture, decisions, history) lives in `.neo/brain/`, not here. If CLAUDE.md grows past ~100 lines, it starts causing rule-skipping. Prune test: "would removing this line cause a mistake?" If no, remove it.

**NEO reads CLAUDE.md** at session start (Claude Code loads it automatically). The brain files load on top of it via the `brain-load.sh` hook. There's no conflict: CLAUDE.md is for rules, the brain is for knowledge.

**To add project rules**, edit CLAUDE.md directly or ask NEO to add them. For rules that came from a mistake, ask neo-shadow to record the lesson in `.neo/brain/LESSONS.md` as well — LESSONS.md loads every session and is the right home for "never again" rules.

---

## Brain Sync Opt-Out

`brain-sync.sh` auto-commits `.neo/brain/` at session end. To disable this for a project:

```bash
touch .neo/no-auto-commit
```

The file's presence is the signal. Its contents don't matter. `brain-sync.sh` checks for it before doing anything and exits cleanly if it's there.

The brain files still exist and still update — they just won't be committed automatically. You manage the commits yourself.
