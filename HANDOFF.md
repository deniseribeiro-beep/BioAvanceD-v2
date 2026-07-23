# HANDOFF

**Written:** 2026-07-23, end of a fix-bugs iteration.
**Branch:** `feature/docker-e2e-backend-integration` (commit `6739c2b7`,
no new commits this session — see below).

## What happened this session

Routed via `fix-bugs` for **issue #218**
(`patient.model.unit.test.js`: `Patient.js`'s `validate()` allegedly
missing ~20 business-rule validations the test asserts — cpf format,
weight/heightCm, alphaGal/lysoGb3, comorbidity booleans,
geneticVariant/icdCode/orphaCode/omimCode, icdReference, status enum,
consentToken/consentAcceptedAt, clinicalUnit/clinicalUnitId type,
representativeName type, sex enum).

Traced before treating the issue's "needs a design call" framing as
settled (per `fix-bugs`' verify-before-deferring step): ran
`npx vitest run tests/unit/patient.model.unit.test.js --reporter=verbose`
— all 58 tests pass against the current `src/models/Patient.js`. None of
the fields/rules #218 listed are asserted by the test file anymore; it
explicitly documents the opposite in places (`does not restrict sex to
an enum`, `rejects a non-canonical field` for `cpf`). `git log` on the
test file showed why: commit `d2544fcf` (2026-07-22, "un-stale
patient/sample model unit tests after e2549bee canonicalization",
`Fixes #245`) already rewrote it to match the current, deliberately
simplified model. #218 was a narrower/earlier split of the same root
cause as #245 (both trace to the `e2549bee` canonicalization rewrite)
that never got closed when #245 landed.

**No code or test changes this session** — the fix already existed on
this branch from a prior session. Commented the trace on #218 (which
commit resolved it, what was verified, why the two issues overlap) and
closed it referencing `d2544fcf`.

`wrap-up` ran: no friction — `git status` confirmed the tree stayed
clean throughout (investigation-only), no lazy fixes, nothing
security-relevant, no sub-point left stranded on a closed issue (#218
had exactly one point and it's fully addressed). Nothing to file: the
underlying bug was already fixed and its own issue (#245) already
closed correctly.

## Repo state

- `feature/docker-e2e-backend-integration` is current and pushed
  (`6739c2b7`), issue #218 closed (no merge — no code changed).
- No uncommitted changes, working tree clean.
- `main` remains frozen — do not branch off it, merge into it, or push
  to it.

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full reconcile
(2026-07-22, before the #231 session): statements 91.05%, branches
**82.3%** (lagging dimension), functions 90.88%, lines 91.5%. This
session touched no product/test code — no fresh reconcile run.

## Recommended next steps

No next issue explicitly named by Dennis this session — none queued.

Still open, worth raising with Dennis directly rather than picking
unprompted: the dead-code cluster (#235, #236, #241, #243, #246, #247,
#248, #249) — the repeated authenticate-shadows-route 503 pattern
(#67/#76/#236/#246/#247/#248, six occurrences, five from
`master-data.routes.js` alone) strongly suggests a repo-wide sweep is
more efficient than continued per-file spot fixes.

Also worth a quick pass: check whether any other open issues are, like
#218 was, already resolved by a later commit that fixed a broader/
overlapping issue (#245-shaped situations) — a cheap sweep before
picking fresh work.

For coverage work: resume the branch%-sorted method in
`COVERAGE_NOTES.md`; next unflagged candidates from the last sort were
`src/services/hl7Audit.service.js`, `src/interface/routes/label.routes.js`,
and `src/interface/routes/sample.routes.js` — none verified for drift
yet.

## Which skills to use

`bioavanced-v2-conventions` first. `fix-bugs` +
`bioavanced-v2-testing-conventions` for bug work. `test-loop` for
coverage work. `wrap-up` every iteration.

## Dependency notes

None queued.

## Session note

None carried forward.
