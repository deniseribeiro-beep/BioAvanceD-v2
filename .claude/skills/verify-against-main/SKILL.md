---
name: verify-against-main
description: Corroborate a fix or test-fixture change against Denise's actual intent — her arch tests, canonical contracts, and latest main commits — instead of inferring intent from a single local file, and pull a single drifted file from main when that's all a fix needs. Use whenever a fix-bugs/test-loop/merge-from-main iteration is "pretty sure" a rename or behavior change matches what Denise wants but hasn't checked an independent source, or when one specific file (not a whole merge's worth) looks behind main.
---

# Verifying a fix actually matches Denise's intent

`fix-bugs` and `test-loop` regularly involve inferring "what does Denise
want this field/behavior to be" from a single local artifact — usually
the model/schema file being edited agreeing with itself. That's often
right, but it's a single source: if that file is mid-migration, stale,
or was never fully rationalized, the fix looks locally consistent while
quietly drifting from what she actually intends. This skill is the
check that catches that before it ships as a confident "aligned with
Denise's expectations" claim.

Confirmed need 2026-07-15 (issue #199): a `parseSampleCSV` fix renaming
snake_case governance fields (`rcs_score`, `final_grade`, ...) to
camelCase to match `Sample.js`'s schema was correct against that schema,
but the schema was the *only* source checked at first. It happened to
also be confirmed independently by
`tests/architecture/canonical-fields.arch.test.js`'s forbidden-field
list and `src/contracts/canonical/v1/index.js`'s ajv schema — but that
corroboration only happened because the user asked "did you check this
matches Denise's expectations?" after the fact, not because the workflow
asked it first.

## When to run this

- Before treating a "canonical"/"rename"/"this must be the new
  convention" inference as settled, anywhere a `fix-bugs` or `test-loop`
  fix renames a field or changes behavior to match what a model/schema
  file currently does.
- Before claiming a fix "matches Denise's intent" in a commit message,
  issue comment, or summary to the user — that claim should be backed by
  more than local self-consistency.
- Whenever `docs/architecture/*` is being relied on to resolve an
  "ambiguous, needs Dennis" question (`fix-bugs`'s "no silent
  dismissals" section) — the doc itself needs the same corroboration
  check, since it can predate a later commit that superseded it.
- When a fix touches a file that might have moved further on `main`
  than the feature branch's copy — see "Scoped single-file pulls" below.

## Corroborating sources, in order of authority

Check as many of these as apply; the more that agree, the more solid
the fix. Don't stop at the first one that happens to confirm your
inference — a single hit can still be coincidental.

1. **`api/backend/tests/architecture/canonical-fields.arch.test.js`** —
   an explicit, maintained enumeration of legacy field names Denise
   wants purged (`REQUIRED_FORBIDDEN`, actively asserted; and
   `ASPIRATIONAL_FORBIDDEN`, defined but not yet CI-gated — still a
   direct statement of intent even though nothing currently fails on
   it). Grep both lists for the field names in question. Confirmed
   useful 2026-07-15: `patientID`, `sampleID`, `registerDate`,
   `tcle_id`, `quality_score`, `quality_category` were all already
   named there, directly confirming a rename direction that had
   otherwise only been inferred from a model file.
2. **`api/backend/src/contracts/canonical/v1/index.js`** — an ajv
   schema covering a narrower set of fields (`specimenId`,
   `participantId`, `registeredAt`, `lifecycleStatus`, `sprec.*`). A
   second independent source when it overlaps with what's being fixed.
3. **`docs/architecture/` and `docs/inventory/`** — Denise's own
   architecture write-ups. Useful, but per the note above, can be
   stale — corroborate with 4 below before trusting a doc alone,
   especially if the doc doesn't cite a specific commit.
4. **Denise's actual commit history for the file being fixed**:
   `git log --all --oneline -- <file>` to see her past intent, then
   `git fetch origin main` and `git log origin/main --oneline -1 --
   <file>` to check nothing has landed on `main` more recently than
   what the feature branch has for that file. A fix anchored to a
   stale local copy can look internally consistent while already
   contradicted by her latest commit.
5. **The model/schema file itself** — always available, but on its
   own is the *weakest* source (self-consistency, not independent
   confirmation). Fine as the deciding vote when nothing above applies
   or disagrees, but say so explicitly (see "Reporting the confidence
   level" below).

## Scoped single-file pulls (lighter than `merge-from-main`)

If step 4 above finds that one specific file has moved further on
`main` than the feature branch's copy, and the current fix is confined
to that file, don't reach for `merge-from-main`'s full workflow — that
drags in every other unrelated commit `main` has accumulated since and
forces conflict resolution on files nothing here cares about.

Pull just that path instead:
- `git fetch origin main`
- `git show origin/main:<path>` to view Denise's current version (see
  `local-env` for the MSYS colon-mangling gotcha on Windows Git Bash —
  prefix with `MSYS_NO_PATHCONV=1` if the revision string errors).
- `git diff HEAD origin/main -- <path>` to see exactly what changed.
- Either adopt her version outright (`git checkout origin/main --
  <path>`, if it should simply replace the local copy) or hand-apply
  just the relevant part with `Edit`, if only part of her change bears
  on what's being fixed.
- Commit it as part of the normal `fix-bugs`/`test-loop` fix commit —
  it's still "fixing the file to match Denise's intent," just informed
  by her literal diff instead of re-derived from the schema alone.

**Escalate to `merge-from-main`'s full workflow instead** if the pull
turns out not to be scoped after all: the file's drift is entangled
with changes across several other files (the directory-rename or
architectural-conflict shapes `merge-from-main` describes), or
`git log feature/docker-e2e-backend-integration..origin/main` turns out
to carry far more commits than expected once you actually look. A
scoped pull is for one contained file catching up; anything wider
belongs in the real merge, survey-first.

## Reporting the confidence level

State plainly, in the commit message, issue comment, or summary to the
user, how many independent sources confirmed the fix:

- **Two or more sources agree** (arch test + contract, or either +
  a fresh check against `origin/main`) — solid, say so and move on.
- **Only the schema/model file being edited agrees with itself** —
  still correct against current code, but say explicitly that there's
  no independent confirmation, so a future session knows this corner
  is more likely to shift than a fix backed by the arch test or
  contract file. Example from 2026-07-15, issue #199: the
  `parseSampleCSV` governance/quality-field renames were correct
  against `Sample.js` as it stood, but nothing else corroborated the
  specific camelCase choice, and `SampleGraphValidator.js` (#222)
  shows that whole subsystem is still mid-migration and could move
  again — worth flagging as the weaker part of that fix rather than
  presenting it with the same confidence as the identifier renames
  that the arch test and contract file both backed.

## Maintaining this skill

If a future session finds another independent source of Denise's
intent worth checking (a new arch test, a new contracts file, a
changelog), add it to the ordered list above. If this check turns out
to be unnecessary overhead for fixes that obviously don't touch
canonical naming, narrow the "when to run this" section rather than
skipping the skill wholesale.
