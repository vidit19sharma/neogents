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
Follow-up observations used `zz-probe.js`, loaded after `neo.js`, to count fences and
nudges in `experimental.chat.system.transform`'s `output.system`; session exports omit it.

- **R1 — PASS.** `run --command neo:status ""` exported expanded `Brain files: … 161 total` and `Graphify: available`, with no literal shell substitutions. In the follow-up `run "Reply exactly: F-OK"`, both system-transform observations for root session `ses_e9b8de441ffeN4CHGUZ5Z7l4SM` recorded `"fences":1,"nudges":0,"parts":2`; the reply was `F-OK`. The brain fence reached the system prompt. No command-file fallback required.
- **R2 — PASS.** `agent list` registered `neo (primary)`, `neo-shadow`, `smith`, and `trinity`; `debug config` contained 11 `neo:*` commands. Default runs selected neo without a fallback warning. `debug agent trinity` reported `modelID: deepseek-v4.1-flash-free`, confirming the user override. No agent-file fallback required.
- **R3 — FAIL.** A default-only `run "Reply exactly: R3-OK"` returned `R3-OK`; the chat probe recorded `{"sessionID":"ses_e9b94c846ffeBMcJa0WrxJX220"}` with no agent field. No fallback required: retain parent-ID/mode-based root detection (`hooks.js:28`).
- **Jail / glob — not observed — jail.sh blocked (safe).** The fixed-path delegated test initially refused without calling a tool. One authorized-diagnostic rephrase produced exactly one shadow `write` call with `filePath: /private/tmp/neo-live/proj/escape.md`, `content: ESCAPE`; its exported tool state was `error` with `[neo jail] neo-shadow may only write under .neo/brain/ — it resolves outside the jail`. `ls -la /private/tmp/neo-live/proj/escape.md` returned `No such file or directory`. No OpenCode permission denial was observed: `hooks.js:98–110` intercepted before glob evaluation. Keep both layers; this proves jail.sh enforcement, not independent glob enforcement. No plugin bug established.
- **Jail / bash deny — PASS via delegated shadow.** Shadow had no bash tool exposed; `bashesc.md` did not exist. The direct `--agent neo-shadow` attempt ran as neo and is not evidence of shadow permissions. Use task delegation for subagent checks.
- **Jail / jail.sh symlink — PASS via delegated shadow.** `.neo/brain/ok.md` was written; `.neo/brain/link/x.md` failed with `[neo jail] neo-shadow may only write under .neo/brain/ — it resolves outside the jail`; `/tmp/neo-live/outside/x.md` did not exist. No fallback required.
- **Ledger / trinity — PASS.** One task returned `PONG`; `.neo/runs/2026-10-22.md` contained exactly one `## 21:54:11 trinity — ping` heading. No fallback required.
- **Ledger / explore — PASS.** `run --agent neo` delegated the brain listing to explore; the ledger contained exactly one `## 21:54:37 explore — List .neo/brain files` heading. No fallback required.
- **Idle hooks / CHECKPOINT.md — PASS.** `.neo/CHECKPOINT.md` existed after the runs; the Stop checkpoint is throttled for ten minutes. No fallback required.
- **Idle hooks / .session — PASS.** `.neo/.session` existed and was refreshed. It is created by brain-load at startup, not by idle. No fallback required.
- **Idle hooks / brain-sync commit — PASS.** Throwaway commits `08b5950` and `177518c`, both `neo: brain sync 2026-10-22`, committed the added brain files. No fallback required.
- **Duplicate-registration — PASS.** With both `default` and `NeoPlugin` re-exported, all three observations for delegation root `ses_e9b8db8d2ffeiSvz4mMUxpcGYP` showed `"fences":1`; trinity child `ses_e9b8da587ffe44IYPWLjAm8smn` showed `"fences":0,"nudges":0,"parts":1`. The fresh ledger contained one `## 21:59:40 trinity — ping` heading and `PONG`; the earlier explore check also had one heading. Multiple transform calls occurred, but each root prompt had exactly one fence and the child had no brain. No fallback required.
- **Stop-gate nudge — NOT OBSERVED (trigger condition unmet).** After adding `x` to the throwaway README, separate runs returned `N-OK` and `N2-OK`; all four corresponding probe observations had `"nudges":0`. `git status --porcelain` showed `?? .neo/CHECKPOINT.md`, `?? .neo/runs/`, and `?? README.md`; `stat -f '%m %N' .neo/.session README.md` showed `1792686606 .neo/.session` versus `1792686593 README.md`. README was untracked and older than the refreshed session marker, so these runs did not establish the gate's exit-2 condition or one-shot delivery. Nudge state is session-local (`hooks.js:26,69–74,91–94`); separate fresh runs cannot test delivery of a previous session's pending nudge. No plugin bug established.
