---
name: map
description: Deep codebase mapping. Fans out parallel keymaker recon across an existing repository and has neo-shadow synthesize the findings into ARCHITECTURE.md. Use when adopting NEO in a mature codebase, when ARCHITECTURE.md is empty or stale, or when the user asks to map or document the codebase structure.
---

Build or refresh the second brain's map of this codebase.

## Current state

- Brain: !`ls .neo/brain 2>/dev/null || echo "MISSING"`
- ARCHITECTURE.md size: !`wc -l .neo/brain/ARCHITECTURE.md 2>/dev/null || echo "n/a"`
- Graphify: !`command -v graphify >/dev/null 2>&1 && echo "available" || echo "not installed"`

## Steps

1. **Guard.** No `.neo/brain/` → stop and suggest `/neo:init` first. This command fills the map; init builds the shelf.

2. **Recon fan-out.** Spawn keymakers IN PARALLEL (one message, 3–4 spawns), each with the full 6-section contract and ONE angle:
   - *Stack & entry points*: languages, frameworks + versions from manifests, build/test/lint commands, where execution starts.
   - *Layout & boundaries*: top-level modules, what owns what, how layers talk (imports, APIs, events).
   - *Patterns & conventions*: error handling, naming, state management, test conventions — concrete one-liners with file:line examples.
   - *Gotchas & hotspots*: the biggest files, circular-looking dependencies, anything where "X looks like Y but is actually Z".

   If graphify is available and a `graph.json` exists, tell each keymaker to prefer `graphify query`/`path`/`explain` over broad grep.

3. **Synthesize via shadow.** Spawn neo-shadow with ALL recon findings as the delta. Contract: rewrite `ARCHITECTURE.md` (Stack / Layout / Patterns / Gotchas — concrete, file-anchored, no prose padding); extract any subsystem too big for a section into `.neo/brain/topics/<name>.md` and [[wiki-link]] it; update `INDEX.md` pointers; touch nothing else.

4. **Report.** Tell the user what the map now covers, its size (flag if ARCHITECTURE.md pushed past ~500 lines — shadow should have split topics), and anything the recon flagged as unclear or contradictory.

Re-running is safe: shadow rewrites from current findings, and prior knowledge lives in git history.
