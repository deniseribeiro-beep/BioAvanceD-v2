# HANDOFF

**Written 2026-09-23, thirty-ninth queue sitting. INTERIM: Dennis gave no
end signal, so treat the session as CONTINUING.** His instruction was to read
the handoff and pick the next group, with Docker on. **The group picked was
#1166** (participant `email`/`phone` in plaintext). Its consumer audit turned
up #1167 and #1169, both fixed and closed, and #1168, filed.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `a5f3ec84`. This is the sitting's **second** `HANDOFF.md`-only commit.
The first went stale when #1169 was worked after it.

## What shipped

- **`0a9b8770`**: `updatePatient`'s ParticipantIdentity sync now goes through
  `encryptIdentityFields`. Before, an edit put plaintext `birthDate` back,
  left the blind index on the old value, stored a punctuated CPF verbatim, and
  a cleared field came back via `decryptIdentity`. **#1167 closed.**
- **`ba9e9f19`**: slice 1 of #1166. `email`/`phone` are in the identity
  encrypted-field map, with a digits-only `phoneHash`, and `updatePatient`
  now mirrors contact edits to the identity copy. **Additive only: no privacy
  gain until slice 4.**
- **`a5f3ec84`**: the consent queue job carries only the ten fields the send
  path reads, so civil identity and the consent token no longer reach Redis.
  **#1169 closed.** Name and contact still travel in the job. Moving them
  out is now part of #1166 slice 2
  ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1166#issuecomment-5800843978)).

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
redirected to a file.

- **#1166**: OPEN on purpose. Closing on a precondition is #574's mistake.
  The consumer audit and the 4-slice plan are in the
  [audit comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1166#issuecomment-5800675130).
  Slice 1's status is in the
  [next comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1166#issuecomment-5800751357).
  **Slice 2 is next:** repoint `consent.controller.js:28`, `eConsent.js:80`,
  `resendConsentNotification` and `toClientPatient` onto `decryptIdentity`.
  Then slice 3 (a `phoneHash` unique index replaces #1165's `patients` index)
  and slice 4 (drop from `patients`, ciphertext-only).
- **#1168** (filed): the same mismatch for the four `representative*` fields
  (dict-02 P1X-0357..0360). Reuse whatever #1166 builds. Unstarted.
- **#1104**: unchanged. `identityDocument` waits on #1112, and `patientName`
  waits on a design call.
- #1163, #1159, #1162: still Dennis's.
- Pack **#1122** (filed): `branch-guard.cjs` misparses `git push -q; git …`.
  Until it's fixed, don't chain a command after a flagged push with `;`.

## Docker

No containers. One image, `mongo:7`, kept for `explain()` probes. Nothing
this sitting needed it: every check was native. Any gate still needs a
from-scratch build and bring-up. RAM is tight, so ask Dennis first.
`INFLUXDB_HOST_PORT=18086` is still required on this machine.

## Things a next session must not undo

Items 12-25 from earlier notes and the index rules from the last rotation
still hold (`git log -p -- HANDOFF.md`). Plus:

- **Every `participantIdentities` writer goes through `encryptIdentityFields`,
  and a writer that clears a field must also null its `*Encrypted`/`*Hash`
  siblings.** `[ran it]` otherwise `decryptIdentity` resurrects the old value
  (#1167's third test).
- **`email`/`phone` stay on `patients` until #1166 slice 4.** `updatePatient`
  mirrors them without stripping them, deliberately.

## Recommended next

**None queued by name.** Unverified prescription: #1166 slice 2,
including the queue-job change from #1169.
