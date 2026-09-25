# HANDOFF

**Written 2026-09-25, sixty-sixth queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues. Docker is on."
The group was **#914**'s remaining RF014 policy wiring. Its live proof
surfaced **#1222**, **#1223**, **#1224** and **#1225**, and the audit filed
**#1226**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `98bbc6c1` (#1224).

## What shipped

- **#914**, still open. Two slices landed, and progress is recorded in its
  newest comment.
  - `2a19fb4a`: `session.maxSessionDurationHours` is an absolute cap.
    `refreshExpiresAt` is set once to `sessionStartedAt + cap`, and
    rotation may only shorten it. The key also joins #649's revocation
    list.
  - `0649ac48`: `authentication.requireMFA` now decides non-admin
    first-login enrolment. It fails closed to `true`. The same commit adds
    #1011's `MFA` audit row on a promotion that clears an enrolment.
- **#1223**, closed, `f340c443`. The RF015 escalation spec now targets a
  per-run role code, so it no longer depends on a fresh volume.
- **#1224**, closed, `98bbc6c1`. `validateBeforePersistence`'s Cypher was a
  syntax error, `SET` then `OPTIONAL MATCH` with no `WITH`, dating from
  2026-07-02. The new `tests/architecture/cypher-write-then-read.arch.test.js`
  guards every Cypher literal in `src/`.

Proof:
- Native backend suite 9,241/9,241 and architecture suite 157/157.
- Full e2e on a fresh-volume stack built from this branch: **254/254, 0
  skipped** on the final run. Two earlier runs each failed one test, which
  became #1222 and #1223.

## Open, touched this sitting

- **#914**. `enhancedSecurity.requireMFAForAll` is deliberately left
  unread. #1011's decision (Denise, 2026-09-25) keeps admin MFA optional
  until it is "revisited via config". The recommended default is in #914's
  newest comment. The remaining policy groups (`passwordRules`,
  `loginAttempts`, `logging`, `privacy`/`lgpd`) are untouched.
- **#1225**, new, not started. With #1224 fixed, the lineage consent gate
  runs and fails for nearly every app-created sample: 116 of 131 `Sample`
  nodes lack `GOVERNED_BY`. `[ran it]` Under production's
  `LINEAGE_MODE=fail-closed`, that refuses allocate, move and release. It
  may be #1220's key split; the cause is `[not established]`. #1026 was
  closed on Denise's branch, and that fix is not on ours.
- **#1222**. `intake-wizard.spec.ts:309` is intermittent: stuck on "Loading
  active consent..." after a 200. The body's process-age theory is refuted
  in its newest comment. The next step is `--repeat-each` with traces.
- **#1226**, a security record for `requireMFA=false` becoming effective.
  No action is needed unless someone objects.
- **#1220**, unchanged, and not blocked. Its body already gives the
  direction for steps 1-4 (`[inference]`, from #1219's pattern). Step 5's
  recommended default is permanent read-side tolerance, not a backfill:
  that is the route #1219 item 1 took for QuarantineAction, and there is
  no deployment whose old rows would need one (#362, #682). Dennis may
  overturn it. #1225 may depend on it.

## For Dennis

- #1220's step 5: accept or overturn the recommended default above
  (read-side tolerance). The rest of #1220 is workable without you.
- When #1011's admin-MFA revisit happens, `requireMFAForAll` is ready to
  wire (see #914).
- Still yours from before: #941 re-close (proof posted), #1218, #956, #979,
  whether `0d87f73b` (#1124's port) stands, whether to mirror Denise's
  `docs/mestrado/` and `docs/planning/bioavanced-v3/` deletions, and the go
  for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next
  `/clear`.
- **Nothing is running.** `bioavanced-fresh` was taken down with `-v`. Its
  24 images are **kept**, built from `98bbc6c1`, so a bring-up of the same
  code needs no `--build`. Any later src change needs `--build`. Port 8086
  was free this time.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Session policy is a snapshot at `createSession`.** `inactiveTimeout`
  comes from `timeoutMinutes`, and the absolute cap rides on
  `refreshExpiresAt`. `rotateSessionTokens` must never extend
  `refreshExpiresAt`. A new session-policy key that is snapshotted joins
  `SESSION_INVALIDATING_PATHS`.
- **Policy reads in the login/session path read `security_config`
  directly**, never through `securityService.getConfig`, which inserts a
  default document.
- **The e2e RF014 tests flip the global policy inside try/finally.** They
  rely on `workers: 1`.

## Standing context: re-measure, don't copy

- **The project phase (Dennis, 2026-09-25):** we are working down the issues
  the e2e plan surfaced (Wave 3 tracker #646). CI comes only after they are
  all resolved and the whole plan passes on Docker. The proof bar is our
  tests plus our Docker e2e on this branch.
- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-24
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 914 commits on hers only, 186 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state
  validation, Full Vitest diagnostic and Coverage diagnostic passed. Release
  manifest integrity failed
  (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis.
