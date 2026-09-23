# HANDOFF

**Written 2026-09-23, thirty-eighth queue sitting. INTERIM: Dennis gave no
end signal, so treat the session as CONTINUING.** His instruction was to read
the handoff, pick the next group, with Docker on and RAM tight. **The group
picked was #941's remainder, the six inert field-level index declarations.
#941 is now CLOSED.**

## Repo state

`feature/docker-e2e-backend-integration`, pushed. Two substantive commits:
`d413923d` (BUILD) and `c6f0f58d` (DELETE). This note rides alone as the
sitting's one `HANDOFF.md`-only commit.

## What shipped

- **`d413923d`**: `samples.specimenId` and `samples.participantId` lookup
  indexes BUILT in `ensureSampleIndexes`, via the shared `buildLookupIndex`.
- **`c6f0f58d`**: `Terminology.ativo`, `Terminology.codigo`, `Cid.active` and
  `StagingImport.status` declarations DELETED. Each one is pinned by a named
  test asserting its helper does NOT build it.
- **#941 closed** with the full table and the inventory boundary, in its last
  two comments. Every index-bearing declaration in `src/models/` now has a
  disposition. `Terminology.sistema` is the one exception, and #1164 owns it.

## Filed this sitting, all unstarted

- **#1164**: `$type: 'string'` partial unique indexes enforce uniqueness but
  can **never** serve an equality lookup. The four sites are
  `samples.barcode`, `terminologies {sistema,codigo}`, `containerID` and
  `macAddress`. The fix, `$gt: ''`, is `[ran it]` in a scratch mongo:7 only,
  not in the tree. It needs new index names plus a legacy-name drop.
- **#1165**: `patients_phone_unique_sanitized_v1` cannot be created (`$ne` is
  illegal in a partial filter, code 67). **Run a docs check before fixing:**
  whether phone uniqueness is even intended is `[not established]`.
- **Pack #1121**: `full-suite-guard`'s refusal prints 5.9 KB when its first
  paragraph has already diagnosed the case. It's a pack-repo item, not
  workable from here.

## Docker is NOT in the state the previous note described

**At the start of this sitting the engine had zero containers, zero volumes
and zero images.** The 14-service stack and its volumes are gone, so
something wiped them between sittings. The only change since then: a
`mongo:7` image pulled for a throwaway `--rm` container, now stopped. So:

- **Any gate needs a from-scratch build and bring-up**, plus the reference-
  data bootstrap chain, which has never run anyway.
- **RAM is the constraint.** 2.3 GB was free with the Docker VM idle at about
  3 GB, and 3.7 GB after the container stopped. `[not established]` whether
  the full 14-service stack fits right now. Ask Dennis before a bring-up.
- `INFLUXDB_HOST_PORT=18086` is still required on this machine.

## Things a next session must not undo

Items 12-25 from earlier notes still hold (`git log -p -- HANDOFF.md`). The
index-specific ones are summarized below:

- **A DELETED declaration is a measured decision, not an oversight.** Two
  of them are *harmful if built*: the planner picks `{ativo:1}` and
  `{active:1}` and examines more docs than a COLLSCAN does. `[ran it]` in
  this sitting. Don't re-add a field-level `index: true` without an
  `explain()` run.
- **A BUILT declaration keeps its `index: true` with a comment naming the
  native builder**, following the `StagingImport.jobId` precedent. Mongoose
  never builds it: autoIndex is false.
- Per-index try/catch; lookup-failure wording never borrows the duplicates
  wording; the route wiring tests use distinct `collectionName`s (items
  23-25).

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
redirected to a file.

- **#1163**: untouched this sitting. It's still a design call: where the
  ensure call for a read-serving index belongs.
- #1159 and #1162: still Dennis's.

## Recommended next

**None queued by name.** Unverified prescription: #1164 is the natural
follow-on. The fix is tested and it touches the helpers this sitting just
edited. Its test pins (four `$type` value assertions) are named in its body.
