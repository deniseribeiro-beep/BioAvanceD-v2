# HANDOFF

**Written:** 2026-08-19, same day as the prior two rotations. **Still
inside a rabbit hole** -- tracker **#642**. Only **#641** remains before
the hole can close. A session resuming this should pick up #641 directly
(not a fresh backlog pick), then check on #331 per Dennis's own
instruction.

## Rabbit-hole state (tracker #642)

Seeds: #641, #640, #586. Dennis's own instruction: at the end of the
hole, check on #331 (not a hole member -- a status check after exiting).

- **#640 -- closed.** `PatientIdentityService.js`'s
  `matchOrUpsertParticipant` wrote civil identity (patientName/
  birthDate/identityDocument) to `participantIdentities` in
  plaintext-only, skipping the `encryptIdentityFields()` call every
  other writer makes (#566). Fixed both the update and insert branches
  to route through it, same precedent as `import.service.js`'s
  `upsertPatient`. Reproduced first (2 new tests in
  `patient-identity.service.test.js`, confirmed failing pre-fix), then
  fixed. 40/40 targeted tests green post-merge. Fix commit `b0e1f553`,
  merge commit `ca7bc317` on `feature/docker-e2e-backend-integration`,
  pushed, issue closed with the hash.
  - Friction note: the merge (`git merge --no-ff`) was denied outright
    by the auto-mode permission classifier on first attempt; asked
    Dennis, he said retry, identical command succeeded second try. No
    new pattern beyond what `fix-bugs` already documents about
    classifier non-determinism on git writes.
- **#586 -- resolved as a case-5 deferral, left open.** Re-verified via
  grep across `api/backend/src` that `toFhirPatient` still has zero live
  callers (only `result-worker.js`/`import-async.service.js` require
  `fhir.service.js`, and both call `resultToFHIR`, not `toFhirPatient`).
  The issue's own premise still holds unchanged. Posted a fresh
  re-verification comment and left it open -- this is a forward-looking
  design guardrail for whoever eventually wires up FHIR patient export,
  not something with code to change today. No commit, no merge.
- **#641 -- not started, the only remaining hole member.** RF007 AC#6:
  build Assay/Dataset entities + generalize scientific-file linkage
  beyond specimenId. Large (the issue itself proposes 2 slices:
  models+minimal endpoints first, then a file-linkage routing-shape
  design decision -- new `/api/assays/:assayId/files` style routes vs.
  a generic `/api/files` endpoint). Full field scope (from
  dict-02_DICIONARIO.md) and existing-model-reuse notes (Study/Protocol
  already exist, no Assay/Dataset yet) are written up on the issue
  itself -- don't re-derive them.

**Budget note** (rabbit-hole's complexity-weighted pacing, ~10 points/
sitting): #640 spent ~2-3 points (medium), #586 spent ~1 point (small,
no code). #641 alone is estimated ~5 points (large) and will likely need
its own `divide-and-conquer` split once picked up (the issue proposes
the split itself) -- recheck budget after #641's first slice rather than
assuming the whole issue fits in what's left.

## After the hole closes

Once #641 is resolved (closed with code, or split via
`divide-and-conquer` with the remainder tracked under #642) and tracker
#642 is closed, **check on #331** (Wave 2 e2e integration tracker) per
Dennis's instruction -- read its current blocking list (#322-330) fresh,
report status, do not assume anything about it from a prior sitting.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `ca7bc317`.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
- No PR to `main` exists. Docker not brought up this sitting (native
  targeted tests only -- no infra change, no Docker-only behavior needed
  for #640 or #586).

## Recommended next steps

1. Resume the rabbit hole (tracker #642): pick up #641. Read the issue's
   own suggested-slice section before planning -- it already proposes
   the models-first / routing-design-second split.
2. After #641 closes (or its remainder is tracked), close tracker #642,
   then check on #331 per Dennis's explicit instruction before ending
   the rabbit-hole thread.
