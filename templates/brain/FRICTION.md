# Friction

> Evidence ledger of what went wrong: user corrections, smith BLOCKs, failed-fix
> escalations, reverts after approval. Raw material for improving NEO's own
> components — a fix without a friction entry behind it is a guess.
> **Append-only. Stable IDs. Never rewrite old entries.**
> Format: `- [F-NNN] YYYY-MM-DD <what happened> → cause: <one line> → component: <file it implicates>`
>   "- [F-001] 2026-08-20 user reverted trinity's retry wrapper after smith APPROVE → cause: review missed double-retry → component: agents/smith.md"
> Next ID = highest existing + 1. Anchor the component whose change would have
> prevented it (an agent prompt, a skill, a template) — not the code that broke.

_No friction yet. Neo-shadow records it here when a session hits it._
