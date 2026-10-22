# OpenCode adapter

Plain-JS OpenCode plugin (1.x). Loaded from the npm package `@vidit19sharma/neogents`, or locally
through a one-line re-export in a project's `.opencode/plugins/`.

## What it injects (nothing is written to disk)

- `cfg.agent`: `neo` (primary), `trinity`, `smith`, `neo-shadow` (subagents) — derived from `agents/*.md`
  by `transform.js`. Frontmatter → `mode`/`model`/`permission` (see `permissions.json`, `models.json`);
  body → `prompt`, with neo's harness block swapped for the OpenCode one.
- `cfg.command`: `/neo:init` … `/neo:equip` — derived from `skills/*/SKILL.md`. Same names, same `!`cmd``
  status lines; `${CLAUDE_PLUGIN_ROOT}` becomes the package path.
- Your own `opencode.json` keys win over the derived ones (override a model per agent there).

## How the hook scripts run

| OpenCode | Script | Note |
|---|---|---|
| first turn of a root session (`experimental.chat.system.transform`) | `brain-load.sh` | output rides the system prompt every turn |
| `tool.execute.before` on `write`/`edit` by `neo-shadow` | `jail.sh` | behind the `permission.edit` glob; exit 2 → thrown error; relative paths resolve against the launch directory |
| `tool.execute.after` on `task` | `run-ledger.sh` | |
| root `session.idle` | `checkpoint.sh` (Stop), `stop-gate.sh`, `brain-sync.sh` | |
| `experimental.session.compacting` | `checkpoint.sh` (PreCompact) | cached brain pushed into the compaction context |

## Degradations vs. Claude Code

- **Stop-gate is advisory.** OpenCode cannot block a turn from ending. If the gate would block, its message is
  appended once to the next turn's system prompt as `[neo stop-gate] …`.
- **Auto-commit runs on every root idle** where the brain is dirty (idempotent), not once at session end.
- `format.sh` is not used; configure OpenCode's `formatter` instead.

## Gotchas

- `opencode run "/neo:status"` does **not** run the command — the model just sees the text. Use
  `opencode run --command neo:status`.
- In `opencode run` mode every permission *ask* is auto-rejected; only `allow`/`deny` rules apply.
- The permission key for the shell tool is `bash` in 1.19.x (docs say `shell`).
- Requires `bash` and `jq` on PATH, like the Claude Code plugin.

## Tests

`node --test adapters/opencode/test/` — unit tests with a fake script runner, plus a snapshot of the
derived config (`test/snapshot.json`; refresh with `UPDATE_SNAPSHOT=1` when an agent or skill edit is intended).
