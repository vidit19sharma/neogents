# NEO Hooks Reference

All hooks are declared in `hooks/hooks.json` and implemented in `hooks/scripts/`. They are the deterministic enforcement layer of the plugin. Prompts guide; hooks enforce.

---

## Exit Code Protocol

| Exit code | Meaning |
|---|---|
| `0` | Allow. The operation proceeds. |
| `2` | Block. The operation is cancelled. stderr is fed back to the agent as corrective feedback. |

Any other non-zero exit code is treated as an error in the hook itself, not a block.

---

## Hook Summary

| Event | Matcher | Script | Behavior |
|---|---|---|---|
| `SessionStart` | (all) | `brain-load.sh` | Cats brain files (and a fresh checkpoint) into context. Hints `/neo:init` if no brain. |
| `PreToolUse` | `Edit\|Write\|NotebookEdit` | `jail.sh` | Hard blocks out-of-jail writes for neo-shadow. |
| `PostToolUse` | `Edit\|Write\|NotebookEdit` | `format.sh` | Formats the just-edited file with project-local formatters. Fail-open. |
| `PostToolUse` | `Agent\|Task` | `run-ledger.sh` | Appends every subagent spawn to the run ledger in `.neo/runs/`. |
| `PreCompact` | (all) | `checkpoint.sh` | Deterministic snapshot to `.neo/CHECKPOINT.md` before compaction. |
| `Stop` | (all) | `checkpoint.sh` then `stop-gate.sh` | Snapshot (throttled), then one-shot block when code changed but brain was not updated. |
| `SessionEnd` | (all) | `brain-sync.sh` | Auto-commits `.neo/brain/` to git. |

One script in `hooks/scripts/` is **not** wired into `hooks.json`: `brain-gc.sh` is a helper invoked by the `/neo:gc` and `/neo:status` skills (documented below).

---

## brain-load.sh

**Event:** `SessionStart`

stdout from a `SessionStart` hook is injected into the session context before the first user message.

1. Checks for `.neo/brain/`. If absent, prints one line hinting `/neo:init` and exits 0.
2. Cats, skipping empty files: `BRIEF.md`, `ACTIVE.md`, `LESSONS.md`, `INDEX.md` (full), `PROGRESS.md` (last 20 lines).
3. Cats `.neo/CHECKPOINT.md` if it was written within the last 60 minutes — the deterministic snapshot from the previous stop or compaction.
4. Prints a note that `ARCHITECTURE.md` and `DECISIONS.md` load on demand via INDEX pointers; surfaces a hint if `WORKFLOWS.md` has `status: proposed` entries; advertises graphify when present.

**Cost:** zero LLM tokens. Pure shell `cat`.

---

## jail.sh

**Event:** `PreToolUse` · **Matcher:** `Edit|Write|NotebookEdit`

Enforces write-path restriction for neo-shadow: it may only write under `.neo/**`. All other agents and the main thread pass through without inspection.

1. Checks for `jq`. If absent, exits 0 (fail-open).
2. Extracts `agent_type` from the payload. If absent or empty, exits 0 (covers the main thread).
3. Strips any namespace prefix (`neo:neo-shadow` → `neo-shadow`).
4. If the agent is not `neo-shadow`, exits 0.
5. Extracts the target path from `tool_input.file_path` or `tool_input.notebook_path`, normalizes it relative to the session `cwd`, and rejects any path containing `..` segments (traversal prevention).
6. If the path is under `.neo/`, exits 0. Otherwise prints to stderr and exits 2.

**stderr on block:**
```
[neo jail] <agent> may only write under <jail> (attempted: <path>). Write your output there, or report back instead of writing elsewhere.
```

**Fail-open rationale:** `agent_type` has no formal stability contract in Claude Code (anthropics/claude-code#56168). If the field is absent, `jq` is missing, or the payload shape is unrecognized, the hook allows. Structural tool allowlists and the stop-gate audit provide defense-in-depth.

---

## format.sh

**Event:** `PostToolUse` · **Matcher:** `Edit|Write|NotebookEdit`

Formats the just-written file using project-local formatters only. Never installs anything.

1. Skips when `jq` is absent, the path is missing, the file doesn't exist, or the file is under `.neo/`.
2. Dispatches by extension:
   - `.js .jsx .ts .tsx .mjs .cjs .json .css .scss .html .yaml .yml .md` — `node_modules/.bin/prettier --write --ignore-unknown` if the project-local binary exists. Never a global install.
   - `.py` — `ruff format` only if the project opts in (`ruff.toml`, `.ruff.toml`, or `[tool.ruff]` in `pyproject.toml`); else `black --quiet` only with `[tool.black]` in `pyproject.toml`.
   - `.go` — `gofmt -w` if on PATH.
   - `.rs` — `rustfmt --edition 2021` if on PATH.
3. Exits 0 on every path. All formatter output is suppressed; a formatter failure never breaks the edit.

---

## checkpoint.sh

**Event:** `Stop` and `PreCompact`

Deterministic session snapshot. Replaces the old advisory "save the brain now" reminder — a script's job is done by a script, not by asking an LLM to remember.

1. Exits 0 unless `.neo/` exists and the cwd is a git work tree.
2. Reads `hook_event_name` and `last_assistant_message` from the payload (fail-open without `jq`).
3. **Throttle:** on `Stop`, skips if `.neo/CHECKPOINT.md` was written in the last 10 minutes. `PreCompact` always writes.
4. Writes `.neo/CHECKPOINT.md` (newest wins, safe to delete):
   - when / event / branch / HEAD
   - `## Uncommitted files` — `git status --short` (first 100 lines)
   - `## Diff stat (vs HEAD)` — `git diff HEAD --stat` (last 40 lines)
   - `## Last assistant message` — first 4000 chars, when present
5. Exits 0 on every path.

`brain-load.sh` re-injects the checkpoint at the next session start while it is fresh (<60 min), so in-flight state survives auto-compaction and abrupt session ends without a single LLM token spent saving it.

---

## run-ledger.sh

**Event:** `PostToolUse` · **Matcher:** `Agent|Task`

Appends every subagent spawn to a daily run ledger. Subagent outputs that only live in a transient chat context become obsolete and hidden; the ledger makes execution history greppable.

1. Exits 0 unless `.neo/` exists and `jq` is present.
2. Extracts the agent name (`tool_input.subagent_type`), the task description (first 120 chars), and the response text (handles string, array-of-blocks, and object payload shapes).
3. Appends to `.neo/runs/YYYY-MM-DD.md`:
   - `## HH:MM:SS <agent> — <description>`
   - the report's `VERDICT:` line when present
   - the first non-empty line of the response (first 200 chars)
4. When the response exceeds 1500 chars, writes the full text to `.neo/runs/YYYY-MM-DD-HHMMSS-<agent>.md` and appends a `full report:` pointer.
5. Exits 0 on every path.

`/neo:recall` greps this ledger alongside the brain and plans.

---

## stop-gate.sh

**Event:** `Stop`

One-shot verification gate: blocks completion when code changed during the session but the second brain was not updated.

1. If `stop_hook_active` is true in the payload, exits 0 immediately — the gate already fired once this stop cycle (no infinite loops).
2. Exits 0 unless inside a git work tree with a `.neo/brain/` directory.
3. `CODE_DIRTY` — `git status --porcelain -- ':(exclude).neo'` counts dirty files outside `.neo/`.
4. `BRAIN_DIRTY` — `git status --porcelain -- .neo/brain` counts dirty brain files.
5. If code is dirty AND the brain is clean, prints to stderr and exits 2. Otherwise exits 0.

**stderr on block:**
```
[neo stop-gate] The repo has uncommitted code changes (this session or earlier) but the second brain was not updated.
Before finishing: spawn neo-shadow with the session delta (what happened, what changed, decisions, lessons, next steps) or run /neo:save.
If there is genuinely nothing worth saving, finish again and this gate will let you through.
```

If there is genuinely nothing worth saving, finishing again lets the session through on the second attempt.

---

## brain-sync.sh

**Event:** `SessionEnd`

Auto-commits `.neo/brain/` at the end of every session so memory survives and travels with the repo.

1. Exits 0 if `.neo/brain/` is absent, `.neo/no-auto-commit` exists (opt-out), the cwd is not a git work tree, or a rebase / merge / cherry-pick is in progress.
2. If `git status --porcelain -- .neo/brain` shows changes: `git add -- .neo/brain` then `git commit --no-verify --quiet -m "neo: brain sync YYYY-MM-DD" -- .neo/brain`.
3. Exits 0 on every path; never fails the session end.

`--no-verify` skips project pre-commit hooks during the automated sync.

---

## brain-gc.sh (helper — not in hooks.json)

Invoked by the `/neo:gc` skill (full report) and `/neo:status` (`--summary`). Deterministic, read-only staleness scan of `.neo/brain/LESSONS.md`.

- Scans bullet lines only. Flags: `DEAD-ANCHOR` (the entry's `(path)` anchor no longer exists on disk), `AGED` (datestamp older than 90 days — override with `NEO_GC_MAX_AGE_DAYS`), `UNDATED` (no `[YYYY-MM-DD]` datestamp).
- Default mode prints `FLAGS | entry` per flagged line plus a summary; `--summary` prints a single line for `/neo:status`.
- Exits 0 on every path; never modifies any file. The curated KEEP / REWRITE / ARCHIVE decisions belong to neo-shadow via `/neo:gc`.

---

## Hook scoping: why every hook stays in `hooks.json`

Claude Code offers two newer ways to narrow a hook. Both were evaluated against this plugin and both are deliberately unused. Read this before moving a hook out of `hooks.json`.

**Hooks in component frontmatter.** A skill or subagent can declare its own `hooks:` block — a subagent's hooks run "only while that subagent is running." Co-locating `jail.sh` in `agents/neo-shadow.md` looks like the natural fit, since the jail only matters while neo-shadow runs. It does not work here: NEO ships its agents inside a plugin, and the Claude Code subagent reference states that "for security reasons, plugin subagents don't support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields. These fields are ignored when loading agents from a plugin." A frontmatter jail would be silently dropped rather than enforced — strictly worse than the current wiring. Plugin hooks declared in `hooks.json` *do* fire inside subagents and receive `agent_type` in the payload, which is exactly what `jail.sh` keys on.

**The `if:` conditional.** A hook handler may carry an `if:` field holding one permission rule (`"Bash(git *)"`, `"Edit(*.ts)"`) so the process only spawns when the tool call matches. Neither of this plugin's tool hooks benefits:

- `jail.sh` discriminates on `agent_type`, which permission-rule syntax cannot express. The reference is also explicit that the filter is advisory — "because the `if` filter is best-effort, use the permission system rather than a hook to enforce a hard allow or deny" — so an `if:` must never carry enforcement weight.
- `format.sh` would need one handler per extension per tool. `if:` holds exactly one rule with no list, `&&`, `||`, or negation syntax, and cannot express the `.neo/` exclusion at all. Nineteen extensions across `Edit|Write|NotebookEdit` is 57 handlers replacing one `case` statement, and the `.neo/` guard would still have to live in the script.

In-script filtering stays the single source of truth for both. Revisit only if `if:` gains negation or an agent-identity predicate.

---

Every hook in this plugin is fail-open. When a hook cannot determine the information it needs (missing `jq`, unrecognized payload shape, absent `agent_type`), it exits 0 and allows the operation. A hook that breaks every write or spawn in a session because of a Claude Code version change is worse than a hook that occasionally misses a violation. Structural tool allowlists and the stop-gate's post-hoc audit provide defense-in-depth.
