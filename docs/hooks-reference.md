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
| `SessionStart` | (all) | `brain-load.sh` | Cats brain files into context. Hints `/neo:init` if no brain. Advertises graphify if present. |
| `PreToolUse` | `Edit\|Write\|NotebookEdit` | `jail.sh` | Hard blocks out-of-jail writes for neo-shadow and architect. |
| `PreToolUse` | `Agent\|Task` | `spawn-guard.sh` | Blocks spawns of agents not in the NEO roster. |
| `PostToolUse` | `Edit\|Write\|NotebookEdit` | `format.sh` | Formats the just-edited file with project-local formatters. Fail-open. |
| `PostToolUse` | `Agent\|Task` | `run-ledger.sh` | Appends every subagent spawn to a daily run ledger in `.neo/runs/`. |
| `PreCompact` | (all) | `checkpoint.sh` | Deterministic snapshot of git state + last assistant message to `.neo/CHECKPOINT.md`. |
| `Stop` | (all) | `checkpoint.sh`, then `stop-gate.sh` | Snapshot (throttled to one per 10 min), then a one-shot block when code changed but brain was not updated. |
| `SessionEnd` | (all) | `brain-sync.sh` | Auto-commits `.neo/brain/` to git. |

---

## brain-load.sh

**Event:** `SessionStart`
**Script:** `hooks/scripts/brain-load.sh`

Runs at the start of every session. stdout from a `SessionStart` hook is injected into the session context before the first user message.

**Behavior:**

1. Checks for `.neo/brain/`. If absent, prints one line: `[neo] No second brain in this project. Run /neo:init to create one.` Then exits 0.
2. If the brain exists, cats the following files in order (skipping any that are empty):
   - `BRIEF.md` (full)
   - `ACTIVE.md` (full)
   - `LESSONS.md` (full)
   - `INDEX.md` (full)
   - `PROGRESS.md` (last 20 lines via `tail -n 20`)
3. Prints a note that `ARCHITECTURE.md` and `DECISIONS.md` live in the brain directory and should be consulted via INDEX pointers.
4. If `.neo/CHECKPOINT.md` exists and is fresh (written in the last 60 minutes), cats it under a `CHECKPOINT.md (deterministic snapshot from last session)` header — so in-flight state written by `checkpoint.sh` survives compaction and abrupt session ends.
5. If `graphify` is on PATH and `graph.json` exists in the project root, prints: `[neo] graphify detected with graph.json — prefer 'graphify query/path/explain' over broad grep for cross-file questions.`
6. Exits 0.

**Cost:** zero LLM tokens. Pure shell `cat`.

---

## jail.sh

**Event:** `PreToolUse`
**Matcher:** `Edit|Write|NotebookEdit`
**Script:** `hooks/scripts/jail.sh`

Enforces write path restrictions for neo-shadow and architect. All other agents and the main thread pass through without inspection.

**Jail policy:**

| Agent | Allowed write paths |
|---|---|
| `neo-shadow` | `.neo/**` |
| `architect` | `.neo/plans/**` |
| all others | unrestricted |

**Behavior:**

1. Checks for `jq`. If absent, exits 0 (fail-open).
2. Reads the PreToolUse payload from stdin.
3. Extracts `agent_type`. If absent or empty, exits 0 (fail-open). This covers the main thread and any agent whose type cannot be determined.
4. Strips any namespace prefix from `agent_type` (e.g., `neo:neo-shadow` becomes `neo-shadow`). Claude Code has delivered both forms across versions.
5. If the agent is not `neo-shadow` or `architect`, exits 0.
6. Extracts the target file path from `tool_input.file_path` or `tool_input.notebook_path`.
7. Normalizes the path to be relative to the session `cwd`.
8. Rejects any path containing `..` segments before the prefix check (traversal prevention).
9. Checks the normalized path against the agent's allowed prefix. If it doesn't match, prints to stderr and exits 2.
10. **Symlink hardening:** even when the prefix matches, refuses to write through a symlink (`-L` check on the target), and — when the parent directory resolves — verifies the physical path (`pwd -P`) still lands inside `.neo/`. A pre-existing symlink under `.neo/` pointing outside the repo can no longer smuggle a write out of the jail. Both checks fail open if the paths cannot be resolved.

**stderr on block:**
```
[neo jail] <agent> may only write under <jail> (attempted: <path>). Write your output there, or report back instead of writing elsewhere.
```

**Fail-open rationale:**

`agent_type` in the PreToolUse payload has no formal stability contract in Claude Code (tracked at anthropics/claude-code#56168). The hook is fail-open by design: if the field is absent, `jq` is missing, or the payload shape is unrecognized, the hook exits 0 and allows the write. The structural tool allowlists (agents without `Write`/`Edit` in their frontmatter) and the stop-gate's `git status` audit provide defense-in-depth when the jail cannot identify the agent.

---

## spawn-guard.sh

**Event:** `PreToolUse`
**Matcher:** `Agent|Task`
**Script:** `hooks/scripts/spawn-guard.sh`

Blocks spawns of agents not in the NEO roster. Defense-in-depth: the primary guarantee is structural (leaf agents have no `Agent` tool in their frontmatter and cannot spawn). This guard catches roster drift from the main thread.

**Allowed agents:**
`neo-shadow`, `keymaker`, `tank`, `architect`, `trinity`, `mouse`, `smith`, `switch`, `oracle`, `morpheus`

**Behavior:**

1. Checks for `jq`. If absent, exits 0 (fail-open).
2. Reads the payload from stdin. If empty, exits 0.
3. Extracts the agent name from `tool_input.subagent_type` or `tool_input.agent_type` (both field names have appeared across Claude Code versions).
4. If the name is in the allowed list, exits 0.
5. Otherwise, prints to stderr and exits 2.

**stderr on block:**
```
[neo spawn-guard] '<agent>' is not in the NEO roster. Spawnable: neo-shadow, keymaker, tank, architect, trinity, mouse, smith, switch, oracle, morpheus.
```

**Fail-open:** unrecognized payload shapes exit 0.

---

## format.sh

**Event:** `PostToolUse`
**Matcher:** `Edit|Write|NotebookEdit`
**Script:** `hooks/scripts/format.sh`

Runs immediately after any file edit. Formats the just-written file using project-local formatters only. Never installs anything.

**Behavior:**

1. Checks for `jq`. If absent, exits 0 (fail-open).
2. Reads the PostToolUse payload from stdin. Extracts the file path from `tool_input.file_path` or `tool_input.notebook_path`.
3. If the file path is absent or the file does not exist, exits 0.
4. Skips any file under `.neo/` — brain and plan layout is content, not code.
5. Dispatches by extension:
   - `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.json`, `.css`, `.scss`, `.html`, `.yaml`, `.yml`, `.md`: runs `node_modules/.bin/prettier --write --ignore-unknown` if the project-local binary exists. Never uses a global prettier install.
   - `.py`: runs `ruff format` if ruff is on PATH, else `black --quiet` if black is on PATH.
   - `.go`: runs `gofmt -w` if gofmt is on PATH.
   - `.rs`: runs `rustfmt --edition 2021` if rustfmt is on PATH.
6. Exits 0 on every path. All formatter output is suppressed.

**Fail-open by design:** this hook must never break an edit. Every code path exits 0. If a formatter is absent, the file is left as-is. If a formatter fails, the exit code is ignored.

**Cost:** zero LLM tokens. Pure shell dispatch.

---

## run-ledger.sh

**Event:** `PostToolUse`
**Matcher:** `Agent|Task`
**Script:** `hooks/scripts/run-ledger.sh`

Appends every subagent spawn to a daily run ledger. Subagent outputs that only live in a transient chat context become obsolete and hidden; the ledger makes execution history greppable across sessions.

**Behavior:**

1. Exits 0 unless `.neo/` exists and `jq` is present.
2. Extracts the agent name (`tool_input.subagent_type`), the task description (first 120 chars), and the response text (handles string, array-of-blocks, and object payload shapes).
3. Appends to `.neo/runs/YYYY-MM-DD.md`:
   - `## HH:MM:SS <agent> — <description>`
   - the report's `VERDICT:` line when present
   - the first non-empty line of the response (first 200 chars)
4. When the response exceeds 1500 chars, writes the full text to `.neo/runs/YYYY-MM-DD-HHMMSS-<agent>-<pid>.md` and appends a `full report:` pointer. The pid suffix keeps same-second parallel spawns from clobbering each other.
5. Exits 0 on every path.

`/neo:recall` greps this ledger alongside the brain and plans.

**Cost:** zero LLM tokens. Pure shell append.

---

## checkpoint.sh

**Event:** `Stop` and `PreCompact`
**Script:** `hooks/scripts/checkpoint.sh`

Deterministic session snapshot. Replaces the old advisory "save the brain now" reminder (`save-brain.sh`) — a script's job is done by a script, not by asking an LLM to remember. PreCompact cannot pause compaction, so an advisory fired there was always too late; a deterministic write is not.

**Behavior:**

1. Exits 0 unless `.neo/` exists and the cwd is a git work tree.
2. Reads `hook_event_name` and `last_assistant_message` from the payload (fail-open without `jq`).
3. **Throttle:** on `Stop`, skips if `.neo/CHECKPOINT.md` was written in the last 10 minutes. `PreCompact` always writes.
4. Writes `.neo/CHECKPOINT.md` atomically (newest wins, safe to delete):
   - when / event / branch / HEAD
   - `## Uncommitted files` — `git status --short` (first 100 lines)
   - `## Diff stat (vs HEAD)` — `git diff HEAD --stat` (last 40 lines)
   - `## Last assistant message` — first 4000 chars, when present
5. Exits 0 on every path.

`brain-load.sh` re-injects the checkpoint at the next session start while it is fresh (<60 min), so in-flight state survives auto-compaction and abrupt session ends without a single LLM token spent saving it.

**Cost:** zero LLM tokens. Pure shell.

---

## stop-gate.sh

**Event:** `Stop`
**Script:** `hooks/scripts/stop-gate.sh`

One-shot verification gate. Blocks session completion when code changed during the session but the second brain was not updated.

**Behavior:**

1. Reads the Stop payload from stdin.
2. Checks `stop_hook_active` in the payload. If true, exits 0 immediately. This is the one-shot mechanism: the gate already fired once this stop cycle; allow through to prevent infinite loops.
3. If `.neo/brain/` does not exist, exits 0.
4. If not inside a git work tree, exits 0.
5. Counts dirty files outside `.neo/` using `git status --porcelain`, filtering out `.neo/` paths.
6. Counts dirty files inside `.neo/brain/` using `git status --porcelain -- .neo/brain`.
7. If code is dirty AND the brain is clean (code changed but brain was not updated), prints to stderr and exits 2.
8. Otherwise exits 0.

**stderr on block:**
```
[neo stop-gate] Code changed this session but the second brain was not updated.
Before finishing: spawn neo-shadow with the session delta (what happened, what changed, decisions, lessons, next steps) or run /neo:save.
If there is genuinely nothing worth saving, finish again and this gate will let you through.
```

**One-shot mechanism:**

The `stop_hook_active` field in the Stop payload is set to `true` when the hook already blocked once in the current stop cycle. The gate checks this field first and exits 0 if it's true. This guarantees the gate fires at most once per stop attempt: block once with specifics, then let through. No infinite loops, no hard walls.

**Conditions for the gate to fire:**

- Inside a git repo
- `.neo/brain/` exists
- At least one file outside `.neo/` is dirty (staged or unstaged)
- No files inside `.neo/brain/` are dirty

If the user genuinely has nothing worth saving, they finish again and the gate lets them through on the second attempt.

---

## brain-sync.sh

**Event:** `SessionEnd`
**Script:** `hooks/scripts/brain-sync.sh`

Auto-commits `.neo/brain/` at the end of every session so memory survives and travels with the repo.

**Behavior:**

1. If `.neo/brain/` does not exist, exits 0.
2. If `.neo/no-auto-commit` exists, exits 0 (opt-out).
3. If not inside a git work tree, exits 0.
4. Checks for in-progress git operations (rebase-merge, rebase-apply, MERGE_HEAD, CHERRY_PICK_HEAD). If any are active, exits 0 to avoid touching the index mid-operation.
5. Checks `git status --porcelain -- .neo/brain` for any changes (tracked or untracked).
6. If changes exist: `git add -- .neo/brain` then `git commit --no-verify --quiet -m "neo: brain sync YYYY-MM-DD" -- .neo/brain`.
7. Exits 0 on every path. This hook must never fail the session end.

**Opt-out:** create `.neo/no-auto-commit` in your project root. The file's content is ignored; its presence is the signal.

**Commit message format:** `neo: brain sync YYYY-MM-DD`

The `--no-verify` flag skips pre-commit hooks to avoid side effects from project-level git hooks during an automated brain sync.

---

## brain-gc.sh (helper — not in hooks.json)

Invoked by the `/neo:gc` skill (full report) and `/neo:status` (`--summary`). Deterministic, read-only staleness scan of `.neo/brain/LESSONS.md`.

- Scans bullet lines only. Flags: `DEAD-ANCHOR` (the entry's `(path)` anchor no longer exists on disk), `AGED` (datestamp older than 90 days — override with `NEO_GC_MAX_AGE_DAYS`), `UNDATED` (no `[YYYY-MM-DD]` datestamp).
- Default mode prints `FLAGS | entry` per flagged line plus a summary; `--summary` prints a single line for `/neo:status`.
- Exits 0 on every path; never modifies any file. The curated KEEP / REWRITE / ARCHIVE decisions belong to neo-shadow via `/neo:gc`.

---

## Fail-open Policy

Every hook in this plugin is fail-open. When a hook cannot determine the information it needs (missing `jq`, unrecognized payload shape, absent `agent_type`), it exits 0 and allows the operation.

The rationale: a hook that breaks every write or every spawn in a session because of a Claude Code version change is worse than a hook that occasionally misses a jail violation. The structural controls (tool allowlists in agent frontmatter) and the stop-gate's post-hoc audit of `git status` provide defense-in-depth for the cases where the hooks cannot act.
