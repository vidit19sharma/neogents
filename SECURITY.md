# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

Older versions are not supported. If you're on a pre-release build, update to the latest `0.1.x` tag before reporting.

---

## Threat model

NEO is a Claude Code plugin. It ships lifecycle hooks that execute shell scripts inside your Claude Code session. Those scripts run with your full user permissions, in your working directory, with access to everything your shell account can reach.

This is the same trust model as any other Claude Code plugin or hook. You should treat installing this plugin the same way you'd treat running a shell script from a third-party repo: read it first, understand what it does, and only install it if you trust the source.

### Brain file content is untrusted input

`.neo/brain/` travels with the repo, so a cloned or forked project can ship brain files crafted to be malicious — a lesson quoting a prompt-injection payload, a pasted error message carrying hostile instructions, anything that ever passed through the project and made it into a saved entry. `brain-load.sh` cats these files straight into session context at every start.

The load fences the dump with a per-run nonce and labels it explicitly as untrusted project data, not instructions, so brain content can't forge the closing marker and speak as the harness — but the fence limits impersonation, it doesn't make the content trustworthy. Treat `.neo/brain/` the way you'd treat a cloned repo's `CLAUDE.md`: read what it ships before you trust the session that loads it.

A repo can also ship *links* rather than content. `brain-load.sh` reads a brain file only when it is a regular file and not a symlink — a clone shipping `.neo/brain/BRIEF.md` as a symlink to `~/.ssh/id_rsa` would otherwise have its target read and injected into session context at every session start. `jail.sh` refuses symmetrically on the write side: it will not write through a symlink or a hardlink, and it blocks outright if `.neo` or `.neo/brain` is itself a symlink, which would relocate the entire jail somewhere the agent was never meant to reach.

### What the hook scripts deliberately do

- `brain-load.sh` reads regular files under `.neo/brain/` (never symlinks) and prints them to stdout (injected into session context). It touches `.neo/.session` as a session start marker; no other writes, no network.
- `jail.sh` reads the PreToolUse payload from stdin and either exits 0 (allow) or exits 2 (block). No writes, no network.
- `format.sh` runs project-local formatters on the just-edited file. It uses binaries already present in your project (`node_modules/.bin/prettier`, `ruff`, `black`, `gofmt`, `rustfmt`). It never installs anything.
- `run-ledger.sh` appends subagent spawn records to `.neo/runs/`. Writes only under `.neo/runs/`, no network.
- `checkpoint.sh` writes a snapshot of git state to `.neo/CHECKPOINT.md`. Writes only that file, no network.
- `stop-gate.sh` reads `git status` output and either exits 0 or exits 2. No writes, no network.
- `brain-sync.sh` runs `git add` and `git commit` on `.neo/brain/` only. No network calls, no pushes.

### What the scripts deliberately do not do

- No network calls of any kind.
- No writes outside the repo directory and `.neo/` (`brain-sync.sh` commits `.neo/brain/`; `run-ledger.sh` and `checkpoint.sh` write under `.neo/`).
- No installs of any software.
- No reads of files outside the repository. `brain-load.sh` skips symlinked brain files rather than following them out of the tree.
- No credential access, no environment variable exfiltration.

The plugin is fail-open by design: when a hook can't determine what it needs, it exits 0 and allows the operation rather than blocking. This is a deliberate tradeoff documented in `docs/architecture.md`.

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
