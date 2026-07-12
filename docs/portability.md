# NEO Portability

**v1 is Claude Code only.** Multi-harness adapters are a v2 non-goal. This document explains what "harness-neutral authoring" means in practice, where the Claude Code specifics are isolated, and what a future adapter would need to swap.

See also: [brain-spec.md](brain-spec.md) for the second brain contract, [customization.md](customization.md) for v1 configuration.

---

## The Design Principle

NEO's agent prose is written to describe behavior, not to invoke specific tools. The orchestration logic in `agents/neo.md` — intent classification, tiered pipeline, delegation contract, evidence rules, memory duties — is all harness-neutral. A reader on any platform can follow it.

Claude Code specifics are isolated to **one clearly marked section** at the bottom of `agents/neo.md`:

```markdown
## Claude Code Specifics

<!-- harness-specific section: swap this block when porting to another harness -->
- Spawn specialists with the `Agent` tool (`subagent_type` = roster name).
- Track work with `TodoWrite`; ask the user structured questions with `AskUserQuestion` (one at a time).
- Brain loading, path jails, spawn whitelist, and the stop-gate are enforced by plugin hooks — they are deterministic, not suggestions.
- Verify edits with project linters/tests via `Bash`; prefer project-defined commands from CLAUDE.md.
```

Porting to another harness means replacing this block. The rest of the file stays.

---

## Concept Map

The table below maps NEO concepts to their equivalents in other harnesses. This is a reference for future adapter authors, not a commitment to build them.

| NEO concept | Claude Code | OpenCode | Codex |
|---|---|---|---|
| Session agent takeover | `settings.json {"agent": "neo"}` | `opencode.json {"agent": "neo"}` (same mechanism) | TBD |
| Spawn a specialist | `Agent` tool (`subagent_type`) | `task()` call with subagent type | TBD |
| Track todos | `TodoWrite` tool | `todowrite` tool | TBD |
| Ask the user a question | `AskUserQuestion` tool | Direct response (no dedicated tool) | TBD |
| SessionStart hook | `hooks.json` `SessionStart` event | `opencode.json` hooks (same structure) | TBD |
| PreToolUse hook | `hooks.json` `PreToolUse` + matcher | `opencode.json` hooks | TBD |
| PreCompact hook | `hooks.json` `PreCompact` event | TBD | TBD |
| Stop hook | `hooks.json` `Stop` event | TBD | TBD |
| SessionEnd hook | `hooks.json` `SessionEnd` event | TBD | TBD |
| Plugin namespace | `.claude-plugin/plugin.json` | TBD | TBD |
| Agent file format | `agents/*.md` with YAML frontmatter | Same format (OpenCode reads the same files) | TBD |
| Skill/command file | `skills/<name>/SKILL.md` | Same format | TBD |

"TBD" means the harness either doesn't have an equivalent yet or the mapping hasn't been verified. Don't fill these in speculatively.

---

## What a v2 Adapter Would Swap

A minimal port to a new harness requires changes in three places:

**1. The harness-specific section in `agents/neo.md`**
Replace the "Claude Code Specifics" block with the target harness's tool names and plugin mechanism. Everything above that block stays identical.

**2. `hooks/hooks.json`**
Hook event names and the plugin hook mechanism are harness-specific. The shell scripts themselves (`brain-load.sh`, `brain-sync.sh`, etc.) are plain bash and are reusable as-is if the target harness supports command hooks.

**3. `.claude-plugin/`**
The plugin manifest format is Claude Code specific. A new harness needs its own plugin registration mechanism.

The brain files, agent prose, skill files, and templates are all harness-neutral and require no changes.

---

## What Stays the Same Across Harnesses

- The second brain contract: seven files, their purposes, update cadences, and size rules. Documented in [brain-spec.md](brain-spec.md).
- The agent roster: neo, neo-shadow, keymaker, tank, architect, trinity, smith, oracle. Their jobs, model tiers, and tool restrictions are harness-neutral concepts.
- The tiered pipeline: TRIVIAL / STANDARD / DEEP. The classification logic and escalation rules don't depend on any harness.
- The delegation contract: six-section spawn prompt (TASK / EXPECTED OUTCOME / TOOLS / MUST DO / MUST NOT DO / CONTEXT). This is a prose discipline, not a tool call.
- The brain file format: plain markdown with `[[wiki-links]]`. No harness dependency.
- The shell scripts: bash with no harness-specific calls. Reusable if the target harness supports command hooks.

---

## v1 Scope Statement

v1 is Claude Code only. The harness-neutral authoring is an investment in future portability, not a promise to deliver adapters. Adapters are explicitly out of scope for v1.

The non-goals from the design spec:

- No multi-harness adapters in v1.
- No MCP servers.
- No vector DB or Graphiti dependency (graphify is detect-don't-depend; see [brain-spec.md](brain-spec.md)).
- No experimental agent-type hooks (documented as a v2 neo-shadow upgrade path).

If you're building an adapter, start with the concept map above, swap the three locations listed, and verify the hook events your target harness supports. The brain and agent prose will work without modification.
