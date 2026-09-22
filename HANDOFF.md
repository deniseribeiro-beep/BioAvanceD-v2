# HANDOFF

**Written 2026-09-22, thirtieth queue sitting. INTERIM — Dennis gave no end
signal, so treat the session as CONTINUING.** He asked one question: read the
old handoff, then check whether the repo owner's recent upstream activity
contains anything our branch must account for. The sitting was **read-only**.

## What shipped

**Nothing.** No commit, no push, no PR, no write to this repo's tracker. Branch
`feature/docker-e2e-backend-integration` is unchanged and still 3 doc-only
commits ahead of its remote.

One issue was filed **on the tooling tracker, not this repo's** — a workflow
defect, no bearing on this backlog.

## The finding that reshapes the next sitting

**This branch's basis is stale, and `main` is no longer where the upstream work
is.** `[ran it]` `git fetch origin --prune`, 2026-09-22:

- `origin/main` has not moved since 2026-09-13.
- The live upstream branch is **334 files / +51k / −43k ahead of `main`**, last
  commit 2026-09-21, and is **not merged**. Two further PRs merged **into that
  branch**, not into `main`.
- A trial merge into this branch yields **exactly two conflicts**, both from our
  doc-only commits: `api/backend/src/services/sensor.service.js` (content) and
  `api/backend/tests/unit/services/location-storage-backfill.service.test.js`
  (deleted upstream, modified here). Both resolve by taking upstream.

**Our security work survives upstream intact** `[read it]`: `consentLimiter` at
`api/backend/app.js:234-253` with all four path prefixes and its isolated
opt-in; #823's opaque 400 at `api/backend/src/controllers/consent.controller.js`
lines 698 and 732.

**But `consent.service.js` is now a 4-line re-export of a new
`consent-v2.service.js`** `[read it]`. Any analysis in a prior note citing line
numbers in that file is void. The behaviour those citations described still
exists, in `ConsentGovernanceV2Repository.createConsent` (~line 127), now
explicit as `reasonCode: 'superseded_by_new_consent'`.

## Two things that block the end-loaded gates

1. **Mongo is now a replica set upstream.** `compose.yml` adds a keyfile-init
   and an rs-init service, runs `--replSet rs0 --keyFile`, and the healthcheck
   only greens on `isWritablePrimary`. Root `package.json` compose scripts layer
   a third compose file and run the foundation bootstrap as a blocking one-shot
   **before** backend/frontend. **`[not established]`** whether the `chmod 400`
   keyfile step survives Docker Desktop on this machine — no stack was brought
   up this sitting.
2. **The CI minutes are exhausted.** `[read it]` upstream tracker comment dated
   2026-09-20: 100% of the 3,000 included monthly minutes consumed; four
   workflows failed in 2–4s having run no steps. **Any plan that depends on a
   PR for a real CI signal is blocked until that resets** — this is the gate
   `ship-integration-branch` would otherwise reach for.

## Issues touched, not closed

Query the tracker for state — `gh issue list --state open`. This sitting wrote
to none of them. What a query will not tell you:

- **#832, #1127, #1060, #1074, #1089, #1118** — untouched by the upstream
  reconciliation sweep, which went through the storage/canonical cluster and did
  not reach the e-consent or temperature-policy issues. #1127's defect is
  verifiably still live upstream `[read it]` (the two controller lines above are
  unchanged there).
- **#988, #990, #1026, #1069** — closed upstream as resolved by the Wave 2 work,
  each with an evidence comment. Not ours to re-open.
- **#941, #967, #1124** — classified upstream as backend debt, staying open,
  each with a recommended reframing in its comments. **Read those comments
  before picking any of them up.**

## Recommended next

**None queued by name.** Dennis named no issue.

The open decision is not which issue to work — it is whether to keep building on
`main` at all while the real upstream work sits on an unmerged branch that is
still moving. That is Dennis's call. **Unverified prescription:** if the answer
is "merge it in", the two conflicts above make that a `merge-from-main`-shaped
job, not a scoped single-file pull.

Still undone from the previous note, and now more urgent: **diff Requisitos
v4.0.0 against v3.0.1 for RF renumbering before building further on
`E2E_TRACEABILITY_PLAN.md`.** The upstream tracker now declares the v2 Git state
the *exclusive* normative authority for modelling questions, which directly
undercuts that plan's v3.0.x basis.

## Things a next session must not undo

Unchanged from the previous note and all three still verified upstream this
sitting:

1. **The four `patient.service.js` throws stay distinct on purpose.** #823's fix
   is at the controller, which is the disclosure boundary.
2. **`consentLimiter` is mounted on four path PREFIXES, not on
   `/api/e-consent`.** The rest of that router is `authenticate`-gated operator
   surface. A CONTROL case pins this.
3. **`CONSENT_RATE_LIMIT_RELAXED` is deliberately separate from
   `AUTH_RATE_LIMIT_RELAXED`**, per the isolated-opt-in doctrine. A test pins
   that the auth flag does not relax it.

Also still true: the live gitignored `.env.docker` on this machine carries a
hand-appended `CONSENT_RATE_LIMIT_RELAXED` line. Machine-local, not a fix.

