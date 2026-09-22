# HANDOFF

**Written 2026-09-22, thirty-first queue sitting. INTERIM — Dennis gave no end
signal, so treat the session as CONTINUING.** His instruction: continue work,
**avoid Docker**, and comment on the issue wherever a Docker verification is
missing rather than running one. No Docker command was run.

## What shipped

Three commits on `feature/docker-e2e-backend-integration`, all pushed; tree
clean and matching origin. Last substantive commit `3d5c4438`.

- **#1127 — fixed, LEFT OPEN on purpose.** `f1c8deff`. The consent-token
  endpoints answered every service throw with 400 *"Link inválido ou
  expirado"*, including infrastructure failures. `validateConsentToken` now
  stamps `code = 'CONSENT_TOKEN_REJECTED'` on the refusals raised against the
  caller's own request; the controller answers those 400 and everything else
  503. #823's opaque 400 body is byte-identical and pinned by CONTROL cases.
- **#1138 — filed and closed same sitting.** `3d5c4438`. Found while fixing
  #1127: `consent.controller.js:666` was the only unauthenticated response in
  the file still echoing `templateError.message`. Key dropped.
- **#1137 — filed and closed same sitting.** `c5ead72e`. Five tracked files
  cited paths under the gitignored `.claude/` directory; the four test-file
  citations named a file that no longer exists. Comment-only. Completes the
  sweep begun in `a44bd7b4`/`c0688749`/`11880f6a`.

## Why #1127 is still open

**The fix is proven; one premise it rests on is not, and that premise needs a
live stack.** `[not established]` whether a real Mongo outage surfaces at
`findOne`/`updateOne` as a **rejected promise at all**, rather than a buffered
hang ending in a request timeout. The tests prove the controller's decision
*given* a rejection — they cannot prove the rejection happens, because they
supply it. Settling it means the compose stack up and Mongo stopped
mid-request. The issue's comment names exactly this as the missing proof.

**Unverified prescription:** if a future sitting brings the stack up for any
other reason, this is a cheap thing to check while it is running.

## Correction the next session should not re-derive

**#1127's body named `getPatientsCollection` as the throw site. It is not a
reachable one** `[read it]`: `collectionResolver.getCollection` resolves the
`patients` key synchronously from a bare `db.collection(name)`, and
`ensurePatientIndexes` swallows every `createIndex`/`dropIndex` rejection with
a `logger.warn`. The reachable I/O throws are `findOne` and `updateOne`. The
issue's "direction 2" (wrap `getPatientsCollection`) would have fixed nothing.
Recorded in the commit message, the issue comment and the test file's header.

## Carried forward, unchanged and NOT re-verified this sitting

Both of these come from the previous note and were not re-measured today:

1. **The branch basis is stale and `main` is not where the upstream work is.**
   `git fetch origin --prune` at the start of this sitting still showed `main`
   **behind 3111**. The unmerged upstream branch's file/line counts, its two
   merged PRs and the trial-merge's two conflicts were *not* re-checked.
   **This remains the open decision and it is Dennis's call**, untouched by
   this sitting's work.
2. **CI minutes are exhausted** (upstream tracker comment, 2026-09-20). Any
   plan needing a PR for a real CI signal is blocked until that resets. Not
   re-checked today.

Also still true: Mongo is a replica set upstream, and whether the `chmod 400`
keyfile step survives Docker Desktop here is **`[not established]`** — no
stack was brought up this sitting either.

## Issues touched but not closed

Query for state — `gh issue list --state open`. What a query will not tell you:

- **#1127** — fixed and merged into the branch, open only for the live-stack
  proof above. **Do not re-pick it as unstarted work.**
- **#1120** — cited in #1127's comments but untouched. The consent-token
  audit-row question (does the trail distinguish an infra 503 from an auth
  400?) is raised in #1127's comment; #1120 is about *machine ingest* and does
  not cover it. If #1127 ever closes, that point needs a home.
- Everything the previous note listed under this heading is unchanged — no
  other issue was written to.

## Recommended next

**None queued by name.** Dennis named no issue this sitting either.

Still undone from the last two notes: **diff Requisitos v4.0.0 against v3.0.1
for RF renumbering before building further on `E2E_TRACEABILITY_PLAN.md`.**

## Things a next session must not undo

The three from the previous note all still hold, and this sitting added tests
that pin the first two harder:

1. **The four `patient.service.js` throws stay distinct on purpose.** #823's
   fix is at the controller, which is the disclosure boundary.
2. **`consentLimiter` is mounted on four path PREFIXES, not on
   `/api/e-consent`.** The rest of that router is `authenticate`-gated.
3. **`CONSENT_RATE_LIMIT_RELAXED` is deliberately separate from
   `AUTH_RATE_LIMIT_RELAXED`.**
4. **New: a bare `Error` out of `validateConsentToken` now MEANS an
   infrastructure failure.** A test that wants the 400 arm must reject with a
   *marked* refusal. `consent.controller.test.js` builds one by calling the
   real service rather than hand-stamping the code, so the fixture cannot
   drift from what the service stamps — don't "simplify" that back to a
   literal.

Still true: the live gitignored `.env.docker` on this machine carries a
hand-appended `CONSENT_RATE_LIMIT_RELAXED` line. Machine-local, not a fix.
