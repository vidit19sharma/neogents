# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

Older versions are not supported. If you're on a pre-release build, update to the latest `0.1.x` tag before reporting.

---

## Threat model

NEO supports Claude Code and OpenCode. Its Claude Code lifecycle hooks execute shell scripts inside your Claude Code session. Those scripts run with your full user permissions, in your working directory, with access to everything your shell account can reach.

This is the same trust model as any other Claude Code plugin or hook. You should treat installing this plugin the same way you'd treat running a shell script from a third-party repo: read it first, understand what it does, and only install it if you trust the source.

### Brain file content is untrusted input

`.neo/brain/` travels with the repo, so a cloned or forked project can ship brain files crafted to be malicious — a lesson quoting a prompt-injection payload, a pasted error message carrying hostile instructions, anything that ever passed through the project and made it into a saved entry. `brain-load.sh` cats these files straight into session context at every start.

The load fences the dump with a per-run nonce and labels it explicitly as untrusted project data, not instructions, so brain content can't forge the closing marker and speak as the harness — but the fence limits impersonation, it doesn't make the content trustworthy. Treat `.neo/brain/` the way you'd treat a cloned repo's `CLAUDE.md`: read what it ships before you trust the session that loads it.

A repo can also ship *links* rather than content. `brain-load.sh` reads a brain file only when it is a regular file and not a symlink — a clone shipping `.neo/brain/BRIEF.md` as a symlink to `~/.ssh/id_rsa` would otherwise have its target read and injected into session context at every session start. `jail.sh` refuses symmetrically on the write side: it will not write through a symlink or a hardlink, and it blocks outright if `.neo` or `.neo/brain` is itself a symlink, which would relocate the entire jail somewhere the agent was never meant to reach.

### Skills installed by `/neo:equip` are untrusted input

`/neo:equip` fetches third-party skill files from the web. A skill is a prompt that runs with your session's tools, so installing one carries the same risk as running a third-party script. The command never runs on its own: its frontmatter sets `disable-model-invocation: true`, so only you can start it by typing `/neo:equip`, and NEO is instructed to point you there instead of installing skills any other way.

You pick from a shortlist of at most three candidates (no pick, no fetch), and your pick is fetched at a pinned commit SHA, not a branch. smith audits the fetched file before anything is written, covering prompt injection, exfiltration, fetch-and-execute, and permission grabs in frontmatter (`allowed-tools`, `hooks`, `mcpServers`), and flags any companion hooks, MCP configs, or executables to you. A BLOCK verdict stops the install. On APPROVE, you see the exact target path and the full content, and NEO writes nothing without your yes. Only `.claude/skills/<name>/SKILL.md` is written: no companion files, submodules, or symlinks. The install is recorded in the brain's `DECISIONS.md` with the source repo and SHA, and updating means re-running `/neo:equip`.

smith's audit is a best-effort LLM review. A skill is itself a prompt, and adversarial text can target the reviewer too, so the audit lowers risk but guarantees nothing. The controls that carry the weight are your read-before-write approval, the SHA pin (the content can't change after review), and, once you commit it, the vendored copy in git: every installed skill is then diff-reviewable and shows up for teammates in PRs. Read the full skill before you approve it, as you would any third-party script.

### The npm package and OpenCode plugin

`npx @vidit19sharma/neogents setup` runs code from the npm registry and rewrites `~/.config/opencode/opencode.json` (or `$XDG_CONFIG_HOME/opencode/opencode.json` for a non-empty, absolute `XDG_CONFIG_HOME`).
It merges `plugin` and sets `default_agent` only if unset, writes atomically, and never touches `.jsonc`; an already-configured JSON is not rewritten.
`init` writes only inside the project (`.neo/`, plus missing instruction files) and refuses symlinked `.neo`, `.neo/brain`, `.neo/.gitignore`, `AGENTS.md`, and `CLAUDE.md` paths.
It never writes instruction files when only `CLAUDE.md` exists; it prints a migration hint instead.
The zero-dependency OpenCode plugin runs in-process in OpenCode and shells out to the same hook scripts, with the same trust model as the Claude Code hooks.
Its neo-shadow jail uses OpenCode permission default-deny for unlisted tools plus the `.neo/brain/**` edit glob and `jail.sh` physical-path checks, and its `read` tool is denied `*.env`/`*.env.*` (except `*.env.example`); `grep` can still match their contents, as with Claude Code's Grep; see the [adapter guide](adapters/opencode/README.md) for enforcement details and limitations.
Publishing is tag-triggered with npm provenance ([publish.yml](.github/workflows/publish.yml)).

### What the hook scripts deliberately do

- `brain-load.sh` reads regular files under `.neo/brain/` (never symlinks) and prints them to stdout (injected into session context). It touches `.neo/.session` as a session start marker; no other writes, no network.
- `jail.sh` reads the PreToolUse payload from stdin and either exits 0 (allow) or exits 2 (block). No writes, no network.
- `format.sh` formats the just-edited file. `prettier` runs only when the project ships a prettier config, resolved from `node_modules/.bin`; `ruff`/`black`/`gofmt`/`rustfmt` resolve from `PATH` and also require project config opt-in. It never installs anything.
- `run-ledger.sh` appends subagent spawn records to `.neo/runs/`. Writes only under `.neo/runs/`, no network.
- `checkpoint.sh` writes a snapshot of git state to `.neo/CHECKPOINT.md`. Writes only that file, no network.
- `stop-gate.sh` reads `git status` output and either exits 0 or exits 2. No writes, no network.
- `brain-sync.sh` runs `git add` and `git commit` on `.neo/brain/` only. No network calls, no pushes.

### What the hook scripts deliberately do not do

- No network calls of any kind.
- No writes outside the repo directory and `.neo/` (`brain-sync.sh` commits `.neo/brain/`; `run-ledger.sh` and `checkpoint.sh` write under `.neo/`).
- No installs of any software.
- No reads of files outside the repository. `brain-load.sh` skips symlinked brain files rather than following them out of the tree.
- No credential access, no environment variable exfiltration.

The hook scripts are fail-open by design: when a hook can't determine what it needs, it exits 0 and allows the operation rather than blocking. This is a deliberate tradeoff documented in `docs/architecture.md`.

---

## The `agent_type` stability caveat

`jail.sh` relies on the `agent_type` field in Claude Code's PreToolUse hook payload to identify which agent is making a write request. This field has no formal stability contract in Claude Code (tracked at [anthropics/claude-code#56168](https://github.com/anthropics/claude-code/issues/56168)).

The enforcement hooks are advisory-grade, not a sandbox. They are defense-in-depth on top of the structural controls (leaf agents have no `Agent` tool in their frontmatter; neo-shadow has no `Bash` tool). If `agent_type` is absent from the payload or arrives in an unrecognized format, the hooks fail open and allow the operation.

This means `jail.sh` cannot guarantee that neo-shadow will never write outside `.neo/brain/` if the payload shape changes in a future Claude Code version.

Once the payload *does* identify neo-shadow, the rest of the check fails closed rather than open: the jail is anchored to the git work tree root (not the session's current directory, which follows `cd`), the allow decision compares physically resolved paths rather than string prefixes, and an unresolvable root, an unresolvable path, a symlinked `.neo`/`.neo/brain`, a symlinked target, or a hardlinked target all block.

The structural tool allowlists in agent frontmatter are the primary control. The hooks are a second layer, not the first.

---

## Known limits

**`jail.sh` is defense-in-depth, not a security boundary.**

A sufficiently adversarial prompt could instruct the main thread (which is not jailed) to write to any path the user has permission to write to. The main thread has full tool access by design; NEO is the session agent and needs it to do its job. The jail only constrains neo-shadow from writing outside `.neo/brain/`.

If you're running NEO in a context where you're processing untrusted input (e.g., automated pipelines that feed external content into the session), be aware that the main thread is not constrained by the jail hooks.

**The stop-gate is one-shot and advisory.**

`stop-gate.sh` blocks session completion once when it detects that code changed *during this session* (mtime newer than the `.neo/.session` marker written at session start) but no brain file did. On the second stop attempt, it lets through unconditionally. It stands down entirely when `.neo/` is gitignored, since there is then no signal to judge. It's a reminder mechanism, not a hard wall.

**Brain sync commits with `--no-verify`.**

`brain-sync.sh` uses `git commit --no-verify` to skip pre-commit hooks during the automated brain sync. This is intentional (to avoid side effects from project-level git hooks), but it means your project's pre-commit checks don't run on brain commits.

---

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository:

1. Go to [github.com/vidit19sharma/neogents](https://github.com/vidit19sharma/neogents).
2. Click the **Security** tab.
3. Click **Report a vulnerability**.

Do not open a public issue for security reports. Public issues are for bugs and feature requests.

**What to include:**

- A description of the vulnerability and what an attacker could do with it.
- Steps to reproduce, as specific as possible.
- The Claude Code version and OS you observed it on.
- Whether you have a suggested fix.

**Response expectation:** This is a solo-maintained project. I'll acknowledge the report as quickly as I can and aim to respond with an assessment within a week. Fix timelines depend on severity and complexity. I won't promise SLAs I can't keep.

If the vulnerability is in Claude Code itself rather than in this plugin's scripts, please report it to Anthropic directly.
