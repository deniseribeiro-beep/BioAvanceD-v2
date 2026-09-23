# HANDOFF

**Written 2026-09-23, thirty-eighth queue sitting. INTERIM: Dennis gave no
end signal, so treat the session as CONTINUING.** His instruction was to read
the handoff, pick the next group, with Docker on and RAM tight. **The group
picked was #941's remainder. It grew into #1164 and #1165, and all three are
now CLOSED.**

## Repo state

`feature/docker-e2e-backend-integration`, pushed. This is the sitting's
**second** `HANDOFF.md`-only commit. The first rotation went stale when the
sitting kept working, and a note listing closed issues as unstarted is the
worse failure.

## What shipped

- **`d413923d`**: `samples.specimenId` and `samples.participantId` lookup
  indexes BUILT.
- **`c6f0f58d`**: `Terminology.ativo`, `Terminology.codigo`, `Cid.active` and
  `StagingImport.status` declarations DELETED, each one pinned as not built.
  **#941 closed.**
- **`9bb33aa6`**: the four `$type: 'string'` partial unique indexes
  (`samples.barcode`, `containerID`, `macAddress`, terminologies
  `{sistema,codigo}`) now filter on `$gt: ''`, under new versioned names. They
  enforced uniqueness but could never serve a lookup; now they do (COLLSCAN
  3000 → 1, `[ran it]` live). A shared `utils/legacyIndex.js` drops each
  superseded name, **only after the replacement builds**. **#1164 closed.**
- **`e6834e0f`**: `patients_phone_unique_sanitized_v2` with `{ phone: { $gt: '' } }`.
  v1's `$ne` filter could never be created (code 67), so phone uniqueness had
  never been enforced. The 409 "Telefone … já cadastrado" path is live now.
  **#1165 closed.**

## Filed this sitting and still open

- **#1166**: participant `email`/`phone` persist in **plaintext** on
  `patients`, while dict-02 places them only on `ParticipantIdentity`
  (protected, *Crítica*). It's a #575-sized consumer audit plus an atomic
  move. **I chose to stop on it this sitting.** Nothing blocks it, it just
  needs its own sitting. Its body lists what isn't established yet.
- **Pack #1121**: `full-suite-guard` prints 5.9 KB when its first paragraph
  already diagnosed the case. Workable only from the pack repo.

## Docker is NOT in the state the previous note described

**At the start of this sitting the engine had zero containers, zero volumes
and zero images**, so the 14-service stack is gone. Now: no containers, and
one image, `mongo:7` (1.18 GB), **kept on purpose** for `explain()` probes. A
throwaway `docker run --rm --memory 700m mongo:7 --wiredTigerCacheSizeGB 0.25`
is the cheap instrument this sitting used for every index decision.

- **Any gate needs a from-scratch build and bring-up**, plus the reference-
  data chain, which has never run.
- **RAM is the constraint:** 2.3-3.7 GB free during the sitting.
  `[not established]` whether the full stack fits. Ask Dennis first.
- `INFLUXDB_HOST_PORT=18086` is still required on this machine.

## Things a next session must not undo

Items 12-25 from earlier notes still hold (`git log -p -- HANDOFF.md`). Plus:

- **A DELETED index declaration is a measured decision.** `{ativo:1}` and
  `{active:1}` are *harmful if built*: the planner picks them and examines
  more docs than a COLLSCAN does. Never re-add an index without an
  `explain()` run.
- **Never use `$type` (or `$ne`) in a `partialFilterExpression`.** `$type`
  makes the index a constraint only, and `$ne` makes it unbuildable. For
  "non-empty string", use `$gt: ''`.
- **A changed partial filter needs a NEW index name, plus a drop of the old
  name AFTER the new one builds** (`dropLegacyIndex`). A failed build must
  keep the old constraint.
- Per-index try/catch; lookup-failure wording never borrows the duplicates
  wording; distinct `collectionName`s in latch tests.

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
redirected to a file.

- **#1163**: its read-path placement question gained a second concrete
  member this sitting. A plain `{sistema:1, codigo:1}` terminologies lookup
  is the measured winner for `GET /api/terminologies` (20,000 → 100 docs),
  per the [comment there](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1163#issuecomment-5800349025).
  It's blocked only on where the read-path ensure call goes, which is still
  Dennis's call.
- #1159 and #1162: still Dennis's.

## Recommended next

**None queued by name.** Unverified prescription: #1166 is the one open
issue this sitting filed and didn't work. Start with its consumer audit
(every reader of `patients.email`/`patients.phone`), which is what #575
needed first.
