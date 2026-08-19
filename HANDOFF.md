# HANDOFF

**Written:** 2026-08-19, same day as the prior rotation. **Still inside
a rabbit hole** -- tracker **#642**, opened this sitting per the
`rabbit-hole` skill. A session resuming this should re-enter the hole
(pick the next open member from #642), not make a fresh backlog pick.

## Rabbit-hole state (tracker #642)

Seeds: #641, #640, #586. Dennis's own instruction: at the end of the
hole, check on #331 (not a hole member -- a status check after exiting).

- **#640 -- closed this sitting.** `PatientIdentityService.js`'s
  `matchOrUpsertParticipant` wrote civil identity (patientName/
  birthDate/identityDocument) to `participantIdentities` in
  plaintext-only, skipping the `encryptIdentityFields()` call every
  other writer makes (#566). Fixed both the update branch and the
  insert branch to route through it first, same precedent as
  `import.service.js`'s `upsertPatient`. Reproduced first (2 new tests
  in `patient-identity.service.test.js` asserting ciphertext/hash
  siblings land in the `$set`, confirmed failing pre-fix), then fixed.
  40/40 targeted tests green post-merge. Fix commit `b0e1f553`
  (branch `fix/640-participant-identity-encrypt-on-write`, deleted
  local+remote after merge), merge commit `ca7bc317` on
  `feature/docker-e2e-backend-integration`, pushed. Issue closed with
  the merge hash.
  - One friction note: the merge (`git merge --no-ff`) was denied
    outright by the auto-mode permission classifier on first attempt;
    asked Dennis, he said retry, identical command succeeded second
    try. No pattern beyond what `fix-bugs`'s own skill file already
    documents about classifier non-determinism on git writes.
- **#641 -- not started.** RF007 AC#6: build Assay/Dataset entities +
  generalize scientific-file linkage beyond specimenId. Large (the
  issue itself proposes 2 slices: models+minimal endpoints first, then
  a file-linkage routing-shape design decision -- new
  `/api/assays/:assayId/files` style routes vs. a generic `/api/files`
  endpoint). Full field scope (from dict-02_DICIONARIO.md) and existing-
  model-reuse notes (Study/Protocol already exist, no Assay/Dataset
  yet) are written up on the issue itself -- don't re-derive them.
- **#586 -- not started.** `toFhirPatient`'s future caller must gate
  identity resolution behind the reidentify authorization boundary.
  Confirmed this sitting (grep) that `toFhirPatient` still has zero
  callers anywhere in `api/backend/src` -- the issue's own premise ("no
  live caller today") still holds. Likely disposition: verify-and-leave-
  open (this is a forward-looking design note for whoever wires up FHIR
  export next, not actionable now) rather than a code change -- but that
  call hasn't been made yet, pick it up fresh.

**Budget note** (rabbit-hole's complexity-weighted pacing, ~10 points/
sitting): #640 spent ~2-3 points (medium, single-slice). #641 alone is
~5 points (large) and may split further via divide-and-conquer once
picked up -- budget should be rechecked after #641, not assumed to have
room left for both #641 and #586 in the same sitting without a check-in.

## After the hole closes

Once #641 and #586 are both resolved (closed with code, closed with no
code change, or left open per `resolve-issue` case 5) and tracker #642
is closed, **check on #331** (Wave 2 e2e integration tracker) per
Dennis's instruction -- read its current blocking list (#322-330) fresh,
report status, do not assume anything about it from a prior sitting.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `ca7bc317`.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
- No PR to `main` exists. Docker not brought up this sitting (native
  targeted tests only, per this fix's scope -- no infra change, no
  Docker-only behavior).

## Recommended next steps

1. Resume the rabbit hole (tracker #642): pick #641 or #586 next --
   #586 is smaller/cheaper (a verify-and-leave-open call) if the intent
   is to close hole members quickly; #641 is the larger build-shaped
   item and the one most likely to need its own divide-and-conquer split.
2. After both close, check on #331 per Dennis's explicit instruction
   before ending the rabbit-hole thread.
