# NEO Second Brain — Contract

The second brain is a set of eight markdown files in `.neo/brain/`. Together they give every session a complete picture of the project without any LLM cost at load time. This document defines what each file is for, who writes it, when, and how the system loads and saves it.

See also: [customization.md](customization.md) for tuning caps and sync behavior, [portability.md](portability.md) for the multi-harness roadmap.

---

## The Eight Files

| File | Purpose | Update cadence |
|---|---|---|
| `INDEX.md` | Map of all brain content. `[[wiki-links]]` to every file and section. | When structure changes (new file, section added or moved). |
| `BRIEF.md` | Scope, goals, constraints, non-goals. The "what and why" of the project. | Pivots only. If you're editing this often, the content belongs in `ACTIVE.md`. |
| `ARCHITECTURE.md` | System patterns, module relationships, stack, gotchas. | When patterns change. Audit at 500 lines (see below). |
| `ACTIVE.md` | Current focus, next steps, open questions, session notes. | **Every save.** Full rewrite each time. Hard cap: 150 lines. |
| `PROGRESS.md` | Append-only ledger of what shipped, dated. | As work completes. Never edit old entries. |
| `DECISIONS.md` | Significant choices with rationale and rejected alternatives. | When a decision is made that will still matter in a month. |
| `LESSONS.md` | Anti-patterns learned the hard way. Always loaded; every line pays rent. | When a mistake teaches something reusable. |
| `WORKFLOWS.md` | Ledger of recurring multi-step workflows. Entries progress through `candidate` → `proposed` → `skilled`. Written by neo-shadow at save time; promoted to project skills by `/neo:train` after user approval. | When a multi-step sequence recurs across sessions. |

---

## File Rules in Detail

### ACTIVE.md — 150-line cap, full rewrite

`ACTIVE.md` is the next session's first breath. It must answer "where was I and what's next" in 30 seconds.

- neo-shadow **rewrites it completely** on every save. It never accumulates history.
- Hard cap: **150 lines**. When the rewrite would exceed that, finished work migrates to `PROGRESS.md` and open questions move to `DECISIONS.md` or get dropped if resolved.
- Sections: Focus (2-3 items max), Next (ordered queue), Open questions, Session notes.

### PROGRESS.md — append-only, newest first

- New entries go at the **top**, under a `## YYYY-MM-DD` heading.
- **Never edit or delete old entries.** This file is the project's memory of what actually happened.
- Session loads read only the most recent entries (tail-20 via `brain-load.sh`). Age is harmless.
- Entry format: terse past-tense bullets. "Added JWT refresh rotation (`src/auth/refresh.ts`); all 14 auth tests green." Not "improved the auth flow."

### ARCHITECTURE.md — audit at 500 lines

- Updated only when system patterns change, not per session.
- When the file passes 500 lines, neo-shadow audits it: extract topic pages to `.neo/brain/topics/<name>.md` and link them from `INDEX.md`. The main file stays navigable.

### LESSONS.md — every line pays rent

- Entry format: `- [YYYY-MM-DD] imperative + reason. (anchor)` — e.g. `- [2026-07-20] Never mock the auth client in integration tests — hides token-refresh bugs. (src/auth/client.ts)`.
  - The **datestamp** is when the lesson was learned or last confirmed true.
  - The **anchor** is an optional trailing `(path)` pointing at the file or config the lesson is about. Project-general lessons ("always run tests before pushing") don't need one.
- Loaded at every session start. A stale lesson that no longer applies wastes context on every session — worse, it can steer the model wrong.
- **Supersession on write:** when a new lesson covers the same subject or anchor as an existing one, neo-shadow **replaces** the old line (new text, today's date) instead of appending a near-duplicate. Contradictory lessons must not coexist.
- **Staleness is detected, not guessed:** `brain-gc.sh` deterministically flags dead anchors, entries older than the age threshold (default 90 days), and undated entries. `/neo:gc` then has neo-shadow review only the flagged entries against the current codebase. Retired lessons move to `.neo/brain/archive/LESSONS.md` — never silently deleted.

### DECISIONS.md — on demand, not always loaded

- Bar for entry: will this still matter in a month? One-off picks don't belong here.
- Loaded on demand via `INDEX.md` pointers, not at session start.
- Entry format: decision, rationale, alternatives considered and why each lost, optional revisit condition.

### BRIEF.md — pivots only

- If you're editing `BRIEF.md` more than once a month, the content belongs in `ACTIVE.md` or `ARCHITECTURE.md`.
- neo-shadow confirms a pivot is real before touching it.

### INDEX.md — pointers, never copies

- Every brain file and significant section gets a `[[wiki-link]]` entry with one line describing what lives there.
- Facts live in exactly one file. `INDEX.md` points to them; it never summarizes or copies them.
- The `topics/` subdirectory is the graph-export escape hatch: when a subject outgrows its section in `ARCHITECTURE.md` or `DECISIONS.md`, neo-shadow extracts it to `.neo/brain/topics/<name>.md` and links it from `INDEX.md`. This structure is compatible with graph tools that consume `[[wiki-links]]` (e.g., Obsidian, graphify) without depending on any of them.

### WORKFLOWS.md — workflow harvesting ledger

- Written by neo-shadow at save time when the session delta contains a recurring multi-step sequence.
- Entry format: `## candidate: <kebab-name>` with `steps`, `trigger`, `seen` count, and `status`.
- **Status lifecycle:** `candidate` (below 3 sightings) → `proposed` (3+ sightings; neo-shadow flags it in its report) → `skilled` (promoted to `.claude/skills/<name>/` via `/neo:train`).
- neo-shadow never marks an entry `skilled` itself. Only `/neo:train` does that, after the user approves the drafted skill.
- A user request to train a specific workflow overrides the 3-sighting threshold.
- Loaded on demand (not at session start), but `brain-load.sh` surfaces a one-line hint when `proposed` entries exist.

---

## Load Path (Zero LLM Cost)

`brain-load.sh` runs at `SessionStart`. It `cat`s files directly into context — no LLM call, no summarization, no cost.

**What loads automatically:**

```
BRIEF.md        (full)
ACTIVE.md       (full)
LESSONS.md      (full)
INDEX.md        (full)
PROGRESS.md     (tail -n 20 only)
```

**What loads on demand:**

```
ARCHITECTURE.md   — read when patterns are relevant; INDEX tells you what's there
DECISIONS.md      — read when a past decision is relevant; INDEX tells you what's there
WORKFLOWS.md      — read when reviewing workflow candidates or running /neo:train
```

The session context includes a note: "ARCHITECTURE.md, DECISIONS.md, and WORKFLOWS.md live in `.neo/brain/` — consult INDEX above for what they hold." NEO reads them when needed; it doesn't load them speculatively.

**Proposed-workflow hint:** if `WORKFLOWS.md` contains any entry with `status: proposed`, `brain-load.sh` surfaces a one-line hint at session start: `[neo] WORKFLOWS.md has proposed entries — recurring workflows ready for /neo:train.` NEO offers `/neo:train` once when it sees this; it never creates the skill without user approval.

**If `.neo/brain/` doesn't exist**, `brain-load.sh` prints one quiet hint: "No second brain in this project. Run `/neo:init` to create one." Then exits cleanly.

**Optional tooling detection:** if `graphify` is on `$PATH` and `graph.json` exists, `brain-load.sh` advertises it to the session. NEO can then prefer `graphify query/path/explain` over broad grep for cross-file questions. graphify is never required; the brain works without it.

---

## Write Path (Main Model Only)

Brain writes are the highest-leverage tokens in the system. A wrong lesson poisons every future session. A vague `ACTIVE.md` strands the next session. This is why neo-shadow runs on `inherit` — the same model as the main thread, never a cheaper one.

**The flow:**

1. NEO assembles a **session delta**: what happened, what changed (git diff summary), decisions made, mistakes hit, where work stopped, what comes next.
2. NEO spawns **neo-shadow** with the delta as context.
3. neo-shadow reads the current brain files before writing anything (never overwrites context it hasn't read).
4. neo-shadow writes: rewrites `ACTIVE.md`, appends `PROGRESS.md`, updates `DECISIONS.md`/`LESSONS.md` only if the delta earns it, touches `ARCHITECTURE.md` only on pattern changes, `BRIEF.md` only on pivots, and updates `WORKFLOWS.md` when the session repeated a known multi-step sequence.
5. neo-shadow reports which files changed and flags anything contradictory for NEO to resolve with the user.

**NEO never writes brain files itself.** Judgment about what to remember is neo-shadow's job.

**When saves happen:**
- Completed task boundaries
- Before compaction (`save-brain.sh` injects a reminder into context)
- When the stop-gate flags a stale brain
- On `/neo:save` (manual)

**Compaction awareness:** the starter `CLAUDE.md` ships a `## Compact Instructions` section that Claude Code injects into every compaction prompt. It tells compaction to preserve current focus, open todos, and unverified changes, and to treat `.neo/brain/` as the source of truth instead of restating it. Combined with `brain-load.sh` re-firing after compaction (SessionStart has no source matcher), the brain survives compaction on both sides: guidance going in, auto-reload coming out.

---

## One Source of Truth

A fact lives in exactly one brain file. Everything else points to it.

- Never copy-paste between brain files.
- If `ACTIVE.md` references a decision, it links `[[DECISIONS]]` — it doesn't restate the rationale.
- If `ARCHITECTURE.md` grows a topic that `DECISIONS.md` also covers, extract to `topics/` and link both.

Violating this rule means the next session gets contradictory ground truth. neo-shadow flags contradictions it finds; it marks uncertain content `(unverified)` rather than deleting it.

---

## Git Sync

`brain-sync.sh` runs at `SessionEnd`. It commits `.neo/brain/` automatically if:

- The project is inside a git work tree.
- No rebase, merge, or cherry-pick is in progress.
- There are staged or unstaged changes under `.neo/brain/`.

Commit message format: `neo: brain sync YYYY-MM-DD`.

**Opt out:** create `.neo/no-auto-commit`. The file's presence is the signal; its contents don't matter. `brain-sync.sh` checks for it before doing anything.

`brain-sync.sh` never fails the session end — it exits 0 on every path, including errors.

---

## Stop-Gate: Stale Brain Detection

`stop-gate.sh` runs at `Stop` (when NEO is about to finish responding). It blocks **once** when code changed this session but the brain was not updated.

**Logic:**
- Dirty files outside `.neo/` + clean `.neo/brain/` = stale memory = block with a message naming what to do.
- `stop_hook_active: true` in the payload = already blocked once this cycle = allow through. No infinite loops, no hard walls.
- No `.neo/brain/` directory = no gate (project hasn't opted in).
- Not a git repo = no gate.

The block message tells NEO exactly what to do: "spawn neo-shadow with the session delta or run `/neo:save`." If there's genuinely nothing worth saving, finishing again lets it through.

---

## Garbage Collection — /neo:gc

Lessons rot: files move, dependencies get removed, patterns get retired. Because a stale lesson is often *more* plausible-looking than a duplicate, rot can't be detected by similarity — it needs evidence. NEO splits the job:

**Deterministic scan (`brain-gc.sh`, zero LLM cost):**

| Flag | Meaning |
|---|---|
| `DEAD-ANCHOR` | The entry's `(path)` anchor no longer exists on disk. |
| `AGED` | Datestamp older than the threshold (default 90 days; `NEO_GC_MAX_AGE_DAYS`). |
| `UNDATED` | No `[YYYY-MM-DD]` datestamp (legacy entry). |

**Curated pass (`/neo:gc`, neo-shadow):** reviews **only the flagged entries** against the current codebase and gives each a verdict:

- **KEEP** — still true. Undated entries get stamped with today's date; aged-but-confirmed entries get their date refreshed.
- **REWRITE** — kernel is true, details drifted (file moved, command renamed). Text, anchor, and date updated.
- **ARCHIVE** — no longer applies. Moved to `.neo/brain/archive/LESSONS.md` under a dated heading with a one-line reason. Nothing is ever deleted outright — the archive plus git history make every GC decision reversible.

Unflagged entries are never touched. `/neo:status` surfaces a one-line lesson-health summary (`brain-gc.sh --summary`) so rot gets noticed without running a full GC.

---

## [[wiki-links]] and the topics/ Graph

`INDEX.md` uses `[[wiki-links]]` syntax throughout. This is the graph-export escape hatch for v2: if the project later adopts a graph tool (Obsidian, graphify, a vector DB), the link structure is already there. v1 doesn't depend on any graph tool — the links are just navigational pointers that happen to be compatible.

When a subject outgrows its section, neo-shadow extracts it to `.neo/brain/topics/<name>.md` and adds a link in `INDEX.md`. The main brain files stay lean; the topics directory grows organically.
