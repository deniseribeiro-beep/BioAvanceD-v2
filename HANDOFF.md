# HANDOFF

**Written 2026-09-25, sixty-eighth queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues to resolve.
Docker is on." The group was four of the open Axis E AMEND implementation
vehicles, all with the direction already decided by Denise: **#1106, #1120,
#1162, #961**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `e063d98b` (#961).

## What shipped

- **#1120 and #1106**, closed, `1d32ed53`. Machine-ingest HTTP rejections
  now carry `payload.reason` on the existing global `auditRequest` row, not
  a second row. A controller sets `res.locals.auditReason` and the
  middleware copies it in. Tokens: `missing_sensor_id`,
  `invalid_temperature`, `unknown_sensor`, `unknown_organization`,
  `invalid_payload`. #1106's fail-open posture is now recorded as decided,
  at the catch in `iot.controller.js`. Its failure-kind split had already
  shipped in `7d9fa26b`.
- **#1162**, closed, `9d9599a0`. The generator writes
  `AUTH_RATE_LIMIT_RELAXED` and `CONSENT_RATE_LIMIT_RELAXED` blank (the
  `RELAX_OPT_INS` set in `sync_from_example`), on both the fresh and the
  `--upgrade` path. The e2e stack needs no change, since `compose.test.yml`
  is `NODE_ENV=test` and mounts no limiter.
- **#961**, closed, `e063d98b`. The CV PDF is untracked with `git rm
  --cached`, and history is not rewritten, per the decision. The root
  `.dockerignore` now excludes `api/backend/{uploads,storage,backups}`.

Proof: every slice ran targeted tests plus a stash-the-fix control (see each
close comment). Architecture 159/159, and `api/backend/scripts/lint.js`
clean (the old note said `scripts/lint.js`, but it lives under
`api/backend/`). **No e2e or Docker run this sitting.** None of the four
changes touches a flow the e2e suite drives, but that is `[inference]`,
unverified.

## Filed this sitting

- **#1230**: every rejected request writes a permanent chained audit row,
  and `globalLimiter`'s own 429s do too, because it mounts after
  `auditRequest` (`app.js:194` against `:244`). The 429 half is
  `[inference]` from mount order and was not probed. It has three remedies,
  none chosen, and no deployment exists.

## Still open from the Axis E batch (workable without asking)

Each decision comment supersedes its issue's body: #714, #830, #840, #883,
#1049, #1055. Unchanged from before: #1227, #1228, #1229, #914, #1225,
#1222, #1226, #1220.

## For Dennis

Unchanged from the previous note: #1228's default, #1220's step 5, the #941
re-close, #1218, #956, #979, whether `0d87f73b` (#1124) stands, whether to
mirror Denise's `docs/` deletions, and the go for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next
  `/clear`. It was not used this sitting.
- **Nothing is running** (`docker ps` is empty). The images kept from the
  previous sitting were built from `49b507ae` and predate this sitting's
  src change, so the next bring-up needs `--build`.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **A rejection's audit reason goes in `res.locals.auditReason`** (or
  `error.auditReason` at a throw site `createReading` catches), never a
  second audit row.
- **Machine ingest stays fail-open on an audit-write failure.** That is
  #1106's decision, and flipping it means reopening the decision.
- **A rate-limit relaxation is never inherited by the generator.** A new
  relax flag goes in `RELAX_OPT_INS`.
- **On this branch a `Closes #N` commit does not close the issue.** Comment,
  then `gh issue close`.

## Standing context: re-measure, don't copy

- **Project phase (Dennis, 2026-09-25):** work down the issues the e2e plan
  surfaced (Wave 3 tracker #646). CI comes only after they are all resolved
  and the whole plan passes on Docker.
- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-24
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 914 commits on hers only, 196 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state
  validation, Full Vitest diagnostic and Coverage diagnostic passed. Release
  manifest integrity failed
  (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her Axis E decision log `docs/stabilization/AXIS_E_DECISION_LOG.md` is
  still on no pushed branch as of 2026-09-25
  (`git ls-tree -r --name-only origin/stabilize/v2.0.0-prototype docs/stabilization`).

## Recommended next

None queued by Dennis.
