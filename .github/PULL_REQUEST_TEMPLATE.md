## What

<!-- One or two sentences: what does this PR change and why? -->

## Component

<!-- Check all that apply -->

- [ ] Agent definition (`agents/`)
- [ ] Hook script or config (`hooks/`)
- [ ] Command (`skills/`)
- [ ] Template (`templates/`)
- [ ] Docs (`docs/`, `README.md`)
- [ ] Repo infrastructure (`.github/`, manifests)

## Checklist

- [ ] `bash -n` passes on every touched shell script
- [ ] `jq . <file>` passes on every touched JSON file
- [ ] Hook scripts stay **fail-open** (every unexpected path exits 0; only deliberate blocks exit 2)
- [ ] No new runtime dependency introduced (pure bash + jq + markdown + JSON)
- [ ] Roster/count references updated everywhere if agents or hooks changed (see CONTRIBUTING.md checklist)
- [ ] `docs/specs/` decision log updated if this changes a design decision
- [ ] Commit messages: imperative, lowercase, < 65 chars

## How I verified

<!-- Commands you ran and their output. "It looks right" is not verification. -->
