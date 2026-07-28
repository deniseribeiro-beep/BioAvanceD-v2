# HANDOFF

**Written:** 2026-07-28, end of a `build-loop` session — continuing
Phase 1 of `E2E_IMPLEMENTATION_PLAN.md`. Landed RF004's happy-path e2e
slice (#294), the fourth Wave 1 RF touched this milestone
(RF001/RF012/RF002 landed in earlier sessions, RF004's negative paths
landed last session).

**Branch:** `test/e2e-real-backend-foundation`, 8 commits ahead of
`origin/test/e2e-real-backend-foundation` (not pushed this session —
confirm with Dennis before pushing, per repo convention).

## What happened this session

1. **Routed issue #294 through `work-issue` → `build-loop`.** #294 was
   the carried-forward remainder of #287 (RF004 negative paths, landed
   last session): AC#2 (specimenId uniqueness), AC#5 (SPREC recording),
   AC#6 (consent-state blocking), all needing a real participant +
   active consent template, which had no clean API seed path.
2. **Built `tests/e2e/helpers/seedParticipant.ts`**: seeds a consent
   template, a real participant (via `POST /api/patients`), and an
   operational location/sensor pair — all directly against the test
   stack's Mongo (no API seed path exists for any of these). Required
   publishing `mongodb-test`'s port to the host in `compose.test.yml`,
   since `npm run test:e2e:docker` drives Playwright from the host, not
   the `playwright-runner` container.
3. **Extended `specimen-quality-inventory.spec.ts`** with 3 new
   real-backend happy-path tests (AC#2, AC#5, AC#6 — the last proving
   both the blocked and unblocked sides of consent gating). All 8 tests
   in the file pass against the live stack.
4. **Building the fixture surfaced two pre-existing backend bugs**,
   fixed in the same commit since they directly blocked proving the
   criteria above:
   - `SampleMovement.generateMovementID` always returned 1 (unwrapped
     `findOneAndUpdate`'s result the pre-driver-v5 way — the current
     `mongodb` driver returns the document directly, not `{value: doc}`)
     — every second-or-later sample ever created collided on
     `movementId`.
   - `getSample`/`withdrawSample`/`returnSample` looked up samples by
     `{specimenId: ObjectId(req.params.id)}` — `specimenId` is a
     separate server-generated string field, so `GET /api/samples/:id`
     and `POST /api/samples/:id/withdraw` could never find a sample by
     the id the create response itself returns. Added a shared
     `findSampleByAnyId` helper (tries `_id` first, falls back to the
     `specimenId` field) used by all three.
   - Verified no regressions: full backend `sample.*` unit/integration
     suites (190 tests across the affected files) still pass.
5. **Hit a collection-name/field-name mismatch mid-build**:
   `consentTemplates`/`consents` (field/param names used throughout the
   API layer) are NOT the actual Mongo collection names — those are
   `consent_templates`/`patientConsents` per
   `api/backend/src/config/collections.js`'s `CANONICAL_COLLECTIONS`
   map. Cost a debug cycle; filed as a lesson for the skills pack
   (`dyeallpies-skills-pack#137`) rather than just working around it
   silently.
6. **`E2E_TRACEABILITY_PLAN.md`'s RF004 row updated** — now PARTIAL with
   AC#1/#2/#4/#5/#6 covered; AC#3 still open.
7. **Closed #294**; then, per `wrap-up`'s shipping addendum, noticed
   AC#3 (Study/Protocol/Collection linkage — flagged inline in both
   #287 and #294, never its own issue) was about to go quiet across two
   now-closed threads — filed it as **#295**.
8. **Docker stack** (`compose.test.yml`, all services except the
   unit/e2e-runner jobs) was built and run for this iteration's
   real-backend verification; torn down and cleaned at session end.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` is 8 commits
  ahead of `origin/test/e2e-real-backend-foundation` — push not done
  this session, confirm with Dennis first.
- Docker stack torn down after this iteration's real-backend run; no
  `bioavanced-test-*` containers/volumes/images remain.
- `test/migrate-rcs-governance-indexes-coverage` still carries the
  unmerged coverage work from issue #285 (untouched, not in scope).

## Recommended next steps

None queued explicitly by Dennis this session. Per the traceability
doc's own sequencing: **#295** (RF004 AC#3, Study/Protocol/Collection
modeling — needs a design call before implementation, see the issue),
then the remaining Wave 1 items `#288` (RF006), `#289` (RF009), `#290`
(RF018), `#291` (RF019), `#292` (RF023), and `#293` (TOTP helper, worth
pulling forward if any of those RFs' acceptance criteria turn out to
need a genuine non-admin session).

## Which skills to use

`work-issue` → `build-loop` held up cleanly for a "known remainder from
a prior chunking decision" case — same milestone branch pattern again:
cut `test/e2e-wave1-rf004-happy-path` off
`test/e2e-real-backend-foundation`, merged back with `--no-ff`, deleted
after. Notably this iteration needed **product code fixes**
(`sample.service.js`, `SampleMovement.js`) alongside the new fixture —
build-loop's "prove, then build" step correctly treated the two
pre-existing bugs as in-scope once they were blocking the exact
criteria #294 asked to prove, rather than deferring them to a separate
fix-bugs pass. `wrap-up`'s shipping addendum (item 11: "labeled a
sub-point ambiguous/needs-owner's-call, then closed the issue it lived
on") caught a real miss — AC#3 had been flagged inline twice across two
now-closed issues with no issue of its own — worth remembering as a
recurring shape in this milestone: any RF acceptance criterion flagged
"not in this issue's scope" needs its own issue at the point the
carrying issue closes, not just a comment.

## Dependency notes

RF001/RF002/RF012 done. RF004 now covers AC#1/#2/#4/#5/#6 (real
backend); AC#3 carried to #295 (needs a design call: real
Study/Protocol/Collection models vs. a cheaper reference-list
validation — not obviously the minimal-code path). RF003/RF005/RF010/
RF020/RF021 (Wave 2) and RF022/RF028 (red-first, own design pass)
remain untouched — not this session's scope. `dyeallpies-skills-pack`
issues from earlier sessions (`#134`, `#135`, `#122`–`#129`, and now
`#137`) are pack-repo items, not BioAvanceD-v2 blockers.

## Session note

No direct user corrections this session. Two things worth flagging:

1. Building the RF004 happy-path fixture required going three layers
   deep past the "just seed some data" premise: the fixture needed a
   consent template AND an active consent record (separate collections,
   separate mismatch in canonical names — see above) AND an operational
   location + sensor (sample creation validates against both, and
   neither is seeded by the test stack by default). Future sessions
   building real-backend fixtures for any RF touching `Sample.js`
   should expect this same location/sensor prerequisite.
2. The two backend bugs (movementId counter, specimenId lookup) were
   both instances of the same root-cause shape: code written against an
   older `mongodb` driver's API contract (`findOneAndUpdate` returning
   `{value: doc}`) or an incorrect assumption about what field a route
   parameter maps to. Neither had any existing test coverage catching
   them. Grepped the rest of the backend for other `findOneAndUpdate`
   callers as part of `wrap-up`'s audit and found a second instance —
   `MongoAuditRepository.generateMovementID` (undefined `.value.seq`,
   throws every call, unlike `SampleMovement.js`'s silent `|| 1`) — filed
   as **#296** rather than fixed here (outside #294's blocking path;
   also unclear whether that code path is even exercised, worth checking
   first).
