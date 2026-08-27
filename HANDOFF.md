# HANDOFF

**Written 2026-08-27. Definitive rotation — the sitting is finished.**
Dennis asked for the next group and left the pick to me, then answered
"pick all issues" when I offered to stop at three. **6 closed, 9 filed,
full e2e gate run.**

## Shipped

| # | What it was | Merge |
|---|---|---|
| **#826** | worker had no Mongoose connection; batch import never completed | `120ced22` |
| **#822** | participant pages used relative `/api`; every request got the SPA shell | `f09c033c` |
| **#820** | `normalizeSignaturePayload` emptied keys the schema `minLength:1`s | `706b3ef8` |
| **#829** | `generate-link` had no try/catch → **unhandled rejection exits the API process** | `318a2882` |
| **#835** | `createPolicy`'s sweep filtered on the id it had just inserted → notified nobody, ever | `6fb1d126` |
| **#834** | `hpo.js` `GET /:id` — the one other unguarded async handler | `88cdd40b` |

Every one verified against the live stack, not only natively.

**The participant e-consent flow now works end to end** — #822 + #820
together — proven by `participant-e-consent-page.spec.ts` (4 passing).

## The operating rule this sitting produced

Last sitting: issue *evidence* was unsound. This sitting: **a "needs an
owner call" claim is itself a premise to re-check, and so is an issue's
description of what *works*.**

- **#820 and #824 were both settled by one grep of
  `docs/docs-7-27-2026/extracted/`** — dict-02 P1X-0372
  (`signerDisplayName` 0..1) and dict-07:39 (`ConsentPolicy + ConsentTemplate`
  → `ConsentTemplate`, "Crítica"). Both had been carried forward as
  blocked on Denise.
- **#824's premise was wrong** ("two paths, one notifies"): #835 proved
  *neither* notified. Wiring the builder to `createPolicy`, as #824
  recommended, would have wired the UI to a sweep that did nothing.
- **#826's fix was necessary but not sufficient** — #828 was waiting
  behind it.

## Filed (9 product + 2 pack)

Severity order:

- **#828** — batch import: the upload is passed API→worker as a filesystem
  *path*, but they are separate containers with no shared volume. **This is
  what `async-import-quarantine.spec.ts` is red on**, not #826.
- **#833** — **no email can be sent on the test stack at all**:
  `sendEmail` is Resend-only with a dummy key, and the `smtp-test` Mailpit
  container is reachable by no backend code path. Blocks every
  email-dependent e2e; it is why #829 survived unnoticed.
- **#836** — republishing a term now overwrites `consentToken` for the whole
  pending cohort, silently killing outstanding invitation links. Newly
  reachable *because of* #835.
- **#832** — `POST /e-consent/update` is unauthenticated and, since #820,
  writes a Consent instead of 422ing. Needs #823's rate limiting.
- **#827** — `createPatientConsent` records no `consentVersion` and no
  evidence fields (RF010 AC#3/AC#4). #821 wrongly credits it with these.
- **#830** — should `StagingImport` be Mongoose at all? Carried out of #826.
  Also: `models/Sample.js` registers a Mongoose model with no query call site.
- **#831** — decision record for #822 widening `TOKEN_OPTIONAL_ROUTES`.
- Pack **#505** (fix-bugs close discipline), **#506** (dennis-windows'
  reactive trigger). Comments on pack **#270** (a clean within-session A/B
  on the full-suite guard not firing) and product **#819**.

## Repo state

- On `feature/docker-e2e-backend-integration`, **clean and matching
  origin**. `main` untouched and frozen. No open PR.
- Last substantive commit: the `#834` merge. All six fix branches merged
  and deleted locally; none was pushed.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**

## The gate WAS run this sitting

`compose.test.yml` and `.env.test.example` changed (#829 needs
`FRONTEND_URL`), so the infra-change rule applied. Full suite,
`--workers=1`:

**215 passed, 3 failed, 1 skipped.** All three failures accounted for:

- 2 × `async-import-quarantine.spec.ts` — **deliberately red on #828**.
  Do not weaken or skip them.
- 1 × `tcle-dinamico.spec.ts:19` — **#819**, the lazy-route cold-compile
  flake. Re-ran in isolation immediately: 4/4 green, the failing test in
  724ms. Commented on #819 with a narrowing hypothesis.

**`FRONTEND_URL` must be HTTPS and non-loopback** — `sendConsentEmail`
calls `validateFrontendUrl({ remote: true })`, which refuses to email a
plaintext or loopback link. `https://e2e.bioavanced.test` is the test
value; specs following an emailed link strip it to the pathname.

## Docker

**Stack: DOWN. Volumes: PRESENT AND BOOTSTRAPPED** — `admin-bootstrap-test`
ran and exited 0 against them this sitting, and `realLogin` succeeded
repeatedly. The reference-data chain was not re-run and was not needed.

`backend-app-test`, `worker-test`, `frontend-app-test` and
`neo4j-projection-worker-test` were rebuilt/recreated this sitting and
carried every change. **All are build-not-mount — rebuild before trusting
them against any later change**, and recreate the *whole* stack after an
`x-test-env` edit, not just one service (they all inherit it).

## Recommended next

**None queued — Dennis has not named the next group.** In the order I
would argue for them:

1. **#833** — unblocks every email-dependent e2e, including the one
   `test.fixme` in `participant-e-consent-page.spec.ts`.
2. **#828** — turns `async-import-quarantine.spec.ts` green and finally
   lets #813's quarantine code run once.
3. **#824** — now a real consolidation (dict-07: unify onto
   `ConsentTemplate`), touching the service, the versioning fields and the
   builder. **Its own sitting.** #835 made it worth doing; note
   `createTemplate` sets `version`/`versionGroupId` but not
   `previousPolicyId`/`revisionType`, and #835's sweep resolves the cohort
   *through the lineage* — so wiring the builder without the lineage fields
   reproduces #824's symptom by another route.
4. **#836 then #832** — both fall out of what shipped here.
5. **#821** — still genuinely owner-facing (the convergence question).

The `#684 / #800 / #801` object-ownership cluster remains the
highest-severity item overall, still blocked on the RF010/RF021 actor
model — unchanged.
