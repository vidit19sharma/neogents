# Lessons

> Anti-patterns learned the hard way. Loaded at EVERY session start — every line pays rent.
> Format: `- [YYYY-MM-DD] [tag] imperative + reason. (anchor) (seen: N, first YYYY-MM-DD)` — tag is exactly one of
>   `[verified]` (corroborated in ~3 independent sessions, or explicitly confirmed by the user —
>   mirrors the 3-sightings rule in WORKFLOWS.md), `[observed]` (seen happen, not yet corroborated),
>   `[assumed]` (inferred, never confirmed). Promote a tag only by rewriting the entry with a fresh date.
>   The `(seen: N, first YYYY-MM-DD)` element is optional — add it once a lesson is re-encountered to
>   track corroboration toward the 3-sightings bar; omit it on first sighting.
>   "- [2026-07-20] [verified] Never call refresh() twice — because it races the token store. (src/auth/refresh.ts) (seen: 3, first 2026-06-01)"
> The datestamp is when the lesson was learned or last confirmed. The anchor is the file or
> path the lesson is about — include one whenever the lesson concerns specific code; omit it
> for project-general rules ("never force-push").
> New knowledge about the same subject REPLACES the old line (supersession) — never append a
> contradicting duplicate. Stale entries are flagged by `/neo:gc` (dead anchors, old dates)
> and archived to `archive/LESSONS.md`, never silently deleted.

_No lessons yet. When something bites, neo-shadow records it here so it never bites twice._
