#!/usr/bin/env bash
# PostToolUse hook (matcher: Edit|Write|NotebookEdit) — auto-format the edited file.
#
# Boris Cherny: formatting hooks are "the last 10% to avoid CI formatting errors."
# Deterministic where CLAUDE.md advice is advisory.
#
# FAIL-OPEN BY DESIGN: this hook must never break an edit. Every path exits 0.
# Only formatters ALREADY PRESENT in the project/machine are used — this script
# never installs anything (no npx downloads, no pip installs).

set -u

command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)"

[ -n "$FILE" ] && [ -f "$FILE" ] || exit 0

# Never reformat the second brain or plan artifacts — their layout is content.
case "$FILE" in
  *.neo/*) exit 0 ;;
esac

CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"
[ -n "$CWD" ] || CWD="$(pwd)"

case "$FILE" in
  *.js|*.jsx|*.ts|*.tsx|*.mjs|*.cjs|*.json|*.css|*.scss|*.html|*.yaml|*.yml|*.md)
    # prettier: only the project-local install, and only if the project configures it
    if [ -x "$CWD/node_modules/.bin/prettier" ]; then
      "$CWD/node_modules/.bin/prettier" --write --ignore-unknown "$FILE" >/dev/null 2>&1
    fi
    ;;
  *.py)
    # Like prettier above, require project opt-in (config present) — a
    # machine-wide ruff/black install must not reformat projects that never
    # chose these tools.
    if command -v ruff >/dev/null 2>&1 && { [ -f "$CWD/ruff.toml" ] || [ -f "$CWD/.ruff.toml" ] || grep -qs '\[tool\.ruff' "$CWD/pyproject.toml"; }; then
      ruff format "$FILE" >/dev/null 2>&1
    elif command -v black >/dev/null 2>&1 && grep -qs '\[tool\.black\]' "$CWD/pyproject.toml"; then
      black --quiet "$FILE" >/dev/null 2>&1
    fi
    ;;
  *.go)
    command -v gofmt >/dev/null 2>&1 && gofmt -w "$FILE" >/dev/null 2>&1
    ;;
  *.rs)
    command -v rustfmt >/dev/null 2>&1 && rustfmt --edition 2021 "$FILE" >/dev/null 2>&1
    ;;
esac

exit 0
