#!/usr/bin/env bash
# PreCompact: last chance to persist session memory before compaction discards detail.
# stdout is injected as context ahead of compaction.
set -uo pipefail

[ -d ".neo/brain" ] || exit 0

cat <<'EOF'
[neo] Context is about to compact. Session detail (decisions, gotchas, in-flight state) will be lost from the transcript.
Save the brain NOW: assemble the session delta and spawn neo-shadow (or run /neo:save) BEFORE continuing other work.
EOF
exit 0
