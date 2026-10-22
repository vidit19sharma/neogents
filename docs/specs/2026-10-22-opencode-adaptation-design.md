# OpenCode Adaptation — Design

**Status:** approved design, pre-implementation. All open questions were resolved by an empirical spike against OpenCode **1.19.1** on 2026-10-22 (section 9).
**Branch:** `opencode-harness`
**Date:** 2026-10-22

## 1. Goal

Make NEO run on OpenCode with the same guarantees it has on Claude Code, from one repository, such that **a project can be worked on from either harness at any time with zero migration**. If OpenCode is down, open the same repo in Claude Code and continue; the brain, plans, and ledger are the same files.

Codex, Kiro, and Cursor follow later through the same boundary. This spec covers OpenCode only, but every decision is made so the next adapter adds a directory, not a redesign.

## 2. Decisions (locked)

| # | Decision | Why |
|---|---|---|
| D1 | One repo serves both harnesses | Prompt and brain fixes land once. The alternative (`full-harness`/`lean-harness`-style sibling trees) proved to drift. |
| D2 | Full parity on OpenCode via a plugin, not prose-only | The memory and review guarantees are the product. Advisory-grade on one harness means the project is only as safe as its weakest harness. |
| D3 | Shim + native-where-better | The 8 hook scripts are hardened (3 audit rounds, 20 behavioral CI tests). The OpenCode plugin feeds them instead of re-implementing them. Where OpenCode has a native mechanism that is strictly stronger (permission globs, formatter config, spawn-depth enforcement), use the native one. |
| D4 | The project never contains harness-specific state | Adapters install globally, like the Claude Code plugin does today. Switching harness must not require touching the repo. |
| D5 | `AGENTS.md` is the canonical project instruction file | Read natively by OpenCode, Codex, and Cursor. Claude Code reads it through a one-line `CLAUDE.md` import. |
| D6 | OpenCode agents and commands are **derived** from `agents/` and `skills/` at plugin load time | Never hand-maintained twice; nothing written to disk (spike Q1). |
| D7 | The OpenCode plugin is plain JavaScript (ESM), not TypeScript | OpenCode loads `.js` plugins. `node --check` and `node:test` cover it with no toolchain. "No build step" stays literally true. |
| D8 | npm is the OpenCode distribution channel | OpenCode plugins *are* npm packages. The same package carries `npx @vidit19sharma/neogents setup \| init`. |
| D9 | **OpenCode 1.x only.** Verified against 1.19.1 / `@opencode-ai/plugin` 1.19.0. OpenCode 2 is out of scope. | The 1.x and 2.x docs are separate; nothing here is checked against 2.x. |

## 3. Architecture

### 3.1 Layout

```
neo/                          root stays Claude-Code-plugin-shaped: CC mandates .claude-plugin/,
│                             agents/, skills/, hooks/ at the root. Root == the Claude Code adapter.
├── agents/*.md               SOURCE OF TRUTH. Harness-neutral body; CC frontmatter; a
│                             marker-delimited "Harness Specifics" block at the bottom.
├── skills/*/SKILL.md         SOURCE OF TRUTH for every harness.
├── hooks/scripts/*.sh        THE NEUTRAL HOOK CONTRACT (section 4). Shared by every adapter.
├── hooks/hooks.json          Claude Code wiring.
├── .claude-plugin/           Claude Code manifest + marketplace.
├── templates/
│   ├── brain/*               unchanged
│   ├── AGENTS.md             NEW canonical project instructions (content of today's CLAUDE.md,
│   │                         made harness-neutral)
│   └── CLAUDE.md             becomes `@AGENTS.md` (Claude Code import syntax) + CC-only notes
├── adapters/
│   └── opencode/
│       ├── plugin.js         config-hook registration + event → script shim (section 5.1)
│       ├── transform.js      agents/ + skills/ → OpenCode agent/command config objects (5.3)
│       ├── permissions.json  per-agent permission blocks (4 rows)
│       ├── models.json       CC model alias → OpenCode model id
│       ├── test/*.test.js    node:test; snapshot of transform output
│       └── README.md         what is injected, how, known degradations
├── bin/neogents.js           `npx @vidit19sharma/neogents setup | init`
└── package.json              npm package; `files` whitelist; version pinned to plugin.json by CI
```

The asymmetry is deliberate and documented: Claude Code's adapter cannot live under `adapters/claude-code/` because Claude Code requires its layout at the repo root. Every other harness is `adapters/<name>/`.

### 3.2 The three rules

1. **Everything NEO writes into a project is harness-neutral.** `.neo/**` (brain, plans, runs, `CHECKPOINT.md`, `.session`), `.claude/skills/` (read natively by Claude Code *and* OpenCode), `AGENTS.md`, and the `CLAUDE.md` import line. Nothing else. Adapter files live under the user's home, never in the repo.
2. **`AGENTS.md` is canonical.** `/neo:init` (and `npx … init`) writes `AGENTS.md` from `templates/AGENTS.md`, plus `CLAUDE.md` containing `@AGENTS.md`. Existing `CLAUDE.md`/`AGENTS.md` files are left alone (init already only writes when absent).
3. **Author once, derive per harness.** Agent bodies and skill bodies are harness-neutral by authoring rule. Harness-specific tool names appear only inside the marked block at the bottom of `agents/neo.md`. Derived config is never edited by hand.

### 3.3 What is shared vs. per-adapter

| Shared (identical on every harness) | Per adapter |
|---|---|
| Brain files and templates | How events reach the scripts |
| The 4 agent prompts (body) | How "block" is expressed (CC: exit 2; OpenCode: permission glob / thrown error) |
| The 11 workflows | Agent/command format and frontmatter |
| Hook *logic* (the scripts) | Install mechanics and manifest |
| Spawn-depth model, tiered pipeline, contract negotiation | Model-alias mapping |

## 4. The neutral hook contract

The scripts in `hooks/scripts/` are the interface every adapter targets. Their input is JSON on stdin; today the field names are the ones Claude Code sends. **They are kept as-is** — renaming them to `NEO_*` would churn 8 hardened scripts and 20 tests for cosmetics. "Claude-shaped" is now simply the contract's shape.

| Script | stdin fields read | env | exit / output contract |
|---|---|---|---|
| `brain-load.sh` | `source` (`startup`/`resume`/`clear`/`compact`) | `CLAUDE_PROJECT_DIR` (fallback after `git rev-parse`) | stdout = text to inject into model context. Touches `.neo/.session` unless `source=compact`. Exit 0 always. |
| `jail.sh` | `agent_type`, `cwd`, `tool_input.file_path` or `tool_input.notebook_path` | `CLAUDE_PROJECT_DIR` | exit 2 + stderr = block with message. Exit 0 = allow. |
| `run-ledger.sh` | `tool_input.subagent_type`, `tool_input.description`, `tool_response` (string, array, or object with `content`) | `CLAUDE_PROJECT_DIR` | writes `.neo/runs/<date>.md`. Exit 0 always. |
| `checkpoint.sh` | `hook_event_name` (`PreCompact`/`Stop`), `last_assistant_message` | `CLAUDE_PROJECT_DIR` | writes `.neo/CHECKPOINT.md` (throttled except `PreCompact`). Exit 0 always. |
| `stop-gate.sh` | `stop_hook_active` | `CLAUDE_PROJECT_DIR` | exit 2 + stderr = "don't stop yet" with specifics. Exit 0 = fine. |
| `brain-sync.sh` | — | `CLAUDE_PROJECT_DIR` | commits `.neo/brain` when dirty and git state is safe. Exit 0 always. |
| `format.sh` | `tool_input.file_path`, `cwd` | `CLAUDE_PROJECT_DIR` | formats the file if an opt-in config is present. Exit 0 always. **Not used on OpenCode** (native formatter config). |
| `brain-gc.sh` | — (CLI, invoked by `/neo:gc` and `/neo:status`) | `NEO_GC_MAX_AGE_DAYS` | prints staleness report. Not a hook. |

Adapters set `CLAUDE_PROJECT_DIR` to the worktree root so every script's existing fallback chain works unchanged. `${CLAUDE_PLUGIN_ROOT}` appears only in three skills (`init`, `gc`, `status`); the transform rewrites it per harness.

## 5. The OpenCode adapter

### 5.1 `plugin.js` — registration and events

Two jobs. **Registration:** in the `config` hook, inject the derived agents into `cfg.agent` and the derived commands into `cfg.command` (spike Q1: works; `{file:}` is not resolved there, so the plugin reads the `.md` sources itself via `import.meta.url` and injects the text). **Events:** translate OpenCode hooks into the JSON in section 4, run the script with `CLAUDE_PROJECT_DIR=<worktree>`, map the result back.

| OpenCode hook / event | Script(s) | Payload built | Result mapping |
|---|---|---|---|
| `chat.message`, first message of a session | `brain-load.sh` | `{source: "startup"}` | stdout prepended to the message parts. Once per session (plugin keeps a `Set` of seen session IDs). The hook also records `sessionID → input.agent` for the jail. |
| `experimental.session.compacting` | `checkpoint.sh` then `brain-load.sh` | `{hook_event_name: "PreCompact"}`; `{source: "compact"}` | checkpoint written; brain-load stdout pushed into `output.context` so the brain survives compaction. |
| `tool.execute.after`, `input.tool === "task"` | `run-ledger.sh` | `{tool_input: {subagent_type, description}, tool_response: output.output}` | ledger entry. Verified (Q4): `args` are exactly `subagent_type`, `description`, `prompt`; `output.output` is the `<task …><task_result>` string; `output.metadata.parentSessionId` is available. |
| `event` → `session.idle`, **root session only** | `checkpoint.sh`, `stop-gate.sh`, `brain-sync.sh` | `{hook_event_name: "Stop", last_assistant_message}` (fetched via SDK); `{stop_hook_active: false}`; `{}` | checkpoint; stop-gate exit 2 → one-shot nudge (5.4); brain-sync commits if dirty. "Root" = a session whose `session.created` event carried no parent ID (Q4: child sessions carry the parent's ID; `session.idle` fires for children too and must be ignored). |
| `tool.execute.before`, tool in `write`/`edit`/`apply_patch` | `jail.sh` (defense-in-depth behind the permission glob) | `{agent_type: <from session map>, cwd: <worktree>, tool_input: {file_path: args.filePath}}` | exit 2 → `throw new Error(stderr)`; the model sees the message as the tool error and `tool.execute.after` does not fire (Q6). Agent identity is recoverable: child sessions' `chat.message` carries `agent` (Q4). |

The plugin does nothing at load or `dispose` beyond registration — `dispose` is process exit and fires on every CLI invocation, including `opencode session list` (Q5).

### 5.2 Native replacements

| CC mechanism | OpenCode mechanism | Note |
|---|---|---|
| `jail.sh` on `PreToolUse` | `permission: {edit: {"*": "deny", ".neo/brain/**": "allow"}, bash: "deny"}` on `neo-shadow` | Verified for `write` and `edit`; `apply_patch` per docs (GPT-only tool, untestable here). **Globs alone are not a jail** (Q2): symlinked paths escape and `bash` bypasses. Hence `bash: deny` (parity — neo-shadow has no Bash on Claude Code either) and `jail.sh` behind the glob for the symlink/hardlink/physical-path checks. `..` segments and absolute paths outside the worktree are already normalized/denied natively. The 1.19.1 permission key is `bash`, not the docs' `shell`. |
| Leaf agents lack the `Agent` tool | OpenCode's own depth enforcement (default `subagent_depth: 1`) + `permission: {task: "deny"}` on `trinity`, `smith`, `neo-shadow` | Verified (Q8): leaves get no `task` tool by default, and even with `task: allow` the depth limit blocks nesting. The explicit deny is documentation, not load-bearing. |
| `format.sh` | `formatter` in `opencode.json` | Script not used on OpenCode. |
| `disable-model-invocation: true` (equip) | Workflows are **commands**, which only the user can invoke | Skills cannot be hidden from the model in 1.19.1 — `opencode/autoinvoke` is ignored (Q7). Commands are not model-invocable by construction, so every `/neo:*` workflow is explicit-only on OpenCode. The Hard Rule in `neo.md` still routes plain-language requests. |
| `settings.json {"agent": "neo"}` | `default_agent: "neo"` in global `opencode.json`; `neo` injected with `mode: primary` | |

### 5.3 `transform.js`

Input: `agents/*.md`, `skills/*/SKILL.md` read from the package. Output: plain objects for `cfg.agent` and `cfg.command`. Pure function; snapshot-tested.

**Agents.** For each `agents/<name>.md`:
- frontmatter → keep `description`; drop `tools:`; `mode: primary` (neo) or `subagent` (others); `permission` from `permissions.json`; `model` through `models.json` (`sonnet`/`opus` → configured OpenCode ids; `inherit` → omitted so the session model is inherited).
- body → `prompt`, verbatim **except** the harness-specific block at the bottom of `neo.md`, replaced by the OpenCode block (`task` for `Agent`, `todowrite` for `TodoWrite`, "ask directly" for `AskUserQuestion`, `webfetch`/`websearch` for `WebFetch`/`WebSearch`). The transform keys on an explicit begin/end marker pair; implementation adds `<!-- harness:begin -->` / `<!-- harness:end -->` around the existing block.

**Commands.** For each `skills/<name>/SKILL.md` → `cfg.command["neo:<name>"]` — `:` is legal in command names (Q3), so `/neo:init` etc. keep their names on both harnesses and no prose rewriting is needed. `description` kept, `agent: "neo"`, `template` = body verbatim including `!`cmd`` lines and `$ARGUMENTS` (both work on OpenCode, Q3); `${CLAUDE_PLUGIN_ROOT}` → the package path. No skill metadata is emitted (5.2).

### 5.4 Degradations (documented, not hidden)

| Guarantee | Claude Code | OpenCode |
|---|---|---|
| Stop-gate | blocks the turn (exit 2) | **advisory**: on root `session.idle`, if the gate would block, the plugin surfaces stop-gate's stderr verbatim, once, through the SDK's TUI toast or prepended to the next user message — whichever the installed SDK exposes. OpenCode has no blockable Stop. |
| Brain auto-commit | once at `SessionEnd` | on each root `session.idle` where the brain is dirty. The script's own guards make this idempotent; commits are more granular. There is no session-end event; `dispose` is process exit (Q5) and is not used. |
| Write-jail | hook | permission glob + `bash: deny` (native) with `jail.sh` behind it — equal or stronger |
| Checkpoint before compaction | hook | compaction hook — **plus** brain context injected into the compaction |
| Explicit-only equip | harness field | commands are not model-invocable; plus the Hard Rule in `neo.md` |

## 6. Distribution

| | Claude Code | OpenCode |
|---|---|---|
| Channel | git repo via marketplace (unchanged) | npm `@vidit19sharma/neogents` |
| Install | `/plugin marketplace add vidit19sharma/neogents` → `/plugin install neo@neogents` | `npx @vidit19sharma/neogents setup` |
| What `setup` does | prints those two commands; never copies into `~/.claude/` | adds the package to `plugin: [...]` and sets `default_agent: "neo"` in `~/.config/opencode/opencode.json`. Nothing else: the plugin registers agents and commands itself at load (Q1). No files on disk, no manifest to track. |
| Update | `/plugin update` | `npx @vidit19sharma/neogents@latest setup` is idempotent; setup normalizes versioned plugin entries to unpinned `@vidit19sharma/neogents`, which OpenCode re-resolves to latest. |
| Project step | `/neo:init` | `/neo:init` (same name), or `npx … init` — harness-free scaffold: `.neo/brain/` from templates, `.neo/plans/`, `.neo/.gitignore`, `AGENTS.md`, `CLAUDE.md` import line. Leaves BRIEF/ARCHITECTURE as template placeholders and says so. |

**Package:** `package.json` at root. `files`: `agents/`, `skills/`, `hooks/scripts/`, `templates/`, `adapters/opencode/`, `bin/`. Not shipped: `hooks/hooks.json`, `.claude-plugin/`, `docs/`, `.github/`. No `dependencies`; `@opencode-ai/plugin` only as a `devDependency` for editor types. `bin: {"neogents": "bin/neogents.js"}`.

**Version:** `.claude-plugin/plugin.json` `version` and `package.json` `version` must match; CI fails otherwise. Publish on tag `v*` through GitHub Actions with npm trusted publishing (OIDC) so releases carry provenance.

**Zero-deps claim, narrowed:** "zero *runtime* dependencies — hooks are bash + jq. The installer and the OpenCode adapter are JavaScript run by the Node/Bun your harness already ships."

## 7. Testing

1. **Existing 27 CI steps unchanged.** They test the contract in section 4, which is exactly what the shim depends on.
2. **Adapter job** (new): `node --check` on `plugin.js`, `transform.js`, `bin/neogents.js`; `node --test adapters/opencode/test/` covering (a) every row of the 5.1 table — event in, JSON out, exit-code mapping, first-message-only brain load, root-session-only idle handling, session→agent map; (b) `transform.js` snapshot diffs against the real `agents/` and `skills/`; (c) `setup`'s `opencode.json` merge is idempotent and never clobbers unrelated keys; version-sync check.
3. **OpenCode smoke** (new, pinned to a 1.19.x version): install into a temp `XDG_CONFIG_HOME`, `npx … setup`, scaffold a brain, then `opencode run --command neo:status` and a `neo-shadow` write attempt outside `.neo/brain/`. Assert the brain loaded (via `opencode export`), the write was denied, and a `task` spawn landed in `.neo/runs/`. Two spike lessons bake in: `opencode run "/neo:x"` does **not** run a command (the model just sees the text) — only `--command` does; and `run` mode auto-rejects every permission *ask*, so the smoke config uses explicit allow/deny only. Runs on tags unless a free/offline model works unauthenticated on the runner (the catalog has `opencode/deepseek-v4.1-flash-free`; verify in phase 4). Implemented model-free in CI (plugin load + agent registration + setup/init); the model-dependent checks are the live verification recorded in `adapters/opencode/README.md`.

## 8. Docs

- **`docs/portability.md` rewritten** from the false "swap 3 places" claim into a per-guarantee table: for each guarantee (brain load, jail, spawn depth, checkpoint, stop-gate, auto-commit, run ledger, formatter, explicit-only workflows) — mechanism on Claude Code, on OpenCode, status for Codex/Kiro/Cursor (TBD). Plus the authoring rules from 3.2 for contributors, and the section-4 contract as the thing new hooks must honor.
- **README**: install section for both harnesses; narrowed zero-deps claim; `AGENTS.md` note.
- **`adapters/opencode/README.md`**: what is injected, how, degradations table, the `--command` and run-mode-permission gotchas.
- **CHANGELOG**: Added — OpenCode adapter, npm package, `npx setup|init`; Changed — `AGENTS.md` canonical with `CLAUDE.md` import.

## 9. Spike results (OpenCode 1.19.1, `@opencode-ai/plugin` 1.19.0, 2026-10-22)

Every run used an empty `XDG_CONFIG_HOME` (no global plugins), the free model `opencode/deepseek-v4.1-flash-free`, and `opencode export` to confirm what the model actually received.

| Q | Finding | Decided |
|---|---|---|
| Q1 | `config` hook can inject `cfg.agent` and `cfg.command`; they appear in `opencode agent list` and run. `{file:…}` in an injected `prompt` is **not** resolved (stays literal). | Zero-copy install; plugin reads the `.md` sources itself. |
| Q2 | `permission.edit` glob denies/allows `write` and `edit` by path; `..` normalized and denied; absolute path inside the worktree allowed; non-canonical `/tmp` vs `/private/tmp` treated as external. **Symlinked path escaped**; **`bash` bypassed** (`echo > file`). | Glob + `bash: deny` + `jail.sh` behind it. |
| Q3 | `commands/neo:ping.md` works as `--command neo:ping`; `neo-ping` and `neo/sub` also work. `!`cmd`` interpolates (trailing newline kept); `$ARGUMENTS` works. | Keep `/neo:<name>`. |
| Q4 | `task` args: `{description, prompt, subagent_type}`. `tool.execute.before` input: `{tool, sessionID, callID}` — no agent. `chat.message` child: `{sessionID, agent: "leaf"}`; root: `agent` undefined unless `--agent` given. `session.created` for a child carries the parent's ID. No `session.deleted` observed. | Run-ledger payload is 1:1. Session→agent map from `chat.message`; root = no parent. |
| Q5 | `dispose` fires 7 ms after root `session.idle` at process exit — and on every CLI call (`session list`, `export`). `session.idle` also fires for child sessions. | Auto-commit on root `session.idle`; never on `dispose`. |
| Q6 | `throw new Error("…")` in `tool.execute.before` → file not written, model sees the message as the tool error, `after` does not fire. `write` arg key is `filePath` (absolute). | Exit 2 → throw(stderr). |
| Q7 | Skills in `.opencode/skills/`, project `.claude/skills/`, and `~/.claude/skills/` are all discovered. Every skill is already runnable as `--command <name>` (server lists them as `source: skill`). `opencode/autoinvoke: "false"` is **ignored** (skill still listed in `<available_skills>`); `debug skill` shows no metadata at all. | Ship workflows as commands, not skills. |
| Q8 | Leaves have no `task` tool by default. With `task: allow`, the call reaches the hook then fails: "Subagent depth limit reached (1)". `experimental.subagent_depth: 2` allows nesting. | Native depth enforcement; explicit `task: deny` kept as documentation. |

**Residual verifications for implementation (not design-changing):**
- R1: `!`cmd`` interpolation in a *config-injected* command `template` (Q3 tested file-based commands). Fallback if it doesn't: `setup` writes the 11 command files to `~/.config/opencode/commands/`.
- R2: `default_agent: "neo"` resolving to a plugin-injected agent (ordering of config validation vs. plugin load). Fallback: `setup` writes `neo.md` to `~/.config/opencode/agents/`.
- R3: root `chat.message` carries `agent: "neo"` once `default_agent` is set (spike saw `undefined` without `--agent`). The root-session rule does not depend on it.

## 10. Out of scope

OpenCode 2.x. Codex, Kiro, Cursor adapters (each gets its own short spec, same boundary). Multi-user brain split (`ACTIVE.md` per user). An `update` verb. Brain schema migrations. Per-project (non-global) OpenCode install.

## 11. Implementation phases

Each phase is shippable on its own and keeps Claude Code green.

1. **Neutral core**: `templates/AGENTS.md`; `templates/CLAUDE.md` → import line; `/neo:init` writes both; `<!-- harness:begin/end -->` markers in `agents/neo.md`; `docs/portability.md` rewrite. Claude Code only, no new code.
2. **Adapter**: `adapters/opencode/{transform.js,permissions.json,models.json,plugin.js}` + `node:test` suite + snapshots. CI adapter job. Resolve R1–R3.
3. **Distribution**: `package.json`, `bin/neogents.js` (`setup`, `init`), version-sync CI step, tag-publish workflow with trusted publishing.
4. **Smoke + docs**: OpenCode smoke test, README, adapter README, CHANGELOG.
