# Local issue tracking

This folder is a local, git-tracked issue tracker for AI-driven sessions
on BioAvanceD-v2. It exists because filing on
`deniseribeiro-beep/BioAvanceD-v2`'s GitHub Issues is Denise's repo
surface — every `gh issue create` is a visible write to someone else's
project, and per `bioavanced-conventions` we don't do that without
Dennis's explicit OK each time. Findings still need a durable,
discoverable destination (per `wrap-up`'s "a finding is not done until
it has a destination" rule) — this folder is that destination by
default. GitHub issues remain the *upstream* record; promote a local
issue there only when Dennis says to.

## Layout

- `NNNN-slug.md` — one file per issue, four-digit zero-padded number,
  short kebab-case slug. Numbers are local to this folder — see
  "Numbering" below for how they relate to GitHub issue numbers.
- `_template.md` — copy this to start a new issue.

## Issue file format

```markdown
---
status: open | closed
priority: P1 | P2 | P3
github: "#3" | none | "pending"
opened: YYYY-MM-DD
closed: YYYY-MM-DD (omit if open)
---

# Title

## Problem
...

## Plan / checklist
- [ ] ...

## Resolution (fill in when closing)
What actually shipped, on what branch/commit.
```

The `github:` field tracks sync state with the upstream repo:
- `none` — local-only, not proposed for GitHub (the common case for
  in-loop findings; most of these will just get fixed inline on the
  current branch rather than ever needing an upstream issue).
- `#N` — mirrors an existing GitHub issue N; keep both in sync manually
  when either changes materially.
- `"pending"` — Dennis has agreed this should go to GitHub but it
  hasn't been filed yet.

## Numbering

Issues that mirror an existing GitHub issue reuse that issue's number
(e.g. `0003-docker-e2e-wiring.md` for gh #3) so the two stay easy to
cross-reference. New local-only issues continue the same counter — pick
the next unused number across this whole folder, regardless of whether
prior numbers came from GitHub or were purely local. Check
`ls .claude/issues/` for the current high-water mark before assigning a
new one.

## Workflow

- **Filing:** when `test-loop`, `ship-to-main`, or any other skill's
  wrap-up step finds something that isn't in-scope for the current
  slice (a bug, a missing capability, broken plumbing), write a new
  `.claude/issues/NNNN-slug.md` with `github: none` and `status: open`.
  This does NOT require asking Dennis first — it's a local file, not a
  write to Denise's repo.
- **Working one:** treat it like `resolve-issue` treats a GitHub issue —
  read it, do the work on the current or a new branch, check off the
  plan items as they land.
- **Closing:** set `status: closed`, fill in `closed:` and
  `## Resolution`, and note the commit/branch. Don't delete closed
  issue files — they're the historical record, same reasoning
  `resolve-issue` applies to GitHub issue history.
- **Promoting to GitHub:** only when Dennis explicitly says to file it
  upstream. At that point `gh issue create`, set this file's `github:`
  field to the new `#N`, and rename the file to match if it's cleaner
  (not required — the frontmatter field is the source of truth, not the
  filename).

## Current issues

- `0003-docker-e2e-wiring.md` — mirrors gh #3 (open, umbrella tracking
  issue for the Docker e2e + coverage push).
- `0005-e2e-real-backend-specs.md` — mirrors gh #5 (open, e2e specs
  need real selectors/auth against the real backend stack).

## Maintaining this folder

If the local/GitHub split stops making sense (e.g. Dennis decides
everything should just go to GitHub, or vice versa), update this file
and the skills that reference it (`bioavanced-conventions`, `test-loop`,
`ship-to-main`, `testing-conventions`) together — they all point here
rather than duplicating the convention.
