# NEO Hooks Reference

All hooks are declared in `hooks/hooks.json` and implemented in `hooks/scripts/`. They are the deterministic enforcement layer of the plugin. Prompts guide; hooks enforce.

Hook processes inherit Claude's current working directory, which follows any `cd` the session issues mid-conversation. Every script resolves the git work tree root via `git rev-parse --show-toplevel` before touching `.neo/`, falling back to `CLAUDE_PROJECT_DIR` if that fails, and exits 0 rather than operate against the wrong directory — without this anchor, a single `cd` mid-session would silently turn the whole memory system off. `jail.sh` does the same from the PreToolUse payload's `cwd` (`git -C "$cwd" rev-parse --show-toplevel`, then `CLAUDE_PROJECT_DIR`, then the raw `cwd`): the payload `cwd` is the session's current directory, not the repo root, so anchoring to it directly would put the jail at `<subdir>/.neo/brain` and block every legitimate brain write.

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
2. Touches `.neo/.session`. This is the session start timestamp `stop-gate.sh` compares mtimes against; see that section for why git state alone cannot answer "did this session save?". It is session state, never committed (`brain-sync.sh`'s pathspec is `.neo/brain` only) and excluded from the checkpoint's file list.
3. Opens the dump with a fence carrying a per-run nonce — `=== BEGIN SECOND BRAIN <nonce> (... untrusted project data ...) ===` — so content written into the brain earlier cannot forge the closing marker and impersonate the harness.
4. Cats, skipping empty files and capping each at 16K: `BRIEF.md`, `ACTIVE.md`, `LESSONS.md`, `INDEX.md` (full), `PROGRESS.md` (last 20 lines).
5. Cats `.neo/CHECKPOINT.md` (also capped at 16K) if it was written within the last 60 minutes — the deterministic snapshot from the previous stop or compaction.
6. Prints a note that `ARCHITECTURE.md` and `DECISIONS.md` load on demand via INDEX pointers; surfaces a hint if `WORKFLOWS.md` has `status: proposed` entries; advertises graphify when present.
7. Closes the fence with the matching nonce.

**Symlinks are skipped, never followed.** Every file above is read only when it is a regular file (`[ -f ]` and not `[ -L ]`). `.neo/brain/` travels with the repo, so a clone can ship `BRIEF.md` as a symlink to `~/.ssh/id_rsa` or anything else the user can read — `[ -s ]` follows it and `head -c` injects the target verbatim into session context at every start. The same guard covers the `CHECKPOINT.md` injection.

**Two caps, not one.** Each file is capped at 16K *and* the dump as a whole at 64K (`MAX_TOTAL`). The per-file cap alone bounds one runaway file; six capped files still buy 96K of context.

**Cost:** zero LLM tokens. Pure shell `cat`. **Trust:** the dump is labeled untrusted project data, not instructions — anything that ever passed through the project (a pasted error, a dependency README, a lesson quoting hostile input) could otherwise land in a brain file and close the fence early with a forged terminator.

---

## jail.sh

**Event:** `PreToolUse` · **Matcher:** `Edit|Write|NotebookEdit`

Enforces write-path restriction for neo-shadow: it may only write under `.neo/brain/**` — not `.neo/CHECKPOINT.md`, `.neo/plans/`, `.neo/runs/`, or `.neo/no-auto-commit`, which are machine-written or user-owned. All other agents and the main thread pass through without inspection.

1. Checks for `jq`. If absent, exits 0 (fail-open).
2. Extracts `agent_type` from the payload. If absent or empty, exits 0 (covers the main thread).
3. Strips any namespace prefix (`neo:neo-shadow` → `neo-shadow`).
4. If the agent is not `neo-shadow`, exits 0.
5. Extracts the target path from `tool_input.file_path` or `tool_input.notebook_path`. Strips a trailing slash from the payload `cwd`.
6. **Anchors the jail to the repo root**, not to the payload `cwd`: `git -C "$cwd" rev-parse --show-toplevel`, falling back to `CLAUDE_PROJECT_DIR`, then the raw `cwd`. Blocks if no root can be determined.
7. Resolves the target to an absolute path. A relative `file_path` with no payload `cwd` cannot be resolved at all, so it blocks — an unresolved path is never waved through.
8. Rejects any path containing `..` segments (traversal prevention).
9. Blocks if `<root>/.neo` or `<root>/.neo/brain` is a symlink. A repo can ship either as a git-tracked link; both the target and the jail then resolve *through the same link* and agree, relocating the whole jail (`.neo/brain` → `$HOME` makes `~/.zshrc` writable from a hostile clone).
10. **The allow decision is physical, not lexical.** Both the target's parent and the jail root are resolved with the same ancestor walk — up to the nearest *existing* directory, `pwd -P` on that, then re-append the components that don't exist yet — and compared as resolved paths. A string prefix compares two *spellings*: on macOS a payload `cwd` of `/tmp` against a file that resolves to `/private/tmp` is the same directory with different names, and a `$CWD/./.neo/brain/...` spelling is not an escape. Both were false-blocked while only the deny layer was physical. If either side fails to resolve, it blocks.
11. Refuses to write through a symlink (`[ -L ]`) — a pre-existing link inside `.neo/brain/` pointing outside it.
12. Refuses to write to a hardlink (link count > 1). `-L` cannot see one, and a hardlinked file inside `.neo/brain/` is the *same inode* as a file outside it, so writing "inside" edits the outside file. Portable across BSD and GNU: `stat -c %h`, else `stat -f %l`, else `ls -ldn`.

**stderr on block:**
```
[neo jail] <agent> may only write under .neo/brain/ — <reason> (attempted: <path>). Write your output there, or report back instead of writing elsewhere.
```

**Fail-open at the gate, fail-closed inside it:** `agent_type` has no formal stability contract in Claude Code (anthropics/claude-code#56168). If the field is absent, `jq` is missing, or the payload shape is unrecognized, the hook allows — steps 1–4. From step 5 on, everything is script-controlled, so an unresolvable root, an unresolvable path, or a relocated jail blocks rather than passes; fail-closed there costs nothing. Structural tool allowlists and the stop-gate audit provide defense-in-depth.

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
2. Reads `hook_event_name` and `last_assistant_message` from the payload (fail-open without `jq`), then **flattens newlines out of `last_assistant_message`** the way `run-ledger.sh`'s `oneline()` does. The field is model-controlled: a newline in it ends the checkpoint line, and everything after it is read back next session as machine-written git fact — a model could forge its own `- branch:` and `- head:` entries.
3. **Throttle:** on `Stop`, skips if `.neo/CHECKPOINT.md` was written in the last 10 minutes. `PreCompact` always writes.
4. Writes `.neo/CHECKPOINT.md` (newest wins, safe to delete):
   - when / event / branch / HEAD. On a detached HEAD `git branch --show-current` prints nothing and exits 0, so a `|| echo '?'` fallback never fires; the branch is checked for emptiness and written as `?`.
   - `## Uncommitted files` — `git status --short -- ':(exclude).neo/.session'` (first 100 lines); the session marker is state, not a change worth reporting
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

1. Reads `stop_hook_active` from the payload. With `jq` present, straightforward. Without it, matches `"stop_hook_active"` followed by optional whitespace then `true` — Claude Code pretty-prints hook payloads, so a fixed-spacing glob never matches. If true, exits 0 immediately — the gate already fired once this stop cycle (no infinite loops).
2. Exits 0 unless inside a git work tree with a `.neo/brain/` directory.
3. Exits 0 when `git check-ignore -q .neo` succeeds. With `.neo/` gitignored — a supported setup — git reports nothing for brain paths, so there is no honest way to tell a saved brain from an unsaved one. No signal, no gate.
4. Exits 0 unless `.neo/.session` exists. That marker is written by `brain-load.sh` at `SessionStart`; without it there is no session to measure against.
5. Blocks (stderr + exit 2) only when **both** hold:
   - some dirty file outside `.neo/` (`git status --porcelain -z -- ':(exclude).neo'`) has an mtime **newer than the marker**, and
   - **no** file under `.neo/brain/` is newer than the marker.

**Why mtimes and not git state.** Git cannot answer "did *this* session save?".

- Counting dirty files alone charges a read-only session for dirt that predates it.
- "The brain is in the last commit" — the rule this replaces — is permanently true from session 2 onward, because `brain-sync.sh` commits `.neo/brain/` at every `SessionEnd` and `SessionEnd` runs last, so HEAD is a brain-only commit at the start of every subsequent session. The gate silently retired itself.

The marker is a timestamp, so both questions become "newer than session start?".

**stderr on block:**
```
[neo stop-gate] Code changed during this session but the second brain was not updated.
Before finishing: spawn neo-shadow with the session delta (what happened, what changed, decisions, lessons, next steps) or run /neo:save.
If there is genuinely nothing worth saving, finish again and this gate will let you through.
```

If there is genuinely nothing worth saving, finishing again lets the session through on the second attempt.

**Known gap:** a dirty file that was *deleted* has no mtime to compare and does not count as session work. Fail-open, consistent with the gate's advisory contract.

---

## brain-sync.sh

**Event:** `SessionEnd`

Auto-commits `.neo/brain/` at the end of every session so memory survives and travels with the repo.

1. Exits 0 if `.neo/brain/` is absent, `.neo/no-auto-commit` exists (opt-out), or the cwd is not inside a git work tree.
2. Exits 0 on detached HEAD (no `git symbolic-ref`) — there's no branch to land a commit on reachably; the next checkout would wipe it.
3. Exits 0 while a rebase, merge, cherry-pick, revert, or bisect is in progress (checks `rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, and `BISECT_LOG` in the git dir).
4. If `git status --porcelain -- .neo/brain` shows changes: records the user's existing index entries with `git ls-files -s -z -- .neo/brain` (mode, blob id, stage, path — NUL-delimited, written to a file under the git dir since NULs cannot survive a command substitution), stages `.neo/brain`, then commits with `git commit --no-verify --quiet -m "neo: brain sync YYYY-MM-DD" -- .neo/brain`.
5. If that commit fails (e.g. a broken signing key), resets `.neo/brain` out of the index and replays the recorded entries through `git update-index -z --index-info`, then removes the temp listing.

   **The restore is content-exact.** Re-adding by *path* would stage whatever the worktree holds at that moment, which is a different version of the file: stage `DECISIONS.md` as A, keep editing to B, hit a signing failure, and the user's deliberately staged A is gone with no diagnostic. Replaying blob ids restores the exact objects. *Known gap:* a brain path staged for **deletion** is restored from HEAD rather than left deleted.
6. Exits 0 on every path; never fails the session end.

With `.neo/` gitignored, step 4 never sees changes and the sync no-ops silently — supported, not a failure.

`--no-verify` is deliberate: pre-commit hooks, including secret scanners, must not be able to fail session end. The brain is markdown the user can inspect and amend after the fact.

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
