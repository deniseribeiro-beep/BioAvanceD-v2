# HANDOFF

**Written 2026-09-23, forty-fourth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** The instruction was to read the
handoff and pick the next group, with Docker on. The group was **#1173, then the
#1174 it spun off**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit is
`c8c72f96`.

## What shipped

- **#1173 CLOSED, `c8c72f96`**
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1173)):
  `tests/e2e/e-consent-import-page.spec.ts` has 6 tests. It seeds a
  `FHIR_BUNDLE` batch and a `PENDING_CONSENT` staging record, and mints the
  import-scope JWT with the new `mintImportConsentToken` in
  `helpers/consentJwt.ts`.
  - `[ran it]` 6 passed, 0 skipped.
  - A probe with the wrong secret turned exactly the 4 token-dependent tests red.

## Filed this sitting

- **#1174** (open, bug): under parallel workers, the consent-page specs race on
  the global "active consent template" singleton
  (`consent.service.js:639`, newest `createdAt` wins).
  - The sibling specs and the 10 specs using `seedParticipant.ts` all seed one.
  - `[ran it]` 1 failed / 18 passed on 3 of 3 multi-worker runs, and 19/19 with
    `--workers=1`.
  - Left **awaiting Dennis's direction**
    ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1174#issuecomment-5804273623)).
    The choice is (a) `workers: 1` unconditionally in `playwright.config.ts`
    (recommended) or (b) making 12 specs singleton-safe.
  - The gate is unaffected, because it already runs `--workers=1`.

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
redirected to a file. The table alone is about 18 KB.

- #1163, #1149 and #1145 are unchanged, and each still needs a design direction
  (see the previous note in `git log -p -- HANDOFF.md`).

## Docker and the machine

**The test stack is LEFT RUNNING.**
- The images were newer than the last `src` commits, so there was no rebuild.
- The twelve services are up, and `admin-bootstrap-test` exited 0 with `--no-deps`.
- `neo4j-projection-worker-test` was still `Up` after the bootstrap (#1130 check).
- The reference-data bootstrap chain was NOT run, so this stack is not ready for a full-suite gate.

Port 8086 was not excluded this time. Free RAM was 5.1 GB before the bring-up.
Tear the stack down at the sitting's end.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Run multi-file e2e locally with `--workers=1` until #1174 is decided.**
  Otherwise a consent-page failure reads as a regression.

## Recommended next

**None queued by name.** #1174 needs Dennis's (a)/(b) call first.
