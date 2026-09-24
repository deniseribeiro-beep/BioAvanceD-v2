# HANDOFF

**Written 2026-09-24, forty-eighth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** The instruction was "read handoff,
pick next group of issues, Docker is on". A parallel session is running too;
this is the main one. The sitting took the RF010 consent cluster, #827 → #821 →
#824, and closed all three.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit is
`ad543841`.

## What shipped (all CLOSED, each with a close comment)

- **#827, `4341761b`.** Every Consent now records `consentVersion` and the
  dict-02 evidence trio. The evidence is an encrypted JSON document stored
  through RF007's `objstore://` path by the new `consentEvidence.service.js`.
  It fails closed without `ENCRYPTION_KEY`.
- **#821, `e6511d7c`.** The bulk-token accept now records a Consent through
  `createPatientConsent`.
  - The request carries `consentTemplateId` + `responses`. A manifestation that
    cannot be recorded as sent gets its own 422 marker.
  - `ConsentTokenPage` has one checkbox per purpose.
  - The convergence question was settled from dict-07, not left to the owner.
- **#824, `ad543841`.**
  - The sweep is extracted into `notifyPendingConsentCohort`, and all three
    publish paths call it. The builder's toast shows the count.
  - Fixed inline on the same path: `ConsentTemplateModel.create` dropped
    `validFrom`/`validTo`, and a term created without a CAAE could never be
    revised.

New real-backend spec: `tcle-publication-sweep.spec.ts`.
`consent-token-page.spec.ts` now asserts the stored Consent. The last run of the
four consent specs was 18 of 18 green, with 0 skipped.

## Filed this sitting, and left open

- **#1181**, the #824 remainder: collapse `createPolicy` into `createTemplate`.
  One real defect sits inside it: a builder revision deactivates only its own
  lineage, so another lineage's term stays `active` and `getActiveTemplate`
  serves the newest. The design fork to settle first is a single active term
  against one active term per lineage. `[read it]`
- **#1180** is a security decision record for #821's widening of the
  unauthenticated accept route. It records why the 422 arm is not a #823
  oracle.
- The pack tracker got **#1139** (running `gh` with the cwd inside a skill
  junction answers for the pack repo), **#1140** (a Rule 0 guard false
  positive) and **#1144** (red-first skipped for a new helper module).
- Unchanged: **#1174** still awaits Dennis's (a)/(b) call, and **#1123** is
  untouched.

## Docker and the machine

**The test stack is UP.** All 12 services are healthy and `admin-bootstrap-test`
has run (Exited 0). `backend-app-test` and `frontend-app-test` were last rebuilt
from the `ad543841` tree. The reference-data bootstrap chain has NOT been run,
so this stack is not ready for a full-suite gate. Evidence files accumulate
under `/app/storage/consents/` in the backend container.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Run multi-file e2e locally with `--workers=1` until #1174 is decided.**
- **Consent e2e seeds need an 8-digit `participantId`.** Acceptance now goes
  through `validateParticipantId` (`/^\d{8}$/`). `[ran it]`
- **Run `gh` from the repo root, or pass `--repo`.** A `cd` into
  `.claude/skills/*` makes `gh` read the PACK's issues. `[ran it]` It returned
  CLOSED for two OPEN product issues (pack #1139).
- **Every `createPatientConsent` writes an evidence file**, so a unit test
  reaching it must stub `consentEvidence.storeConsentEvidence`. The unit env has
  no key. See the `beforeEach` in `consent.service.unit.test.js`.

## Recommended next

**None queued by name.** #1181 is the natural follow-on to this group, but
Dennis has not asked for it.
