# HANDOFF

**Written 2026-09-23, fortieth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** His instruction was to read the
handoff and pick the next group, with Docker on. **The group picked was #1166
slices 2 and 3.** Both shipped. The issue stays open for slice 4.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `714d0b5d`. This is the sitting's only `HANDOFF.md`-only commit.

## What shipped

- **`917ecc7b`**, slice 2 of #1166: every consent-path reader takes the
  participant's contact from the decrypted ParticipantIdentity record via
  `participantIdentityService.withIdentityContact`. The Patient copy is only
  a transition fallback. Five readers moved: the pending-consent list,
  `/generate-link`'s ownership check, resend, the publication sweep, and the
  queue worker. **The consent queue job now carries `participantId` only**,
  and the worker resolves name and contact at send time (`resolveConsentRecipient`).
  `toClientPatient` was deliberately NOT repointed, per #575's "never on
  Patient responses" posture
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1166#issuecomment-5801221393)).
- **`714d0b5d`**, slice 3: `participant_identities_phone_hash_unique_v1`
  (unique, partial `$gt: ''`, `[ran it]` on mongo:7). Also
  `insertIdentityOrRollbackPatient`, so none of the four Patient-then-identity
  insert pairs leaves an orphan Patient when the identity insert fails.
  **`patients_phone_unique_sanitized_v2` is kept until slice 4**
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1166#issuecomment-5801389084)).

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
redirected to a file.

- **#1166**: OPEN on purpose. **Slice 4's full checklist is in the slice 3
  comment linked above**, in order: backfill and parity (including stale
  identity contact from before `ba9e9f19`), stop writing `email`/`phone` on
  `patients` and remove the fallbacks, drop the `patients` phone index (which
  first needs an `updatePatient` phoneHash pre-check), then the frontend type
  and the e2e seed.
- **#1170** (filed): decision record for `/generate-link`'s case-insensitive
  email check against the identity record. Labelled `question`, and left open
  like the other decision records.
- **#1168**: representative fields, the same mismatch. Unstarted. Reuse
  `withIdentityContact` and the rollback helper.
- **#1104**, #1163, #1159, #1162: unchanged from the last note.
- Pack **#1122**: don't chain a command after a flagged `git push` with `;`.

## Docker

No containers. The `mongo:7` image is kept for `explain()` and index probes,
run as `docker run --rm` with `mongod --fork` and `mongosh` inside. It was
used once this sitting. The gates still need a from-scratch build and
bring-up, and RAM is tight, so ask Dennis first. `INFLUXDB_HOST_PORT=18086`
is still required on this machine.

## Things a next session must not undo

Earlier notes' items still hold (`git log -p -- HANDOFF.md`). Plus:

- **A participant's contact is read through `withIdentityContact`**, never
  straight off `patients`. `[ran it]` 6 tests pin this across the five readers.
- **A consent queue job carries nothing but `participantId`.**
- **Every Patient-then-identity insert goes through
  `insertIdentityOrRollbackPatient`.** A new writer must do the same.

## Recommended next

**None queued by name.** Unverified prescription: #1166 slice 4, then #1168.
