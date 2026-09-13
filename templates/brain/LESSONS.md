# Lessons

> Anti-patterns learned the hard way. Loaded at EVERY session start — every line pays rent.
> Format: `- [YYYY-MM-DD] [tag] imperative + reason. (anchor)` — tag is exactly one of
>   `[verified]` (proven by test/command output), `[observed]` (seen once, not re-confirmed),
>   `[assumed]` (inferred, never confirmed).
>   "- [2026-07-20] [verified] Never call refresh() twice — because it races the token store. (src/auth/refresh.ts)"
> The datestamp is when the lesson was learned or last confirmed. The anchor is the file or
> path the lesson is about — include one whenever the lesson concerns specific code; omit it
> for project-general rules ("never force-push").
> New knowledge about the same subject REPLACES the old line (supersession) — never append a
> contradicting duplicate. Stale entries are flagged by `/neo:gc` (dead anchors, old dates)
> and archived to `archive/LESSONS.md`, never silently deleted.

_No lessons yet. When something bites, neo-shadow records it here so it never bites twice._
