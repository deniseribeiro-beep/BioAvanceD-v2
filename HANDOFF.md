# HANDOFF

**Written 2026-09-23, forty-second queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** The instruction was to read the
handoff and pick the next group, with Docker on and a parallel session sharing
the machine. The group was **the #1166 Docker gate, then #1104**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit is
`b1f28a19`.

## What shipped

- **#1166 CLOSED** ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1166#issuecomment-5803267089)):
  - The test stack was built from scratch at `0b383e24`, with the full bootstrap chain.
  - Full e2e suite: **223 passed, 0 failed, 0 skipped**, `--workers=1`.
  - That covers #1166 slice 4, #1168 and #1171.
- **#1104, `b1f28a19`**: `patientName` and `identityDocument` are now **ciphertext-only**. All three civil-identity fields are done.
  - `listPatients`' name filter is an **exact match** on a new `patientNameHash`: accents stripped, lowercased, whitespace collapsed. That was Dennis's call this sitting; no screen sent that filter.
  - The `identityDocument` `$or` query sites are hash-only.
  - New index `participant_identities_patient_name_hash_idx_v1`.

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
**redirected to a file**, because the unredirected result is about 18 KB.

- **#1104**: OPEN only for the **Docker e2e proof** of `interop-monitoring.spec.ts`, whose FHIR-commit assertion now reads the name through `POST /api/patients/:id/reidentify` ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1104#issuecomment-5803475856)). Close it when that spec runs green. The unit sweep, architecture suite and root `tsc` are green.
- #1103 (re-encryption tooling) now also covers rows written before `b1f28a19`, which keep their plaintext and have no `patientNameHash`.
- #1112, #682, #1163, #1159, #1162: unchanged.

## Docker and the machine

No containers are running. **RAM is the constraint:**
- After `compose down`, free RAM was 1.1 GB, with `vmmemWSL` still holding ~3 GB.
- Dennis warned mid-sitting.
- Tear the stack down as soon as a gate's result is in, and run native vitest with `--maxWorkers=1`, one file set at a time.
- `docker desktop stop` is Dennis's call, because a parallel session may be using the engine.

`[ran it]` Port 8086 was **not** reserved this time: the excluded ranges were `23761-24260`. So `INFLUXDB_HOST_PORT=18086` is no longer a standing requirement. Derive it from `netsh interface ipv4 show excludedportrange protocol=tcp` each time.

## Things a next session must not undo

Earlier notes' items still hold (`git log -p -- HANDOFF.md`). Plus:

- **Every field in `participantIdentity.service#getEncryptedFieldMap` is ciphertext-only.** A new reader decrypts, and a new query needs a blind index. A new encrypted field joins `getCiphertextOnlyFields` only once its readers decrypt.
- **The plaintext query arms exist only in the keyless-stack branch (#1083).** Don't re-add one beside a hash arm, because Mongo can't serve that `$or` from indexes.
- **The e2e suite must not read civil identity off a raw `participantIdentities` row.** Read it through the reidentify endpoint.

## Recommended next

**None queued by name.** Unverified: the natural step is a targeted Docker run of `interop-monitoring.spec.ts`, which closes #1104, once RAM allows. It needs a `--build`, because `b1f28a19` touched `api/backend/src`.
