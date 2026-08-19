# Contributing to Neogents

Thanks for wanting to improve NEO. This project is small and opinionated, so contributions that fit the grain land quickly; ones that fight it tend to stall. Read this before opening a PR.

---

## What kinds of contributions are wanted

- **Bug reports** — hook misbehavior, agent prompt failures, incorrect brain file writes, anything that breaks the pipeline.
- **Docs fixes** — wrong commands, stale paths, unclear explanations. The docs are the source of truth; keeping them accurate matters.
- **New roster agents** — a specialist that fills a real gap in the pipeline. See the full checklist below.
- **Hook improvements** — better jail logic, smarter stop-gate heuristics, new formatter support in `format.sh`. Must stay fail-open.
- **Portability adapters** — the plugin is authored for Claude Code but `docs/portability.md` describes the multi-harness roadmap. Adapters for OpenCode or Codex are welcome.

What's not wanted right now: test frameworks, CI config, npm/pip dependencies, or anything that adds a runtime beyond bash + jq + git.

---

## Dev setup

Clone the repo and point Claude Code at it directly:

```bash
git clone https://github.com/vidit19sharma/neogents
cd neogents
claude --plugin-dir .
```

That's it. No install step, no build step. The plugin loads from the local directory on every session start.

To test the marketplace-installed path instead:

```
/plugin marketplace add vidit19sharma/neogents
/plugin install neo@neogents
```

Changes to hook scripts take effect on the next session start (or next tool use, for `PreToolUse` hooks). Changes to agent files take effect on the next spawn.

---

## Repo map

| Directory | Contents |
|---|---|
| `agents/` | 4 agent definitions (`*.md` with YAML frontmatter). Each file is the full system prompt for that specialist. |
| `skills/` | 9 slash commands (`/neo:init`, `/neo:save`, `/neo:status`, `/neo:plan`, `/neo:review`, `/neo:map`, `/neo:train`, `/neo:gc`, `/neo:recall`). Each is a subdirectory with a `SKILL.md`. |
| `hooks/` | `hooks.json` (event wiring) and `scripts/` (8 shell scripts that implement the enforcement layer). |
| `templates/` | Starter files for `/neo:init`: 9 brain file templates, a `CLAUDE.md` template, and a plan template. |
| `docs/` | Architecture, hooks reference, customization guide, brain spec, workflow walkthrough, portability notes, and the design decision log under `specs/`. |
| `.claude-plugin/` | `plugin.json` (name, version, author) and `marketplace.json`. |

---

## How to add a new roster agent

This is the most common non-trivial contribution. Every step is required; skipping any one of them will leave the plugin in a broken or inconsistent state.

**1. Create the agent file**

Create `agents/<name>.md` with this frontmatter at the top:

```yaml
---
name: <name>
description: <one line — this is what NEO reads to decide when to spawn>
model: <haiku|sonnet|opus|inherit>
tools: <comma-separated list>
---
```

Leaf agents must not have `Agent` in their `tools` list. The structural guarantee that leaf agents can't spawn is that they don't have the tool. CI enforces this check.

Write the system prompt body below the frontmatter. Follow the conventions in existing agents: one job per agent, explicit MUST DO / MUST NOT DO sections, a `verify:` step in every task description.

Before proposing a new agent, check the friction ledger idea: a new specialist should answer a recurring, evidenced pattern (user corrections, review blocks, escalations recorded in `.neo/brain/FRICTION.md`), not a hypothetical.

**2. Add a row to the team table in `agents/neo.md`**

NEO reads its own team table to decide when to spawn each specialist. Add a row:

```markdown
| **<name>** | <job description> | <when to spawn> |
```

**3. Update the README roster table**

Add a row to the Agent Roster table in `README.md`.

**4. Update `docs/architecture.md`**

Add a subsection under "Agent Roster" describing the new agent: model, tools, spawns, and responsibilities. Follow the format of the existing entries.

**5. Update `docs/customization.md`**

Add a row to the "Agent Models" table.

**6. Update `docs/hooks-reference.md`**

If the new agent has write restrictions (like neo-shadow), document the jail policy in the `jail.sh` section.

**7. Append a decision-log row in `docs/specs/2026-07-13-neo-design.md`**

Add a row to the agent roster table in section 2 with the date added and a brief rationale. This is the project's decision log; it's append-only.

---

## Shell script rules

All hook scripts must follow these rules. PRs that violate them will be asked to revise.

- **Fail-open on every unexpected path.** If the script can't determine what it needs (missing `jq`, unrecognized payload shape, absent field), it exits 0 and allows the operation. A hook that breaks every write in a session because of a Claude Code version change is worse than one that occasionally misses a violation.
- **Exit 2 is reserved for deliberate blocks.** When you exit 2, you must write a clear, actionable message to stderr. That message is fed back to the agent as corrective feedback.
- **No new runtime dependencies** beyond bash, jq, and git. The plugin works with zero external installs; don't add one.
- **Scripts must pass `bash -n`** (syntax check) and `shellcheck` (if installed). Run both before opening a PR.
- **No global tool installs.** `format.sh` uses project-local binaries only (`node_modules/.bin/prettier`, not a global one). Follow the same pattern for any new formatter or tool dispatch.

---

## Design principles

These come from `docs/architecture.md` and are non-negotiable constraints, not preferences.

| Principle | What it means for contributors |
|---|---|
| Markdown + bash + JSON only | No Node.js runtime, no Python scripts, no compiled binaries. If it needs a build step, it doesn't belong here. |
| Detect, don't depend | Optional tooling (graphify, formatters) is advertised when present, never required. The plugin must work with zero external dependencies. |
| One source of truth in docs | If a fact appears in two places, one of them will rot. Use pointers, not copies. When you change behavior, update the one canonical doc and add a pointer from anywhere else that references it. |
| Subagents never spawn subagents | Spawn depth is capped at 2. Leaf agents have no `Agent` tool. Don't add it to a leaf agent's frontmatter, and don't write a leaf agent that tries to delegate. |
| Hooks are deterministic; prompts are advisory | Behavioral guarantees belong in hooks, not in system prompt prose. A jail in a prompt is a suggestion; a jail in a `PreToolUse` hook with `exit 2` is a hard block. |

---

## Verification before opening a PR

Run these checks locally. All must pass.

```bash
# Syntax check all hook scripts
bash -n hooks/scripts/*.sh

# Validate JSON files
jq . hooks/hooks.json
jq . .claude-plugin/plugin.json
jq . .claude-plugin/marketplace.json
jq . settings.json

# Lint hook scripts (if shellcheck is installed)
shellcheck hooks/scripts/*.sh
```

If shellcheck isn't installed, note that in the PR. It's not a hard blocker, but the maintainer will run it before merging.

---

## Commit style

- Imperative mood, lowercase, under 65 characters: `add run ledger hook for subagent spawns`
- No AI attribution in commit messages (`Co-authored-by: Claude` and similar are not wanted).
- One logical change per commit. Don't bundle an agent addition with an unrelated hook fix.

---

## PR process

- **One logical change per PR.** A new agent is one PR. A hook fix is another.
- **Link an issue** for any non-trivial change. If no issue exists, open one first so the change can be discussed before you invest time implementing it.
- **Docs update in the same PR as behavior changes.** If you change what a hook does, update `docs/hooks-reference.md` in the same PR. Docs-only PRs are fine; behavior-only PRs are not.
- The maintainer is a solo developer. Response time is best-effort.
