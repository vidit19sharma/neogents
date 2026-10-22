# OpenCode Adaptation — Design

**Status:** approved design, pre-implementation. Items marked `PENDING SPIKE` are being verified against OpenCode v1.19.x on a real install; the spec is updated when results land.
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
| D3 | Shim + native-where-better | The 8 hook scripts are hardened (3 audit rounds, 20 behavioral CI tests). The OpenCode plugin feeds them instead of re-implementing them. Where OpenCode has a native mechanism that is strictly stronger (permission globs, formatter config, spawn-depth setting), use the native one. |
| D4 | The project never contains harness-specific state | Adapters install globally, like the Claude Code plugin does today. Switching harness must not require touching the repo. |
| D5 | `AGENTS.md` is the canonical project instruction file | Read natively by OpenCode, Codex, and Cursor. Claude Code reads it through a one-line `CLAUDE.md` import. |
| D6 | OpenCode agents and commands are **generated** from `agents/` and `skills/` | Never hand-maintained twice. |
| D7 | The OpenCode plugin is plain JavaScript (ESM), not TypeScript | OpenCode loads `.js` plugins. `node --check` and `node:test` cover it with no toolchain. "No build step" stays literally true. |
| D8 | npm is the OpenCode distribution channel | OpenCode plugins *are* npm packages. The same package carries `npx @vidit19sharma/neogents setup \| init`. |

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
│       ├── plugin.js         event → script shim (section 5.1)
│       ├── generate.js       agents/ + skills/ → OpenCode agents/ + commands/ (section 5.3)
│       ├── permissions.json  per-agent permission blocks (4 rows)
│       ├── models.json       CC model alias → OpenCode model id
│       ├── test/*.test.js    node:test
│       └── README.md         what is generated, how, known degradations
├── bin/neogents.js           `npx @vidit19sharma/neogents setup | init`
└── package.json              npm package; `files` whitelist; version pinned to plugin.json by CI
```

The asymmetry is deliberate and documented: Claude Code's adapter cannot live under `adapters/claude-code/` because Claude Code requires its layout at the repo root. Every other harness is `adapters/<name>/`.

### 3.2 The three rules

1. **Everything NEO writes into a project is harness-neutral.** `.neo/**` (brain, plans, runs, `CHECKPOINT.md`, `.session`), `.claude/skills/` (read natively by Claude Code *and* OpenCode), `AGENTS.md`, and the `CLAUDE.md` import line. Nothing else. Adapter files live under the user's home, never in the repo.
2. **`AGENTS.md` is canonical.** `/neo:init` (and `npx … init`) writes `AGENTS.md` from `templates/AGENTS.md`, plus `CLAUDE.md` containing `@AGENTS.md`. Existing `CLAUDE.md`/`AGENTS.md` files are left alone (init already only writes when absent).
3. **Author once, derive per harness.** Agent bodies and skill bodies are harness-neutral by authoring rule. Harness-specific tool names appear only inside the marked block at the bottom of `agents/neo.md`. Generated files are never edited by hand.

### 3.3 What is shared vs. per-adapter

| Shared (identical on every harness) | Per adapter |
|---|---|
| Brain files and templates | How events reach the scripts |
| The 4 agent prompts (body) | How "block" is expressed (CC: exit 2; OpenCode: permission glob / thrown error) |
| The 11 workflows | Agent/command file format and frontmatter |
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

Adapters set `CLAUDE_PROJECT_DIR` to the worktree root so every script's existing fallback chain works unchanged. `${CLAUDE_PLUGIN_ROOT}` appears only in three skills (`init`, `gc`, `status`); the generator rewrites it per harness.

## 5. The OpenCode adapter

### 5.1 `plugin.js` — events to scripts

One job: translate OpenCode events into the JSON above, run the script with `CLAUDE_PROJECT_DIR=<worktree>`, map the result back.

| OpenCode hook / event | Script(s) | Payload built | Result mapping |
|---|---|---|---|
| `chat.message`, first message of a session | `brain-load.sh` | `{source: "startup"}` | stdout prepended to the message parts. Once per session (plugin keeps a `Set` of seen session IDs). |
| `experimental.session.compacting` | `checkpoint.sh` then `brain-load.sh` | `{hook_event_name: "PreCompact"}`; `{source: "compact"}` | checkpoint written; brain-load stdout pushed into `output.context` so the brain survives compaction. |
| `tool.execute.after`, `input.tool === "task"` | `run-ledger.sh` | `{tool_input: {subagent_type, description}, tool_response}` from `args` + `output` | ledger entry. Exact arg names `PENDING SPIKE Q4`. |
| `event` → `session.idle`, primary session only | `checkpoint.sh`, `stop-gate.sh`, `brain-sync.sh` | `{hook_event_name: "Stop", last_assistant_message}` (fetched via SDK); `{stop_hook_active: false}`; `{}` | checkpoint; stop-gate exit 2 → one-shot nudge (5.4); brain-sync commits if dirty. "Primary" = the session whose agent is `neo` (from the `chat.message` session→agent map); if Q4 shows subagent sessions carry no agent name, fall back to "the session that received the user's first message". |
| `tool.execute.before`, tool in `edit`/`write`/`patch` | `jail.sh` (defense-in-depth behind the permission glob) | `{agent_type, cwd, tool_input: {file_path}}` with `agent_type` from the session→agent map | exit 2 → `throw new Error(stderr)`; the model sees the message. Only if `PENDING SPIKE Q4` confirms agent identity is recoverable; otherwise the permission glob alone is the jail. |

The plugin resolves its own package directory (`import.meta.url`) for anything that needs bundled files. It never writes into the project except through the scripts.

### 5.2 Native replacements

| CC mechanism | OpenCode mechanism | Note |
|---|---|---|
| `jail.sh` on `PreToolUse` | `permission.edit: {"*": "deny", ".neo/brain/**": "allow"}` on the generated `neo-shadow` agent | Harness-enforced; equal or stronger than a hook. `PENDING SPIKE Q2`: confirm `edit` governs `write`/`patch` and that symlink/`..` paths are normalized. |
| Leaf agents lack the `Agent` tool | `subagent_depth: 1` (OpenCode default) + `permission.task: deny` on `trinity`, `smith`, `neo-shadow` | `PENDING SPIKE Q8`. |
| `format.sh` | `formatter` in `opencode.json` | Script not shipped in the npm tarball's OpenCode path. |
| `disable-model-invocation: true` (equip) | `opencode/autoinvoke: "false"` metadata on the generated command | `PENDING SPIKE Q7` for exact YAML shape. |
| `settings.json {"agent": "neo"}` | `default_agent: "neo"` in global `opencode.json`; `neo` generated with `mode: primary` | |

### 5.3 `generate.js`

Input: `agents/*.md`, `skills/*/SKILL.md`. Output: OpenCode agent and command markdown.

**Agents.** For each `agents/<name>.md`:
- frontmatter → keep `description`; drop `tools:`; add `mode: primary` (neo) or `mode: subagent` (others); add `permission:` from `permissions.json`; map `model:` through `models.json` (`sonnet`/`opus` → configured OpenCode ids; `inherit` → omit so the session model is inherited).
- body → copied verbatim **except** the harness-specific block at the bottom of `neo.md`, which is replaced by the OpenCode block (`task` instead of `Agent`, `todowrite` instead of `TodoWrite`, "ask directly" instead of `AskUserQuestion`, `webfetch` instead of `WebFetch`/`WebSearch`). The generator keys on an explicit begin/end marker pair; if the current single HTML comment is one-sided, implementation adds `<!-- harness:begin -->` / `<!-- harness:end -->`.

**Commands.** For each `skills/<name>/SKILL.md` → `commands/neo-<name>.md` (`/neo:<name>` if `PENDING SPIKE Q3` shows `:` is legal): frontmatter `description` kept, `agent: neo` added; body kept verbatim including `!`cmd`` lines (same syntax on OpenCode); `${CLAUDE_PLUGIN_ROOT}` → the package path; `/neo:` references → the chosen prefix. Equip gets the autoinvoke-off metadata.

Golden files for the generated output live in `adapters/opencode/test/golden/` and are diffed in CI.

### 5.4 Degradations (documented, not hidden)

| Guarantee | Claude Code | OpenCode |
|---|---|---|
| Stop-gate | blocks the turn (exit 2) | **advisory**: on `session.idle`, if the gate would block, the plugin surfaces stop-gate's stderr verbatim, once, through the SDK's TUI toast or prepended to the next user message — whichever the installed SDK exposes. OpenCode has no blockable Stop. |
| Brain auto-commit | once at `SessionEnd` | on each `session.idle` where the brain is dirty. The script's own guards make this idempotent; commits are more granular. No session-end event exists (`PENDING SPIKE Q5` on `dispose`). |
| Write-jail | hook | permission glob (native) — equal or stronger |
| Checkpoint before compaction | hook | compaction hook — **plus** brain context injected into the compaction |
| Explicit-only equip | harness field | skill metadata + the Hard Rule in `neo.md` |

## 6. Distribution

| | Claude Code | OpenCode |
|---|---|---|
| Channel | git repo via marketplace (unchanged) | npm `@vidit19sharma/neogents` |
| Install | `/plugin marketplace add vidit19sharma/neogents` → `/plugin install neo@neogents` | `npx @vidit19sharma/neogents setup` |
| What `setup` does | prints those two commands; never copies into `~/.claude/` | adds the package to `plugin: [...]` and sets `default_agent: "neo"` in `~/.config/opencode/opencode.json`; then either (a) nothing else — the plugin self-registers agents/commands through its `config` hook (`PENDING SPIKE Q1`), or (b) runs `generate.js` into `~/.config/opencode/{agents,commands}/` and records the written paths in `~/.config/opencode/.neogents-manifest.json` so re-runs overwrite only what they own |
| Update | `/plugin update` | `npx @vidit19sharma/neogents@latest setup` (idempotent) |
| Project step | `/neo:init` | `/neo-init`, or `npx … init` — harness-free scaffold: `.neo/brain/` from templates, `.neo/plans/`, `.neo/.gitignore`, `AGENTS.md`, `CLAUDE.md` import line. Leaves BRIEF/ARCHITECTURE as template placeholders and says so. |

**Package:** `package.json` at root. `files`: `agents/`, `skills/`, `hooks/scripts/`, `templates/`, `adapters/opencode/`, `bin/`. Not shipped: `hooks/hooks.json`, `.claude-plugin/`, `docs/`, `.github/`. No `dependencies`; `@opencode-ai/plugin` only as a `devDependency` for editor types. `bin: {"neogents": "bin/neogents.js"}`.

**Version:** `.claude-plugin/plugin.json` `version` and `package.json` `version` must match; CI fails otherwise. Publish on tag `v*` through GitHub Actions with npm trusted publishing (OIDC) so releases carry provenance.

**Zero-deps claim, narrowed:** "zero *runtime* dependencies — hooks are bash + jq. The installer and the OpenCode adapter are JavaScript run by the Node/Bun your harness already ships."

## 7. Testing

1. **Existing 27 CI steps unchanged.** They test the contract in section 4, which is exactly what the shim depends on.
2. **Adapter job** (new): `node --check` on `plugin.js`, `generate.js`, `bin/neogents.js`; `node --test adapters/opencode/test/` covering (a) every row of the 5.1 table — event in, JSON out, exit-code mapping, first-message-only brain load, primary-session-only idle handling; (b) `generate.js` golden-file diffs; (c) `setup`'s `opencode.json` merge is idempotent and never clobbers unrelated keys; version-sync check.
3. **OpenCode smoke** (new, pinned OpenCode version): install into a temp `HOME`, `npx … setup`, scaffold a brain, `opencode run --agent neo` with a tiny prompt; assert the brain loaded, a write outside `.neo/brain/` by `neo-shadow` is denied, and a `task` spawn lands in `.neo/runs/`. Runs on every PR if OpenCode offers an offline/mock provider; otherwise on tags only, with a cheap model.

## 8. Docs

- **`docs/portability.md` rewritten** from the false "swap 3 places" claim into a per-guarantee table: for each guarantee (brain load, jail, spawn depth, checkpoint, stop-gate, auto-commit, run ledger, formatter, explicit-only skills) — mechanism on Claude Code, on OpenCode, status for Codex/Kiro/Cursor (TBD). Plus the authoring rules from 3.2 for contributors, and the section-4 contract as the thing new hooks must honor.
- **README**: install section for both harnesses; narrowed zero-deps claim; `AGENTS.md` note.
- **`adapters/opencode/README.md`**: what is generated, how to regenerate, degradations table.
- **CHANGELOG**: Added — OpenCode adapter, npm package, `npx setup|init`; Changed — `AGENTS.md` canonical with `CLAUDE.md` import.
- Spike results recorded in this spec (section 9) so nobody re-tests them.

## 9. Open questions — PENDING SPIKE

Being verified now against the local OpenCode install. Each decides one branch above.

| Q | Question | Decides |
|---|---|---|
| Q1 | Can the plugin `config` hook inject agent and command definitions (with `prompt: {file:…}`)? | 6: zero-copy install (a) vs. generated files on disk (b) |
| Q2 | Does `permission.edit` govern `write`/`patch` too, and are symlink/`..` paths normalized? | 5.2: glob alone vs. glob + `jail.sh` behind it |
| Q3 | Is `:` legal in command names? | 5.3: `/neo:init` vs `/neo-init` |
| Q4 | `task` tool arg names; does `tool.execute.before` carry agent/session identity; does `chat.message` fire for subagent sessions with the agent name? | 5.1: run-ledger payload; whether jail.sh can run as defense-in-depth |
| Q5 | Does `dispose` fire on TUI exit? | 5.4: brain-sync on idle only, or also at exit |
| Q6 | Does a thrown error in `tool.execute.before` reach the model as the tool result? | 5.1: block message fidelity |
| Q7 | Skill metadata YAML shape for `opencode/slash` and `opencode/autoinvoke`; does a SKILL.md body support `!`cmd``? | 5.2 / 5.3: commands vs. skills for our workflows |
| Q8 | Can a subagent call `task` under default `subagent_depth`? | 5.2: whether `permission.task: deny` is needed on leaves |

## 10. Out of scope

Codex, Kiro, Cursor adapters (each gets its own short spec, same boundary). Multi-user brain split (`ACTIVE.md` per user). An `update` verb. Brain schema migrations. Per-project (non-global) OpenCode install.

## 11. Implementation phases

Each phase is shippable on its own and keeps Claude Code green.

0. **Spike** (section 9) → update this spec.
1. **Neutral core**: `templates/AGENTS.md`; `templates/CLAUDE.md` → import line; `/neo:init` writes both; explicit begin/end harness markers in `agents/neo.md`; `docs/portability.md` rewrite. Claude Code only, no new code.
2. **Adapter**: `adapters/opencode/{generate.js,permissions.json,models.json,plugin.js}` + `node:test` suite + golden files. CI adapter job.
3. **Distribution**: `package.json`, `bin/neogents.js` (`setup`, `init`), version-sync CI step, tag-publish workflow with trusted publishing.
4. **Smoke + docs**: OpenCode smoke test, README, adapter README, CHANGELOG.
