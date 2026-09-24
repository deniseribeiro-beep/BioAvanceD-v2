# HANDOFF

**Written 2026-09-24, fifty-second queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.**

The instruction was "read handoff, pick next group of issues, Docker is on,
the skills pack has ways to answer things that seem to need my input". The
group was the previous note's "waiting on Dennis" list. **Every item it
closed was settled from the docs or from repo precedent, not by asking.**
Walk that ladder before calling anything Dennis's.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `2ebe0f3a` (#1191).

## What shipped

- **#1174**, `84ce8b8a`: `playwright.config.ts` now sets `workers: 1`
  everywhere, with `--workers=N` as the override. The call was taken from
  precedent: CI already used 1, and so did the #403 gate.
- **#807**, `dbe22d52` + `49795446`: quarantined rows and the retained source
  file are encrypted at rest, per RNF020 AC#4 and RNF029 AC#5.
  `api/backend/src/utils/stagedRowCrypto.js` seals `row`/`normalized` into
  `sealedPayload`, and the readers reveal. With no key, the civil payload is
  withheld rather than written in plaintext.
- **#813**, `f5df9ddf`: the async importer now quarantines patient rows too,
  sealed.
- **#1191**, `2ebe0f3a`: FHIR staging is sealed through
  `sealedStagingCollection` (`row`/`normalized`/`fhir`/`consentTracking`).
  The e2e helpers now find and clean up staged records by batch.
- **#1184** closed by comment. dict-02 separates collection site (ELM-0128)
  from custodian (P1X-0103); the model change is **#1192**.
- `[ran it]` Real backend, images rebuilt from `2ebe0f3a`:
  `interop-monitoring`, `e-consent-import-page`, `lgpd-sample-import` and
  `async-import-quarantine` passed 44/44 with 0 skipped. **The full-suite
  gate was not run this sitting.**

## Touched, not closed

- **#793**: commented that rows staged before `dbe22d52`/`2ebe0f3a` stay
  plaintext until retention removes them. No backfill exists.
- **#1192** (filed): splitting `collectionSite` into site and owner needs a
  custodian chain the code lacks (see #1124). A build, not a gate change.
- **#1193** (filed): whether both row importers should exist. Docs walked
  (comment there). RF029 is channel-agnostic and holds each importer to the
  same criteria, so the only open question is whether to retire an
  operator-facing page, which is Denise's product call.
- **#941**: unchanged from the last note. Denise says it is resolved on her
  branches. Not ours to close without Dennis.

## Still waiting on Dennis

#1181's single-active-term call and #1139's Q2/Q3, carried forward and
**not re-checked against the docs this sitting**, so walk the ladder
before treating either as his. For the rest, query `gh issue list --state
open --label question` and read each issue's last comment.

## Docker and the machine

The test stack is **down**. Volumes are kept, and the images were built from
`2ebe0f3a`. On this machine, bring-up needs `INFLUXDB_HOST_PORT=18086`.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **`import_staging_records` is sealed at rest for every writer.** A new
  reader or writer goes through `revealStagedRecord`/`sealStagedRecord`, or
  through `sealedStagingCollection`. A query key on `normalized.*`, `row.*`,
  `fhir.*` or `consentTracking.*` matches nothing; filter on `batchId`,
  `status`, `rowNumber` or another top-level field.
- Read-time log anonymization is still the contract for every export of
  `logs`.

## Recommended next

**None queued by name.** The branch is gate-green only as of the previous
full gate. A full `--workers=1` gate on HEAD comes before Dennis's go on a PR
into `main`.
