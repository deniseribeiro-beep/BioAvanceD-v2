# HANDOFF

**Written 2026-09-23, forty-first queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** The instruction was to read the
handoff and pick the next group, with Docker on. The group was **#1166 slice 4,
then #1168**. #1171 was filed and worked along the way.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit is
`17f97c2d`.

## What shipped

- **#1166 slice 4** (`8621904e`, `9440610c`, `b57c9236`): a participant's
  email/phone now live on ParticipantIdentity only, **ciphertext-only**.
  - `PatientModel.create` validates them as input but no longer emits them.
  - `withIdentityContact` has no Patient fallback.
  - `patients_phone_unique_sanitized_v2` is dropped.
  - `updatePatient` checks phoneHash (`assertPhoneAvailable`) before its first write.
  - The backfill `moveParticipantContactToIdentity` is `[ran it]` against a real `mongo:7`, including a real E11000.
- **#1168** (`6b783425`, CLOSED): the four `representative*` fields made the same move.
  - This also fixed an `updatePatient` ordering bug: the patients-side encryption loop nulled the representative document before the deceased merge validated it.
  - **It keeps #1083's fail-closed refusal on a keyless stack at the raw input**, because the identity side degrades to plaintext by design.
- **#1171** (`17f97c2d`, CLOSED, filed this sitting): the FHIR commit records the contact on the identity row. The phone is left out, with a warning, when another participant holds its hash, because `commitBatch` has no per-record catch.

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
redirected to a file.

- **#1166**: OPEN only for the **Docker e2e proof**, `participant-e-consent-page.spec.ts`, whose seed now writes a ParticipantIdentity row ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1166#issuecomment-5801907216)). Close it when the end-loaded gate runs green. Held back per `docker-workflow`'s #429 rule: this is the only proof left, and it needs a from-scratch 12-service build.
- **#682**: gained a pre-deployment item: run `src/scripts/backfillParticipantIdentities.js` on any database with pre-`ba9e9f19` participants.
- **#1048** (closed): got a recurrence tally for two tests that hit the 5 s timeout in a 91-file run.
- Pack **#1123** (filed): a `Write`-authored patch script loses whitespace-only lines, and a multi-file script that asserts per edit half-applies.
- #1104, #1163, #1159, #1162: unchanged.

## Docker

No containers. A throwaway `mongo:7` on host port 27099 was used once and removed. The e2e gate still needs a from-scratch build and bring-up, and RAM is tight, so ask Dennis first. `INFLUXDB_HOST_PORT=18086` is still required on this machine.

## Things a next session must not undo

Earlier notes' items still hold (`git log -p -- HANDOFF.md`). Plus:

- **Contact and representative fields are written to ParticipantIdentity only**, through `encryptIdentityFields`. A Patient write that does not go through `PatientModel.create` strips them with `omitParticipantIdentityOnlyFields`.
- **Every identity-only field is ciphertext-only.** A new reader decrypts; a new query needs a blind index.
- **A new writer of `representativeIdentityDocument` asserts `assertFieldEncryptionConfigured` first** (#1083's posture).

## Recommended next

**None queued by name.** Unverified: the e2e gate (closes #1166) is the natural next step once Dennis okays the bring-up. After that, #1104 (the civil-identity ciphertext cutover) is the closest open sibling.
