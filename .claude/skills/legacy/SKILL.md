---
name: legacy
description: BioAvanceD-v2 legacy-code register — how to judge whether a file/flow is legacy, the known list of already-flagged legacy areas and gotchas, and where to record a new one. Use whenever picking a slice, debugging a hard-to-test file, or touching an old flow, alongside bioavanced-conventions/testing-conventions.
---

# BioAvanceD-v2 legacy code

A single place to check whether code you're about to touch, test, or
build on is legacy — and to record what's already been identified so
nobody has to re-derive it. Other skills should link here rather than
duplicating this judgment call; if you flag something as legacy while
following another skill's workflow, log it in this file (see "Recording
a new legacy finding" below) instead of leaving it only in that
session's transcript.

## What counts as legacy here

Dennis flagged (2026-07-02) that a fair amount of code in this repo is
legacy — old patterns, half-replaced flows, code on its way out — and
that this should shape both slice-picking and how failures against it
get treated. There's no fixed marker for "legacy" (no directory
convention, no tag) — it's a judgment call you make per file, same as
the scripts/interfaces judgment call `COVERAGE_NOTES.md` already
documents. Signs worth weighing:

- Superseded by a newer module doing the same job.
- Dead code paths no route/service actually calls anymore.
- Logic clearly mid-migration (old and new implementations both
  present).

Before calling something's legacy status ambiguous, check `docs/architecture/`
and `docs/inventory/` at the repo root — Denise's own architecture
contracts and inventory snapshots sometimes state the intended direction
directly (see `bioavanced-conventions`'s "`docs/` may already answer a
design question" section for the confirmed example, issue #111).

## How this should shape work

- **Picking a test slice** (`test-loop`, `parallel-test-agents`): a
  ZERO/LOW-coverage file that's legacy in this sense is lower priority
  than one of equal coverage % that's live request-path logic — the
  same "real logic over scripts/interfaces" preference in
  `COVERAGE_NOTES.md` extends to "real logic over legacy." Don't skip
  it outright by default (it may still be load-bearing), just don't
  reach for it first. Before picking any candidate, do a quick "is this
  wired into a live route/scheduler/caller" check (e.g. `grep` for the
  module's filename across `src/`) and say so explicitly in your report
  — don't just assume live because it appeared in `COVERAGE_NOTES.md`.
- **When a slice on legacy code won't test cleanly** — the code's own
  structure (tangled dependencies, no seams to inject fakes, behavior
  that depends on state nothing modern sets up) makes an honest test
  disproportionately expensive for what it proves: treat this the same
  as a known pre-existing failure (see `testing-conventions`'s "Known
  pre-existing failures"). Don't weaken the test or skip/delete it to
  force green. Instead, record it below as a **known gap** and move to
  a different slice. If the difficulty itself looks like a bug (not
  just old code), that's still a normal `gh issue create` per
  `test-loop`'s "when a test finds a real bug" — the legacy label
  doesn't excuse a real defect, it just explains why coverage there is
  cheaper to defer than to force.
- **Any other workflow** (refactor, bug fix, feature work touching an
  old flow): weigh whether the fix belongs in the legacy path at all,
  or whether the newer module is the one that should get the change —
  ask Dennis if it's not obvious which is authoritative.

## Known legacy areas

Nothing has been confirmed and recorded here yet as of 2026-07-02 —
this section fills in as specific files/areas get flagged during work.
Don't treat an empty list as "nothing in this repo is legacy"; it means
no one has done the flagging-and-recording step yet.

## Known legacy gotchas

(Tooling/testing quirks specific to legacy code, as opposed to files.
Empty for now — add here if a legacy-only quirk is found, distinct from
a general testing gotcha which belongs in `testing-conventions`.)

## Recording a new legacy finding

When you identify a file/module as legacy (per the signs above) or hit
a legacy-specific gotcha, add it here in the same session — don't leave
it only in chat or in another skill's file:

- **A specific legacy file/area** → add a bullet under "Known legacy
  areas": file path, why it's legacy (superseded by X / dead path /
  mid-migration), and the date flagged.
- **A gap where legacy code doesn't test cleanly** → add a bullet under
  "Known legacy areas" noting it's a deferred test gap and why (cross-
  reference `testing-conventions`'s "Known pre-existing failures" if
  it's also listed there).
- **A tooling quirk unique to working with legacy code** → add under
  "Known legacy gotchas".

**Also raise a GitHub issue** for any legacy finding that's a real gap,
defect, or ambiguity (not just "this file is old") — it may already be
known or being resolved elsewhere, so the issue exists to surface that
rather than assume it's new work. Per `bioavanced-conventions`, file it
directly with `gh issue create` (blanket OK, no sign-off needed):

- Frame the body as: found while doing test-loop work on the current
  test branch (name it), what the legacy signal was (superseded/dead
  path/mid-migration/didn't test cleanly), and an explicit line asking
  to revisit once the test branch's PR merges to `main` — since it may
  turn out already handled by other in-flight work, this is a "please
  reconcile," not a fresh assignment.
- Apply the `test-branch` label (`gh issue create --label test-branch
  ...`) so these are filterable as test-branch-originated findings
  separate from issues filed for other reasons.

## Maintaining this skill

If a legacy finding turns out to be wrong (the file was actually live,
or has since been replaced), fix or remove the entry rather than
leaving it stale. If another skill's workflow keeps surfacing legacy
judgment calls this file doesn't yet cover, extend this file rather
than letting the judgment call live only in that other skill.
