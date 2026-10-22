# OpenCode adapter

Plain-JS OpenCode plugin (1.x). Loaded from the npm package `@vidit19sharma/neogents`, or locally
through a one-line re-export in a project's `.opencode/plugins/`.

## What it injects (in-memory config; the hook scripts do write `.neo/`)

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
| `tool.execute.after` on `task` | `run-ledger.sh` | the `<task_result>` wrapper is stripped so the ledger sees the result text |
| root `session.idle` | `checkpoint.sh` (Stop), `stop-gate.sh`, `brain-sync.sh` | |
| `experimental.session.compacting` | `checkpoint.sh` (PreCompact), then `brain-load.sh` (`source=compact`) | root sessions only; reloads the brain, refreshes the cache, and injects it into the compaction context |

## Degradations vs. Claude Code

- **Stop-gate is advisory.** OpenCode cannot block a turn from ending. If the gate would block, its message is
  appended once to the next turn's system prompt as `[neo stop-gate] …`.
- **Auto-commit runs on every root idle** where the brain is dirty (idempotent), not once at session end.
- `format.sh` is not used; configure OpenCode's `formatter` instead.

## Gotchas

- `opencode run "/neo:status"` does **not** run the command — the model just sees the text. Use
  `opencode run --command neo:status`.
- By default, non-interactive `opencode run` auto-rejects permission *asks*; use explicit `allow`/`deny` rules in test configs.
- If plugin initialization throws (unknown model alias in `models.json`, missing harness markers in `agents/neo.md`), OpenCode logs `failed to load plugin` and skips NEO silently — check the OpenCode log when `/neo:*` commands are missing.
- The permission key for the shell tool is `bash` in 1.19.x (docs say `shell`).
- Requires `bash` and `jq` on PATH, like the Claude Code plugin.

## Tests

`node --test adapters/opencode/test/` — unit tests with a fake script runner, plus a snapshot of the
derived config (`test/snapshot.json`; refresh with `UPDATE_SNAPSHOT=1` when an agent or skill edit is intended).

### Live verification (OpenCode 1.19.1)

Verified 2026-10-22 in `/tmp/neo-live/proj`, with `XDG_CONFIG_HOME=/tmp/neo-live/xdg`
and only `opencode/deepseek-v4.1-flash-free`. Exact `opencode --version` output: `1.19.1`.
FAIL (COULD NOT TEST) below denotes missing evidence, not a demonstrated adapter bug.

- **R1 — FAIL (COULD NOT TEST the system fence); interpolation PASS.** `run --command neo:status ""` exported expanded `Brain files: … 161 total` and `Graphify: available`, with no literal shell substitutions. The model referred to the auto-loaded brain, but exports contained zero `BEGIN SECOND BRAIN` markers and no system prompt; fence delivery cannot be established from exports. No command-file fallback is indicated; phase 3 must verify the outgoing system prompt separately.
- **R2 — PASS.** `agent list` registered `neo (primary)`, `neo-shadow`, `smith`, and `trinity`; `debug config` contained 11 `neo:*` commands. Default runs selected neo without a fallback warning. `debug agent trinity` reported `modelID: deepseek-v4.1-flash-free`, confirming the user override. No agent-file fallback required.
- **R3 — FAIL.** A default-only `run "Reply exactly: R3-OK"` returned `R3-OK`; the chat probe recorded `{"sessionID":"ses_e9b94c846ffeBMcJa0WrxJX220"}` with no agent field. No fallback required: retain parent-ID/mode-based root detection (`hooks.js:28`).
- **Jail / glob — FAIL (COULD NOT TEST independently).** `--agent neo-shadow` warned `agent "neo-shadow" is a subagent, not a primary agent. Falling back to default agent`; the resulting neo writes were unrestricted. One rephrase delegated to the actual shadow: its `escape.md` write targeted `.neo/brain/escape.md`, and jail.sh intercepted its outside `bashesc.md` write before permission evaluation. `debug agent neo-shadow` confirmed edit `*` deny and `.neo/brain/**` allow. Phase 3 verification must delegate to shadow and capture a permission-glob denial separately; no plugin bug established.
- **Jail / bash deny — PASS via delegated shadow.** Shadow had no bash tool exposed; `bashesc.md` did not exist. The direct `--agent neo-shadow` attempt ran as neo and is not evidence of shadow permissions. Use task delegation for subagent checks.
- **Jail / jail.sh symlink — PASS via delegated shadow.** `.neo/brain/ok.md` was written; `.neo/brain/link/x.md` failed with `[neo jail] neo-shadow may only write under .neo/brain/ — it resolves outside the jail`; `/tmp/neo-live/outside/x.md` did not exist. No fallback required.
- **Ledger / trinity — PASS.** One task returned `PONG`; `.neo/runs/2026-10-22.md` contained exactly one `## 21:54:11 trinity — ping` heading. No fallback required.
- **Ledger / explore — PASS.** `run --agent neo` delegated the brain listing to explore; the ledger contained exactly one `## 21:54:37 explore — List .neo/brain files` heading. No fallback required.
- **Idle hooks / CHECKPOINT.md — PASS.** `.neo/CHECKPOINT.md` existed after the runs; the Stop checkpoint is throttled for ten minutes. No fallback required.
- **Idle hooks / .session — PASS.** `.neo/.session` existed and was refreshed. It is created by brain-load at startup, not by idle. No fallback required.
- **Idle hooks / brain-sync commit — PASS.** Throwaway commits `08b5950` and `177518c`, both `neo: brain sync 2026-10-22`, committed the added brain files. No fallback required.
- **Duplicate-registration — FAIL (COULD NOT TEST the fence count); ledger PASS.** Re-exporting both `default` and `NeoPlugin` yielded one ledger heading per trinity/explore spawn. The trinity session export contained zero brain fences because it omitted the system prompt, so exactly one fence per session remains unverified. Phase 3 must observe the outgoing prompt; no duplicate-registration bug established.
