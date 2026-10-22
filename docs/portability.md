# NEO Portability

NEO runs on Claude Code today and on OpenCode through `adapters/opencode/` (see
[specs/2026-10-22-opencode-adaptation-design.md](specs/2026-10-22-opencode-adaptation-design.md)).
Codex, Kiro, and Cursor are future adapters. This document is the contract that keeps one source
tree serving every harness, and the honest table of what each harness enforces.

See also: [brain-spec.md](brain-spec.md) for the second brain contract, [hooks-reference.md](hooks-reference.md) for the scripts.

---

## The rule: a project never contains harness-specific state

Everything NEO writes into a project is harness-neutral: `.neo/**` (brain, plans, runs, checkpoint,
session marker), `.claude/skills/` (read natively by Claude Code and OpenCode), `AGENTS.md` (the
canonical instruction file), and a one-line `CLAUDE.md` that imports it. Adapters install under the
user's home, never in the repo. Switching harness on a project means opening it in the other tool.

## Source of truth and derivation

| Authored once | Derived per harness |
|---|---|
| `agents/*.md` — harness-neutral body; tool names only inside the `<!-- harness:begin -->` … `<!-- harness:end -->` block at the end of `agents/neo.md` | OpenCode agent config (`adapters/opencode/transform.js` swaps the block, maps frontmatter) |
| `skills/*/SKILL.md` | OpenCode commands `/neo:<name>` (same names, same `!`cmd`` lines) |
| `hooks/scripts/*.sh` — the neutral hook contract | How each harness invokes them |
| `templates/**` | — |

Authoring rules for contributors:

- Agent and skill bodies describe behavior ("spawn trinity", "track todos"), never a harness tool name. Tool names go in the harness block.
- A new hook reads JSON on stdin, exits 2 with a message on stderr to block, exits 0 otherwise, and resolves the project root the way the existing scripts do. Never read a harness-specific env var without a fallback.
- Generated config is never edited by hand.

## The neutral hook contract

| Script | stdin fields | Exit / output |
|---|---|---|
| `brain-load.sh` | `source` (`startup` / `resume` / `clear` / `compact`) | stdout = context to inject; touches `.neo/.session` unless `compact` |
| `jail.sh` | `agent_type`, `cwd`, `tool_input.file_path` | exit 2 + stderr = block |
| `run-ledger.sh` | `tool_input.subagent_type`, `tool_input.description`, `tool_response` | writes `.neo/runs/` |
| `checkpoint.sh` | `hook_event_name` (`PreCompact` / `Stop`), `last_assistant_message` | writes `.neo/CHECKPOINT.md` |
| `stop-gate.sh` | `stop_hook_active` | exit 2 + stderr = "don't stop yet" |
| `brain-sync.sh` | — | commits `.neo/brain` when dirty and safe |
| `format.sh` | `tool_input.file_path`, `cwd` | formats opt-in; Claude Code only |

All scripts accept `CLAUDE_PROJECT_DIR` as the root fallback after `git rev-parse --show-toplevel`. The field names are Claude Code's; they are kept as the contract's names on purpose.

## Per-guarantee enforcement

| Guarantee | Claude Code | OpenCode | Codex / Kiro / Cursor |
|---|---|---|---|
| Brain loaded at session start | `SessionStart` hook stdout | plugin injects `brain-load.sh` output into the system prompt (root sessions only) | TBD |
| neo-shadow writes only `.neo/brain/` | `PreToolUse` hook, exit 2 | per-agent `permission.edit` glob + `bash: deny` (native), `jail.sh` behind it for symlink/hardlink checks | TBD |
| Spawn depth 2 | leaf agents lack the `Agent` tool | OpenCode's own `subagent_depth` (default 1) + `permission.task: deny` on leaves | TBD |
| Checkpoint before compaction | `PreCompact` hook | compaction hook; brain context also injected into the compaction | TBD |
| Stop-gate | `Stop` hook blocks the turn | **advisory** — one-line nudge on the next turn; OpenCode has no blockable Stop | TBD |
| Brain auto-commit | `SessionEnd` hook | on each root `session.idle` when the brain is dirty (idempotent) | TBD |
| Run ledger | `PostToolUse` on `Agent`/`Task` | `tool.execute.after` on `task` | TBD |
| Formatter | `format.sh`, opt-in | OpenCode's `formatter` config | TBD |
| Workflows user-invoked only | `disable-model-invocation` (equip) | commands are never model-invoked | TBD |

"TBD" means no adapter exists yet. Don't fill it in speculatively.

## What stays the same across harnesses

- The second brain contract ([brain-spec.md](brain-spec.md)).
- The roster: neo, neo-shadow, trinity, smith — jobs, model tiers, tool restrictions.
- The tiered pipeline, contract negotiation, and the six-section delegation contract.
- The scripts' logic and their behavioral CI tests.

## Scope

OpenCode support targets OpenCode 1.x (verified on 1.19.1). OpenCode 2 is out of scope. No MCP servers, no vector DB or Graphiti dependency.
