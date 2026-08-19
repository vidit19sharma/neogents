---
name: recall
description: Search everything the project remembers — the second brain, plan artifacts, and the run ledger — with plain grep, returning file:line pointers. Use when the user asks "did we already...", "when did we decide...", "what did the review say about...", or before re-exploring something a past session may have answered.
---

# /neo:recall — grep project memory

Memory on disk: !`du -sh .neo 2>/dev/null || echo "no .neo — run /neo:init"`

Past sessions already paid for this knowledge. Search it before re-earning it with fresh recon.

## Steps

1. **Guard**: no `.neo/` → suggest `/neo:init` and stop.

2. **Derive terms** from the user's question — 1 to 3 of them. Exact identifiers (file names, function names, error strings) beat prose. Try the most specific term first.

3. **Search** (one command per term):
   ```bash
   grep -rin -- "<term>" .neo/brain .neo/plans .neo/runs 2>/dev/null | head -40
   ```
   Too noisy → tighten the term or add `-w`. Zero hits → loosen it (stem the word, drop qualifiers).

4. **Answer from pointers.** Read only the files the hits point at, then answer citing `file:line` for every claim. Prefer the newest hit when sources disagree — and say so.

5. **Nothing found** → say memory has nothing on it and fall back to normal recon. Never present absence of memory as absence of fact.
