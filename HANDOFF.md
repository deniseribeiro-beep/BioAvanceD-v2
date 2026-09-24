# HANDOFF

**Written 2026-09-24, fifty-third queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.**

The instruction was "Read handoff. Continue work." Docker was treated as
still on, carried from the previous sitting's INTERIM note (asked of the
pack as a rule gap, not settled). The work was the previous note's
recommended full gate, plus its two carried-forward "waiting on Dennis"
questions. **Both were settled from the docs, not by asking.**

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `182248ec` (#1195).

## What shipped

- **#1194**, `29e6b09c`: `usePolicies.getActiveLimit` is now a
  `useCallback`. The policies tab had been refetching every policy's active
  limit in an unbounded loop (82+ requests per policy per page load,
  `[ran it]` from a trace). That starved the tab's DELETE, which was the
  intermittent `temperature-policies-ui` failure in the first gate.
- **#1195**, `182248ec`: the policy form's `alertDelayMin` now lands on
  `minimumDuration` (dict-02 P1X-0110), the field `TelemetryMonitor`
  enforces. Before this, it was stored as a dead extension beside a
  hard-coded null, so no operator's value was ever enforced. The e2e spec
  reads the stored document from Mongo, and it was red against a pre-fix
  backend image.
- **Gates.** First full gate on `acc4078b`: 238 passed, 1 failed (#1194),
  0 skipped. Second, on `182248ec`: **239 passed, 0 failed,
  0 skipped** (`[ran it]`, `--workers=1`, full bootstrap chain).

## Touched, not closed

- **#1181**: answered from dict-02 (`versionGroupId`, per-template `caae`,
  `templateStatus: superseded`): **one active term per lineage**. The
  comment there lays out a three-step build, starting with stamping the
  invited lineage on the invitation, because every participant path uses
  the global `getActiveTemplate`. It is a build, not a question.
- **#1139**: Q2/Q3 answered in a comment. `alertDelayMin` is
  `minimumDuration` (done, #1195). `temperatureUnit` goes inside the UCUM
  `Quantity` limits. `targetTemp` stays as a declared extension plus a
  dictionary amendment request (#985 precedent). What remains is the
  mechanical retirement.
- **#1196** (filed, `question`): the form pre-fills 5 minutes, which is now
  a live excursion/quarantine threshold (it was 2 h global), and pre-#1195
  policies are not backfilled. The docs are silent on a default, and the
  ladder is recorded there. This is the one genuine product call from this
  sitting.
- #793, #1192, #1193 and #941: unchanged from the last note.

## Still waiting on Dennis

#1196's default. For the rest, query `gh issue list --state open --label
question` and read each issue's last comment. Walk the docs ladder first:
this sitting and the last one both found "Dennis's call" items that the
docs answered.

## Docker and the machine

The test stack is **down**, torn down at the end of the sitting after the
second gate. Volumes are kept, and the build cache is pruned.
`backend-app-test` and `frontend-app-test` images were built from
`182248ec`, so a bring-up without `--build` is current as long as no source
has changed since. Bring-up here needs `INFLUXDB_HOST_PORT=18086`, and a
host-side run needs `E2E_INFLUXDB_URL=http://localhost:18086`. Volumes carry
about 50 accumulated policies from earlier sittings.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Temperature policies:** the HTTP `alertDelayMin` is the stored
  `minimumDuration`. Never store `alertDelayMin` again, and never hard-code
  `minimumDuration: null` on a write path.
- **A hook function used in a component effect's deps must be stable**
  (`useCallback`). #1194's loop was invisible until #1178 made the list
  non-empty.

## Recommended next

**None queued by name.** The branch is gate-green only as of the second gate
above. Dennis's go is still needed for a PR into `main`.
